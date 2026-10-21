# colabdraw-backend

The persistence layer for ColabDraw: encrypted scenes, share-link payloads and encrypted image bytes. It replaces the Appwrite Cloud project the app used before.

The browser talks to it with plain `fetch`. Payloads are already encrypted client-side with the room key, so the Worker only stores opaque strings and bytes. There is no authentication — the same trust model as before, where ids are unguessable and the data is ciphertext.

## Routes

| method | path | request | success | failure |
| --- | --- | --- | --- | --- |
| `GET` | `/scenes/:roomId` | — | `200 {roomId, sceneVersion, iv, ciphertext}` | `404 {error:"not_found"}` |
| `PUT` | `/scenes/:roomId` | `{roomId, sceneVersion, iv, ciphertext}` | `204` (upsert) | `400`, `413` |
| `GET` | `/share-links/:id` | — | `200 {ciphertext}` | `404` |
| `PUT` | `/share-links/:id` | `{ciphertext}` | `201` | `409` if the id exists, `400`, `413` |
| `GET` | `/files/:fileId` | — | `200` bytes, immutable cache | `404` |
| `PUT` | `/files/:fileId` | raw bytes | `204` (overwrite allowed) | `413` |

Ids must match `^[A-Za-z0-9._-]{1,128}$`; anything else is a `404` before D1 or R2 is touched. The client composes file ids as `<ownerId>_<fileId>` — room id or share-link id — so a share link never overwrites a room's bytes. JSON bodies are capped at 1.9 MB (D1's row limit is 2 MB), file bodies at 8 MiB. Every response carries `access-control-allow-origin: *`.

## Local development

`wrangler dev --local` works without a Cloudflare login, so use it for the local loop:

```bash
cd worker
npx wrangler d1 migrations apply DB --local   # once, and after adding a migration
npx wrangler dev --port 8787 --local
```

Point the app at it with `VITE_APP_BACKEND_URL=http://localhost:8787` (already the value in `.env.development`).

Unit tests stub D1 and R2 and run in the repo's Vitest project:

```bash
bunx vitest run worker/tests
```

The end-to-end script exercises every route against the running Worker, using real local D1 and R2:

```bash
node worker/tests/e2e.mjs                     # defaults to localhost:8787
node worker/tests/e2e.mjs https://host.example # or any deployment
```

Every id it writes carries a per-run suffix (`e2e-<runId>`), so it can be run repeatedly against the same database. It does not delete what it created; sweep the rows when they bother you:

```bash
npx wrangler d1 execute colabdraw --remote \
  --command "DELETE FROM scenes WHERE room_id LIKE 'e2e-%'; DELETE FROM share_links WHERE id LIKE 'e2e-%';"
```

Objects in R2 follow the same `e2e-` prefix. Wrangler cannot list a bucket, so delete them by key:

```bash
npx wrangler r2 object delete "colabdraw-files/<key>" --remote
```

## Deploying

Resource creation uses `cf` (the Cloudflare CLI), which is authenticated on this machine:

```bash
cf d1 create --name colabdraw          # copy database_id into wrangler.jsonc
cf r2 buckets create --name colabdraw-files
cf d1 migrations apply <database-id> --dir migrations
```

Deploying the Worker uses `wrangler` directly. `cf dev` and `cf deploy` refuse to run unless the project declares `wrangler` (or `@cloudflare/vite-plugin`) in its `package.json`, and adding that dependency to the repo for a Worker with no dependencies is not worth the install weight. `wrangler` is not logged in, but it accepts the OAuth token `cf` already stores:

```bash
$cfg = Get-Content "$env:APPDATA\xdg.config\cloudflare\config\default.json" -Raw | ConvertFrom-Json
$env:CLOUDFLARE_API_TOKEN = $cfg.oauth_token
cd worker && npx wrangler deploy
```

The stored token is short-lived (minutes), so run any cheap `cf` command immediately before reading it — that refreshes it.

An account needs a `workers.dev` subdomain before its first Worker can be published, and neither `cf` nor `wrangler` can register one. If `wrangler deploy` reports the subdomain is missing, register it once:

```bash
$h = @{ Authorization = "Bearer $((Get-Content "$env:APPDATA\xdg.config\cloudflare\config\default.json" -Raw | ConvertFrom-Json).oauth_token)" }
Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/subdomain" `
  -Headers $h -Method PUT -Body '{"subdomain":"<name>"}' -ContentType "application/json"
```

`workers_dev` defaults to `true`, so the Worker then publishes at `https://<worker-name>.<subdomain>.workers.dev`.

Finally set `VITE_APP_BACKEND_URL` to that URL in the Vercel project.

## Deployed instance

`https://colabdraw-backend.jyotimoydas.workers.dev` — D1 `colabdraw`, R2 `colabdraw-files`, both APAC. Verified with `node worker/tests/e2e.mjs https://colabdraw-backend.jyotimoydas.workers.dev` (15/15).

## What it costs

Free tier: 100k requests/day on Workers, 5 GB of D1 storage with 500 MB for a single database, 10 GB of R2 with no egress charge. With the 1.9 MB JSON cap, one database holds roughly 260 maximum-size scenes, which is well beyond what this app needs. Because the API is unauthenticated, anyone who finds the URL can write until those quotas are hit. If that becomes a problem, the cheapest mitigation is a Turnstile check on the `PUT` routes.

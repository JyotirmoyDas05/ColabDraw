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

Ids must match `^[A-Za-z0-9._-]{1,128}$`; anything else is a `404` before D1 or R2 is touched. JSON bodies are capped at 10 MiB, file bodies at 8 MiB. Every response carries `access-control-allow-origin: *`.

## Local development

`wrangler dev --local` works without a Cloudflare login, so use it for the local loop:

```bash
cd worker
npx wrangler d1 migrations apply DB --local   # once, and after adding a migration
npx wrangler dev --port 8787
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

Then set `VITE_APP_BACKEND_URL` to the Worker URL in the Vercel project.

## What it costs

Free tier: 100k requests/day on Workers, 5 GB of D1, 10 GB of R2 with no egress charge. Because the API is unauthenticated, anyone who finds the URL can write until those quotas are hit. If that becomes a problem, the cheapest mitigation is a Turnstile check on the `PUT` routes.

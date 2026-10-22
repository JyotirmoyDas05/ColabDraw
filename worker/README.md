# colabdraw-backend

The backend for ColabDraw: encrypted scene persistence, share links, encrypted files, realtime collaboration rooms via Cloudflare Durable Objects, and the Gemini trial proxy. It replaces both the legacy Appwrite Cloud project and the Render room server.

The browser talks to it with `fetch` for HTTP endpoints and native WebSockets for rooms. Payloads are encrypted client-side with the room key, so the Worker only relays and stores opaque ciphertexts.

## Routes

| method | path | request | success | failure |
| --- | --- | --- | --- | --- |
| `GET` | `/rooms/:roomId` | WebSocket upgrade (`Sec-WebSocket-Protocol: colabdraw-v1`) | `101 Switching Protocols` | `400`, `403`, `426` |
| `GET` | `/scenes/:roomId` | — | `200 {roomId, sceneVersion, iv, ciphertext}` | `404 {error:"not_found"}` |
| `PUT` | `/scenes/:roomId` | `{roomId, sceneVersion, iv, ciphertext}` | `204` (upsert) | `400`, `413` |
| `GET` | `/share-links/:id` | — | `200 {ciphertext}` | `404` |
| `PUT` | `/share-links/:id` | `{ciphertext}` | `201` | `409` if the id exists, `400`, `413` |
| `GET` | `/files/:fileId` | — | `200` bytes, immutable cache | `404` |
| `PUT` | `/files/:fileId` | raw bytes | `204` (overwrite allowed) | `413` |
| `GET` | `/ai/trial` | `x-device-id` header | `200 {used, remaining, max}` | `400` |
| `POST` | `/ai/trial/generate` | `x-device-id` header + JSON body | `200` (Gemini response) | `400`, `403`, `413`, `415`, `429`, `502` |

Ids must match `^[A-Za-z0-9._-]{1,128}$`; anything else is a `404` before D1 or R2 is touched. The client composes file ids as `<ownerId>_<fileId>` — room id or share-link id — so a share link never overwrites a room's bytes. JSON bodies are capped at 1.9 MB (D1's row limit is 2 MB), file bodies at 8 MiB. Every HTTP response carries CORS headers for configured origins.

### Realtime Rooms (Durable Objects)

WebSocket connections to `/rooms/:roomId` are handled by a `Room` Durable Object. Each room maintains WebSocket hibernation state, validates binary protocol opcodes (`collabdraw-v1`), enforces a 20-participant cap, a 128 KiB frame size limit, and relays encrypted scene updates and cursor ephemeral states.

### Gemini AI Trial Proxy

The `/ai/trial` routes proxy requests to Google's Gemini API with daily rate limits tracked in D1 (`trial_usage` table):

- Per-device limit: 15 requests / Pacific day
- Per-IP limit: 60 requests / Pacific day
- Global limit: 1000 requests / Pacific day
- Provision upstream API key via `wrangler secret put GEMINI_API_KEY`.

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
bun run test:worker
```

The end-to-end script exercises every route against the running Worker, using real local D1 and R2:

```bash
node worker/tests/e2e.mjs                     # defaults to localhost:8787
node worker/tests/e2e.mjs https://host.example # or any deployment
```

Every id it writes carries a per-run suffix (`e2e-<runId>`), so it can be run repeatedly against the same database. It does not delete what it created; sweep the rows when they bother you:

`bash\nnpx wrangler d1 execute colabdraw --remote \\\n --command "DELETE FROM scenes WHERE room_id LIKE 'e2e-%'; DELETE FROM share_links WHERE id LIKE 'e2e-%';"\n`

Objects in R2 follow the same `e2e-` prefix. Wrangler cannot list a bucket, so delete them by key:

```bash
npx wrangler r2 object delete "colabdraw-files/<key>" --remote
```

## Deploying

Resource creation uses `cf` (the Cloudflare CLI), which is authenticated on this machine:

```bash
cf d1 create --name colabdraw          # copy database_id into wrangler.jsonc
cf r2 buckets create --name colabdraw-files
cf d1 migrations apply colabdraw --remote --dir migrations
```

Set the Gemini API key secret:

```bash
cd worker && npx wrangler secret put GEMINI_API_KEY
```

Deploying the Worker uses `wrangler` directly:

```bash
$cfg = Get-Content "$env:APPDATA\xdg.config\cloudflare\config\default.json" -Raw | ConvertFrom-Json
$env:CLOUDFLARE_API_TOKEN = $cfg.oauth_token
cd worker && npx wrangler deploy
```

Finally set `VITE_APP_BACKEND_URL` to that URL in the Vercel project.

## Deployed instance

`https://colabdraw-backend.jyotimoydas.workers.dev` — D1 `colabdraw`, R2 `colabdraw-files`, Durable Objects `Room`, APAC.

## What it costs

Free tier: 100k requests/day on Workers, 5 GB of D1 storage with 500 MB for a single database, 10 GB of R2 with no egress charge.

# Cloudflare backend migration — design

Date: 2026-10-21 Status: awaiting review

## Context

The app stores three things on Appwrite Cloud: a `scenes` document per room, a `share-links` document per share link, and one file per image in the `collab-files` bucket. Nothing else touches the backend — the scene library is IndexedDB, realtime is our own socket.io server, and there is no auth.

The Appwrite project is frozen with `402 billing_limit_exceeded`. Per Appwrite's billing docs, exceeding the Free plan's bandwidth denies **all** API access until the billing cycle resets or the plan is upgraded, so this recurs every time traffic passes the limit. Storage is capped at ~2 GB and files are served through Appwrite, so every image view counts against bandwidth.

Cloudflare Workers + D1 + R2 removes both ceilings: 10 GB of R2 storage with no egress charge, 5 GB of D1, and no plan that expires.

## Goal

Move the three persistence paths to a Cloudflare Worker backed by D1 and R2, with no change to user-visible behaviour, and no data migration (existing rooms and share links are one-off and unused).

## Non-goals

- Authentication or per-user authorization (same trust model as today: ids are unguessable, payloads are encrypted client-side).
- Rate limiting. Documented as a known risk; anyone who finds the URL can write until the free quota is hit.
- Migrating existing Appwrite documents or files.
- Changes to the socket.io room server.
- Splitting dev and prod Cloudflare resources. One D1 database, one R2 bucket, local emulation for development.

## Architecture

```
browser (Vercel)
   │  fetch JSON / bytes, no credentials
   ▼
Worker  colabdraw-backend.<account>.workers.dev
   ├── D1   scenes, share_links
   └── R2   file id -> encrypted bytes
```

The Worker is a single `fetch` handler with a small router. No framework, no runtime dependencies, so `bun.lock` gains nothing.

### API

All JSON is UTF-8. Ids are validated against `^[A-Za-z0-9._-]{1,128}$`.

| method | path | request | success | failure |
| --- | --- | --- | --- | --- |
| `GET` | `/scenes/:roomId` | — | `200 {roomId, sceneVersion, iv, ciphertext}` | `404 {error:"not_found"}` |
| `PUT` | `/scenes/:roomId` | `{roomId, sceneVersion, iv, ciphertext}` | `204` (upsert) | `400`, `413` |
| `GET` | `/share-links/:id` | — | `200 {ciphertext}` | `404` |
| `PUT` | `/share-links/:id` | `{ciphertext}` | `201` | `409` if id exists, `400`, `413` |
| `GET` | `/files/:fileId` | — | `200` bytes, `content-type: application/octet-stream`, `cache-control: public, max-age=31536000, immutable`, `etag` | `404` |
| `PUT` | `/files/:fileId` | raw bytes | `204` (overwrite allowed) | `413` |

`OPTIONS` on any path returns `204` with CORS headers.

CORS: `access-control-allow-origin: *`, methods `GET, PUT, OPTIONS`, headers `content-type`, `max-age: 86400`. No credentials are ever sent, so `*` is safe.

Limits: JSON bodies ≤ 10 MiB, file bodies ≤ 8 MiB (the client caps uploads at 4 MiB before encryption). Exceeding either returns `413`.

### Data model

```sql
CREATE TABLE scenes (
  room_id       TEXT PRIMARY KEY,
  scene_version INTEGER NOT NULL,
  iv            TEXT NOT NULL,
  ciphertext    TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE share_links (
  id         TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

R2 object key is the Excalidraw file id. Ids are derived from file content, so `PUT` overwriting an existing key is idempotent and matches the current "409 means already saved" behaviour.

### Client changes

| before | after |
| --- | --- |
| `data/appwrite.ts` | `data/backend.ts` |
| `saveToAppwrite` / `loadFromAppwrite` | `saveToBackend` / `loadFromBackend` |
| `saveFilesToAppwrite` / `loadFilesFromAppwrite` | `saveFilesToBackend` / `loadFilesFromBackend` |
| `isSavedToAppwrite` | `isSavedToBackend` |
| `_getDatabase()` + raw `getDocument`/`createDocument` in `data/index.ts` | `readShareLink(id)` / `createShareLink(id, ciphertext)` |
| 6 `VITE_APP_APPWRITE_*` env vars | `VITE_APP_BACKEND_URL` |
| `appwrite` dependency | removed |

`saveToBackend` simplifies: fetch the stored scene (ignore 404), reconcile if one exists, then a single `PUT`. The current code branches on a 404 from `getDocument` and calls `createDocument`/`updateDocument`; the upsert makes that branch disappear.

Untouched: `AppwriteSceneVersionCache` logic (renamed), the encryption and reconcile flow, `encodeFilesForUpload`, `FILE_UPLOAD_MAX_BYTES`, and every call site's behaviour.

### Error handling

- `loadFromBackend`: `404` → `null`, matching today's "no stored scene".
- `loadFilesFromBackend`: non-2xx or network error → that file id goes into `erroredFiles`, matching today.
- `exportToBackend` / `describeShareLinkError`: map `413` to the existing "too big" message, `402`/billing wording disappears, everything else falls through to the generic message. A `fetch` rejection surfaces as the generic message plus a console error.
- The Worker never leaks SQL errors; unexpected failures return `500 {error:"internal"}` and log via `console.error` (visible in `cf` logs).

## Testing

1. **Worker unit tests** (`worker/tests/api.test.ts`, root vitest): a stub `DB` that records the SQL and bindings it receives plus an in-memory `FILES` map. Covers: each route's success path, 404s, id validation, body-size rejection, `OPTIONS`/CORS headers, and that `PUT /scenes/:id` issues an upsert.
2. **Local end-to-end**: `cf dev` (falls back to the Workers dev server) with local D1 + R2, then a Node script exercising all six routes against `http://localhost:8787` — write, read back, overwrite, 404 for unknown ids, binary round-trip, CORS preflight.
3. **App tests**: `bun run test:app` stays green; the `data/appwrite` mock in `ColabDraw-app/tests/collab.test.tsx` is repointed at `data/backend`.
4. **Manual**: two browser tabs on one room with an image, reload one tab, confirm the scene and image come back; create a share link, open it in a fresh profile.

## Deployment (via `cf`)

```
cf d1 create colabdraw                                  # capture database_id
cf r2 buckets create colabdraw-files
cf d1 migrations apply colabdraw --remote
cd worker && cf deploy
```

Then in Vercel: set `VITE_APP_BACKEND_URL` to the Worker URL, delete the six `VITE_APP_APPWRITE_*` vars, redeploy.

Rollback: revert the app commit and redeploy Vercel. The Worker, D1 and R2 stay in place, unused, costing nothing.

## Risks

- **Public write surface.** Anyone with the Worker URL can create documents and objects. This is the same exposure as the current public Appwrite collections, and the free quotas (100k requests/day, 5 GB D1, 10 GB R2) bound the damage. If it becomes a problem, the cheapest fix is a Turnstile check on `PUT`.
- **Worker free tier is 10 ms CPU per request.** Our handlers are a single D1 query or an R2 get/put, well inside that.
- **`.workers.dev` URL is not a custom domain.** Fine for this app; a custom domain can be attached later without code changes.

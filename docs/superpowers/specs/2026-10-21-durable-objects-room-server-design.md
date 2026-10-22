# Durable Objects room server — design

Date: 2026-10-21 Status: awaiting review

## Context

Realtime collaboration runs on `ColabDraw-room/`, a socket.io server hosted on Render's free tier. Free Render services spin down when idle and take minutes to come back, so the first person to open a room link often waits in front of a spinner — the single worst moment in the product, at the exact moment a shared link is being tried.

The same package also proxies the free Gemini trial (`/api/ai/trial/*`) with an in-memory usage counter that resets on every restart.

Cloudflare Durable Objects remove the cold start structurally: an object holds each room's WebSocket connections, hibernates when the room is empty, and wakes in milliseconds. Durable Objects are available on the Workers Free plan (SQLite-backed classes only), and an idle hibernated room incurs no duration charge.

The catch is that socket.io cannot run on Workers — it needs a Node HTTP server for its handshake, polling fallback and room semantics. The room protocol has to be rewritten against native WebSockets, which means the client's transport changes too.

## Goal

Replace the Render room server with a Durable Object inside the existing `colabdraw-backend` Worker, preserving every collaboration behaviour the app has today, so that:

- opening a room link never waits on a cold start;
- there is one deployed service, one URL and one environment variable;
- the Gemini trial proxy and its usage counters move with it.

## Non-goals

- Authentication. Same trust model as today: room ids are unguessable and payloads are encrypted client-side; the server never sees plaintext.
- A long-polling fallback for networks that block WebSockets. Degraded mode is made visible instead (see "Blocked network").
- Backwards compatibility with the socket.io protocol. Client and server ship together; rooms are throwaway.
- Room state persistence. Scenes live in D1; the Durable Object stores no scene data, only per-connection attachments.
- Changing the encryption model, the scene format, or the save path.

## Architecture

```
browser (Vercel)
   │  wss://…/rooms/<roomId>            fetch /scenes /share-links /files /ai/trial
   ▼
Worker  colabdraw-backend.jyotimoydas.workers.dev
   ├── Room Durable Object   one per room, holds WebSockets only
   ├── D1                    scenes, share_links, trial_usage
   └── R2                    encrypted file bytes
```

The Worker routes `GET /rooms/:roomId` with `Upgrade: websocket` to `env.ROOMS.getByName(roomId)`. Everything else keeps its current route. The upgrade response is returned untouched — it is a `101` carrying a `webSocket` property, so it must not pass through the CORS header wrapper.

The object lives in `worker/src/room.ts` and is re-exported from `worker/src/index.ts`, because a Durable Object class must be exported from the Worker's entry module.

### Bindings

`worker/wrangler.jsonc` gains:

```jsonc
"durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "Room" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }],
"vars": {
  "GEMINI_MODELS": "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
  "AI_TRIAL_PER_DEVICE": "20",
  "AI_TRIAL_PER_IP": "40",
  "AI_TRIAL_GLOBAL": "400"
}
```

`GEMINI_API_KEY`, `AI_TRIAL_PER_DEVICE`, `AI_TRIAL_PER_IP`, `AI_TRIAL_GLOBAL` follow the existing conventions: the key is a secret (`wrangler secret put`), the limits are plain vars with the current defaults (20 / 40 / 400).

## Wire protocol

The room is in the URL. The Worker rejects upgrades whose `Origin` is not the production domain, a `*.vercel.app` preview, or `localhost:3000`; it also rejects ids failing `^[A-Za-z0-9_-]{1,128}$` and non-upgrade GETs (`426`).

Two frame kinds:

- **Text frame** — JSON control message `{"t": "…", …}`. Rare, small, readable in devtools.
- **Binary frame** — scene payload `[1 byte opcode][12 byte IV][ciphertext]`. The IV length is fixed (`IV_LENGTH_BYTES = 12`), so the frame needs no length field. Keeping payloads binary avoids base64's 33% tax on every cursor move and every scene sync.

Opcodes: `1` scene update, `2` volatile update, `3` volatile update to the sender's followers only.

Opcode 3 exists because `broadcastVisibleSceneBounds` currently publishes into the `follow@<socketId>` room so only followers receive viewport bounds. The payload is encrypted, so the server cannot infer the intent — the client states it in the opcode.

### Client → server

| message | meaning |
| --- | --- |
| `{"t":"join","clientId":"<uuid>"}` | attach this socket to the room under `clientId` |
| `{"t":"view-only"}` | this socket may not broadcast |
| `{"t":"follow","target":"<id>"}` / `{"t":"unfollow","target":"<id>"}` | subscribe to that user's viewport bounds |
| `{"t":"ping"}` | heartbeat, answered with `pong` |
| binary op `1` / `2` / `3` | scene update / volatile update / followers-only update |

### Server → client

| message | replaces |
| --- | --- |
| `{"t":"joined","first":bool,"members":["<id>",…]}` | `first-in-room` + the initial `room-user-change` |
| `{"t":"members","ids":[…]}` | `room-user-change` |
| `{"t":"new-user","id":"<id>"}` | `new-user` — existing members answer with a `SCENE_INIT` |
| `{"t":"followers","ids":[…]}` | `user-follow-room-change` |
| `{"t":"unfollowed"}` | `broadcast-unfollow` |
| `{"t":"pong"}` | heartbeat reply |
| binary op `1` / `2` | `client-broadcast` |

There is no `init-room` round trip: socket.io needed a server-issued id before the client could join, but the client now generates its own, so `join` is the first frame on open.

### Identity

`clientId` is a per-tab `crypto.randomUUID()`, kept for the tab's lifetime and reused across reconnects. Today the server assigns ids, so a reconnect produces a new id and anyone following that user silently stops receiving viewport bounds. Client-generated identity removes that failure.

If a `join` arrives for an id that is already attached, the newer socket wins and the older one is closed with code `4001` (`replaced`) — that is the reconnect race, not an error.

## Room semantics

Membership and follower edges are **derived on every message** by walking `state.getWebSockets()` and reading each socket's attachment, rather than cached in memory. A room holds a handful of people, so the cost is trivial, and it means a Durable Object woken from hibernation cannot serve a stale map. Nothing is written to DO storage.

Per-socket attachment: `{ id, viewOnly, following }`, written with `serializeAttachment` whenever it changes.

| event | behaviour |
| --- | --- |
| `join` | register attachment; reply `joined` with `first: true` when this is the only socket, otherwise broadcast `new-user` to the others and reply `joined` with `first: false`; then broadcast `members` to every socket, the joiner included |
| `view-only` | set the flag; later binary frames from this socket are dropped |
| binary frame | dropped if `viewOnly`; op 1/2 go to every other socket, op 3 only to sockets whose `following` equals the sender, forwarded as op 2 because the receiver handles it exactly like a volatile update |
| `follow` | set `following`; send `followers` to the target |
| `unfollow` | clear `following`; send `followers` to the target, or `unfollowed` if the list is now empty |
| close | clear the socket; broadcast `members`; if it was a target, send `unfollowed` to each of its followers and clear their `following`; if it was a follower and its target now has none, send `unfollowed` to the target |

View-only remains enforcement, not secrecy: the client holds the decryption key, so this stops edits from a read-only tab, not a hostile one. Same caveat as today.

Heartbeat: the client sends `ping` when it has sent nothing for 25 s and reconnects if no `pong` arrives within 10 s. socket.io provided this transparently (engine.io ping/pong); raw WebSockets do not, and half-open connections from sleeping laptops would otherwise leave ghost collaborators in a room.

Limits: inbound frames over 4 MiB are rejected by closing with `1009`. The platform allows 32 MiB inbound, and D1 caps a stored scene at 1.9 MB, so 4 MiB comfortably holds a full `SCENE_INIT`.

A Durable Object has a soft limit of ~1,000 requests/second, and WebSocket messages are billed at 1/20 of a request. A busy multiple-person room is far below both.

## Client

### `CollabSocket` — new, `ColabDraw-app/collab/CollabSocket.ts`

A transport with no Excalidraw knowledge:

```ts
type CollabSocketEvents = {
  joined: (payload: { first: boolean; members: string[] }) => void;
  members: (ids: string[]) => void;
  newUser: (id: string) => void;
  followers: (ids: string[]) => void;
  unfollowed: () => void;
  scene: (payload: { opcode: 1 | 2; iv: Uint8Array; data: Uint8Array }) => void;
  status: (status: "connecting" | "open" | "unavailable") => void;
};

class CollabSocket {
  readonly id: string; // crypto.randomUUID()
  connect(): void; // opens, reconnects with backoff
  close(): void;
  sendUpdate(
    data: Uint8Array,
    opts?: { volatile?: boolean; followersOnly?: boolean },
  ): void;
  on<K extends keyof CollabSocketEvents>(
    event: K,
    handler: CollabSocketEvents[K],
  ): void;
  off<K extends keyof CollabSocketEvents>(
    event: K,
    handler: CollabSocketEvents[K],
  ): void;
}
```

Backoff: 1 s, 2 s, 4 s, 8 s, capped at 15 s, ±25% jitter, reset on a successful open. `status: "unavailable"` fires after three consecutive failed opens.

### `Portal.tsx`

Keeps the room logic; only the transport calls change:

- `open(socket, roomId, roomKey, isViewOnly)` stores the socket and calls `connect()`; it no longer waits for `init-room`.
- `_broadcastSocketData` encrypts and calls `sendUpdate(bytes, { volatile, followersOnly })`.
- `broadcastVisibleSceneBounds` passes `followersOnly: true`.
- `new-user` → `broadcastScene(INIT, syncAll = true)`, as today.
- `close()` calls `socket.close()`.

### `Collab.tsx`

- Constructs `new CollabSocket(BACKEND_WS_URL, roomId)` instead of `socketIOClient(…)`; the lazy `socket.io-client` chunk disappears.
- Listeners renamed: `first-in-room` → `joined`, `client-broadcast` → `scene`, `user-follow-room-change` → `followers`, and `connect_error` → `status`.
- `SceneVersionCache` keeps its shape; the `WeakMap` key type becomes `CollabSocket`.

### Reconnect is a non-destructive resync

On reopen: re-send `join` with the same `clientId`, re-send `view-only` when viewing, and set `socketInitialized = false` so an incoming `SCENE_INIT` is applied instead of ignored.

- `joined` with `first: true` (alone in the room) sets `socketInitialized` straight back to true and **keeps the local elements**. A reconnect must never call `resetScene`, or edits made while disconnected are lost.
- `joined` with `first: false` leaves initialization to the peers' `SCENE_INIT`, which flows through the existing `_reconcileElements` path.

`INITIAL_SCENE_UPDATE_TIMEOUT` still covers a silent room, and the existing periodic full-scene rebroadcast stays as the second net. Today a reconnect shows the newcomer as a new user and their `SCENE_INIT` is ignored because initialization already happened — the drift this rule removes.

### Blocked network

Three consecutive failed opens put the session in degraded mode: the existing fallback loads the scene from D1, and a persistent pill appears near the collaborators row — _"Live sync unavailable on this network — your changes are still saved."_ Editing keeps working, and `queueSaveToBackend` persists because the fallback path sets `socketInitialized`. The pill clears on the next successful open.

## AI trial proxy

Two routes join the Worker router, replacing the Express handlers:

| method | path | success | failure |
| --- | --- | --- | --- |
| `GET` | `/ai/trial?deviceId=…` | `200 {enabled, remaining, limit}` | `400 invalid_device_id` |
| `POST` | `/ai/trial/generate` | `200 {response, remaining, limit}` | `400`, `413`, `415`, `429 trial_exhausted\|trial_busy`, `502 upstream_error`, `503 trial_disabled` |

Behaviour is unchanged: text-only (media rejected with `415`), request JSON ≤ 40,000 characters, model fallback on `503`/`500`, 20 s stall timeout, usage refunded when upstream fails, limits reset at midnight Pacific.

Counters cannot live in Worker memory: a Worker runs many isolates, so per-isolate maps would each count from zero. They move to D1:

```sql
CREATE TABLE trial_usage (
  day   TEXT NOT NULL,
  key   TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
```

Keys are `device:<id>`, `ip:<ip>` (from `CF-Connecting-IP`) and `global`. Each generate does one `SELECT` for the three keys and, on success, three upserts; failures decrement. Rows older than two days are pruned on the first request of a new day, so stored IPs do not accumulate.

Client: `aiClient.ts` points `TRIAL_URL` at `${BACKEND_URL}/ai/trial`, so `VITE_APP_WS_SERVER_URL` has no remaining consumer.

## Error handling

| condition | behaviour |
| --- | --- |
| upgrade without `Upgrade: websocket` | `426`, JSON body |
| disallowed `Origin` | `403` |
| malformed room id | `404` |
| malformed control frame | frame ignored, socket stays open |
| frame > 4 MiB | close `1009` |
| duplicate `clientId` | older socket closed `4001`, newer kept |
| Durable Object evicted mid-room | hibernation preserves sockets and attachments; state is re-derived on the next message |
| AI upstream `429` | refund usage, `429 trial_busy` |

## Testing

1. **Unit (existing jsdom setup)** — `CollabSocket` frame encoding/decoding, backoff schedule and `unavailable` transition against a fake `WebSocket`; `Portal` routing of `new-user`/`followers`; trial-limit accounting against the existing fake-D1 pattern.
2. **Durable Object under workerd** — new `worker/vitest.config.ts` using `@cloudflare/vitest-pool-workers`, so the room is exercised with the real hibernation and WebSocket APIs: two clients, first-in-room, `new-user` → `SCENE_INIT`, fan-out, viewer frame dropped, follow/unfollow, opcode 3 restricted to followers, disconnect cleanup.
3. **Production smoke** — two tabs on one room (draw, add an image, reload both) and a share link in a private window; then confirm the room still works after an idle period of more than ten minutes, which is the cold-start regression this change exists to fix.

## Rollout and cleanup

- Work happens on `feat/durable-objects-rooms`, branched from `feat/cloudflare-backend` and merged into it; PR #13 and #14 land together, so production switches to Cloudflare once.
- Render stays running until the production smoke test passes. It is deleted afterwards by the account owner, not by this change.
- Deletions: `ColabDraw-room/`, the `dev:collab` script and `@types/socket.io-client`, `socket.io-client` from the app, the `.eslintignore` and `tsconfig.json` entries, and the socket.io mock in `collab.test.tsx`.
- `vercel.json`: drop `https://colabdraw.onrender.com` from the `Access-Control-Allow-Origin` header value. There is no CSP `connect-src` in this project, so no `wss://` entry is needed.
- `VITE_APP_WS_SERVER_URL` is removed from `.env.development.example`, `.env.production.example`, `ColabDraw-app/vite-env.d.ts` and the Vercel project. The declaration in `packages/ColabDraw/vite-env.d.ts` stays: it is the vendored library's own env surface and nothing in the package reads it.
- `GEMINI_API_KEY` is set with `wrangler secret put`; D1 migration `0002_trial_usage.sql` is applied to the remote database.

## Risks

- **`@cloudflare/vitest-pool-workers` version coupling.** It tracks a specific vitest major; if the installed vitest is unsupported, the fallback is unit tests against a fake `DurableObjectState` plus the production smoke test. Decided while writing the plan, not mid-implementation.
- **Free-plan request quota.** 100k requests/day, WebSocket messages at 1/20. Heartbeats make an idle tab cost ~6,900 raw messages/day (~345 billed). Hundreds of simultaneously open tabs would approach the ceiling; the failure mode is `1027` errors for everyone, so it is worth watching the first week.
- **No polling fallback.** Users behind WebSocket-blocking networks lose live sync; they now see a notice instead of silence.
- **Runtime updates.** Cloudflare drains connections during runtime updates with up to 20 minutes' grace; long-lived sockets will occasionally reconnect, which the resync rule above handles.

## Out of scope

- Rate limiting or abuse protection on the room or trial endpoints.
- Persisting presence, cursors or follow state across sessions.
- Moving the app off Vercel.
- Any change to `/scenes`, `/share-links` or `/files`.

# Durable Objects room server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Render-hosted socket.io room server with a Durable Object inside the existing `colabdraw-backend` Worker, and move the Gemini trial proxy with it.

**Architecture:** One Durable Object per room (`ROOMS.getByName(roomId)`) accepts a native WebSocket and relays frames between its sockets: JSON text frames for control messages, binary frames for encrypted scene payloads. Membership and follow edges are derived from per-socket attachments on every message, so nothing is written to DO storage and an idle room costs nothing. The client gains a small `CollabSocket` transport that replaces `socket.io-client`.

**Tech Stack:** Cloudflare Workers + Durable Objects (SQLite-backed, free plan), D1, TypeScript, vitest 3.0.6, `@cloudflare/vitest-pool-workers@0.12.0`.

**Spec:** `docs/superpowers/specs/2026-10-21-durable-objects-room-server-design.md`

## Global Constraints

- The Worker gets **no new runtime dependencies**. `@cloudflare/vitest-pool-workers` is dev-only, like `@cloudflare/workers-types`.
- Free-plan feature set only: SQLite-backed Durable Object classes (`new_sqlite_classes`), no key-value-backed namespace.
- No authentication and no rate limiting, matching today's trust model.
- Room ids match `^[A-Za-z0-9_-]{1,128}$`; API ids keep `^[A-Za-z0-9._-]{1,128}$`; client ids match `^[A-Za-z0-9-]{8,64}$`.
- The existing API contract is untouched: `/scenes`, `/share-links`, `/files`, CORS `*`, 1.9 MB JSON cap, 8 MiB file cap.
- Inbound WebSocket frames over 4 MiB are rejected; `IV_LENGTH_BYTES` is 12 and frames carry `[opcode][iv][ciphertext]`.
- `worker/tsconfig.json` is the only type gate for Worker code; the root `tsc` excludes `worker/`.
- ESLint runs with `@typescript-eslint/consistent-type-imports` as an error; run `bunx eslint --fix` before committing.
- New DOM/browser API usage derives `ownerDocument`/`ownerWindow` from the mounted node rather than globals.

## Review Focus

1. A socket that connects but never sends `join` (tab killed early, a probe) — must be absent from presence, and closing it must leave the room relaying traffic.
2. A `join` with a missing or non-string `clientId` — must be ignored without closing the socket and without throwing.
3. A room id outside the allowlist (`bad!id`, or 200 characters) — must `404` without creating a Durable Object.
4. Binary frames at the size boundary — exactly 4 MiB relays, one byte over closes with `1009`.
5. The last participant leaving, then someone rejoining — `joined.first` must be `true` and no stale member id may survive.

---

### Task 1: Upgrade route, Durable Object skeleton, and the `join` handshake

**Files:**

- Create: `worker/vitest.config.ts`
- Create: `worker/src/protocol.ts`
- Create: `worker/src/room.ts`
- Create: `worker/tests/room.worker.test.ts`
- Modify: `worker/wrangler.jsonc`
- Modify: `worker/src/types.ts`
- Modify: `worker/src/index.ts`
- Modify: `vitest.config.mts`
- Modify: `package.json`
- Modify: `.github/workflows/test-coverage-pr.yml`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `class Room` exported from `worker/src/index.ts`; `Env.ROOMS: DurableObjectNamespace`; wire message `{"t":"joined","first":boolean,"members":string[]}`; `worker/src/protocol.ts` exporting `MAX_FRAME_BYTES`, `IV_BYTES`, `Attachment`, `ClientControl`, `ServerControl`, `isClientId`, `isRoomId`.

- [ ] **Step 1: Add the Workers test pool as a dev dependency**

Run: `bun add -d @cloudflare/vitest-pool-workers@0.12.0` Expected: `package.json` devDependencies gains the entry and `bun.lock` changes. Version `0.12.0` is the newest release whose peer range (`vitest 2.0.x - 3.2.x`) accepts this repo's vitest 3.0.6; every later release requires vitest 4.

- [ ] **Step 2: Create `worker/vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["tests/**/*.worker.test.ts"],
    poolOptions: {
      workers: { wrangler: { configPath: "./wrangler.jsonc" } },
    },
  },
});
```

It is discovered because the script runs vitest with `worker/` as the working directory.

- [ ] **Step 3: Add the script and keep the root suite out of these files**

In `package.json` scripts: `"test:worker": "cd worker && vitest run"`.

In `vitest.config.mts`, import `configDefaults` from `vitest/config` and add to `test`:

```ts
exclude: [...configDefaults.exclude, "worker/tests/**/*.worker.test.ts"],
```

- [ ] **Step 4: Add the binding and migration**

`worker/wrangler.jsonc` gains, alongside the existing keys:

```jsonc
"durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "Room" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }],
```

`worker/src/types.ts` gains `ROOMS: DurableObjectNamespace` on `Env`.

- [ ] **Step 5: Write the failing test**

Create `worker/tests/room.worker.test.ts`:

```ts
/// <reference types="@cloudflare/vitest-pool-workers" />
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://colab-draw-with-nextjs.vercel.app";
const ALICE = "11111111-1111-4111-8111-111111111111";

const open = async (roomId: string) => {
  const res = await SELF.fetch(`https://api.test/rooms/${roomId}`, {
    headers: { Upgrade: "websocket", Origin: ORIGIN },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  ws.binaryType = "arraybuffer";
  return ws;
};

const inbox = (ws: WebSocket) => {
  const queued: (string | ArrayBuffer)[] = [];
  const waiting: ((message: string | ArrayBuffer) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const handler = waiting.shift();
    if (handler) handler(event.data as string | ArrayBuffer);
    else queued.push(event.data as string | ArrayBuffer);
  });
  return () =>
    new Promise<string | ArrayBuffer>((resolve) => {
      const message = queued.shift();
      if (message !== undefined) resolve(message);
      else waiting.push(resolve);
    });
};

const join = (ws: WebSocket, clientId: string) =>
  ws.send(JSON.stringify({ t: "join", clientId }));

describe("room", () => {
  it("answers a join with the room membership", async () => {
    const ws = await open("room-join");
    const next = inbox(ws);

    join(ws, ALICE);

    expect(JSON.parse((await next()) as string)).toEqual({
      t: "joined",
      first: true,
      members: [ALICE],
    });
  });

  it("ignores a join without a usable clientId", async () => {
    const ws = await open("room-bad-join");
    const next = inbox(ws);

    ws.send(JSON.stringify({ t: "join" }));
    ws.send(JSON.stringify({ t: "join", clientId: 42 }));
    join(ws, ALICE);

    expect(JSON.parse((await next()) as string)).toEqual({
      t: "joined",
      first: true,
      members: [ALICE],
    });
  });

  it("404s a room id outside the allowlist", async () => {
    for (const roomId of ["bad!id", "a".repeat(200)]) {
      const res = await SELF.fetch(`https://api.test/rooms/${roomId}`, {
        headers: { Upgrade: "websocket", Origin: ORIGIN },
      });
      expect(res.status).toBe(404);
    }
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun run test:worker` Expected: FAIL — `SELF.fetch` returns a `404 not_found` from the existing router, so `res.status` is not 101.

- [ ] **Step 7: Implement the protocol module**

Create `worker/src/protocol.ts`:

```ts
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const MAX_CONTROL_BYTES = 4 * 1024;
export const IV_BYTES = 12;

export type ClientControl =
  | { t: "join"; clientId: string }
  | { t: "view-only" }
  | { t: "follow"; target: string }
  | { t: "unfollow"; target: string }
  | { t: "ping" };

export type ServerControl =
  | { t: "joined"; first: boolean; members: string[] }
  | { t: "members"; ids: string[] }
  | { t: "new-user"; id: string }
  | { t: "followers"; ids: string[] }
  | { t: "unfollowed" }
  | { t: "pong" };

/** Written per socket with `serializeAttachment`; the only source of room state. */
export type Attachment = {
  id: string;
  viewOnly: boolean;
  following: string | null;
};

export const isClientId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);

export const isRoomId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
```

- [ ] **Step 8: Implement the Durable Object**

Create `worker/src/room.ts` with:

```ts
import { isClientId } from "./protocol";

import type { Attachment, ServerControl } from "./protocol";
import type { Env } from "./types";

export class Room {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // join handled here; other message kinds arrive in later tasks
  }
}
```

Use the constructor form rather than `extends DurableObject` from `cloudflare:workers`: `worker/tests/router.test.ts` imports `../src/index` under jsdom, and a runtime import of `cloudflare:workers` would make that import fail. Hibernation works the same through `state.acceptWebSocket`.

`webSocketMessage` parses a text frame as JSON, ignores anything that is not a known `ClientControl`, and for `join`:

1. ignore it unless `isClientId(payload.clientId)`;
2. close any other socket whose attachment has the same id with code `4001` and reason `replaced`;
3. write `{ id, viewOnly: false, following: null }` with `ws.serializeAttachment`;
4. send `{"t":"joined","first":<no other member existed>,"members":[…ids…, id]}`.

Add a private `members()` that maps `this.state.getWebSockets()` through `deserializeAttachment()` and drops sockets without an attachment. Add `private send(ws, control: ServerControl)` doing `ws.send(JSON.stringify(control))`.

- [ ] **Step 9: Route and export**

In `worker/src/index.ts`:

- `export { Room } from "./room";`
- `const ROOM = /^\/rooms\/([^/]+)$/;`
- handle the room path **before** the CORS wrapper, because a `101` response carries `webSocket` and rebuilding it with `new Response` would drop that property:

```ts
const handleRoom = (
  request: Request,
  env: Env,
  roomId: string,
): Response | Promise<Response> => {
  if (!isRoomId(roomId)) return fail(404, "not_found");
  if (request.headers.get("upgrade") !== "websocket")
    return fail(426, "upgrade_required");
  if (!isAllowedOrigin(request.headers.get("origin")))
    return fail(403, "forbidden_origin");
  return env.ROOMS.getByName(roomId).fetch(request);
};
```

`isAllowedOrigin` returns true for `https://colab-draw-with-nextjs.vercel.app`, `http://localhost:3000`, `http://127.0.0.1:3000`, and any host ending in `.vercel.app`; false for a missing or unparsable origin.

Call it from the default export before the existing `try`/`withCors` block, so the upgrade response is returned untouched:

```ts
async fetch(request: Request, env: Env): Promise<Response> {
  const room = ROOM.exec(new URL(request.url).pathname);
  if (room) {
    return handleRoom(request, env, room[1]);
  }

  if (request.method === "OPTIONS") {
    // unchanged from today
  }
  // ...
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `bun run test:worker` Expected: PASS, 3 tests.

- [ ] **Step 11: Add the CI step**

In `.github/workflows/test-coverage-pr.yml`, after the coverage step:

```yaml
- name: Durable Object tests
  run: bun run test:worker
```

- [ ] **Step 12: Typecheck and commit**

Run: `bun run test:typecheck` Expected: no output, exit 0.

```bash
git add worker/vitest.config.ts worker/src/protocol.ts worker/src/room.ts worker/tests/room.worker.test.ts worker/wrangler.jsonc worker/src/types.ts worker/src/index.ts vitest.config.mts package.json bun.lock .github/workflows/test-coverage-pr.yml
git commit -m "feat(worker): serve a room over a Durable Object WebSocket"
```

---

### Task 2: Presence — `new-user`, `members`, and close

**Files:**

- Modify: `worker/src/room.ts`
- Modify: `worker/tests/room.worker.test.ts`

**Interfaces:**

- Consumes: `Room`, `members()`, `send()`, `Attachment` from Task 1.
- Produces: `{"t":"new-user","id":string}` and `{"t":"members","ids":string[]}` frames; `webSocketClose` handler.

- [ ] **Step 1: Write the failing tests**

Append to `worker/tests/room.worker.test.ts`:

```ts
const BOB = "22222222-2222-4222-8222-222222222222";

it("tells the room about a second participant", async () => {
  const alice = await open("room-presence");
  const aliceIn = inbox(alice);
  join(alice, ALICE);
  await aliceIn();

  const bob = await open("room-presence");
  const bobIn = inbox(bob);
  join(bob, BOB);

  expect(JSON.parse((await bobIn()) as string)).toEqual({
    t: "joined",
    first: false,
    members: [ALICE, BOB],
  });
  expect(JSON.parse((await aliceIn()) as string)).toEqual({
    t: "new-user",
    id: BOB,
  });
  expect(JSON.parse((await aliceIn()) as string)).toEqual({
    t: "members",
    ids: [ALICE, BOB],
  });
});

it("drops a departing participant from presence", async () => {
  const alice = await open("room-leave");
  const aliceIn = inbox(alice);
  join(alice, ALICE);
  await aliceIn();

  const bob = await open("room-leave");
  const bobIn = inbox(bob);
  join(bob, BOB);
  await bobIn();
  await aliceIn();
  await aliceIn();

  bob.close();

  expect(JSON.parse((await aliceIn()) as string)).toEqual({
    t: "members",
    ids: [ALICE],
  });
});

it("treats a rejoin after the room empties as first", async () => {
  const alice = await open("room-empty");
  const aliceIn = inbox(alice);
  join(alice, ALICE);
  await aliceIn();
  alice.close();

  const bob = await open("room-empty");
  const bobIn = inbox(bob);
  join(bob, BOB);

  expect(JSON.parse((await bobIn()) as string)).toEqual({
    t: "joined",
    first: true,
    members: [BOB],
  });
});

it("keeps a socket that never joins out of the room", async () => {
  const ghost = await open("room-ghost");
  const alice = await open("room-ghost");
  const aliceIn = inbox(alice);
  join(alice, ALICE);

  expect(JSON.parse((await aliceIn()) as string)).toEqual({
    t: "joined",
    first: true,
    members: [ALICE],
  });

  // a socket with no attachment is not a member; after closing it the room must
  // still compute membership from attachments alone
  ghost.close();

  const bob = await open("room-ghost");
  const bobIn = inbox(bob);
  join(bob, BOB);
  expect(JSON.parse((await bobIn()) as string)).toEqual({
    t: "joined",
    first: false,
    members: [ALICE, BOB],
  });
});

it("answers a heartbeat", async () => {
  const ws = await open("room-ping");
  const next = inbox(ws);

  ws.send(JSON.stringify({ t: "ping" }));

  expect(JSON.parse((await next()) as string)).toEqual({ t: "pong" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test:worker` Expected: FAIL — `new-user` never arrives; the second test times out on the second `await aliceIn()`.

- [ ] **Step 3: Implement the join broadcast and close handling**

In `join`: after replying `joined`, when other members existed send each of them `{"t":"new-user","id":id}`, then send every member (the joiner included) `{"t":"members","ids":[…]}`, computed after the attachment is written.

Add:

```ts
async webSocketClose(ws: WebSocket) {
  const attachment = ws.deserializeAttachment() as Attachment | null;
  if (!attachment) return;
  this.broadcastMembers(attachment.id);
}
```

`broadcastMembers(excludeId?)` sends `{"t":"members","ids":[…]}` to every member except the excluded one. A close from a socket with no attachment returns early, which is what keeps the ghost test quiet.

Also handle `{"t":"ping"}` by sending `{"t":"pong"}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:worker` Expected: PASS, 8 tests (3 from Task 1 plus 5 here).

- [ ] **Step 5: Commit**

```bash
git add worker/src/room.ts worker/tests/room.worker.test.ts
git commit -m "feat(worker): broadcast room presence over the Durable Object"
```

---

### Task 3: Scene relay, view-only, followers, and follow/unfollow

**Files:**

- Modify: `worker/src/room.ts`
- Modify: `worker/tests/room.worker.test.ts`

**Interfaces:**

- Consumes: `Room`, `members()`, `send()`, `Attachment` from Tasks 1–2.
- Produces: binary relay of opcodes `1`, `2`, `3`; `{"t":"followers","ids":string[]}` and `{"t":"unfollowed"}` frames; handler for `view-only`, `follow`, `unfollow`.

- [ ] **Step 1: Write the failing tests**

Append:

```ts
const CAROL = "33333333-3333-4333-8333-333333333333";
const IV = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

const frame = (opcode: number, body: Uint8Array) => {
  const out = new Uint8Array(1 + IV.byteLength + body.byteLength);
  out[0] = opcode;
  out.set(IV, 1);
  out.set(body, 1 + IV.byteLength);
  return out.buffer;
};

const bytes = (message: string | ArrayBuffer) =>
  new Uint8Array(message as ArrayBuffer);

const ping = async (
  ws: WebSocket,
  next: () => Promise<string | ArrayBuffer>,
) => {
  ws.send(JSON.stringify({ t: "ping" }));
  expect(JSON.parse((await next()) as string)).toEqual({ t: "pong" });
};

/**
 * Opens and joins, then swallows the joiner's two frames (`joined`, then the
 * `members` broadcast). Every join costs each participant exactly two frames,
 * so the returned `next` starts at the next event.
 */
const participant = async (roomId: string, clientId: string) => {
  const ws = await open(roomId);
  const next = inbox(ws);
  join(ws, clientId);
  await next(); // joined
  await next(); // members
  return { ws, next };
};

const twoIn = async (roomId: string) => {
  const alice = await participant(roomId, ALICE);
  const bob = await participant(roomId, BOB);
  await alice.next(); // new-user
  await alice.next(); // members
  return { alice, bob };
};

const threeIn = async (roomId: string) => {
  const { alice, bob } = await twoIn(roomId);
  const carol = await participant(roomId, CAROL);
  for (const existing of [alice, bob]) {
    await existing.next(); // new-user
    await existing.next(); // members
  }
  return { alice, bob, carol };
};

it("relays opcode 1 to everyone but the sender", async () => {
  const { alice, bob } = await twoIn("room-relay-1");
  const body = new Uint8Array([9, 8, 7]);

  alice.ws.send(frame(1, body));

  expect(bytes(await bob.next())).toEqual(new Uint8Array([1, ...IV, ...body]));
  // the sender receives nothing, so its next frame is the heartbeat reply
  await ping(alice.ws, alice.next);
});

it("drops frames from a view-only socket", async () => {
  const { alice, bob } = await twoIn("room-viewer");

  alice.ws.send(JSON.stringify({ t: "view-only" }));
  alice.ws.send(frame(1, new Uint8Array([1])));
  // same-socket ordering proves the frame was processed: nothing came back
  await ping(alice.ws, alice.next);
  // and the other participant saw only its own heartbeat
  await ping(bob.ws, bob.next);
});

it("sends opcode 3 only to the sender's followers", async () => {
  const { alice, bob, carol } = await threeIn("room-followers");

  bob.ws.send(JSON.stringify({ t: "follow", target: ALICE }));
  expect(JSON.parse((await alice.next()) as string)).toEqual({
    t: "followers",
    ids: [BOB],
  });

  alice.ws.send(frame(3, new Uint8Array([5])));
  expect(bytes(await bob.next())).toEqual(new Uint8Array([2, ...IV, 5]));

  await ping(alice.ws, alice.next);
  // carol is not a follower of alice, so her only frame is the pong
  await ping(carol.ws, carol.next);
});

it("reports the follower list emptying and clears it when a target leaves", async () => {
  const { alice, bob } = await twoIn("room-unfollow");

  bob.ws.send(JSON.stringify({ t: "follow", target: ALICE }));
  expect(JSON.parse((await alice.next()) as string)).toEqual({
    t: "followers",
    ids: [BOB],
  });

  bob.ws.send(JSON.stringify({ t: "unfollow", target: ALICE }));
  expect(JSON.parse((await alice.next()) as string)).toEqual({
    t: "unfollowed",
  });

  bob.ws.send(JSON.stringify({ t: "follow", target: ALICE }));
  await alice.next();

  alice.ws.close();
  expect(JSON.parse((await bob.next()) as string)).toEqual({ t: "unfollowed" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test:worker` Expected: FAIL — binary frames are ignored, so the relay test times out.

- [ ] **Step 3: Implement binary relay and follow**

In `webSocketMessage`, when the message is an `ArrayBuffer`:

- read the attachment; drop the frame when there is none or `viewOnly` is true;
- drop the frame when the opcode is not `1`, `2` or `3`;
- for opcode `3`, copy the frame with the first byte set to `2`;
- send to every member except the sender, and for opcode `3` only to members whose `following` equals the sender's id.

For `view-only`, rewrite the attachment with `viewOnly: true`.

For `follow`, rewrite the attachment with `following: target`, then send the target `{"t":"followers","ids":[…ids of members following it…]}`. For `unfollow`, set `following: null` on the sender and send `target` either the remaining `followers` list or `{"t":"unfollowed"}` when it is empty.

In `webSocketClose`, before `broadcastMembers`: clear `following` on members that followed the closing socket and send each `{"t":"unfollowed"}`; if the closing socket was itself following someone, send that target its remaining `followers` list (or `unfollowed` when empty).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:worker` Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/room.ts worker/tests/room.worker.test.ts
git commit -m "feat(worker): relay scene frames and follow state between room members"
```

---

### Task 4: Frame limits, duplicate ids, and connection guards

**Files:**

- Modify: `worker/src/room.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/tests/room.worker.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–3.
- Produces: close codes `1009` (frame too large) and `4001` (replaced); `426` and `403` responses from the room route.

- [ ] **Step 1: Write the failing tests**

Append:

```ts
const closed = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener("close", (event) =>
      resolve({ code: event.code, reason: event.reason }),
    ),
  );

it("relays a frame of exactly 4 MiB and rejects one byte more", async () => {
  const { alice, bob } = await twoIn("room-limit");
  const max = 4 * 1024 * 1024;

  alice.ws.send(frame(1, new Uint8Array(max - 1 - IV_BYTES)));
  expect(bytes(await bob.next()).byteLength).toBe(max);

  const closeCode = closed(alice.ws);
  alice.ws.send(frame(1, new Uint8Array(max - IV_BYTES)));
  expect((await closeCode).code).toBe(1009);
});

it("replaces an older socket that claims the same client id", async () => {
  const first = await participant("room-duplicate", ALICE);

  const second = await open("room-duplicate");
  const secondIn = inbox(second);
  const firstClosed = closed(first.ws);
  join(second, ALICE);

  expect((await firstClosed).code).toBe(4001);
  expect(JSON.parse((await secondIn()) as string)).toEqual({
    t: "joined",
    first: true,
    members: [ALICE],
  });
});

it("refuses a plain request and a foreign origin", async () => {
  const plain = await SELF.fetch("https://api.test/rooms/room-plain", {
    headers: { Origin: ORIGIN },
  });
  expect(plain.status).toBe(426);

  const foreign = await SELF.fetch("https://api.test/rooms/room-foreign", {
    headers: { Upgrade: "websocket", Origin: "https://evil.example" },
  });
  expect(foreign.status).toBe(403);
});
```

Import `IV_BYTES` from `../src/protocol` in the test file.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test:worker` Expected: FAIL — no close code is produced for an oversized frame, a duplicate id yields `first: false`, and `/rooms/room-plain` returns `101` instead of `426`.

- [ ] **Step 3: Implement the limits**

- At the top of `webSocketMessage`, if the message is an `ArrayBuffer` whose `byteLength` exceeds `MAX_FRAME_BYTES`, call `ws.close(1009, "frame too large")` and return; if it is a string longer than `MAX_CONTROL_BYTES`, close the same way.
- In `join`, after validating the id, iterate `members()` and close any socket with the same id (other than the one joining) with `4001`, `"replaced"`, and exclude it from the `first`/`members` computation.
- In the Worker's room route, reject a request without `upgrade: websocket` with `426` and a disallowed origin with `403`, before touching the namespace.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:worker` Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/room.ts worker/tests/room.worker.test.ts
git commit -m "feat(worker): cap frame size, replace duplicate clients, answer heartbeats"
```

---

### Task 5: `CollabSocket` client transport

**Files:**

- Create: `ColabDraw-app/collab/CollabSocket.ts`
- Create: `ColabDraw-app/tests/collabSocket.test.ts`

**Interfaces:**

- Consumes: the wire protocol from Tasks 1–4.
- Produces: `class CollabSocket` with `readonly id: string`, `constructor(baseUrl: string, roomId: string, options?: { isViewOnly?: boolean })`, `connect()`, `close()`, `sendUpdate(data: ArrayBuffer, iv: Uint8Array, options?: { volatile?: boolean; followersOnly?: boolean })`, `setFollowing(target: string | null)`, `on`/`off` over `CollabSocketEvents`.

```ts
export type CollabSocketEvents = {
  joined: (payload: { first: boolean; members: string[] }) => void;
  members: (ids: string[]) => void;
  newUser: (id: string) => void;
  followers: (ids: string[]) => void;
  unfollowed: () => void;
  scene: (payload: { opcode: 1 | 2; iv: Uint8Array; data: Uint8Array }) => void;
  status: (status: "connecting" | "open" | "unavailable") => void;
};
```

- [ ] **Step 1: Write the failing tests**

Create `ColabDraw-app/tests/collabSocket.test.ts`. It drives a fake `WebSocket` installed with `vi.stubGlobal`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollabSocket } from "../collab/CollabSocket";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = "arraybuffer";
  sent: (string | ArrayBuffer)[] = [];
  private listeners: Record<string, ((event: any) => void)[]> = {};

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: any) => void) {
    (this.listeners[type] ??= []).push(handler);
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close", {});
  }

  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(data: string | ArrayBuffer) {
    this.emit("message", { data });
  }

  fail() {
    this.readyState = 3;
    this.emit("close", {});
  }

  private emit(type: string, event: any) {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CollabSocket", () => {
  it("joins with a stable id when the socket opens", () => {
    const socket = new CollabSocket("https://api.test", "room-1", {
      isViewOnly: true,
    });
    socket.connect();
    FakeSocket.instances[0].open();

    expect(FakeSocket.instances[0].url).toBe("wss://api.test/rooms/room-1");
    expect(FakeSocket.instances[0].sent).toEqual([
      JSON.stringify({ t: "join", clientId: socket.id }),
      JSON.stringify({ t: "view-only" }),
    ]);
  });

  it("wraps an update in a binary frame with an opcode", () => {
    const socket = new CollabSocket("http://localhost:8787", "room-1");
    socket.connect();
    FakeSocket.instances[0].open();

    const iv = new Uint8Array(12).fill(7);
    socket.sendUpdate(new Uint8Array([1, 2, 3]).buffer, iv, {
      volatile: true,
      followersOnly: true,
    });

    const frame = new Uint8Array(
      FakeSocket.instances[0].sent[1] as ArrayBuffer,
    );
    expect(frame[0]).toBe(3);
    expect(frame.subarray(1, 13)).toEqual(iv);
    expect(frame.subarray(13)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reports control messages to listeners", () => {
    const socket = new CollabSocket("https://api.test", "room-1");
    const joined = vi.fn();
    socket.on("joined", joined);
    socket.connect();
    FakeSocket.instances[0].open();

    FakeSocket.instances[0].message(
      JSON.stringify({ t: "joined", first: false, members: ["a"] }),
    );

    expect(joined).toHaveBeenCalledWith({ first: false, members: ["a"] });
  });

  it("reconnects with backoff and reports unavailability", () => {
    const socket = new CollabSocket("https://api.test", "room-1");
    const status = vi.fn();
    socket.on("status", status);
    socket.connect();

    FakeSocket.instances[0].fail();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.instances[1].fail();
    vi.advanceTimersByTime(2000);
    expect(FakeSocket.instances).toHaveLength(3);

    FakeSocket.instances[2].fail();
    expect(status).toHaveBeenLastCalledWith("unavailable");
  });

  it("pings when idle and reconnects when no pong arrives", () => {
    const socket = new CollabSocket("https://api.test", "room-1");
    socket.connect();
    FakeSocket.instances[0].open();

    vi.advanceTimersByTime(25_000);
    expect(FakeSocket.instances[0].sent.at(-1)).toBe(
      JSON.stringify({ t: "ping" }),
    );

    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances[0].readyState).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run collabSocket` Expected: FAIL — cannot resolve `../collab/CollabSocket`.

- [ ] **Step 3: Implement `CollabSocket`**

Requirements the tests pin:

- `id = crypto.randomUUID()` once per instance, reused on every reconnect.
- URL is `baseUrl.replace(/^http/, "ws") + "/rooms/" + encodeURIComponent(roomId)`.
- On `open`: reset the attempt counter, emit `open`, send `join`, then `view-only` when `isViewOnly`.
- `sendUpdate` writes `[opcode, ...iv, ...data]` where opcode is `3` for `followersOnly`, `2` for `volatile`, `1` otherwise, and drops the frame when the socket is not open.
- Incoming strings parse to a control message and dispatch `joined` / `members` / `new-user` / `followers` / `unfollowed` / `pong`; unknown `t` values are ignored.
- Incoming `ArrayBuffer` splits into `opcode`, `iv = bytes[1..13]`, `data = bytes[13..]` and emits `scene` for opcodes `1` and `2`.
- Backoff on close when not intentionally closed: delay `min(15000, 1000 * 2 ** (attempt - 1))` multiplied by `1 + (Math.random() - 0.5) / 2`; after three consecutive failures emit `unavailable` and keep retrying at the cap.
- Ping every 25 s while open; if no `pong` within 10 s, close the socket (which triggers the reconnect path).
- `setFollowing(target)`: when `target` is an id, remember it and send `{"t":"follow","target":target}`; when it is `null`, send `{"t":"unfollow","target":<the id it was following>}` and forget it.
- `close()` clears timers and sockets and suppresses reconnection.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run collabSocket` Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add ColabDraw-app/collab/CollabSocket.ts ColabDraw-app/tests/collabSocket.test.ts
git commit -m "feat(app): add a native WebSocket transport for collaboration"
```

---

### Task 6: Wire `Portal`, `Collab`, and the backend cache to the new transport

**Files:**

- Modify: `ColabDraw-app/collab/Portal.tsx`
- Modify: `ColabDraw-app/collab/Collab.tsx:547-576,608-715,717-735,1022-1034`
- Modify: `ColabDraw-app/data/backend.ts:28,265,285`
- Modify: `ColabDraw-app/tests/collab.test.tsx:69-81`
- Create: `ColabDraw-app/tests/portal.test.ts`

**Interfaces:**

- Consumes: `CollabSocket` and `CollabSocketEvents` from Task 5.
- Produces: `Portal.open(socket: CollabSocket, id, key, isViewOnly?)`, `Portal.broadcastScene`, `Portal.broadcastVisibleSceneBounds(payload)`, `Portal.broadcastMouseLocation`, `Portal.broadcastIdleChange`, `Portal.broadcastUserFollowed` — same names as today, now over `CollabSocket`; and `syncUnavailableAtom` exported from `Collab.tsx` for Task 8's banner.

- [ ] **Step 1: Write the failing Portal test**

Create `ColabDraw-app/tests/portal.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import Portal from "../collab/Portal";

vi.mock("@excalidraw/excalidraw/data/encryption", () => ({
  encryptData: async () => ({
    encryptedBuffer: new Uint8Array([1]).buffer,
    iv: new Uint8Array(12),
  }),
}));

const fakeSocket = () => ({
  id: "client-1",
  connect: vi.fn(),
  close: vi.fn(),
  sendUpdate: vi.fn(),
  setFollowing: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
});

const fakeCollab = () => ({
  state: { username: "alice" },
  setCollaborators: vi.fn(),
  getSceneElementsIncludingDeleted: () => [],
  excalidrawAPI: {
    getSceneElementsIncludingDeleted: () => [],
    getFiles: () => ({}),
    getAppState: () => ({ selectedElementIds: {} }),
    updateScene: vi.fn(),
  },
  fileManager: {
    saveFiles: async () => {},
    shouldUpdateImageElementStatus: () => false,
  },
});

const opened = () => {
  const socket = fakeSocket();
  const collab = fakeCollab();
  const portal = new Portal(collab as any);
  portal.socket = socket as any;
  portal.roomId = "room-1";
  portal.roomKey = "key";
  portal.socketInitialized = true;
  return { portal, socket, collab };
};

describe("Portal", () => {
  it("broadcasts a scene as a non-volatile update", async () => {
    const { portal, socket } = opened();

    await portal.broadcastScene("SCENE_UPDATE" as any, [], true);

    expect(socket.sendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        volatile: false,
        followersOnly: false,
      },
    );
  });

  it("broadcasts scene bounds to followers only", async () => {
    const { portal, socket } = opened();

    await portal.broadcastVisibleSceneBounds({
      sceneBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    });

    expect(socket.sendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        volatile: true,
        followersOnly: true,
      },
    );
  });

  it("never broadcasts as a viewer", async () => {
    const { portal, socket } = opened();
    portal.isViewOnly = true;

    await portal.broadcastScene("SCENE_UPDATE" as any, [], true);

    expect(socket.sendUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run portal` Expected: FAIL — `portal.socket.sendUpdate` is not a function; `broadcastScene` still calls `emit`.

- [ ] **Step 3: Rewrite `Portal` against `CollabSocket`**

- Replace the `Socket` import with `import type { CollabSocket } from "./CollabSocket";` and type `socket: CollabSocket | null`.
- `open(socket, id, key, isViewOnly)` stores the fields, registers `newUser` → `broadcastScene(WS_SUBTYPES.INIT, this.collab.getSceneElementsIncludingDeleted(), true)` and `members` → `this.collab.setCollaborators(ids)`, then calls `socket.connect()`. It no longer registers `init-room`.
- `_broadcastSocketData(data, volatile = false, followersOnly = false)` encrypts as today and calls `socket.sendUpdate(encryptedBuffer, iv, { volatile, followersOnly })`.
- `broadcastScene` passes `volatile: false`, `followersOnly: false` (the default) and keeps the version bookkeeping.
- `broadcastVisibleSceneBounds` passes `followersOnly: true` and no longer takes a `roomId` argument; update its caller.
- `broadcastUserFollowed` calls `this.socket.setFollowing(action === "FOLLOW" ? userToFollow.socketId : null)`.
- `close()` calls `this.socket?.close()` so the transport stops reconnecting.

- [ ] **Step 4: Rewrite the socket lifecycle in `Collab.tsx`**

- Import `CollabSocket` (static import; the `socket.io-client` dynamic import goes away) and `BACKEND_URL` from `../data/backend`.
- Add `export const syncUnavailableAtom = atom(false);` next to `isOfflineAtom`.
- Create the socket with `new CollabSocket(BACKEND_URL, roomId, { isViewOnly })` and keep `this.portal.open(socket, roomId, roomKey, isViewOnly)`.
- Replace `connect_error` with `status`:

```ts
let hasConnected = false;
this.portal.socket.on("status", (status) => {
  if (status === "open") {
    if (hasConnected) {
      // a reconnect must accept the peers' SCENE_INIT again
      this.portal.socketInitialized = false;
    }
    hasConnected = true;
    appJotaiStore.set(syncUnavailableAtom, false);
  }
  if (status === "unavailable") {
    appJotaiStore.set(syncUnavailableAtom, true);
    fallbackInitializationHandler();
  }
});
```

- Replace `first-in-room` with `joined`:

```ts
this.portal.socket.on("joined", async ({ first }) => {
  if (!first) return; // peers will send SCENE_INIT
  if (this.portal.socketInitialized) return; // reconnect while alone: keep local edits
  const sceneData = await this.initializeRoom({
    fetchScene: true,
    roomLinkData: existingRoomLinkData,
  });
  scenePromise.resolve(sceneData);
});
```

- Replace `client-broadcast` with `scene`:

```ts
this.portal.socket.on("scene", async ({ iv, data }) => {
  if (!this.portal.roomKey) return;
  const decryptedData = await this.decryptPayload(
    iv,
    data.buffer as ArrayBuffer,
    this.portal.roomKey,
  );
  // body unchanged from today
});
```

- Replace `user-follow-room-change` with `followers`.
- `syncUnavailableAtom` is created here and consumed by Task 8.

- [ ] **Step 5: Update the backend cache type and the app test mock**

- `ColabDraw-app/data/backend.ts`: replace the `Socket` import with `CollabSocket` and type `SceneVersionCache` and `loadFromBackend`'s third parameter with it.
- `ColabDraw-app/tests/collab.test.tsx`: delete the `socket.io-client` mock and add

```ts
vi.mock("../collab/CollabSocket", () => ({
  CollabSocket: class {
    id = "test-client";
    connect() {}
    close() {}
    sendUpdate() {}
    setFollowing() {}
    on() {}
    off() {}
  },
}));
```

- [ ] **Step 6: Run the app tests**

Run: `bunx vitest run portal collab` Expected: PASS — 3 Portal tests and the existing collaboration tests.

- [ ] **Step 7: Remove the dependency and commit**

Delete `"socket.io-client": "4.7.2"` from `ColabDraw-app/package.json` and run `bun install`, then confirm `bunx --cwd ColabDraw-app node -e "require.resolve('socket.io-client')"` fails. Expected: no `socket.io-client` under `ColabDraw-app`.

```bash
git add ColabDraw-app/collab/Portal.tsx ColabDraw-app/collab/Collab.tsx ColabDraw-app/data/backend.ts ColabDraw-app/tests/collab.test.tsx ColabDraw-app/tests/portal.test.ts ColabDraw-app/package.json bun.lock
git commit -m "feat(app): speak the Durable Object protocol from the collab client"
```

---

### Task 7: Gemini trial proxy on the Worker with D1 counters

**Files:**

- Create: `worker/src/trial.ts`
- Create: `worker/migrations/0002_trial_usage.sql`
- Create: `worker/tests/trial.test.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/types.ts`
- Modify: `worker/tests/fakes.ts`
- Modify: `ColabDraw-app/ai/aiClient.ts:9`

**Interfaces:**

- Consumes: `fail`, `json`, `readJson` from `worker/src/http.ts`.
- Produces: `handleTrialStatus(env: Env, request: Request): Promise<Response>` and `handleTrialGenerate(env: Env, request: Request): Promise<Response>`; `Env.GEMINI_API_KEY?: string`, `Env.GEMINI_MODELS?: string`, `Env.AI_TRIAL_PER_DEVICE?: string`, `Env.AI_TRIAL_PER_IP?: string`, `Env.AI_TRIAL_GLOBAL?: string`.

- [ ] **Step 1: Extend the fake D1 with `all()`**

In `worker/tests/fakes.ts`, add `all?: unknown[]` to the `fakeD1` seed and make `all: async () => ({ results: seed.all ?? [] })`.

- [ ] **Step 2: Write the failing tests**

Create `worker/tests/trial.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";

import { fakeD1, fakeR2 } from "./fakes";

const envWith = (seed: { all?: unknown[] } = {}, apiKey = "key") => {
  const d1 = fakeD1(seed);
  return {
    env: {
      DB: d1.db,
      FILES: fakeR2().bucket,
      GEMINI_API_KEY: apiKey,
      GEMINI_MODELS: "gemini-3.5-flash-lite",
      AI_TRIAL_PER_DEVICE: "20",
      AI_TRIAL_PER_IP: "40",
      AI_TRIAL_GLOBAL: "400",
    },
    statements: d1.statements,
  };
};

const DEVICE = "device-1234";

afterEach(() => vi.unstubAllGlobals());

describe("trial status", () => {
  it("rejects a malformed device id", async () => {
    const { env } = envWith();
    const res = await worker.fetch(
      new Request(`https://api.test/ai/trial?deviceId=x`),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("reports remaining usage from D1", async () => {
    const { env } = envWith({ all: [{ key: `device:${DEVICE}`, count: 5 }] });
    const res = await worker.fetch(
      new Request(`https://api.test/ai/trial?deviceId=${DEVICE}`),
      env,
    );
    expect(await res.json()).toEqual({
      enabled: true,
      remaining: 15,
      limit: 20,
    });
  });

  it("reports the trial as disabled without an API key", async () => {
    const { env } = envWith({}, "");
    const res = await worker.fetch(
      new Request(`https://api.test/ai/trial?deviceId=${DEVICE}`),
      env,
    );
    expect(await res.json()).toEqual({
      enabled: false,
      remaining: 20,
      limit: 20,
    });
  });
});

describe("trial generate", () => {
  const body = (overrides: Record<string, unknown> = {}) =>
    new Request("https://api.test/ai/trial/generate", {
      method: "POST",
      body: JSON.stringify({
        deviceId: DEVICE,
        request: { contents: [{ parts: [{ text: "hi" }] }] },
        ...overrides,
      }),
    });

  it("503s without an API key", async () => {
    const { env } = envWith({}, "");
    expect((await worker.fetch(body(), env)).status).toBe(503);
  });

  it("415s a request carrying media", async () => {
    const { env } = envWith();
    const res = await worker.fetch(
      body({
        request: {
          contents: [
            { parts: [{ inlineData: { mimeType: "image/png", data: "x" } }] },
          ],
        },
      }),
      env,
    );
    expect(res.status).toBe(415);
  });

  it("429s when the device is exhausted", async () => {
    const { env } = envWith({ all: [{ key: `device:${DEVICE}`, count: 20 }] });
    expect((await worker.fetch(body(), env)).status).toBe(429);
  });

  it("counts a successful generate per key and returns the remaining quota", async () => {
    const { env, statements } = envWith({
      all: [{ key: `device:${DEVICE}`, count: 5 }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      ),
    );

    const res = await worker.fetch(body(), env);

    expect(await res.json()).toMatchObject({ remaining: 14, limit: 20 });
    const upserts = statements.filter((s) => s.sql.includes("ON CONFLICT"));
    expect(upserts).toHaveLength(3);
    expect(upserts.map((s) => s.args[1])).toEqual([
      `device:${DEVICE}`,
      expect.stringMatching(/^ip:/),
      "global",
    ]);
  });

  it("refunds the usage when the upstream fails", async () => {
    const { env, statements } = envWith({
      all: [{ key: `device:${DEVICE}`, count: 5 }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );

    const res = await worker.fetch(body(), env);

    expect(res.status).toBe(502);
    expect(
      statements.some((s) => s.sql.includes("count = MAX(count - 1, 0)")),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `bunx vitest run trial` Expected: FAIL — `/ai/trial` is a `404`.

- [ ] **Step 4: Add the migration and the module**

`worker/migrations/0002_trial_usage.sql`:

```sql
CREATE TABLE trial_usage (
  day   TEXT NOT NULL,
  key   TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
```

`worker/src/trial.ts` ports the Express handlers verbatim in behaviour: `isValidDeviceId` (`/^[\w-]{8,64}$/`), the Pacific calendar day via `toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })`, media rejection, the 40,000-character cap, the model fallback loop with a 20 s stall timeout, and refunds on failure. Differences:

- the IP comes from `request.headers.get("cf-connecting-ip") ?? "unknown"`;
- `remaining` is read with `SELECT key, count FROM trial_usage WHERE day = ? AND key IN (?, ?, ?)` into a map keyed by `key`;
- a successful generate runs three `INSERT … ON CONFLICT(day, key) DO UPDATE SET count = count + 1`;
- a refund runs `UPDATE trial_usage SET count = MAX(count - 1, 0) WHERE day = ? AND key = ?` for each key;
- on the first request of a new day, `DELETE FROM trial_usage WHERE day < ?` with yesterday's date.

`worker/src/types.ts` gains the five optional env fields. `worker/src/index.ts` routes `GET /ai/trial` and `POST /ai/trial/generate` to the new handlers (with CORS, like the other routes).

- [ ] **Step 5: Point the client at the Worker**

In `ColabDraw-app/ai/aiClient.ts`: import `BACKEND_URL` from `../data/backend` and set `const TRIAL_URL = \`${BACKEND_URL}/ai/trial\`;`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bunx vitest run trial` Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add worker/src/trial.ts worker/src/types.ts worker/src/index.ts worker/migrations/0002_trial_usage.sql worker/tests/trial.test.ts worker/tests/fakes.ts ColabDraw-app/ai/aiClient.ts
git commit -m "feat(worker): serve the Gemini trial from D1-backed counters"
```

---

### Task 8: Visible degraded mode

**Files:**

- Modify: `ColabDraw-app/collab/Collab.tsx` (atom export, near `isOfflineAtom`)
- Modify: `ColabDraw-app/App.tsx:1034-1038`
- Modify: `packages/ColabDraw/locales/en.json` (alerts block)
- Create: `ColabDraw-app/tests/collabBanner.test.tsx`

**Interfaces:**

- Consumes: `syncUnavailableAtom` exported by `Collab.tsx` in Task 6.
- Produces: translation key `alerts.collabSyncUnavailable`.

- [ ] **Step 1: Write the failing test**

Create `ColabDraw-app/tests/collabBanner.test.tsx`:

```tsx
import { render, screen } from "@excalidraw/excalidraw/tests/test-utils";
import { describe, expect, it } from "vitest";

import ExcalidrawApp from "../App";
import { isCollaboratingAtom, syncUnavailableAtom } from "../collab/Collab";
import { appJotaiStore } from "../app-jotai";

describe("degraded collaboration", () => {
  it("explains that live sync is unavailable while edits are still saved", async () => {
    appJotaiStore.set(isCollaboratingAtom, true);
    appJotaiStore.set(syncUnavailableAtom, true);

    await render(<ExcalidrawApp />);

    expect(await screen.findByText(/live sync is unavailable/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run collabBanner` Expected: FAIL — no element matches the text.

- [ ] **Step 3: Add the atom, the banner, and the string**

- `syncUnavailableAtom` already exists from Task 6; do not redeclare it.
- In `App.tsx`, after the offline banner, add the same block guarded by `syncUnavailableAtom`, and fix the adjacent `className="alertalert--warning"` to `"alert alert--warning"` so both banners use the existing `alert` styles.
- In `packages/ColabDraw/locales/en.json`, under `alerts`: `"collabSyncUnavailable": "Live sync is unavailable on this network.\nYour changes are still saved."`

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run collabBanner` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ColabDraw-app/collab/Collab.tsx ColabDraw-app/App.tsx ColabDraw-app/tests/collabBanner.test.tsx packages/ColabDraw/locales/en.json
git commit -m "feat(app): tell users when live sync is unavailable"
```

---

### Task 9: Remove the Render room server and its leftovers

**Files:**

- Delete: `ColabDraw-room/`
- Modify: `package.json` (scripts, `@types/socket.io-client`)
- Modify: `.eslintignore`
- Modify: `tsconfig.json`
- Modify: `vercel.json`
- Modify: `.env.development.example`, `.env.production.example`
- Modify: `ColabDraw-app/vite-env.d.ts`
- Modify: `worker/README.md`, `README.md`

**Interfaces:**

- Consumes: nothing; all behaviour now lives in the Worker.
- Produces: no `ColabDraw-room`, no `VITE_APP_WS_SERVER_URL`.

- [ ] **Step 1: Delete the package and its references**

```bash
git rm -r ColabDraw-room
```

Then in `package.json`: delete the `dev:collab` script, change `dev` from `concurrently "bun:dev:collab" "bun:dev:app" --names "collab,app" --prefix-colors "cyan,green"` to `bun run dev:app`, and delete `@types/socket.io-client` from `devDependencies`. Run `bun install` to refresh `bun.lock`.

Remove the `ColabDraw-room/` entry and its comment from `.eslintignore`, and `"ColabDraw-room"` from the `exclude` array in `tsconfig.json`.

- [ ] **Step 2: Drop the environment variable**

- `.env.development.example`: delete the `VITE_APP_WS_SERVER_URL` block and its comment.
- `.env.production.example`: same.
- `ColabDraw-app/vite-env.d.ts`: delete the `VITE_APP_WS_SERVER_URL` declaration and its comment.
- `vercel.json`: change the `Access-Control-Allow-Origin` header value to `https://colab-draw-with-nextjs.vercel.app`.

- [ ] **Step 3: Update the docs**

- `worker/README.md`: document `/rooms/:roomId`, the Durable Object binding, `GEMINI_API_KEY` via `wrangler secret put`, and the `/ai/trial` routes.
- `README.md`: replace the room-server section with a line stating that realtime collaboration is served by the same Worker.

- [ ] **Step 4: Verify nothing refers to the old server**

Run: `git grep -n "ColabDraw-room\|socket.io\|VITE_APP_WS_SERVER_URL\|onrender"` Expected: no matches outside `docs/superpowers/` history.

- [ ] **Step 5: Run the full local gate**

Run: `bun run test:typecheck && bun run test:code && bun run test:other && bun run test:worker` Expected: all pass. If prettier reports formatting, run `bun run fix:other`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: retire the Render room server"
```

---

### Task 10: Deploy and verify in production

**Files:** none — deployment only.

**Interfaces:**

- Consumes: everything above.
- Produces: a live `wss://colabdraw-backend.jyotimoydas.workers.dev/rooms/<roomId>`.

- [ ] **Step 1: Apply the D1 migration remotely**

Run from `worker/`: `bunx wrangler d1 execute colabdraw --remote --file=migrations/0002_trial_usage.sql` Expected: `Executed 1 command`.

- [ ] **Step 2: Set the Gemini secret**

Run from `worker/`: `bunx wrangler secret put GEMINI_API_KEY` and paste the key from the current Render environment. Expected: `Success! Uploaded secret GEMINI_API_KEY`.

- [ ] **Step 3: Deploy**

Run from `worker/`: `bunx wrangler deploy` Expected: a new version id and `Migrations applied`.

- [ ] **Step 4: Smoke test the deployment**

Run: `node worker/tests/e2e.mjs https://colabdraw-backend.jyotimoydas.workers.dev` Expected: 17/17, as today. The script leaves its `e2e-*` rows behind; sweep them with the queries in `worker/README.md`.

Then, in a browser: open a room link in two tabs, draw, add an image, reload both; open a view-only share link in a private window and confirm images render. Leave the room idle for more than ten minutes and confirm a new tab joins instantly — that is the cold-start regression this change exists to fix.

- [ ] **Step 5: Hand the Render service over**

Once Step 4 passes, delete the Render service and remove `VITE_APP_WS_SERVER_URL` from the Vercel project. Rebuild the app so the new bundle is served.

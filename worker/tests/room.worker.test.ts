/// <reference types="@cloudflare/vitest-pool-workers" />
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { IV_BYTES, MAX_CONTROL_BYTES } from "../src/protocol";

const ORIGIN = "https://colab-draw-with-nextjs.vercel.app";
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";

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
    if (handler) {
      handler(event.data as string | ArrayBuffer);
    } else {
      queued.push(event.data as string | ArrayBuffer);
    }
  });
  return () =>
    new Promise<string | ArrayBuffer>((resolve) => {
      const message = queued.shift();
      if (message !== undefined) {
        resolve(message);
      } else {
        waiting.push(resolve);
      }
    });
};

const join = (ws: WebSocket, clientId: string) =>
  ws.send(JSON.stringify({ t: "join", clientId }));

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

const closed = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener("close", (event) =>
      resolve({ code: event.code, reason: event.reason }),
    ),
  );

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

  it("tells the room about a second participant", async () => {
    const alice = await open("room-presence");
    const aliceIn = inbox(alice);
    join(alice, ALICE);
    await aliceIn();
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

  it("relays opcode 1 to everyone but the sender", async () => {
    const { alice, bob } = await twoIn("room-relay-1");
    const body = new Uint8Array([9, 8, 7]);

    alice.ws.send(frame(1, body));

    expect(bytes(await bob.next())).toEqual(
      new Uint8Array([1, ...IV, ...body]),
    );
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
    expect(JSON.parse((await bob.next()) as string)).toEqual({
      t: "unfollowed",
    });
  });

  it("relays opcode 2 unchanged", async () => {
    const { alice, bob } = await twoIn("room-volatile");
    const body = new Uint8Array([4, 5]);

    alice.ws.send(frame(2, body));

    expect(bytes(await bob.next())).toEqual(
      new Uint8Array([2, ...IV, ...body]),
    );
  });

  it("relays a frame of exactly 4 MiB and rejects one byte more", async () => {
    const { alice, bob } = await twoIn("room-limit");
    const max = 4 * 1024 * 1024;

    alice.ws.send(frame(1, new Uint8Array(max - 1 - IV_BYTES)));
    const relayed = bytes(await bob.next());
    expect(relayed.byteLength).toBe(max);
    expect(relayed[0]).toBe(1);
    expect(relayed.slice(1, 1 + IV_BYTES)).toEqual(IV);

    const closeCode = closed(alice.ws);
    alice.ws.send(frame(1, new Uint8Array(max - IV_BYTES)));
    expect((await closeCode).code).toBe(1009);
    // nothing was relayed; the oversize close reaches the room as a departure:
    // the ghost socket (which never fires a close handler) leaves membership
    expect(JSON.parse((await bob.next()) as string)).toEqual({
      t: "members",
      ids: [BOB],
    });
    await ping(bob.ws, bob.next);
  });

  it("closes a control frame padded past the cap", async () => {
    const { alice, bob } = await twoIn("room-control-cap");
    const oversized = JSON.stringify({ t: "ping", pad: "x".repeat(4100) });
    expect(oversized.length).toBeGreaterThan(MAX_CONTROL_BYTES);

    const closeCode = closed(alice.ws);
    alice.ws.send(oversized);

    expect((await closeCode).code).toBe(1009);
    expect(JSON.parse((await bob.next()) as string)).toEqual({
      t: "members",
      ids: [BOB],
    });
    await ping(bob.ws, bob.next);
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
    // The broadcast must still reach the joiner: eviction sits earlier in
    // accept order, so a handler that threw on the closing socket would
    // never get this far.
    expect(JSON.parse((await secondIn()) as string)).toEqual({
      t: "members",
      ids: [ALICE],
    });
  });
});

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
});

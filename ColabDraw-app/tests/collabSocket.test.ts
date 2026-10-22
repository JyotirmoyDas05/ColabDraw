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
    for (const handler of this.listeners[type] ?? []) {
      handler(event);
    }
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
    const newUser = vi.fn();
    const followers = vi.fn();
    const unfollowed = vi.fn();

    socket.on("joined", joined);
    socket.on("newUser", newUser);
    socket.on("followers", followers);
    socket.on("unfollowed", unfollowed);

    socket.connect();
    FakeSocket.instances[0].open();

    FakeSocket.instances[0].message(
      JSON.stringify({ t: "joined", first: false, members: ["a"] }),
    );
    expect(joined).toHaveBeenCalledWith({ first: false, members: ["a"] });

    FakeSocket.instances[0].message(
      JSON.stringify({ t: "new-user", id: "user-b" }),
    );
    expect(newUser).toHaveBeenCalledWith("user-b");

    FakeSocket.instances[0].message(
      JSON.stringify({ t: "followers", ids: ["user-c"] }),
    );
    expect(followers).toHaveBeenCalledWith(["user-c"]);

    FakeSocket.instances[0].message(JSON.stringify({ t: "unfollowed" }));
    expect(unfollowed).toHaveBeenCalled();
  });

  it("decodes incoming binary scene frames and ignores invalid ones", () => {
    const socket = new CollabSocket("https://api.test", "room-1");
    const onScene = vi.fn();
    socket.on("scene", onScene);
    socket.connect();
    FakeSocket.instances[0].open();

    // Valid opcode 1 frame
    const iv = new Uint8Array(12).fill(9);
    const payload = new Uint8Array([42, 43]);
    const validFrame = new Uint8Array([1, ...iv, ...payload]);
    FakeSocket.instances[0].message(validFrame.buffer);

    expect(onScene).toHaveBeenCalledWith({
      opcode: 1,
      iv,
      data: payload,
    });

    // Too short frame (< 13 bytes)
    FakeSocket.instances[0].message(new Uint8Array([1, 2, 3]).buffer);
    // Invalid opcode (e.g. 5)
    FakeSocket.instances[0].message(
      new Uint8Array([5, ...iv, ...payload]).buffer,
    );

    expect(onScene).toHaveBeenCalledTimes(1);
  });

  it("tracks follow state and sends follow/unfollow control frames", () => {
    const socket = new CollabSocket("https://api.test", "room-1");
    socket.connect();
    FakeSocket.instances[0].open();

    socket.setFollowing("target-1");
    expect(FakeSocket.instances[0].sent.at(-1)).toBe(
      JSON.stringify({ t: "follow", target: "target-1" }),
    );

    socket.setFollowing(null);
    expect(FakeSocket.instances[0].sent.at(-1)).toBe(
      JSON.stringify({ t: "unfollow", target: "target-1" }),
    );

    // Calling with null again does not send another unfollow
    socket.setFollowing(null);
    expect(FakeSocket.instances[0].sent.at(-1)).toBe(
      JSON.stringify({ t: "unfollow", target: "target-1" }),
    );
  });

  it("allows unregistering event listeners with off", () => {
    const socket = new CollabSocket("https://api.test", "room-1");
    const members = vi.fn();
    socket.on("members", members);
    socket.connect();
    FakeSocket.instances[0].open();

    FakeSocket.instances[0].message(
      JSON.stringify({ t: "members", ids: ["a", "b"] }),
    );
    expect(members).toHaveBeenCalledTimes(1);

    socket.off("members", members);
    FakeSocket.instances[0].message(
      JSON.stringify({ t: "members", ids: ["a", "b", "c"] }),
    );
    expect(members).toHaveBeenCalledTimes(1);
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

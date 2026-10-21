import { describe, expect, it } from "vitest";

import worker from "../src/index";

import { fakeD1, fakeR2 } from "./fakes";

const envWith = (opts: { first?: unknown; changes?: number } = {}) => {
  const d1 = fakeD1(opts);
  const r2 = fakeR2();
  return { env: { DB: d1.db, FILES: r2.bucket }, statements: d1.statements };
};

const put = (roomId: string, body: unknown) =>
  new Request(`https://api.test/scenes/${roomId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /scenes/:roomId", () => {
  it("returns the stored scene", async () => {
    const { env } = envWith({
      first: { scene_version: 7, iv: "aaa", ciphertext: "bbb" },
    });

    const res = await worker.fetch(
      new Request("https://api.test/scenes/abc123"),
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      roomId: "abc123",
      sceneVersion: 7,
      iv: "aaa",
      ciphertext: "bbb",
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("404s when no scene is stored", async () => {
    const { env } = envWith({ first: null });

    const res = await worker.fetch(
      new Request("https://api.test/scenes/nope"),
      env,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404s for an id that is not url-safe, without querying D1", async () => {
    const { env, statements } = envWith({ first: null });

    const res = await worker.fetch(
      new Request(`https://api.test/scenes/${"x".repeat(200)}`),
      env,
    );

    expect(res.status).toBe(404);
    expect(statements).toHaveLength(0);
  });
});

describe("PUT /scenes/:roomId", () => {
  it("upserts and returns 204", async () => {
    const { env, statements } = envWith({ changes: 1 });

    const res = await worker.fetch(
      put("abc123", {
        roomId: "abc123",
        sceneVersion: 3,
        iv: "iv",
        ciphertext: "ct",
      }),
      env,
    );

    expect(res.status).toBe(204);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(/INSERT INTO scenes/i);
    expect(statements[0].sql).toMatch(/ON CONFLICT\(room_id\) DO UPDATE/i);
    expect(statements[0].args.slice(0, 4)).toEqual(["abc123", 3, "iv", "ct"]);
  });

  it("400s when the body is not a scene", async () => {
    const { env } = envWith({});

    const res = await worker.fetch(put("abc123", { roomId: "abc123" }), env);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("413s when the body declares more than 10 MiB", async () => {
    const { env } = envWith({});

    const res = await worker.fetch(
      new Request("https://api.test/scenes/abc123", {
        method: "PUT",
        headers: { "content-length": String(11 * 1024 * 1024) },
        body: "{}",
      }),
      env,
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });
});

import { describe, expect, it } from "vitest";

import worker from "../src/index";

import { fakeD1, fakeR2, fakeRooms } from "./fakes";

const envWith = (opts: { first?: unknown; changes?: number } = {}) => {
  const d1 = fakeD1(opts);
  const r2 = fakeR2();
  return {
    env: { DB: d1.db, FILES: r2.bucket, ROOMS: fakeRooms() },
    statements: d1.statements,
    calls: r2.calls,
  };
};

describe("router", () => {
  it("answers OPTIONS with 204 and CORS", async () => {
    const { env } = envWith({});

    const res = await worker.fetch(
      new Request("https://api.test/scenes/abc", { method: "OPTIONS" }),
      env,
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
  });

  it("404s an unknown path", async () => {
    const { env } = envWith({});

    const res = await worker.fetch(new Request("https://api.test/nope"), env);

    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("404s a nested path instead of treating it as an id", async () => {
    const { env, calls } = envWith({});

    const res = await worker.fetch(
      new Request("https://api.test/files/a/b"),
      env,
    );

    expect(res.status).toBe(404);
    expect(calls.get).toBe(0);
  });

  it("405s an unsupported method on a known resource", async () => {
    const { env } = envWith({});

    const res = await worker.fetch(
      new Request("https://api.test/scenes/abc", { method: "DELETE" }),
      env,
    );

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
  });
});

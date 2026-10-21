import { describe, expect, it } from "vitest";

import worker from "../src/index";

import { fakeD1, fakeR2 } from "./fakes";

const envWith = (opts: { first?: unknown; changes?: number } = {}) => {
  const d1 = fakeD1(opts);
  const r2 = fakeR2();
  return {
    env: { DB: d1.db, FILES: r2.bucket },
    statements: d1.statements,
    objects: r2.objects,
  };
};

const put = (id: string, body: unknown) =>
  new Request(`https://api.test/share-links/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /share-links/:id", () => {
  it("returns the stored ciphertext", async () => {
    const { env, statements } = envWith({ first: { ciphertext: "abc" } });

    const res = await worker.fetch(
      new Request("https://api.test/share-links/xyz"),
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ciphertext: "abc" });

    // The fake replays whatever it is seeded with, so pin the query itself.
    expect(statements[0].sql).toMatch(
      /SELECT .*FROM share_links WHERE id = \?/i,
    );
    expect(statements[0].args).toEqual(["xyz"]);
  });

  it("404s when absent", async () => {
    const { env } = envWith({ first: null });

    const res = await worker.fetch(
      new Request("https://api.test/share-links/xyz"),
      env,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("PUT /share-links/:id", () => {
  it("creates and returns 201", async () => {
    const { env, statements } = envWith({ changes: 1 });

    const res = await worker.fetch(put("xyz", { ciphertext: "abc" }), env);

    expect(res.status).toBe(201);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(/INSERT INTO share_links/i);
    expect(statements[0].args[0]).toBe("xyz");
    expect(statements[0].args[1]).toBe("abc");
  });

  it("409s when the id already exists", async () => {
    const { env } = envWith({ changes: 0 });

    const res = await worker.fetch(put("xyz", { ciphertext: "abc" }), env);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict" });
  });

  it("400s when ciphertext is missing", async () => {
    const { env } = envWith({});

    const res = await worker.fetch(put("xyz", {}), env);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });
});

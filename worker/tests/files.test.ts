import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES } from "../src/http";
import worker from "../src/index";

import { fakeD1, fakeR2, fakeRooms, streamedRequest } from "./fakes";

const envWith = (opts: { first?: unknown; changes?: number } = {}) => {
  const d1 = fakeD1(opts);
  const r2 = fakeR2();
  return {
    env: { DB: d1.db, FILES: r2.bucket, ROOMS: fakeRooms() },
    objects: r2.objects,
  };
};

const putFile = (id: string, bytes: Uint8Array) =>
  new Request(`https://api.test/files/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
  });

const getFile = (id: string) =>
  new Request(`https://api.test/files/${id}`, { method: "GET" });

describe("GET /files/:fileId", () => {
  it("returns the stored bytes", async () => {
    const { env, objects } = envWith({});
    objects.set("f1", new TextEncoder().encode("hello"));

    const res = await worker.fetch(getFile("f1"), env);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("hello");
  });

  it("404s for a missing object and still sends CORS", async () => {
    const { env } = envWith({});

    const res = await worker.fetch(getFile("missing"), env);

    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("PUT /files/:fileId", () => {
  it("stores the bytes and returns 204", async () => {
    const { env, objects } = envWith({});

    const res = await worker.fetch(
      putFile("f1", new TextEncoder().encode("hello")),
      env,
    );

    expect(res.status).toBe(204);
    expect(new TextDecoder().decode(objects.get("f1"))).toBe("hello");
  });

  it("overwrites an existing object", async () => {
    const { env, objects } = envWith({});

    await worker.fetch(putFile("f1", new TextEncoder().encode("first")), env);
    await worker.fetch(putFile("f1", new TextEncoder().encode("second")), env);

    expect(new TextDecoder().decode(objects.get("f1"))).toBe("second");
  });

  it("413s when the body declares more than the cap", async () => {
    const { env, objects } = envWith({});

    const res = await worker.fetch(
      new Request("https://api.test/files/f1", {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(MAX_FILE_BYTES + 1),
        },
        body: new Uint8Array(1),
      }),
      env,
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(objects.size).toBe(0);
  });

  it("413s on a chunked body that exceeds the cap with no content-length", async () => {
    const { env, objects } = envWith({});

    const res = await worker.fetch(
      streamedRequest(
        "https://api.test/files/f1",
        [new Uint8Array(MAX_FILE_BYTES + 1)],
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
        },
      ),
      env,
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(objects.size).toBe(0);
  });
});

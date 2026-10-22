import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";

import { fakeD1, fakeR2, fakeRooms } from "./fakes";

const envWith = (seed: { all?: unknown[] } = {}, apiKey = "key") => {
  const d1 = fakeD1(seed);
  return {
    env: {
      DB: d1.db,
      FILES: fakeR2().bucket,
      ROOMS: fakeRooms(),
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

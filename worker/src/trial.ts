import { fail, HttpError, json, readJson } from "./http";

import type { Env } from "./types";

const MAX_TRIAL_REQUEST_CHARS = 40_000;
const GEMINI_STALL_MS = 20_000;

export const isValidDeviceId = (deviceId: unknown): deviceId is string =>
  typeof deviceId === "string" && /^[\w-]{8,64}$/.test(deviceId);

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

const getIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ?? "unknown";

const getLimits = (env: Env) => ({
  device: Number(env.AI_TRIAL_PER_DEVICE || 20),
  ip: Number(env.AI_TRIAL_PER_IP || 40),
  global: Number(env.AI_TRIAL_GLOBAL || 400),
});

const getModels = (env: Env) =>
  (env.GEMINI_MODELS || "gemini-3.5-flash-lite,gemini-3.1-flash-lite")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

const trialKeys = (deviceId: string, ip: string) => ({
  device: `device:${deviceId}`,
  ip: `ip:${ip}`,
  global: "global",
});

let lastPrunedDay = "";

const pruneOldDays = async (env: Env, day: string) => {
  if (lastPrunedDay !== day) {
    lastPrunedDay = day;
    try {
      await env.DB.prepare("DELETE FROM trial_usage WHERE day < ?")
        .bind(day)
        .run();
    } catch {
      // Ignore cleanup failures
    }
  }
};

const readRemaining = async (
  env: Env,
  day: string,
  deviceId: string,
  ip: string,
) => {
  const limits = getLimits(env);
  const keys = trialKeys(deviceId, ip);
  const rows = await env.DB.prepare(
    "SELECT key, count FROM trial_usage WHERE day = ? AND key IN (?, ?, ?)",
  )
    .bind(day, keys.device, keys.ip, keys.global)
    .all<{ key: string; count: number }>();

  const counts = new Map<string, number>();
  for (const row of rows.results ?? []) {
    counts.set(row.key, row.count);
  }

  const remaining = Math.max(
    0,
    Math.min(
      limits.device - (counts.get(keys.device) || 0),
      limits.ip - (counts.get(keys.ip) || 0),
      limits.global - (counts.get(keys.global) || 0),
    ),
  );

  return { remaining, limit: limits.device };
};

export const handleTrialStatus = async (
  env: Env,
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId");
  if (!isValidDeviceId(deviceId)) {
    return fail(400, "invalid_device_id");
  }

  const day = today();
  await pruneOldDays(env, day);

  const ip = getIp(request);
  const { remaining, limit } = await readRemaining(env, day, deviceId, ip);

  return json({
    enabled: !!env.GEMINI_API_KEY,
    remaining,
    limit,
  });
};

type GeminiRequestBody = {
  deviceId?: unknown;
  request?: {
    contents?: unknown;
    systemInstruction?: unknown;
    generationConfig?: unknown;
    tools?: unknown;
  };
};

export const handleTrialGenerate = async (
  env: Env,
  request: Request,
): Promise<Response> => {
  if (!env.GEMINI_API_KEY) {
    return fail(503, "trial_disabled");
  }

  let body: GeminiRequestBody;
  try {
    body = await readJson<GeminiRequestBody>(request);
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(error.status, error.code);
    }
    return fail(400, "invalid_request");
  }

  const { deviceId, request: geminiRequest } = body || {};
  if (!isValidDeviceId(deviceId) || !geminiRequest?.contents) {
    return fail(400, "invalid_request");
  }

  const parts = [geminiRequest.contents, geminiRequest.systemInstruction].flat(
    2,
  );
  const hasMedia = /"(inlineData|fileData)"/.test(JSON.stringify(parts));
  if (hasMedia) {
    return fail(415, "media_not_allowed");
  }

  if (JSON.stringify(geminiRequest).length > MAX_TRIAL_REQUEST_CHARS) {
    return fail(413, "request_too_large");
  }

  const day = today();
  await pruneOldDays(env, day);

  const ip = getIp(request);
  const { remaining, limit } = await readRemaining(env, day, deviceId, ip);

  if (remaining <= 0) {
    return fail(429, "trial_exhausted");
  }

  const keys = trialKeys(deviceId, ip);
  for (const key of [keys.device, keys.ip, keys.global]) {
    await env.DB.prepare(
      "INSERT INTO trial_usage (day, key, count) VALUES (?, ?, 1) ON CONFLICT(day, key) DO UPDATE SET count = count + 1",
    )
      .bind(day, key)
      .run();
  }

  const refund = async () => {
    for (const key of [keys.device, keys.ip, keys.global]) {
      await env.DB.prepare(
        "UPDATE trial_usage SET count = MAX(count - 1, 0) WHERE day = ? AND key = ?",
      )
        .bind(day, key)
        .run();
    }
  };

  try {
    const models = getModels(env);
    let geminiRes: Response | null = null;

    for (const model of models) {
      const stall = new AbortController();
      const stallTimer = setTimeout(() => stall.abort(), GEMINI_STALL_MS);
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: geminiRequest.contents,
            systemInstruction: geminiRequest.systemInstruction,
            generationConfig: geminiRequest.generationConfig,
            tools: Array.isArray(geminiRequest.tools)
              ? geminiRequest.tools
              : undefined,
          }),
          signal: stall.signal,
        },
      )
        .catch(() => null)
        .finally(() => clearTimeout(stallTimer));

      if (geminiRes && geminiRes.status !== 503) {
        break;
      }
    }

    if (!geminiRes || geminiRes.status === 503) {
      await refund();
      return fail(429, "trial_busy");
    }

    if (!geminiRes.ok) {
      await refund();
      const code = geminiRes.status === 429 ? "trial_busy" : "upstream_error";
      return fail(geminiRes.status === 429 ? 429 : 502, code);
    }

    const data = await geminiRes.json();
    return json({
      response: data,
      remaining: Math.max(0, remaining - 1),
      limit,
    });
  } catch (error) {
    await refund();
    console.error("trial generate failed:", error);
    return fail(502, "upstream_error");
  }
};

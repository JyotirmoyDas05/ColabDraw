import { parseSSEStream } from "@excalidraw/excalidraw";
import { safelyParseJSON } from "@excalidraw/common";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const TRIAL_URL = `${import.meta.env.VITE_APP_WS_SERVER_URL}/api/ai/trial`;

const API_KEY_STORAGE_KEY = "colabdraw-gemini-api-key";
const DEVICE_ID_STORAGE_KEY = "colabdraw-device-id";

export type GeminiPart = { text: string };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type GeminiRequest = {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: Record<string, unknown>;
};

export type TrialStatus = {
  enabled: boolean;
  remaining: number;
  limit: number;
};

export type AIErrorCode =
  | "trial_exhausted" // this device used today's free requests
  | "trial_busy" // the shared trial key ran out of quota for everyone
  | "trial_disabled"
  | "invalid_key"
  | "quota_exceeded" // the user's own key hit its free-tier limit
  | "network";

export class AIError extends Error {
  constructor(public code: AIErrorCode, message: string = code) {
    super(message);
    this.name = "AIError";
  }
}

export const getUserApiKey = () => localStorage.getItem(API_KEY_STORAGE_KEY);

export const setUserApiKey = (apiKey: string | null) => {
  if (apiKey) {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
};

const getDeviceId = () => {
  let deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  }
  return deviceId;
};

const getText = (response: any): string =>
  response?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? "")
    .join("") ?? "";

const toGeminiError = async (res: Response) => {
  const body = await res.text();
  if (res.status === 429) {
    return new AIError("quota_exceeded");
  }
  if (res.status === 403 || /API_KEY_INVALID|API key not valid/.test(body)) {
    return new AIError("invalid_key");
  }
  return new AIError("network", `Gemini error ${res.status}`);
};

/** Checks a key without using any generation quota. */
export const validateApiKey = async (apiKey: string) => {
  const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}`, {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!res.ok) {
    throw await toGeminiError(res);
  }
};

export const getTrialStatus = async (): Promise<TrialStatus | null> => {
  try {
    const res = await fetch(`${TRIAL_URL}?deviceId=${getDeviceId()}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

const generateWithApiKey = async (
  apiKey: string,
  request: GeminiRequest,
  signal?: AbortSignal,
  onChunk?: (delta: string) => void,
) => {
  const res = await fetch(
    `${GEMINI_URL}/${GEMINI_MODEL}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(request),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw await toGeminiError(res);
  }
  let text = "";
  for await (const data of parseSSEStream(res.body.getReader())) {
    const delta = getText(safelyParseJSON(data));
    if (delta) {
      text += delta;
      onChunk?.(delta);
    }
  }
  return text;
};

const generateWithTrial = async (
  request: GeminiRequest,
  signal?: AbortSignal,
) => {
  const res = await fetch(`${TRIAL_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getDeviceId(), request }),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.error;
    throw new AIError(
      ["trial_exhausted", "trial_busy", "trial_disabled"].includes(code)
        ? code
        : "network",
    );
  }
  return {
    text: getText(data.response),
    trial: {
      enabled: true,
      remaining: data.remaining,
      limit: data.limit,
    } as TrialStatus,
  };
};

/**
 * Runs a Gemini request with the user's own key (streamed, direct from the
 * browser) or, without a key, through the server's rate-limited free trial.
 */
export const generate = async (
  request: GeminiRequest,
  {
    signal,
    onChunk,
  }: { signal?: AbortSignal; onChunk?: (delta: string) => void } = {},
): Promise<{ text: string; trial: TrialStatus | null }> => {
  try {
    const apiKey = getUserApiKey();
    if (apiKey) {
      const text = await generateWithApiKey(apiKey, request, signal, onChunk);
      return { text, trial: null };
    }
    const { text, trial } = await generateWithTrial(request, signal);
    onChunk?.(text);
    return { text, trial };
  } catch (error: any) {
    if (error instanceof AIError || error?.name === "AbortError") {
      throw error;
    }
    throw new AIError("network", error?.message);
  }
};

import { parseSSEStream } from "@excalidraw/excalidraw";
import { safelyParseJSON } from "@excalidraw/common";

import { BACKEND_URL } from "../data/backend";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";
// tried in order when a model is overloaded (503) or stalls
const GEMINI_MODELS = [GEMINI_MODEL, "gemini-3.1-flash-lite"];
const STALL_MS = 20000;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const TRIAL_URL = `${BACKEND_URL}/ai/trial`;

const API_KEY_STORAGE_KEY = "colabdraw-gemini-api-key";
const DEVICE_ID_STORAGE_KEY = "colabdraw-device-id";
const SETTINGS_STORAGE_KEY = "colabdraw-ai-settings";

export type AISettings = {
  /** "nano" runs Chrome's built-in Gemini Nano on this device */
  engine: "gemini" | "nano";
  /** "auto" picks on-device browser speech, else the Whisper model */
  speech: "auto" | "whisper" | "browser";
  /** BCP 47 tag, empty for the browser language */
  speechLang: string;
  /** send voice commands as soon as you stop talking */
  autoSend: boolean;
};

const DEFAULT_SETTINGS: AISettings = {
  engine: "gemini",
  speech: "auto",
  speechLang: "",
  autoSend: true,
};

export const getAISettings = (): AISettings => ({
  ...DEFAULT_SETTINGS,
  ...safelyParseJSON(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}"),
});

export const setAISettings = (settings: AISettings) =>
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, any> } }
  | { functionResponse: { name: string; response: Record<string, any> } };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters: object;
};

export type GeminiRequest = {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: Record<string, unknown>;
  tools?: { functionDeclarations: FunctionDeclaration[] }[];
};

export type FunctionCall = { name: string; args: Record<string, any> };

export type GenerateResult = {
  text: string;
  calls: FunctionCall[];
  trial: TrialStatus | null;
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
  | "nano_unavailable"
  | "model_busy" // every Gemini model we tried was overloaded
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

const getParts = (response: any): any[] =>
  response?.candidates?.[0]?.content?.parts ?? [];

const getText = (response: any): string =>
  getParts(response)
    .map((part) => part.text ?? "")
    .join("");

const getCalls = (response: any): FunctionCall[] =>
  getParts(response)
    .filter((part) => part.functionCall)
    .map((part) => ({
      name: part.functionCall.name,
      args: part.functionCall.args ?? {},
    }));

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

const openStream = async (
  apiKey: string,
  model: string,
  request: GeminiRequest,
  signal?: AbortSignal,
) => {
  // overloaded models sometimes never answer, so give up on headers after a while
  const stall = new AbortController();
  const timer = setTimeout(() => stall.abort(), STALL_MS);
  try {
    return await fetch(`${GEMINI_URL}/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(request),
      signal: signal ? AbortSignal.any([signal, stall.signal]) : stall.signal,
    });
  } catch (error: any) {
    if (stall.signal.aborted && !signal?.aborted) {
      return null;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const generateWithApiKey = async (
  apiKey: string,
  request: GeminiRequest,
  signal?: AbortSignal,
  onChunk?: (delta: string) => void,
) => {
  let res: Response | null = null;
  for (const model of GEMINI_MODELS) {
    res = await openStream(apiKey, model, request, signal);
    if (res && res.status !== 503 && res.status !== 500) {
      break;
    }
  }
  if (!res || res.status === 503 || res.status === 500) {
    throw new AIError("model_busy");
  }
  if (!res.ok || !res.body) {
    throw await toGeminiError(res);
  }
  let text = "";
  const calls: FunctionCall[] = [];
  for await (const data of parseSSEStream(res.body.getReader())) {
    const chunk = safelyParseJSON(data);
    const delta = getText(chunk);
    calls.push(...getCalls(chunk));
    if (delta) {
      text += delta;
      onChunk?.(delta);
    }
  }
  return { text, calls };
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
    calls: getCalls(data.response),
    trial: {
      enabled: true,
      remaining: data.remaining,
      limit: data.limit,
    } as TrialStatus,
  };
};

// Chrome's built-in AI (Prompt API), feature-detected
declare const LanguageModel: any;

const NANO_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export const getNanoAvailability = async (): Promise<
  "unavailable" | "downloadable" | "downloading" | "available"
> => {
  try {
    return typeof LanguageModel === "undefined"
      ? "unavailable"
      : await LanguageModel.availability(NANO_OPTIONS);
  } catch {
    return "unavailable";
  }
};

/** Must run from a click: Chrome only starts the model download on user activation. */
export const downloadNano = async (onProgress: (fraction: number) => void) => {
  const session = await LanguageModel.create({
    ...NANO_OPTIONS,
    monitor: (monitor: EventTarget) =>
      monitor.addEventListener("downloadprogress", (event: any) =>
        onProgress(event.loaded),
      ),
  });
  session.destroy();
};

/** Gemini's schema dialect uses upper-case types; the Prompt API wants JSON Schema */
const toJSONSchema = (schema: any): any =>
  Array.isArray(schema)
    ? schema.map(toJSONSchema)
    : schema && typeof schema === "object"
    ? Object.fromEntries(
        Object.entries(schema).map(([key, value]) => [
          key,
          key === "type" && typeof value === "string"
            ? value.toLowerCase()
            : toJSONSchema(value),
        ]),
      )
    : schema;

const partsToText = (parts: GeminiPart[]) =>
  parts.map((part) => ("text" in part ? part.text : "")).join("\n");

const generateWithNano = async (
  request: GeminiRequest,
  signal?: AbortSignal,
) => {
  if ((await getNanoAvailability()) === "unavailable") {
    throw new AIError("nano_unavailable");
  }
  const history = request.contents.slice(0, -1);
  const last = request.contents[request.contents.length - 1];
  const session = await LanguageModel.create({
    ...NANO_OPTIONS,
    signal,
    initialPrompts: [
      ...(request.systemInstruction
        ? [
            {
              role: "system",
              content: partsToText(request.systemInstruction.parts),
            },
          ]
        : []),
      ...history.map((content) => ({
        role: content.role === "model" ? "assistant" : "user",
        content: partsToText(content.parts),
      })),
    ],
  });
  try {
    const functions = request.tools?.flatMap(
      (tool) => tool.functionDeclarations,
    );
    if (!functions?.length) {
      return {
        text: await session.prompt(partsToText(last.parts), { signal }),
        calls: [],
      };
    }
    // no function calling on-device: constrain the output to the same calls instead
    const raw = await session.prompt(partsToText(last.parts), {
      signal,
      responseConstraint: {
        type: "object",
        properties: {
          reply: { type: "string" },
          calls: {
            type: "array",
            items: {
              anyOf: functions.map((fn) => ({
                type: "object",
                properties: {
                  name: { const: fn.name },
                  args: toJSONSchema(fn.parameters),
                },
                required: ["name", "args"],
              })),
            },
          },
        },
        required: ["reply", "calls"],
      },
    });
    const json = safelyParseJSON(raw);
    return {
      text: String(json?.reply ?? raw),
      calls: Array.isArray(json?.calls) ? (json.calls as FunctionCall[]) : [],
    };
  } finally {
    session.destroy();
  }
};

/**
 * Runs a Gemini request on-device (Gemini Nano, when chosen), with the user's
 * own key (streamed, direct from the browser) or, without a key, through the
 * server's rate-limited free trial.
 */
export const generate = async (
  request: GeminiRequest,
  {
    signal,
    onChunk,
  }: { signal?: AbortSignal; onChunk?: (delta: string) => void } = {},
): Promise<GenerateResult> => {
  try {
    if (getAISettings().engine === "nano") {
      const result = await generateWithNano(request, signal);
      onChunk?.(result.text);
      return { ...result, trial: null };
    }
    const apiKey = getUserApiKey();
    if (apiKey) {
      const result = await generateWithApiKey(apiKey, request, signal, onChunk);
      return { ...result, trial: null };
    }
    const result = await generateWithTrial(request, signal);
    onChunk?.(result.text);
    return result;
  } catch (error: any) {
    if (error instanceof AIError || error?.name === "AbortError") {
      throw error;
    }
    throw new AIError("network", error?.message);
  }
};

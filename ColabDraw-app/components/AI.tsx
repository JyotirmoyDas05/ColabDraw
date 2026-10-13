import { TTDDialog } from "@excalidraw/excalidraw";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { RequestError } from "@excalidraw/excalidraw/errors";

import { useEffect } from "react";

import { useAtom, useAtomValue, useSetAtom } from "../app-jotai";
import {
  AIError,
  generate,
  getTrialStatus,
  getUserApiKey,
} from "../ai/aiClient";
import {
  aiKeyDialogOpenAtom,
  aiLastErrorAtom,
  aiStatusAtom,
  aiTrialAtom,
} from "../ai/aiState";
import { TTDIndexedDBAdapter } from "../data/TTDStorage";

import type { AIErrorCode } from "../ai/aiClient";

const MERMAID_SYSTEM_PROMPT = `You turn the user's description into a single Mermaid diagram. It is converted into an editable, hand-drawn Excalidraw whiteboard drawing.

Rules:
- Reply with Mermaid code only: no prose, no markdown code fences.
- Prefer "flowchart TD" ("flowchart LR" for wide pipelines). Use "sequenceDiagram" for interactions over time between actors and "classDiagram" for data models. Other diagram types become a static image, so only use them when explicitly asked.
- Give every node a short id and a quoted label, e.g. A["User signs in"]. Keep labels under about six words.
- Use shapes meaningfully: A(["Start"]) for start/end, B{"Valid?"} for decisions, C[("Database")] for storage.
- Label decision branches: B -- "yes" --> C.
- Group related nodes with "subgraph Name ... end" when it helps.
- At most about 25 nodes; prefer clarity over completeness.
- When the user asks for a change, return the full updated diagram.
- If the request is ambiguous, make a sensible assumption instead of asking.`;

const stripCodeFences = (text: string) =>
  text
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

const RATE_LIMIT_ERRORS: AIErrorCode[] = [
  "trial_exhausted",
  "trial_busy",
  "quota_exceeded",
];

const ERROR_MESSAGES: Record<AIErrorCode, string> = {
  trial_exhausted: "You've used today's free AI requests.",
  trial_busy: "The free AI trial is busy right now.",
  trial_disabled: "The free AI trial isn't available right now.",
  invalid_key: "Your Gemini key was rejected. Check it in AI settings.",
  quota_exceeded: "Your Gemini key hit its free daily limit.",
  nano_unavailable: "Gemini Nano isn't available in this browser.",
  network: "Couldn't reach the AI. Check your connection and try again.",
};

const AIKeyPrompt = ({ errorCode }: { errorCode: AIErrorCode | null }) => {
  const openKeyDialog = useSetAtom(aiKeyDialogOpenAtom);
  return (
    <div>
      {errorCode ? ERROR_MESSAGES[errorCode] : ERROR_MESSAGES.trial_exhausted}{" "}
      {errorCode === "quota_exceeded"
        ? "It resets at midnight Pacific time."
        : "Add your own free Gemini key to keep going."}
      <div style={{ marginTop: "10px" }}>
        <FilledButton
          label={
            errorCode === "quota_exceeded" ? "AI settings" : "Add free key"
          }
          onClick={() => openKeyDialog(true)}
        />
      </div>
    </div>
  );
};

const TTDWelcome = () => {
  const [trial, setTrial] = useAtom(aiTrialAtom);
  const openKeyDialog = useSetAtom(aiKeyDialogOpenAtom);
  const hasOwnKey = !!getUserApiKey();

  useEffect(() => {
    if (!hasOwnKey) {
      getTrialStatus().then(setTrial);
    }
  }, [hasOwnKey, setTrial]);
  return (
    <div className="chat-interface__welcome-screen__welcome-message">
      <h3>Describe a diagram</h3>
      <p>
        Try "user signup flow with email verification" or "how a CDN serves a
        request". Then ask for changes in plain words.
      </p>
      <p style={{ opacity: 0.7, fontSize: "0.875rem" }}>
        {hasOwnKey
          ? "Using your own Gemini key. "
          : trial?.enabled
          ? `${trial.remaining} of ${trial.limit} free requests left today. `
          : "Powered by Gemini. "}
        <button
          type="button"
          onClick={() => openKeyDialog(true)}
          style={{
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--color-primary)",
            textDecoration: "underline",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          AI settings
        </button>
      </p>
    </div>
  );
};

export const AIComponents = () => {
  const setStatus = useSetAtom(aiStatusAtom);
  const setLastError = useSetAtom(aiLastErrorAtom);
  const setTrial = useSetAtom(aiTrialAtom);
  const lastError = useAtomValue(aiLastErrorAtom);

  return (
    <TTDDialog
      onTextSubmit={async ({ messages, onChunk, onStreamCreated, signal }) => {
        setStatus("thinking");
        setLastError(null);
        try {
          onStreamCreated?.();
          const { text, trial } = await generate(
            {
              systemInstruction: { parts: [{ text: MERMAID_SYSTEM_PROMPT }] },
              contents: messages.map((message) => ({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: message.content }],
              })),
              generationConfig: { temperature: 0.2 },
            },
            { signal, onChunk },
          );
          if (trial) {
            setTrial(trial);
          }
          setStatus("done");
          return {
            generatedResponse: stripCodeFences(text),
            error: null,
            rateLimit: trial?.limit ?? null,
            rateLimitRemaining: trial?.remaining ?? null,
          };
        } catch (error: any) {
          if (error?.name === "AbortError") {
            setStatus("idle");
            return {
              error: new RequestError({
                message: "Request aborted",
                status: 499,
              }),
            };
          }
          const code: AIErrorCode =
            error instanceof AIError ? error.code : "network";
          setStatus("error");
          setLastError(code);
          return {
            error: new RequestError({
              message: ERROR_MESSAGES[code],
              status: RATE_LIMIT_ERRORS.includes(code) ? 429 : 500,
            }),
          };
        }
      }}
      persistenceAdapter={TTDIndexedDBAdapter}
      renderWelcomeScreen={() => <TTDWelcome />}
      renderWarning={(message) =>
        message.warningType ? <AIKeyPrompt errorCode={lastError} /> : undefined
      }
    />
  );
};

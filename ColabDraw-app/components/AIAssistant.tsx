import {
  ArrowRightIcon,
  CloseIcon,
  TrashIcon,
  mermaidLogoIcon,
  microphoneIcon,
  settingsIcon,
} from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom, useAtomValue, useSetAtom } from "../app-jotai";
import {
  AIError,
  generate,
  getAISettings,
  getTrialStatus,
  getUserApiKey,
} from "../ai/aiClient";
import {
  aiKeyDialogOpenAtom,
  aiLevelAtom,
  aiPanelOpenAtom,
  aiStatusAtom,
  aiTrialAtom,
} from "../ai/aiState";
import {
  CANVAS_FUNCTIONS,
  CANVAS_SYSTEM_PROMPT,
  functionCallToOps,
  applyCanvasOps,
  buildCanvasContext,
  snapshotElements,
} from "../ai/canvasAgent";
import { startLiveSession } from "../ai/live";
import { isOnDevice, startListening } from "../ai/speech";

import { AIBuddy } from "./AIBuddy/AIBuddy";

import "./AIAssistant.scss";

import type { AIErrorCode, GeminiContent } from "../ai/aiClient";
import type { ApplyResult } from "../ai/canvasAgent";
import type { LiveSession } from "../ai/live";
import type { ListeningSession, SpeechEngine } from "../ai/speech";

type Message = {
  role: "user" | "model";
  text: string;
  note?: string;
  error?: AIErrorCode;
};

const HISTORY_LIMIT = 8;
// a press longer than this is hold-to-talk; shorter toggles listening
const HOLD_MS = 350;

const SUGGESTIONS = [
  "Explain what's on the board",
  "Add a database connected to the API",
  "Turn my selection into a flowchart",
  "Group these into a frame called Backend",
];

const ERROR_TEXT: Record<AIErrorCode, string> = {
  trial_exhausted: "You've used today's free AI requests.",
  trial_busy: "The free AI trial is busy right now. Try again soon.",
  trial_disabled: "The free AI trial isn't available right now.",
  invalid_key: "Your Gemini key was rejected.",
  quota_exceeded: "Your Gemini key hit its free daily limit.",
  nano_unavailable: "Gemini Nano isn't available in this browser.",
  model_busy: "Gemini is overloaded right now. Try again in a minute.",
  network: "Couldn't reach the AI. Check your connection and try again.",
};

// errors a (different) key fixes
const KEY_ERRORS: AIErrorCode[] = [
  "trial_exhausted",
  "trial_busy",
  "trial_disabled",
  "invalid_key",
  "quota_exceeded",
];

const describeResult = ({
  added,
  changed,
  deleted,
  libraryAdded,
}: ApplyResult) =>
  [
    added && `added ${added}`,
    changed && `changed ${changed}`,
    deleted && `removed ${deleted}`,
    libraryAdded && `saved ${libraryAdded} to your library`,
  ]
    .filter(Boolean)
    .join(", ");

export const AIAssistant = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [isOpen, setIsOpen] = useAtom(aiPanelOpenAtom);
  const [status, setStatus] = useAtom(aiStatusAtom);
  const [trial, setTrial] = useAtom(aiTrialAtom);
  const level = useAtomValue(aiLevelAtom);
  const setLevel = useSetAtom(aiLevelAtom);
  const openKeyDialog = useSetAtom(aiKeyDialogOpenAtom);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [speechEngine, setSpeechEngine] = useState<SpeechEngine | null>(null);
  const [speechStatus, setSpeechStatus] = useState("");
  const [isLive, setIsLive] = useState(false);

  const listeningRef = useRef<ListeningSession | null>(null);
  const pressStartRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef<LiveSession | null>(null);
  const liveAliasesRef = useRef<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // voice callbacks outlive the render that created them
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const hasOwnKey = !!getUserApiKey();
  const isBusy = status === "thinking" || status === "drawing";

  useEffect(() => {
    if (isOpen && !hasOwnKey && getAISettings().engine === "gemini") {
      getTrialStatus().then(setTrial);
    }
  }, [isOpen, hasOwnKey, setTrial]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(
    () => () => {
      listeningRef.current?.cancel();
      liveRef.current?.stop();
      abortRef.current?.abort();
    },
    [],
  );

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || isBusy) {
      return;
    }
    setInput("");
    const history = messagesRef.current
      .filter((message) => !message.error && message.text)
      .slice(-HISTORY_LIMIT);
    setMessages((prev) => [...prev, { role: "user", text: prompt }]);
    setStatus("thinking");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const context = await buildCanvasContext(excalidrawAPI, prompt);
      const parts: GeminiContent["parts"] = [
        { text: `${prompt}\n\n${context.text}` },
      ];
      // the free trial is text-only, so drawings are only shown with an own key
      if (
        context.visualElements.length &&
        hasOwnKey &&
        getAISettings().engine === "gemini"
      ) {
        parts.push(
          await snapshotElements(excalidrawAPI, context.visualElements),
        );
      }
      const {
        text,
        calls,
        trial: nextTrial,
      } = await generate(
        {
          systemInstruction: { parts: [{ text: CANVAS_SYSTEM_PROMPT }] },
          contents: [
            ...history.map(
              (message): GeminiContent => ({
                role: message.role,
                parts: [{ text: message.text }],
              }),
            ),
            { role: "user", parts },
          ],
          tools: [{ functionDeclarations: CANVAS_FUNCTIONS }],
          generationConfig: { temperature: 0.3 },
        },
        { signal: controller.signal },
      );
      if (nextTrial) {
        setTrial(nextTrial);
      }
      const response = {
        reply: text.trim() || (calls.length ? "Done." : "I'm not sure."),
        ops: calls.flatMap(functionCallToOps),
      };
      let note: string | undefined;
      if (response.ops.length) {
        setStatus("drawing");
        try {
          const result = await applyCanvasOps(
            excalidrawAPI,
            response.ops,
            context.aliases,
          );
          const summary = describeResult(result);
          note = summary ? `${summary} · Ctrl+Z to undo` : undefined;
        } catch (applyError) {
          // the AI answered; the board just couldn't take that change
          console.error(applyError);
          setMessages((prev) => [
            ...prev,
            {
              role: "model",
              text: "I couldn't apply that to the board. Try rephrasing, or ask for a smaller change.",
              error: "network",
            },
          ]);
          setStatus("error");
          return;
        }
      }
      setMessages((prev) => [
        ...prev,
        { role: "model", text: response.reply, note },
      ]);
      setStatus("done");
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setStatus("idle");
        return;
      }
      console.error(error);
      const code: AIErrorCode =
        error instanceof AIError ? error.code : "network";
      setMessages((prev) => [
        ...prev,
        { role: "model", text: ERROR_TEXT[code], error: code },
      ]);
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  };

  // --- voice ---------------------------------------------------------------

  const finishListening = async () => {
    const session = listeningRef.current;
    if (!session) {
      return;
    }
    listeningRef.current = null;
    setStatus("thinking");
    try {
      const transcript = await session.stop();
      setStatus("idle");
      if (!transcript) {
        return;
      }
      if (getAISettings().autoSend) {
        send(transcript);
      } else {
        setInput(transcript);
      }
    } catch (error) {
      console.error(error);
      setStatus("error");
      setSpeechStatus("Couldn't transcribe that. Try again.");
    }
  };

  const startVoice = async () => {
    if (listeningRef.current || isBusy || isLive) {
      return;
    }
    setSpeechStatus("");
    try {
      const session = await startListening({
        settings: getAISettings(),
        onPartial: setInput,
        onLevel: setLevel,
        onStatus: setSpeechStatus,
        onEnd: finishListening,
      });
      listeningRef.current = session;
      setSpeechEngine(session.engine);
      setStatus("listening");
    } catch (error: any) {
      setStatus("error");
      setSpeechStatus(
        error?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the address bar."
          : "Couldn't start the microphone.",
      );
    }
  };

  const onMicDown = () => {
    pressStartRef.current = Date.now();
    if (listeningRef.current) {
      finishListening();
      pressStartRef.current = 0;
    } else {
      startVoice();
    }
  };

  const onMicUp = () => {
    if (pressStartRef.current && Date.now() - pressStartRef.current > HOLD_MS) {
      finishListening();
    }
  };

  // --- live conversation -----------------------------------------------------

  const toggleLive = async () => {
    if (liveRef.current) {
      liveRef.current.stop();
      return;
    }
    const apiKey = getUserApiKey();
    if (!apiKey) {
      openKeyDialog(true);
      return;
    }
    listeningRef.current?.cancel();
    listeningRef.current = null;
    setIsLive(true);
    const context = await buildCanvasContext(excalidrawAPI);
    liveAliasesRef.current = context.aliases;
    let lastRole: Message["role"] | null = null;
    try {
      liveRef.current = await startLiveSession({
        apiKey,
        systemPrompt: `${CANVAS_SYSTEM_PROMPT}\n\nYou are in a live voice conversation. Speak briefly and naturally. Edit the board by calling the functions instead of describing changes aloud.\n\nThe board when the conversation started:\n${context.text}`,
        onState: (state) => {
          if (state === "closed") {
            liveRef.current = null;
            setIsLive(false);
            setStatus("idle");
          } else {
            setStatus(state === "connecting" ? "thinking" : "listening");
          }
        },
        onLevel: setLevel,
        onTranscript: (role, text) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && lastRole === role && last.role === role) {
              return [
                ...prev.slice(0, -1),
                { ...last, text: last.text + text },
              ];
            }
            lastRole = role;
            return [...prev, { role, text: text.trimStart() }];
          });
        },
        onToolCalls: async (calls) => {
          if (calls.some((call) => call.name === "read_canvas")) {
            const fresh = await buildCanvasContext(excalidrawAPI);
            liveAliasesRef.current = fresh.aliases;
          }
          const ops = calls.flatMap(functionCallToOps);
          const result = ops.length
            ? await applyCanvasOps(excalidrawAPI, ops, liveAliasesRef.current)
            : null;
          if (result) {
            lastRole = null;
            setMessages((prev) => [
              ...prev,
              {
                role: "model",
                text: "",
                note: `${
                  describeResult(result) || "no changes"
                } · Ctrl+Z to undo`,
              },
            ]);
          }
          const canvas =
            calls.some((call) => call.name === "read_canvas") &&
            (await buildCanvasContext(excalidrawAPI)).text;
          return calls.map((call) =>
            call.name === "read_canvas" ? { canvas } : { ok: true },
          );
        },
        onError: (message) =>
          setMessages((prev) => [
            ...prev,
            { role: "model", text: message, error: "network" },
          ]),
      });
    } catch (error: any) {
      setIsLive(false);
      setStatus("error");
      setSpeechStatus(
        error?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the address bar."
          : "Couldn't start the live conversation.",
      );
    }
  };

  if (!isOpen) {
    return null;
  }

  const engine = getAISettings().engine;
  const quota =
    engine === "nano"
      ? "Gemini Nano · on this device"
      : hasOwnKey
      ? "Your Gemini key"
      : trial?.enabled
      ? `${trial.remaining}/${trial.limit} free today`
      : "Gemini";

  return (
    <div
      className="ai-assistant"
      role="dialog"
      aria-label="AI assistant"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      <header className="ai-assistant__header">
        <AIBuddy state={status} size={22} level={level} followCursor={false} />
        <div className="ai-assistant__title">
          <strong>ColabDraw AI</strong>
          <span>{quota}</span>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="ai-assistant__icon-button"
            title="New conversation"
            aria-label="New conversation"
            onClick={() => setMessages([])}
          >
            {TrashIcon}
          </button>
        )}
        <button
          type="button"
          className="ai-assistant__icon-button"
          title="AI settings"
          aria-label="AI settings"
          onClick={() => openKeyDialog(true)}
        >
          {settingsIcon}
        </button>
        <button
          type="button"
          className="ai-assistant__icon-button"
          title="Close"
          aria-label="Close"
          onClick={() => setIsOpen(false)}
        >
          {CloseIcon}
        </button>
      </header>

      <div className="ai-assistant__messages">
        {messages.length === 0 ? (
          <div className="ai-assistant__empty">
            <p>
              Ask about the board or tell it what to draw. Select things first
              to work on just those.
            </p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="ai-assistant__chip"
                onClick={() => send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
            <button
              type="button"
              className="ai-assistant__chip"
              onClick={() =>
                excalidrawAPI.updateScene({
                  appState: {
                    openDialog: { name: "ttd", tab: "text-to-diagram" },
                  },
                })
              }
            >
              {mermaidLogoIcon} Diagram chat with preview
            </button>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={clsx(
                "ai-assistant__message",
                `ai-assistant__message--${message.role}`,
                { "ai-assistant__message--error": message.error },
              )}
            >
              {message.text && <p>{message.text}</p>}
              {message.note && (
                <span className="ai-assistant__note">{message.note}</span>
              )}
              {message.error && KEY_ERRORS.includes(message.error) && (
                <button
                  type="button"
                  className="ai-assistant__link"
                  onClick={() => openKeyDialog(true)}
                >
                  {message.error === "quota_exceeded" ||
                  message.error === "invalid_key"
                    ? "Open AI settings"
                    : "Add your own free key"}
                </button>
              )}
            </div>
          ))
        )}
        {isBusy && (
          <div className="ai-assistant__message ai-assistant__message--model ai-assistant__typing">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {(speechStatus || speechEngine) && (
        <div className="ai-assistant__speech">
          {speechEngine && (
            <span
              className={clsx("ai-assistant__badge", {
                "ai-assistant__badge--cloud": !isOnDevice(speechEngine),
              })}
              title={
                isOnDevice(speechEngine)
                  ? "Your voice is transcribed on this device"
                  : "Your browser sends audio to its speech service"
              }
            >
              {isOnDevice(speechEngine) ? "On-device" : "Cloud"}
            </span>
          )}
          <span>{speechStatus}</span>
        </div>
      )}

      <form
        className="ai-assistant__input"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          rows={2}
          placeholder={
            status === "listening" ? "Listening…" : "Ask or describe a change…"
          }
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <div className="ai-assistant__actions">
          <button
            type="button"
            className={clsx("ai-assistant__live", {
              "ai-assistant__live--on": isLive,
            })}
            title={
              hasOwnKey
                ? "Live voice conversation with Gemini"
                : "Live voice needs your own free Gemini key"
            }
            onClick={toggleLive}
          >
            {isLive ? "End live" : "Live"}
          </button>
          <button
            type="button"
            className={clsx("ai-assistant__icon-button", {
              "ai-assistant__icon-button--active": status === "listening",
            })}
            title="Click to talk, or hold and release"
            aria-label="Voice input"
            aria-pressed={status === "listening"}
            disabled={isLive}
            onPointerDown={onMicDown}
            onPointerUp={onMicUp}
          >
            {microphoneIcon}
          </button>
          {isBusy ? (
            <button
              type="button"
              className="ai-assistant__icon-button"
              title="Stop"
              aria-label="Stop"
              onClick={() => abortRef.current?.abort()}
            >
              {CloseIcon}
            </button>
          ) : (
            <button
              type="submit"
              className="ai-assistant__icon-button ai-assistant__send"
              title="Send"
              aria-label="Send"
              disabled={!input.trim()}
            >
              {ArrowRightIcon}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

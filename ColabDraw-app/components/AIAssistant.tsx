import {
  CloseIcon,
  PlusIcon,
  chevronDownIcon,
  mermaidLogoIcon,
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
import {
  createMessage,
  rememberFullImages,
  useChatHistory,
} from "../ai/chatHistory";
import { makeThumbnail } from "../ai/drawing";
import { searchOnlineLibraries } from "../ai/libraryItems";
import { startLiveSession } from "../ai/live";
import { isOnDevice, startListening } from "../ai/speech";

import { AIBuddy } from "./AIBuddy/AIBuddy";
import { AIChatMessage } from "./AIChatMessage";
import { AIHistoryMenu } from "./AIHistoryMenu";
import { AIComposer } from "./AIComposer";

import "./AIAssistant.scss";

import type { AIErrorCode, GeminiContent } from "../ai/aiClient";
import type { ApplyResult } from "../ai/canvasAgent";
import type { LiveSession, LiveState } from "../ai/live";
import type { ComposerAttachment } from "./AIComposer";
import type { ListeningSession, SpeechEngine } from "../ai/speech";

const HISTORY_LIMIT = 8;
// how far from the bottom still counts as "following" the conversation
const FOLLOW_PX = 80;

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

  const {
    messages,
    setMessages,
    chats,
    activeId,
    newChat,
    openChat,
    deleteChat,
  } = useChatHistory();
  const [input, setInput] = useState("");
  const [speechEngine, setSpeechEngine] = useState<SpeechEngine | null>(null);
  const [speechStatus, setSpeechStatus] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);

  const isLive = liveState !== null;
  const listeningRef = useRef<ListeningSession | null>(null);
  // true while the microphone is being opened, so a second click can't open another
  const startingVoiceRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef<LiveSession | null>(null);
  const liveAliasesRef = useRef<Map<string, string>>(new Map());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
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

  const scrollToEnd = (smooth = false) => {
    const scroller = scrollerRef.current;
    scroller?.scrollTo({
      top: scroller.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  };

  useEffect(() => {
    if (followingRef.current) {
      scrollToEnd();
    }
  }, [messages, isBusy, isOpen]);

  useEffect(
    () => () => {
      listeningRef.current?.cancel();
      liveRef.current?.stop();
      abortRef.current?.abort();
    },
    [],
  );

  const canAttach = hasOwnKey && getAISettings().engine === "gemini";

  /** a picture of the selection (or the whole board) to show the model */
  const attachSelection = async (): Promise<ComposerAttachment | null> => {
    const state = excalidrawAPI.getAppState();
    const elements = excalidrawAPI.getSceneElements();
    const selected = elements.filter(
      (element) => state.selectedElementIds[element.id],
    );
    const target = selected.length ? selected : elements;
    if (!target.length) {
      setSpeechStatus("There's nothing on the board to take a picture of.");
      return null;
    }
    const part = await snapshotElements(excalidrawAPI, target);
    if (!("inlineData" in part)) {
      return null;
    }
    const { mimeType, data } = part.inlineData;
    return {
      id: `selection-${Date.now()}`,
      name: "Selection.png",
      mimeType,
      data,
      sourceMime: mimeType,
      url: `data:${mimeType};base64,${data}`,
    };
  };

  const send = async (text: string, attachments: ComposerAttachment[] = []) => {
    const prompt = text.trim();
    if (!prompt || isBusy) {
      return;
    }
    setInput("");
    followingRef.current = true;
    const history = messagesRef.current
      .filter((message) => !message.error && message.text)
      .slice(-HISTORY_LIMIT);
    // pictures only go to Gemini with the user's own key
    const pictures = canAttach ? attachments : [];
    // small copies are kept in the saved chat, full ones for this session
    const thumbnails = (
      await Promise.all(
        pictures.map((picture) =>
          makeThumbnail(picture.url, 160).catch(() => null),
        ),
      )
    ).filter((thumbnail): thumbnail is string => !!thumbnail);
    const userMessage = createMessage("user", prompt, {
      images: thumbnails.length ? thumbnails : undefined,
    });
    rememberFullImages(
      userMessage.id,
      pictures.map((picture) => picture.url),
    );
    setMessages((prev) => [...prev, userMessage]);
    setStatus("thinking");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const context = await buildCanvasContext(excalidrawAPI, prompt);
      const pictureNote = pictures.length
        ? `\n\nAttached pictures: ${pictures
            .map((picture, index) => `${index + 1} = "${picture.name}"`)
            .join(", ")}`
        : "";
      const parts: GeminiContent["parts"] = [
        { text: `${prompt}\n\n${context.text}${pictureNote}` },
      ];
      for (const picture of pictures) {
        parts.push({
          inlineData: { mimeType: picture.mimeType, data: picture.data },
        });
      }
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
        text: answer,
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
        reply: answer.trim() || (calls.length ? "Done." : "I'm not sure."),
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
            pictures.map((picture) => ({
              name: picture.name,
              mimeType: picture.sourceMime,
              url: picture.url,
            })),
          );
          const summary = describeResult(result);
          note = summary ? `${summary} · Ctrl+Z to undo` : undefined;
        } catch (applyError) {
          // the AI answered; the board just couldn't take that change
          console.error(applyError);
          setMessages((prev) => [
            ...prev,
            createMessage(
              "model",
              "I couldn't apply that to the board. Try rephrasing, or ask for a smaller change.",
              { error: "network" },
            ),
          ]);
          setStatus("error");
          return;
        }
      }
      setMessages((prev) => [
        ...prev,
        createMessage("model", response.reply, { note }),
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
        createMessage("model", ERROR_TEXT[code], { error: code }),
      ]);
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  };

  /** drop this message and everything after it, returning its text */
  const rewindTo = (messageId: string) => {
    const index = messagesRef.current.findIndex(
      (message) => message.id === messageId,
    );
    if (index < 0) {
      return "";
    }
    const text = messagesRef.current[index].text;
    setMessages((prev) => prev.slice(0, index));
    return text;
  };

  const retryFrom = (modelMessageId: string) => {
    const index = messagesRef.current.findIndex(
      (message) => message.id === modelMessageId,
    );
    const user = messagesRef.current
      .slice(0, index)
      .reverse()
      .find((message) => message.role === "user");
    if (user) {
      send(rewindTo(user.id));
    }
  };

  // --- voice ---------------------------------------------------------------

  const finishListening = async () => {
    const session = listeningRef.current;
    if (!session) {
      return;
    }
    listeningRef.current = null;
    setIsRecording(false);
    setStatus("thinking");
    try {
      const transcript = await session.stop();
      setStatus("idle");
      if (!transcript) {
        setInput("");
        setSpeechStatus("I didn't catch anything. Try again.");
        return;
      }
      setSpeechStatus("");
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

  const cancelListening = () => {
    listeningRef.current?.cancel();
    listeningRef.current = null;
    setIsRecording(false);
    setInput("");
    setSpeechStatus("");
    setStatus("idle");
  };

  const startVoice = async () => {
    if (listeningRef.current || startingVoiceRef.current || isBusy || isLive) {
      return;
    }
    startingVoiceRef.current = true;
    // the browser may be asking for permission; say so instead of looking dead
    setSpeechStatus("Allow the microphone in your browser…");
    setInput("");
    try {
      const session = await startListening({
        settings: getAISettings(),
        onPartial: setInput,
        onLevel: setLevel,
        onStatus: setSpeechStatus,
        onEngine: setSpeechEngine,
      });
      listeningRef.current = session;
      setSpeechEngine(session.engine);
      setSpeechStatus("");
      setIsRecording(true);
      setStatus("listening");
    } catch (error: any) {
      console.error(error);
      setStatus("error");
      setSpeechStatus(
        error?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the address bar."
          : error?.name === "NotFoundError"
          ? "No microphone found."
          : "Couldn't start the microphone.",
      );
    } finally {
      startingVoiceRef.current = false;
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
    setIsRecording(false);
    setLiveState("connecting");
    setSpeechStatus("");
    const context = await buildCanvasContext(excalidrawAPI);
    liveAliasesRef.current = context.aliases;
    // a model turn that has already been shown, so transcript text keeps joining it
    let lastRole: "user" | "model" | null = null;
    try {
      liveRef.current = await startLiveSession({
        apiKey,
        systemPrompt: `${CANVAS_SYSTEM_PROMPT}\n\nYou are in a live voice conversation. Speak briefly and naturally. Edit the board by calling the functions instead of describing changes aloud. To use ready-made art that isn't in the user's library, call find_library_art first, then insert_library_item with the library and item name (and replace to swap an existing shape for it).\n\nThe board when the conversation started:\n${context.text}`,
        onState: (state) => {
          if (state === "closed") {
            liveRef.current = null;
            setLiveState(null);
            setStatus("idle");
            return;
          }
          setLiveState(state);
          setStatus(
            state === "connecting"
              ? "thinking"
              : state === "working"
              ? "drawing"
              : "listening",
          );
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
            return [...prev, createMessage(role, text.trimStart())];
          });
        },
        onToolCalls: async (calls) => {
          const wantsCanvas = calls.some((call) => call.name === "read_canvas");
          if (wantsCanvas) {
            const fresh = await buildCanvasContext(excalidrawAPI);
            liveAliasesRef.current = fresh.aliases;
          }
          const libraryAnswers = new Map<number, string>();
          await Promise.all(
            calls.map(async (call, index) => {
              if (call.name === "find_library_art") {
                libraryAnswers.set(
                  index,
                  (await searchOnlineLibraries(
                    String(call.args.query ?? ""),
                  )) || "No matching online library found.",
                );
              }
            }),
          );
          const ops = calls.flatMap(functionCallToOps);
          const result = ops.length
            ? await applyCanvasOps(excalidrawAPI, ops, liveAliasesRef.current)
            : null;
          if (result) {
            lastRole = null;
            setMessages((prev) => [
              ...prev,
              createMessage("model", "", {
                note: `${
                  describeResult(result) || "no changes"
                } · Ctrl+Z to undo`,
              }),
            ]);
          }
          const canvas =
            wantsCanvas && (await buildCanvasContext(excalidrawAPI)).text;
          return calls.map((call, index) =>
            call.name === "read_canvas"
              ? { canvas }
              : libraryAnswers.has(index)
              ? { libraries: libraryAnswers.get(index) }
              : { ok: true },
          );
        },
        onError: (message) =>
          setMessages((prev) => [
            ...prev,
            createMessage("model", message, { error: "network" }),
          ]),
      });
    } catch (error: any) {
      setLiveState(null);
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

  const lastModelIndex = messages.reduce(
    (found, message, index) => (message.role === "model" ? index : found),
    -1,
  );
  return (
    <div
      className="ai-assistant"
      role="dialog"
      aria-label="AI assistant"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (isRecording) {
            cancelListening();
          } else {
            setIsOpen(false);
          }
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
            title="New chat"
            aria-label="New chat"
            onClick={newChat}
          >
            {PlusIcon}
          </button>
        )}
        <AIHistoryMenu
          chats={chats}
          activeId={activeId}
          onNew={newChat}
          onOpen={openChat}
          onDelete={deleteChat}
        />
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

      <div className="ai-assistant__conversation">
        <div
          className="ai-assistant__messages"
          ref={scrollerRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            const following =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              FOLLOW_PX;
            followingRef.current = following;
            setIsFollowing(following);
          }}
        >
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
              <AIChatMessage
                key={message.id}
                message={message}
                isLast={index === messages.length - 1}
                offerKey={
                  message.error && KEY_ERRORS.includes(message.error)
                    ? message.error === "quota_exceeded" ||
                      message.error === "invalid_key"
                      ? "Open AI settings"
                      : "Add your own free key"
                    : null
                }
                onOfferKey={() => openKeyDialog(true)}
                onEdit={
                  message.role === "user" && !isBusy && !isLive
                    ? () => setInput(rewindTo(message.id))
                    : undefined
                }
                onRetry={
                  index === lastModelIndex &&
                  !message.note &&
                  !isBusy &&
                  !isLive
                    ? () => retryFrom(message.id)
                    : undefined
                }
              />
            ))
          )}
          {isBusy && (
            <div className="ai-assistant__message ai-assistant__message--model ai-assistant__typing">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
        {!isFollowing && messages.length > 0 && (
          <button
            type="button"
            className="ai-assistant__scroll-down"
            title="Scroll to latest"
            aria-label="Scroll to latest"
            onClick={() => {
              followingRef.current = true;
              setIsFollowing(true);
              scrollToEnd(true);
            }}
          >
            {chevronDownIcon}
          </button>
        )}
      </div>

      {(speechStatus || speechEngine) && (isRecording || speechStatus) && (
        <div className="ai-assistant__speech" role="status">
          {speechEngine && isRecording && (
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

      <AIComposer
        value={input}
        onChange={setInput}
        onSubmit={send}
        placeholder="Ask or describe a change…"
        recordingPlaceholder="Listening…"
        isRecording={isRecording}
        onToggleRecording={isRecording ? finishListening : startVoice}
        isBusy={isBusy}
        onStopBusy={() => abortRef.current?.abort()}
        isLive={isLive}
        liveState={liveState}
        onToggleLive={toggleLive}
        liveTitle={
          hasOwnKey
            ? "Live voice conversation with Gemini"
            : "Live voice needs your own free Gemini key"
        }
        canAttach={canAttach}
        attachTitle="Pictures need your own Gemini key (AI settings)."
        onAttachSelection={attachSelection}
      />
    </div>
  );
};

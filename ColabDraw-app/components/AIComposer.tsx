import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { toModelImage } from "../ai/drawing";

import { AILightbox } from "./AILightbox";
import { AIVoiceVisualizer } from "./AIVoiceVisualizer";

import "./AIComposer.scss";

import type { LiveState } from "../ai/live";

export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  /** what the model is sent: base64 (no data: prefix) of a png, jpeg or webp */
  data: string;
  /** the file as the user attached it, for the board and previews */
  url: string;
  /** the original file's type (the model copy may have been converted to png) */
  sourceMime: string;
};

const MAX_ATTACHMENTS = 4;
const MIN_TEXT_HEIGHT = 68;
const MAX_TEXT_HEIGHT = 160;
const COLLAPSED_HEIGHT = 48;
const LIVE_LABELS: Record<LiveState, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Speaking",
  working: "Working on the board",
  closed: "",
};

// the same small glyphs as the reference input
const ArrowUp = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const Mic = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="5"
      y="1"
      width="4"
      height="7"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M2.75 6.5V7a4.25 4.25 0 0 0 8.5 0v-.5M7 11.25V13"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);
const Stop = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
  >
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="currentColor" />
  </svg>
);
const Plus = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M7 2.5V11.5M2.5 7H11.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);
const Close = () => (
  <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path
      d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
const LiveGlyph = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
  >
    <rect x="1.5" y="5" width="2.5" height="4" rx="1" fill="currentColor" />
    <rect x="5.75" y="2" width="2.5" height="10" rx="1" fill="currentColor" />
    <rect x="10" y="4.5" width="2.5" height="5" rx="1" fill="currentColor" />
  </svg>
);

const readAsAttachment = async (file: File): Promise<ComposerAttachment> => {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  // the model only reads png, jpeg and webp; SVGs and the rest go in as a png
  const forModel = await toModelImage(url, file.type);
  return {
    id: `${file.name}-${file.lastModified}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    name: file.name,
    mimeType: forModel.mimeType,
    data: forModel.data,
    sourceMime: file.type,
    url,
  };
};

/**
 * The chat input: a card that opens with a spring, a textarea that grows,
 * one round button that becomes mic, send or stop, and bars that follow your
 * voice while you speak (after the 21st.dev "ai-chat-input" by jahed).
 */
export const AIComposer = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  recordingPlaceholder,
  isRecording,
  onToggleRecording,
  isBusy,
  onStopBusy,
  isLive,
  liveState,
  onToggleLive,
  liveTitle,
  canAttach,
  attachTitle,
  onAttachSelection,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string, attachments: ComposerAttachment[]) => void;
  placeholder: string;
  recordingPlaceholder: string;
  isRecording: boolean;
  onToggleRecording: () => void;
  isBusy: boolean;
  onStopBusy: () => void;
  isLive: boolean;
  liveState: LiveState | null;
  onToggleLive: () => void;
  liveTitle: string;
  /** pictures can only go to Gemini with the user's own key */
  canAttach: boolean;
  attachTitle: string;
  onAttachSelection: () => Promise<ComposerAttachment | null>;
}) => {
  const [expanded, setExpanded] = useState(true);
  const [textHeight, setTextHeight] = useState(MIN_TEXT_HEIGHT);
  const [isScrolling, setIsScrolling] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState<ComposerAttachment | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const topFadeRef = useRef<HTMLDivElement>(null);
  const bottomFadeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasValue = value.trim() !== "" || attachments.length > 0;
  const showArrow = hasValue && !isRecording && !isBusy;
  const showStop = isRecording || isBusy;
  const showMic = !hasValue && !isRecording && !isBusy;
  const open = expanded || isRecording || hasValue || isLive;
  const hasTray = attachments.length > 0 && open;

  const updateFades = () => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = element;
    if (topFadeRef.current) {
      topFadeRef.current.style.opacity = String(Math.min(scrollTop / 20, 1));
    }
    if (bottomFadeRef.current) {
      const below = scrollHeight - clientHeight - scrollTop;
      bottomFadeRef.current.style.opacity = String(
        Math.min(Math.max(below - 16, 0) / 10, 1),
      );
    }
  };

  // grow with the text, between 68 and 160px, like the original
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = "0px";
    const natural = element.scrollHeight;
    const next = Math.max(MIN_TEXT_HEIGHT, Math.min(natural, MAX_TEXT_HEIGHT));
    element.style.height = `${next}px`;
    setTextHeight(next);
    setIsScrolling(natural > MAX_TEXT_HEIGHT);
    setTimeout(updateFades, 0);
  }, [value, open]);

  // keep the newest words in view while dictating
  useEffect(() => {
    if (isRecording && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [value, isRecording]);

  useEffect(() => {
    if (open && !isRecording && !isLive) {
      const timer = setTimeout(() => {
        const element = textareaRef.current;
        if (element && !element.disabled) {
          element.focus({ preventScroll: true });
          element.setSelectionRange(element.value.length, element.value.length);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, isRecording, isLive]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const submit = () => {
    if (!hasValue) {
      return;
    }
    onSubmit(value, attachments);
    setAttachments([]);
    setMenuOpen(false);
  };

  const addFiles = async (files: FileList | null) => {
    const images = Array.from(files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    const room = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const added = await Promise.all(
      images.slice(0, room).map(readAsAttachment),
    );
    setAttachments((previous) => [...previous, ...added]);
    setExpanded(true);
  };

  const addSelection = async () => {
    setMenuOpen(false);
    const picture = await onAttachSelection();
    if (picture) {
      setAttachments((previous) =>
        [...previous, picture].slice(0, MAX_ATTACHMENTS),
      );
      setExpanded(true);
    }
  };

  const onAction = () => {
    if (isRecording) {
      onToggleRecording();
    } else if (isBusy) {
      onStopBusy();
    } else if (hasValue) {
      submit();
    } else {
      setExpanded(true);
      onToggleRecording();
    }
  };

  const attachDisabled = attachments.length >= MAX_ATTACHMENTS || !canAttach;

  return (
    <>
      <div
        ref={rootRef}
        className="ai-composer"
        onBlur={(event) => {
          if (rootRef.current?.contains(event.relatedTarget as Node)) {
            return;
          }
          if (value.trim() === "" && !attachments.length && !isRecording) {
            setExpanded(false);
            setMenuOpen(false);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="ai-composer__file"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        {/* pictures slide up from behind the card */}
        <div
          className="ai-composer__tray"
          aria-hidden={!hasTray}
          style={{ height: hasTray ? 68 : 0 }}
        >
          <div
            className="ai-composer__tray-inner"
            style={{
              transform: hasTray ? "translateY(0)" : "translateY(100%)",
              opacity: hasTray ? 1 : 0,
            }}
          >
            {attachments.map((attachment) => (
              <span key={attachment.id} className="ai-composer__thumb">
                <button
                  type="button"
                  className="ai-composer__thumb-open"
                  aria-label={`Preview ${attachment.name}`}
                  onClick={() => setPreview(attachment)}
                >
                  <img src={attachment.url} alt="" draggable={false} />
                </button>
                <button
                  type="button"
                  className="ai-composer__thumb-remove"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setAttachments((previous) =>
                      previous.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <Close />
                </button>
              </span>
            ))}
          </div>
        </div>

        <div
          className={clsx("ai-composer__card", {
            "ai-composer__card--open": open,
            "ai-composer__card--recording": isRecording,
            "ai-composer__card--live": isLive,
          })}
          style={{
            height: isLive
              ? "auto"
              : open
              ? Math.max(116, textHeight + 48)
              : COLLAPSED_HEIGHT,
          }}
          onMouseDown={(event) => {
            const onText = event.target === textareaRef.current;
            if (open && !onText && !isRecording && !isLive) {
              event.preventDefault();
              textareaRef.current?.focus();
            }
          }}
        >
          {isLive ? (
            <div className="ai-composer__live" role="status">
              <AIVoiceVisualizer
                active={liveState !== "connecting"}
                bars={24}
                height={40}
                source={liveState === "speaking" ? "model" : "you"}
              />
              <span className="ai-composer__live-label">
                {liveState ? LIVE_LABELS[liveState] : ""}
              </span>
              <button
                type="button"
                className="ai-composer__chip ai-composer__chip--live-on"
                onClick={onToggleLive}
              >
                End live
              </button>
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                className={clsx("ai-composer__text", {
                  "ai-composer__text--scroll": isScrolling,
                })}
                value={value}
                disabled={isRecording}
                aria-label="Message"
                placeholder={isRecording ? recordingPlaceholder : placeholder}
                tabIndex={open ? 0 : -1}
                onChange={(event) => onChange(event.target.value)}
                onScroll={updateFades}
                onPaste={(event) => {
                  if (canAttach && event.clipboardData.files.length) {
                    event.preventDefault();
                    addFiles(event.clipboardData.files);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (!isBusy) {
                      submit();
                    }
                  }
                  if (
                    event.key === "Escape" &&
                    value.trim() === "" &&
                    !attachments.length
                  ) {
                    event.stopPropagation();
                    setExpanded(false);
                    setMenuOpen(false);
                  }
                }}
              />
              <div
                ref={topFadeRef}
                className="ai-composer__fade ai-composer__fade--top"
              />
              <div
                ref={bottomFadeRef}
                className="ai-composer__fade ai-composer__fade--bottom"
                style={{ top: textHeight - 32 }}
              />

              {/* collapsed: the placeholder is a button that opens the card */}
              <button
                type="button"
                className={clsx("ai-composer__collapsed", {
                  "ai-composer__collapsed--hidden": open,
                })}
                aria-label="Open message box"
                tabIndex={open ? -1 : 0}
                onClick={() => setExpanded(true)}
              >
                {placeholder}
              </button>

              <div
                className={clsx("ai-composer__toolbar", {
                  "ai-composer__toolbar--hidden": !open || isRecording,
                })}
              >
                <button
                  type="button"
                  className="ai-composer__chip"
                  title={liveTitle}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onToggleLive}
                  disabled={isRecording}
                >
                  <LiveGlyph />
                  <span>Live</span>
                </button>
                <div className="ai-composer__plus-wrap">
                  <button
                    type="button"
                    className="ai-composer__plus"
                    aria-label="Add a picture"
                    aria-expanded={menuOpen}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setMenuOpen(!menuOpen)}
                  >
                    <Plus />
                  </button>
                  <div
                    className={clsx("ai-composer__menu", {
                      "ai-composer__menu--open": menuOpen,
                    })}
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={attachDisabled}
                      title={canAttach ? "" : attachTitle}
                      onClick={() => {
                        setMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      Upload an image
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={attachDisabled}
                      title={canAttach ? "" : attachTitle}
                      onClick={addSelection}
                    >
                      Picture of my selection
                    </button>
                    {!canAttach && (
                      <p className="ai-composer__menu-hint">{attachTitle}</p>
                    )}
                  </div>
                </div>
              </div>

              <AIVoiceVisualizer
                className="ai-composer__bars"
                active={isRecording}
                bars={5}
                height={24}
              />

              <button
                type="button"
                className="ai-composer__action"
                aria-label={
                  showArrow
                    ? "Send message"
                    : isRecording
                    ? "Stop recording"
                    : isBusy
                    ? "Stop generating"
                    : "Use voice input"
                }
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={onAction}
              >
                <span
                  className={clsx("ai-composer__glyph", {
                    "ai-composer__glyph--on": showArrow,
                    "ai-composer__glyph--turn-right": !showArrow,
                  })}
                >
                  <ArrowUp />
                </span>
                <span
                  className={clsx("ai-composer__glyph", {
                    "ai-composer__glyph--on": showMic,
                    "ai-composer__glyph--turn-left": !showMic,
                  })}
                >
                  <Mic />
                </span>
                <span
                  className={clsx("ai-composer__glyph", {
                    "ai-composer__glyph--on": showStop,
                    "ai-composer__glyph--turn-right": !showStop,
                  })}
                >
                  <Stop />
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {preview && (
        <AILightbox
          url={preview.url}
          name={preview.name}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
};

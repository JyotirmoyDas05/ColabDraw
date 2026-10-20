import {
  RetryIcon,
  checkIcon,
  copyIcon,
  pencilIcon,
} from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useEffect, useState } from "react";

import type { ChatMessage } from "../ai/chatHistory";

const COPIED_MS = 1600;

/** One turn of the chat, with the small actions that appear on hover. */
export const AIChatMessage = ({
  message,
  isLast,
  offerKey,
  onOfferKey,
  onEdit,
  onRetry,
}: {
  message: ChatMessage;
  isLast: boolean;
  /** show the "add your own key" link under this message */
  offerKey: string | null;
  onOfferKey: () => void;
  /** user messages: put the text back in the input */
  onEdit?: () => void;
  /** replies that changed nothing: ask again */
  onRetry?: () => void;
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
    } catch {
      // clipboard blocked: nothing useful to do
    }
  };

  return (
    <div
      className={clsx(
        "ai-assistant__turn",
        `ai-assistant__turn--${message.role}`,
        { "ai-assistant__turn--last": isLast },
      )}
    >
      <div
        className={clsx(
          "ai-assistant__message",
          `ai-assistant__message--${message.role}`,
          { "ai-assistant__message--error": message.error },
        )}
        title={new Date(message.at).toLocaleString()}
      >
        {message.text && <p>{message.text}</p>}
        {message.note && (
          <span className="ai-assistant__note">{message.note}</span>
        )}
        {offerKey && (
          <button
            type="button"
            className="ai-assistant__link"
            onClick={onOfferKey}
          >
            {offerKey}
          </button>
        )}
      </div>
      {message.text && (
        <div className="ai-assistant__message-actions">
          <button
            type="button"
            className="ai-assistant__icon-button ai-assistant__icon-button--small"
            title={copied ? "Copied" : "Copy"}
            aria-label={copied ? "Copied" : "Copy message"}
            onClick={copy}
          >
            {copied ? checkIcon : copyIcon}
          </button>
          {onEdit && (
            <button
              type="button"
              className="ai-assistant__icon-button ai-assistant__icon-button--small"
              title="Edit and resend"
              aria-label="Edit message"
              onClick={onEdit}
            >
              {pencilIcon}
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              className="ai-assistant__icon-button ai-assistant__icon-button--small"
              title="Try again"
              aria-label="Try again"
              onClick={onRetry}
            >
              {RetryIcon}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

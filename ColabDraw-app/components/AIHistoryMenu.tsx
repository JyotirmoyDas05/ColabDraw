import {
  PlusIcon,
  TrashIcon,
  historyIcon,
} from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import type { Chat } from "../ai/chatHistory";

const ago = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return new Date(time).toLocaleDateString();
};

/** Past chats saved in this browser, with a way back into each. */
export const AIHistoryMenu = ({
  chats,
  activeId,
  onNew,
  onOpen,
  onDelete,
}: {
  chats: Chat[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [isOpen]);

  return (
    <div className="ai-history" ref={rootRef}>
      <button
        type="button"
        className="ai-assistant__icon-button"
        title="Chat history"
        aria-label="Chat history"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        {historyIcon}
      </button>
      {isOpen && (
        <div className="ai-history__menu" role="menu">
          <button
            type="button"
            className="ai-history__new"
            role="menuitem"
            onClick={() => {
              onNew();
              setIsOpen(false);
            }}
          >
            {PlusIcon} New chat
          </button>
          {chats.length === 0 ? (
            <p className="ai-history__empty">
              Your chats are saved here, in this browser only.
            </p>
          ) : (
            <ul>
              {chats.map((chat) => (
                <li
                  key={chat.id}
                  className={clsx("ai-history__item", {
                    "ai-history__item--active": chat.id === activeId,
                  })}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="ai-history__open"
                    onClick={() => {
                      onOpen(chat.id);
                      setIsOpen(false);
                    }}
                  >
                    <span className="ai-history__title">{chat.title}</span>
                    <span className="ai-history__time">
                      {ago(chat.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ai-assistant__icon-button ai-assistant__icon-button--small"
                    title="Delete chat"
                    aria-label={`Delete chat ${chat.title}`}
                    onClick={() => onDelete(chat.id)}
                  >
                    {TrashIcon}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

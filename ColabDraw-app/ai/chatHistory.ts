import { useCallback, useEffect, useState } from "react";

import type { AIErrorCode } from "./aiClient";

export type ChatMessage = {
  id: string;
  role: "user" | "model";
  text: string;
  /** what the reply changed on the board */
  note?: string;
  error?: AIErrorCode;
  at: number;
};

export type Chat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

type State = { activeId: string | null; chats: Chat[] };

const STORAGE_KEY = "colabdraw-ai-chats";
const MAX_CHATS = 30;
const MAX_MESSAGES = 80;

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now();

export const createMessage = (
  role: ChatMessage["role"],
  text: string,
  extra: Partial<Pick<ChatMessage, "note" | "error">> = {},
): ChatMessage => ({ id: newId(), role, text, at: Date.now(), ...extra });

const load = (): State => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && Array.isArray(saved.chats)) {
      return { activeId: saved.activeId ?? null, chats: saved.chats };
    }
  } catch {
    // unreadable history is the same as none
  }
  return { activeId: null, chats: [] };
};

const titleFor = (messages: ChatMessage[]) => {
  const first = messages.find((message) => message.role === "user")?.text;
  return first ? first.replace(/\s+/g, " ").slice(0, 48) : "New chat";
};

/** Chats kept in this browser: the active conversation plus past ones. */
export const useChatHistory = () => {
  const [state, setState] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked: the chat still works, it just isn't saved
    }
  }, [state]);

  const active = state.chats.find((chat) => chat.id === state.activeId);
  const messages = active?.messages ?? [];

  const setMessages = useCallback(
    (update: (previous: ChatMessage[]) => ChatMessage[]) =>
      setState((prev) => {
        const current = prev.chats.find((chat) => chat.id === prev.activeId);
        const next = update(current?.messages ?? []).slice(-MAX_MESSAGES);
        const id = current?.id ?? newId();
        const chat: Chat = {
          id,
          title: titleFor(next),
          updatedAt: Date.now(),
          messages: next,
        };
        const others = prev.chats.filter((other) => other.id !== id);
        return {
          activeId: id,
          // empty chats aren't worth keeping
          chats: (next.length ? [chat, ...others] : others).slice(0, MAX_CHATS),
        };
      }),
    [],
  );

  const newChat = useCallback(
    () => setState((prev) => ({ ...prev, activeId: null })),
    [],
  );

  const openChat = useCallback(
    (id: string) => setState((prev) => ({ ...prev, activeId: id })),
    [],
  );

  const deleteChat = useCallback(
    (id: string) =>
      setState((prev) => ({
        activeId: prev.activeId === id ? null : prev.activeId,
        chats: prev.chats.filter((chat) => chat.id !== id),
      })),
    [],
  );

  return {
    messages,
    setMessages,
    chats: state.chats,
    activeId: state.activeId,
    newChat,
    openChat,
    deleteChat,
  };
};

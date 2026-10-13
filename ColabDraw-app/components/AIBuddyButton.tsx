import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom, useAtomValue } from "../app-jotai";
import { aiLevelAtom, aiPanelOpenAtom, aiStatusAtom } from "../ai/aiState";

import { AIAssistant } from "./AIAssistant";
import { AIBuddy } from "./AIBuddy/AIBuddy";

const STATUS_RESET_MS = { done: 1500, error: 3000 } as const;

export const AIBuddyButton = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [status, setStatus] = useAtom(aiStatusAtom);
  const [isOpen, setIsOpen] = useAtom(aiPanelOpenAtom);
  const level = useAtomValue(aiLevelAtom);

  useEffect(() => {
    if (status !== "done" && status !== "error") {
      return;
    }
    const timer = setTimeout(() => setStatus("idle"), STATUS_RESET_MS[status]);
    return () => clearTimeout(timer);
  }, [status, setStatus]);

  return (
    <div className="ai-buddy-anchor">
      <button
        type="button"
        className="ai-buddy-button"
        title="ColabDraw AI"
        aria-label="ColabDraw AI assistant"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        <AIBuddy state={status} size={26} level={level} />
      </button>
      <AIAssistant excalidrawAPI={excalidrawAPI} />
    </div>
  );
};

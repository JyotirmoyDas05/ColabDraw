import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom } from "../app-jotai";
import { aiStatusAtom } from "../ai/aiState";

import { AIBuddy } from "./AIBuddy/AIBuddy";

const STATUS_RESET_MS = { done: 1500, error: 3000 } as const;

export const AIBuddyButton = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [status, setStatus] = useAtom(aiStatusAtom);

  useEffect(() => {
    if (status !== "done" && status !== "error") {
      return;
    }
    const timer = setTimeout(() => setStatus("idle"), STATUS_RESET_MS[status]);
    return () => clearTimeout(timer);
  }, [status, setStatus]);

  return (
    <button
      type="button"
      className="ai-buddy-button"
      title="AI: describe a diagram"
      aria-label="Open AI diagram assistant"
      onClick={() =>
        excalidrawAPI.updateScene({
          appState: {
            openDialog: { name: "ttd", tab: "text-to-diagram" },
          },
        })
      }
    >
      <AIBuddy state={status} size={26} />
    </button>
  );
};

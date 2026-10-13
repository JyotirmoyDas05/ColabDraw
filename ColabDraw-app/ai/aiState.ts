import { atom } from "../app-jotai";

import type { AIErrorCode, TrialStatus } from "./aiClient";

export type AIStatus =
  | "idle"
  | "listening"
  | "thinking"
  | "drawing"
  | "done"
  | "error";

export const aiStatusAtom = atom<AIStatus>("idle");
export const aiLastErrorAtom = atom<AIErrorCode | null>(null);
export const aiTrialAtom = atom<TrialStatus | null>(null);
export const aiKeyDialogOpenAtom = atom(false);
export const aiPanelOpenAtom = atom(false);
/** mic or voice loudness, 0..1, drives the buddy's pulse */
export const aiLevelAtom = atom(0);

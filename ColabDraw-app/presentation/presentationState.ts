import { atom } from "../app-jotai";

export interface PresentationModeState {
  isActive: boolean;
  currentSlideIndex: number;
  totalSlides: number;
  currentSlideId: string | null;
  isLive: boolean;
  isFollower: boolean;
  presenterSocketId: string | null;
  presenterUsername: string | null;
}

export interface RemotePresentationInfo {
  presenterSocketId: string;
  presenterUsername: string;
  slideIndex: number;
  totalSlides: number;
  slideTitle?: string;
}

export const DEFAULT_PRESENTATION_STATE: PresentationModeState = {
  isActive: false,
  currentSlideIndex: 0,
  totalSlides: 0,
  currentSlideId: null,
  isLive: false,
  isFollower: false,
  presenterSocketId: null,
  presenterUsername: null,
};

export const presentationModeAtom = atom<PresentationModeState>(
  DEFAULT_PRESENTATION_STATE,
);

export const activeRemotePresentationAtom = atom<RemotePresentationInfo | null>(
  null,
);

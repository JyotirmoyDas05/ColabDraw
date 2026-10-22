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

export interface PresentationSettings {
  animateSlideMovement: boolean;
  showCursor: boolean;
  showSlideTitle: boolean;
  isPublic: boolean;
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

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = {
  animateSlideMovement: true,
  showCursor: false,
  showSlideTitle: false,
  isPublic: false,
};

export const presentationModeAtom = atom<PresentationModeState>(
  DEFAULT_PRESENTATION_STATE,
);

export const activeRemotePresentationAtom = atom<RemotePresentationInfo | null>(
  null,
);

export const presentationSettingsAtom = atom<PresentationSettings>(
  DEFAULT_PRESENTATION_SETTINGS,
);

export const presentationSlideOrderAtom = atom<string[]>([]);

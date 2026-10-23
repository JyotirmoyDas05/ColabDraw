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
  settings?: Partial<PresentationSettings>;
}

export interface PresentationSettings {
  animateSlideMovement: boolean;
  showCursor: boolean;
  showSlideTitle: boolean;
  isPublic: boolean;
}

export interface PresentationEndedInfo {
  /** the presenter's display name, when the viewer watched someone else */
  presenterUsername: string | null;
  /** true when this client was watching another presenter */
  wasFollower: boolean;
  /** optional public link the participants can use to revisit the slides */
  shareUrl: string | null;
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
  showCursor: true,
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

/**
 * Set when a presentation ends so both the presenter and the audience can see
 * the "presentation has now ended" card. `null` means no ended card is shown.
 */
export const presentationEndedAtom = atom<PresentationEndedInfo | null>(null);

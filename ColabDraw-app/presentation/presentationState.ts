import { appJotaiStore, atom } from "../app-jotai";
import { getActiveSceneId } from "../data/scenes";

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
  slideId?: string | null;
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
  /** whether the viewer voluntarily stopped or the presenter ended it */
  reason?: "stopped" | "ended";
}

/**
 * The presentation the room server says is running. The server owns the
 * lifecycle: this atom mirrors it, so a remote device that wakes up after the
 * host ended still learns the session is gone.
 */
export interface PresentationSessionInfo {
  sessionId: string;
  /** the client id of the presenting device */
  hostId: string;
  viewers: number;
  remote: boolean;
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

/**
 * Mirrors the room server's presentation session. `null` means nothing is
 * being presented — the audience uses that to show a closed screen, and the
 * presenter uses it to notice a remote ended the session.
 */
export const presentationSessionAtom = atom<PresentationSessionInfo | null>(
  null,
);

/**
 * False until the server tells us it understands presentation sessions, so an
 * older worker still gets the client-only behaviour instead of a dead screen.
 */
export const presentationSessionSupportedAtom = atom(false);

/**
 * The "end this presentation?" dialog shared by the presenter HUD, the Esc
 * shortcut and the remote control.
 */
export const presentationStopConfirmAtom = atom(false);

export const viewerPriorSceneIdAtom = atom<string | null>(null);

const PRIOR_SCENE_KEY = "colabdraw_viewer_prior_scene_id";

export const rememberViewerPriorSceneId = (explicitId?: string | null) => {
  const id = explicitId || getActiveSceneId();
  if (id) {
    try {
      sessionStorage.setItem(PRIOR_SCENE_KEY, id);
    } catch {}
    appJotaiStore.set(viewerPriorSceneIdAtom, id);
  }
};

export const getViewerPriorSceneId = (): string | null => {
  const mem = appJotaiStore.get(viewerPriorSceneIdAtom);
  if (mem) {
    return mem;
  }
  try {
    return sessionStorage.getItem(PRIOR_SCENE_KEY);
  } catch {
    return null;
  }
};

export const clearViewerPriorSceneId = () => {
  try {
    sessionStorage.removeItem(PRIOR_SCENE_KEY);
  } catch {}
  appJotaiStore.set(viewerPriorSceneIdAtom, null);
};

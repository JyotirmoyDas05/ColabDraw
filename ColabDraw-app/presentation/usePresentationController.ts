import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom } from "../app-jotai";

import { stripPresentationParams } from "./presentationLayout";
import {
  DEFAULT_PRESENTATION_STATE,
  presentationEndedAtom,
  presentationModeAtom,
  presentationSettingsAtom,
  presentationSlideOrderAtom,
  presentationStopConfirmAtom,
} from "./presentationState";
import { presentationSync } from "./presentationSync";
import { getOrderedSlides } from "./presentationUtils";

import type { CollabAPI } from "../collab/Collab";
import type { PresentationSettings } from "./presentationState";

interface UsePresentationControllerOptions {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  collabAPI?: CollabAPI | null;
  onLiveBroadcast?: (payload: {
    isLive: boolean;
    slideIndex: number;
    totalSlides: number;
    slideTitle?: string;
    slideId?: string | null;
    settings?: Partial<PresentationSettings>;
  }) => void;
}

export const usePresentationController = ({
  excalidrawAPI,
  collabAPI,
  onLiveBroadcast,
}: UsePresentationControllerOptions) => {
  const [presentationState, setPresentationState] =
    useAtom(presentationModeAtom);
  const [settings, setSettings] = useAtom(presentationSettingsAtom);
  const [customSlideOrder] = useAtom(presentationSlideOrderAtom);
  const [, setPresentationEnded] = useAtom(presentationEndedAtom);
  const [, setStopConfirm] = useAtom(presentationStopConfirmAtom);

  const [orderedSlides, setOrderedSlides] = useState<
    ExcalidrawFrameLikeElement[]
  >(() =>
    getOrderedSlides(
      excalidrawAPI?.getSceneElementsIncludingDeleted(),
      customSlideOrder,
    ),
  );
  const [activeToolType, setActiveToolType] = useState<string | null>(() => {
    try {
      return excalidrawAPI?.getAppState().activeTool.type ?? null;
    } catch {
      return null;
    }
  });

  const prevAppStateRef = useRef<{
    frameRendering: {
      enabled: boolean;
      clip: boolean;
      name: boolean;
      outline: boolean;
    };
    zenModeEnabled: boolean;
    viewModeEnabled: boolean;
  } | null>(null);

  const slidesRef = useRef(
    getOrderedSlides(
      excalidrawAPI?.getSceneElementsIncludingDeleted(),
      customSlideOrder,
    ),
  );

  // Periodic heartbeat broadcast while presenting in a room to sync late-joining remotes
  useEffect(() => {
    if (!presentationState.isActive || !onLiveBroadcast) {
      return;
    }
    const interval = setInterval(() => {
      onLiveBroadcast({
        isLive: true,
        slideIndex: presentationState.currentSlideIndex,
        totalSlides: presentationState.totalSlides,
        slideTitle: presentationState.currentSlideId || undefined,
        slideId: presentationState.currentSlideId || undefined,
        settings,
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [
    presentationState.isActive,
    presentationState.currentSlideIndex,
    presentationState.totalSlides,
    presentationState.currentSlideId,
    settings,
    onLiveBroadcast,
  ]);

  const refreshSlides = useCallback(() => {
    if (!excalidrawAPI) {
      return slidesRef.current;
    }
    const next = getOrderedSlides(
      excalidrawAPI.getSceneElementsIncludingDeleted(),
      customSlideOrder,
    );
    slidesRef.current = next;
    setOrderedSlides((prev) => {
      if (
        prev.length === next.length &&
        prev.every((frame, i) => frame.id === next[i]?.id)
      ) {
        return prev;
      }
      return next;
    });
    return next;
  }, [excalidrawAPI, customSlideOrder]);

  // Keep slides refreshed during active presentations or following sessions
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    if (!presentationState.isActive && !presentationState.isFollower) {
      return;
    }
    const interval = setInterval(refreshSlides, 800);
    return () => clearInterval(interval);
  }, [
    excalidrawAPI,
    presentationState.isActive,
    presentationState.isFollower,
    refreshSlides,
  ]);

  // Follower auto-framing: When watching someone else's presentation, immediately
  // frame and animate viewport to the presenter's active slide.
  useEffect(() => {
    if (!presentationState.isFollower || !excalidrawAPI) {
      return;
    }

    const slides = refreshSlides();
    if (!slides.length) {
      return;
    }

    let targetSlide: ExcalidrawFrameLikeElement | undefined;
    if (presentationState.currentSlideId) {
      targetSlide = slides.find(
        (s) => s.id === presentationState.currentSlideId,
      );
    }

    if (!targetSlide) {
      const clampedIndex = Math.max(
        0,
        Math.min(presentationState.currentSlideIndex, slides.length - 1),
      );
      targetSlide = slides[clampedIndex];
    }

    if (targetSlide) {
      excalidrawAPI.setViewport({
        target: targetSlide,
        fit: "contain",
        animation: settings.animateSlideMovement,
      });
    }
  }, [
    presentationState.isFollower,
    presentationState.currentSlideIndex,
    presentationState.currentSlideId,
    settings.animateSlideMovement,
    refreshSlides,
    excalidrawAPI,
  ]);

  // Follower canvas lock: Enforce viewModeEnabled: true, zenModeEnabled: true,
  // hand tool, clean frame rendering, and clear selection so viewers cannot interact or edit.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    if (presentationState.isFollower) {
      const appState = excalidrawAPI.getAppState();
      if (!prevAppStateRef.current) {
        prevAppStateRef.current = {
          frameRendering: { ...appState.frameRendering },
          zenModeEnabled: appState.zenModeEnabled,
          viewModeEnabled: appState.viewModeEnabled,
        };
      }

      excalidrawAPI.updateScene({
        appState: {
          viewModeEnabled: true,
          zenModeEnabled: true,
          frameRendering: {
            enabled: true,
            clip: true,
            name: false,
            outline: true,
          },
          selectedElementIds: {},
          selectedGroupIds: {},
        },
      });

      excalidrawAPI.setActiveTool({ type: "hand" });
      document.body.classList.add("presentation-viewer-locked");
    } else {
      document.body.classList.remove("presentation-viewer-locked");
      if (prevAppStateRef.current && !presentationState.isActive) {
        excalidrawAPI.updateScene({
          appState: {
            frameRendering: prevAppStateRef.current.frameRendering,
            zenModeEnabled: prevAppStateRef.current.zenModeEnabled,
            viewModeEnabled: prevAppStateRef.current.viewModeEnabled,
          },
        });
        prevAppStateRef.current = null;
      }
    }

    return () => {
      document.body.classList.remove("presentation-viewer-locked");
    };
  }, [presentationState.isFollower, presentationState.isActive, excalidrawAPI]);

  // Guard against internal Excalidraw resets or hotkeys exiting view mode while following
  useEffect(() => {
    if (!excalidrawAPI || !presentationState.isFollower) {
      return;
    }
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = excalidrawAPI.onStateChange(
        (appState) => ({
          viewModeEnabled: appState.viewModeEnabled,
          hasSelection: Object.keys(appState.selectedElementIds).length > 0,
        }),
        ({ viewModeEnabled, hasSelection }) => {
          if (!viewModeEnabled || hasSelection) {
            excalidrawAPI.updateScene({
              appState: {
                viewModeEnabled: true,
                selectedElementIds: {},
                selectedGroupIds: {},
              },
            });
          }
        },
      );
    } catch {
      // API can be destroyed
    }
    return () => unsubscribe?.();
  }, [presentationState.isFollower, excalidrawAPI]);

  // Track the active tool so HUD toggles (laser pointer) reflect immediately.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    let unsubscribe: (() => void) | undefined;
    try {
      setActiveToolType(excalidrawAPI.getAppState().activeTool.type);
      unsubscribe = excalidrawAPI.onStateChange(
        (appState) => appState.activeTool.type,
        (type) => setActiveToolType(type),
      );
    } catch {
      // API can be destroyed between renders
    }
    return () => unsubscribe?.();
  }, [excalidrawAPI]);

  // Toggle presentation-mode-active class on body during presentation
  useEffect(() => {
    const isPresenting =
      presentationState.isActive || presentationState.isFollower;
    if (isPresenting) {
      document.body.classList.add("presentation-mode-active");
    } else {
      document.body.classList.remove("presentation-mode-active");
    }
    return () => {
      document.body.classList.remove("presentation-mode-active");
    };
  }, [presentationState.isActive, presentationState.isFollower]);

  const navigateToSlide = useCallback(
    (index: number) => {
      if (!excalidrawAPI) {
        return;
      }
      const slides = refreshSlides();

      if (!slides.length) {
        return;
      }

      const clampedIndex = Math.max(0, Math.min(index, slides.length - 1));
      const targetSlide = slides[clampedIndex];

      if (targetSlide) {
        // Zoom and fit to the target slide frame with configured animation setting
        excalidrawAPI.setViewport({
          target: targetSlide,
          fit: "contain",
          animation: settings.animateSlideMovement,
        });

        const slideTitle =
          targetSlide.name?.trim() || `Slide ${clampedIndex + 1}`;

        setPresentationState((prev) => ({
          ...prev,
          currentSlideIndex: clampedIndex,
          totalSlides: slides.length,
          currentSlideId: targetSlide.id,
        }));

        // Broadcast to remote controllers (cross-tab / local devices)
        presentationSync.send({
          type: "SYNC_STATE",
          slideIndex: clampedIndex,
          totalSlides: slides.length,
          slideTitle,
          isActive: true,
          slideIds: slides.map((s) => s.id),
          slideId: targetSlide.id,
        });

        if (onLiveBroadcast) {
          onLiveBroadcast({
            isLive: true,
            slideIndex: clampedIndex,
            totalSlides: slides.length,
            slideTitle,
            slideId: targetSlide.id,
            settings,
          });
        }
      }
    },
    [
      excalidrawAPI,
      onLiveBroadcast,
      setPresentationState,
      settings,
      refreshSlides,
    ],
  );

  const startPresentation = useCallback(
    (startIndex = 0, isLive = false) => {
      if (!excalidrawAPI) {
        return false;
      }

      const slides = refreshSlides();

      if (!slides.length) {
        excalidrawAPI.setToast({
          message:
            "No frames found. Create frames on the canvas (press F) to use them as presentation slides.",
          closable: true,
          duration: 5000,
        });
        return false;
      }

      const appState = excalidrawAPI.getAppState();
      prevAppStateRef.current = {
        frameRendering: { ...appState.frameRendering },
        zenModeEnabled: appState.zenModeEnabled,
        viewModeEnabled: appState.viewModeEnabled,
      };

      // Set clean frame rendering for presentation (clip content within frame, hide internal name label)
      excalidrawAPI.updateScene({
        appState: {
          frameRendering: {
            enabled: true,
            clip: true,
            name: false,
            outline: true,
          },
          zenModeEnabled: true,
          viewModeEnabled: true,
          openSidebar: null,
          openDialog: null,
          openMenu: null,
        },
      });

      const clampedIndex = Math.max(0, Math.min(startIndex, slides.length - 1));
      const initialSlide = slides[clampedIndex];

      excalidrawAPI.setViewport({
        target: initialSlide,
        fit: "contain",
        animation: settings.animateSlideMovement,
      });

      const slideTitle =
        initialSlide.name?.trim() || `Slide ${clampedIndex + 1}`;

      setPresentationState({
        isActive: true,
        currentSlideIndex: clampedIndex,
        totalSlides: slides.length,
        currentSlideId: initialSlide.id,
        isLive,
        isFollower: false,
        presenterSocketId: null,
        presenterUsername: null,
      });

      setPresentationEnded(null);

      // Broadcast initial presentation start to remote controllers
      presentationSync.send({
        type: "SYNC_STATE",
        slideIndex: clampedIndex,
        totalSlides: slides.length,
        slideTitle,
        isActive: true,
        slideIds: slides.map((s) => s.id),
        slideId: initialSlide.id,
      });

      if (onLiveBroadcast) {
        onLiveBroadcast({
          isLive: true,
          slideIndex: clampedIndex,
          totalSlides: slides.length,
          slideTitle,
          slideId: initialSlide.id,
          settings,
        });
      }

      if (
        collabAPI?.isCollaborating?.() ||
        collabAPI?.isPresentationOnlyRoom?.()
      ) {
        collabAPI.startPresentationSession?.();
      }

      return true;
    },
    [
      excalidrawAPI,
      onLiveBroadcast,
      setPresentationState,
      setPresentationEnded,
      settings,
      refreshSlides,
      collabAPI,
    ],
  );

  const stopPresentation = useCallback(() => {
    collabAPI?.endPresentationSession?.();
    collabAPI?.broadcastPresentationControl?.({
      action: "STOP_PRESENTATION",
    });
    presentationSync.send({
      type: "STOP_PRESENTATION",
    });
    presentationSync.send({
      type: "SYNC_STATE",
      slideIndex: 0,
      totalSlides: 0,
      slideTitle: "",
      isActive: false,
    });

    if (onLiveBroadcast) {
      onLiveBroadcast({
        isLive: false,
        slideIndex: 0,
        totalSlides: 0,
      });
    }

    if (excalidrawAPI && prevAppStateRef.current) {
      excalidrawAPI.updateScene({
        appState: {
          frameRendering: prevAppStateRef.current.frameRendering,
          zenModeEnabled: prevAppStateRef.current.zenModeEnabled,
          viewModeEnabled: prevAppStateRef.current.viewModeEnabled,
        },
      });
    }

    document.body.classList.remove("presentation-mode-active");

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    const roomLink = collabAPI?.getActiveRoomLink?.();
    const baseLink =
      roomLink || (typeof window !== "undefined" ? window.location.href : "");
    if (collabAPI?.isPresentationOnlyRoom?.()) {
      collabAPI.stopCollaboration(false);
    }

    setPresentationEnded({
      presenterUsername: collabAPI?.getUsername?.() || null,
      wasFollower: false,
      shareUrl: baseLink ? stripPresentationParams(baseLink) : null,
      reason: "stopped",
    });

    setPresentationState(DEFAULT_PRESENTATION_STATE);
  }, [
    collabAPI,
    excalidrawAPI,
    onLiveBroadcast,
    setPresentationEnded,
    setPresentationState,
  ]);

  const nextSlide = useCallback(() => {
    const slides = refreshSlides();
    if (!slides.length) {
      return;
    }
    const nextIndex = presentationState.currentSlideIndex + 1;
    if (nextIndex < slides.length) {
      navigateToSlide(nextIndex);
    }
  }, [navigateToSlide, presentationState.currentSlideIndex, refreshSlides]);

  const prevSlide = useCallback(() => {
    const prevIndex = presentationState.currentSlideIndex - 1;
    if (prevIndex >= 0) {
      navigateToSlide(prevIndex);
    }
  }, [navigateToSlide, presentationState.currentSlideIndex]);

  const toggleLaser = useCallback(() => {
    if (!excalidrawAPI) {
      return;
    }
    const currentTool = excalidrawAPI.getAppState().activeTool.type;
    const nextTool = currentTool === "laser" ? "selection" : "laser";
    excalidrawAPI.setActiveTool({ type: nextTool });
    setActiveToolType(nextTool);
  }, [excalidrawAPI]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const toggleLivePresentation = useCallback(() => {
    if (!presentationState.isActive) {
      return;
    }
    const nextIsLive = !presentationState.isLive;
    setPresentationState((prev) => ({ ...prev, isLive: nextIsLive }));

    if (onLiveBroadcast) {
      const slides = slidesRef.current;
      const currentSlide = slides[presentationState.currentSlideIndex];
      onLiveBroadcast({
        isLive: nextIsLive,
        slideIndex: presentationState.currentSlideIndex,
        totalSlides: slides.length,
        slideTitle:
          currentSlide?.name?.trim() ||
          `Slide ${presentationState.currentSlideIndex + 1}`,
        slideId: currentSlide?.id,
      });
    }
  }, [
    onLiveBroadcast,
    presentationState.currentSlideIndex,
    presentationState.isActive,
    presentationState.isLive,
    setPresentationState,
  ]);

  // Listen to remote controller messages
  useEffect(() => {
    const unsub = presentationSync.subscribe((msg) => {
      if (msg.type === "NAVIGATE_SLIDE") {
        navigateToSlide(msg.slideIndex);
      } else if (msg.type === "NEXT_SLIDE") {
        nextSlide();
      } else if (msg.type === "PREV_SLIDE") {
        prevSlide();
      } else if (msg.type === "STOP_PRESENTATION") {
        stopPresentation();
      } else if (msg.type === "UPDATE_SETTINGS" && msg.settings) {
        setSettings((prev) => ({ ...prev, ...msg.settings }));
      }
    });
    return unsub;
  }, [navigateToSlide, nextSlide, prevSlide, stopPresentation, setSettings]);

  // Keyboard navigation handler
  useEffect(() => {
    if (!presentationState.isActive) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events when typing in inputs or textareas
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ": {
          e.preventDefault();
          nextSlide();
          break;
        }
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace": {
          e.preventDefault();
          prevSlide();
          break;
        }
        case "Home": {
          e.preventDefault();
          navigateToSlide(0);
          break;
        }
        case "End": {
          e.preventDefault();
          navigateToSlide(slidesRef.current.length - 1);
          break;
        }
        case "Escape": {
          e.preventDefault();
          setStopConfirm((prev) => !prev);
          break;
        }
        case "l":
        case "L": {
          e.preventDefault();
          toggleLaser();
          break;
        }
        case "f":
        case "F": {
          e.preventDefault();
          toggleFullscreen();
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    navigateToSlide,
    nextSlide,
    presentationState.isActive,
    prevSlide,
    stopPresentation,
    toggleFullscreen,
    toggleLaser,
    setStopConfirm,
  ]);

  return {
    presentationState,
    orderedSlides,
    activeToolType,
    startPresentation,
    stopPresentation,
    navigateToSlide,
    nextSlide,
    prevSlide,
    toggleLaser,
    toggleFullscreen,
    toggleLivePresentation,
    settings,
    setSettings,
  };
};

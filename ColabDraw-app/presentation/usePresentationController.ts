import { useCallback, useEffect, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom } from "../app-jotai";

import {
  DEFAULT_PRESENTATION_STATE,
  presentationModeAtom,
  presentationSettingsAtom,
} from "./presentationState";
import { presentationSync } from "./presentationSync";
import { getOrderedSlides } from "./presentationUtils";

import type { CollabAPI } from "../collab/Collab";

interface UsePresentationControllerOptions {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  collabAPI?: CollabAPI | null;
  onLiveBroadcast?: (payload: {
    isLive: boolean;
    slideIndex: number;
    totalSlides: number;
    slideTitle?: string;
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
    getOrderedSlides(excalidrawAPI?.getSceneElementsIncludingDeleted()),
  );

  // Keep slides list updated
  useEffect(() => {
    if (excalidrawAPI) {
      slidesRef.current = getOrderedSlides(
        excalidrawAPI.getSceneElementsIncludingDeleted(),
      );
    }
  }, [excalidrawAPI, presentationState.isActive]);

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

  // Handle cursor visibility during presentation
  useEffect(() => {
    if (presentationState.isActive && !settings.showCursor) {
      document.body.classList.add("presentation-hide-cursor");
    } else {
      document.body.classList.remove("presentation-hide-cursor");
    }
    return () => {
      document.body.classList.remove("presentation-hide-cursor");
    };
  }, [presentationState.isActive, settings.showCursor]);

  const navigateToSlide = useCallback(
    (index: number) => {
      if (!excalidrawAPI) {
        return;
      }
      const slides = getOrderedSlides(
        excalidrawAPI.getSceneElementsIncludingDeleted(),
      );
      slidesRef.current = slides;

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
        });

        if (presentationState.isLive && onLiveBroadcast) {
          onLiveBroadcast({
            isLive: true,
            slideIndex: clampedIndex,
            totalSlides: slides.length,
            slideTitle,
          });
        }
      }
    },
    [
      excalidrawAPI,
      onLiveBroadcast,
      presentationState.isLive,
      setPresentationState,
      settings.animateSlideMovement,
    ],
  );

  const startPresentation = useCallback(
    (startIndex = 0, isLive = false) => {
      if (!excalidrawAPI) {
        return false;
      }

      const slides = getOrderedSlides(
        excalidrawAPI.getSceneElementsIncludingDeleted(),
      );
      slidesRef.current = slides;

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

      // Broadcast initial presentation start to remote controllers
      presentationSync.send({
        type: "SYNC_STATE",
        slideIndex: clampedIndex,
        totalSlides: slides.length,
        slideTitle,
        isActive: true,
        slideIds: slides.map((s) => s.id),
      });

      if (isLive && onLiveBroadcast) {
        onLiveBroadcast({
          isLive: true,
          slideIndex: clampedIndex,
          totalSlides: slides.length,
          slideTitle,
        });
      }

      return true;
    },
    [
      excalidrawAPI,
      onLiveBroadcast,
      setPresentationState,
      settings.animateSlideMovement,
    ],
  );

  const stopPresentation = useCallback(() => {
    presentationSync.send({
      type: "SYNC_STATE",
      slideIndex: 0,
      totalSlides: 0,
      slideTitle: "",
      isActive: false,
    });

    if (presentationState.isLive && onLiveBroadcast) {
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
    document.body.classList.remove("presentation-hide-cursor");

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    setPresentationState(DEFAULT_PRESENTATION_STATE);
  }, [
    excalidrawAPI,
    onLiveBroadcast,
    presentationState.isLive,
    setPresentationState,
  ]);

  const nextSlide = useCallback(() => {
    navigateToSlide(presentationState.currentSlideIndex + 1);
  }, [navigateToSlide, presentationState.currentSlideIndex]);

  const prevSlide = useCallback(() => {
    navigateToSlide(presentationState.currentSlideIndex - 1);
  }, [navigateToSlide, presentationState.currentSlideIndex]);

  const toggleLaser = useCallback(() => {
    if (!excalidrawAPI) {
      return;
    }
    const currentTool = excalidrawAPI.getAppState().activeTool.type;
    excalidrawAPI.setActiveTool({
      type: currentTool === "laser" ? "selection" : "laser",
    });
  }, [excalidrawAPI]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
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
      }
    });
    return unsub;
  }, [navigateToSlide, nextSlide, prevSlide, stopPresentation]);

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
          stopPresentation();
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
  ]);

  return {
    presentationState,
    orderedSlides: slidesRef.current,
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

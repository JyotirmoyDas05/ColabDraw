import React, { useEffect, useRef, useState } from "react";

import { presentationIcon } from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom, appJotaiStore } from "../app-jotai";
import { dashboardOpenAtom } from "../components/Dashboard";

import {
  activeRemotePresentationAtom,
  DEFAULT_PRESENTATION_STATE,
  presentationModeAtom,
  presentationSessionAtom,
  presentationSessionSupportedAtom,
  presentationSettingsAtom,
} from "./presentationState";
import { presentationSync } from "./presentationSync";
import { getOrderedSlides, getSlideTitle } from "./presentationUtils";
import { PresentationEndConfirmDialog } from "./PresentationEndConfirmDialog";
import { SlideThumbnailCard } from "./SlideThumbnailCard";

import "./PresentationRemoteController.scss";

import type { CollabAPI } from "../collab/Collab";
import type { PresentationSettings } from "./presentationState";

interface PresentationRemoteControllerProps {
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  collabAPI?: CollabAPI | null;
  projectName?: string;
  onExit?: () => void;
}

export const PresentationRemoteController: React.FC<
  PresentationRemoteControllerProps
> = ({
  excalidrawAPI = null,
  collabAPI = null,
  projectName = "Presentation Feature",
  onExit,
}) => {
  const [presentationState, setPresentationState] =
    useAtom(presentationModeAtom);
  const [settings, setSettings] = useAtom(presentationSettingsAtom);
  const [presentationSession] = useAtom(presentationSessionAtom);
  const [presentationSessionSupported] = useAtom(
    presentationSessionSupportedAtom,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const hasSeenActiveSession = useRef(false);

  useEffect(() => {
    if (presentationSession !== null) {
      hasSeenActiveSession.current = true;
    } else if (hasSeenActiveSession.current && presentationSessionSupported) {
      setIsEnded(true);
      if (collabAPI && collabAPI.isCollaborating()) {
        collabAPI.stopCollaboration(false);
      }
    }
  }, [presentationSessionSupported, presentationSession, collabAPI]);
  const [remotePresentation, setRemotePresentation] = useAtom(
    activeRemotePresentationAtom,
  );

  const settingsModalRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  const [slides, setSlides] = useState<readonly ExcalidrawFrameLikeElement[]>(
    () => {
      if (excalidrawAPI) {
        return getOrderedSlides(
          excalidrawAPI.getSceneElementsIncludingDeleted(),
        );
      }
      return [];
    },
  );

  const [currentSlideIndex, setCurrentSlideIndex] = useState(
    presentationState.currentSlideIndex || 0,
  );

  // Close settings popup when clicking outside
  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (
        settingsModalRef.current &&
        !settingsModalRef.current.contains(e.target as Node) &&
        settingsBtnRef.current &&
        !settingsBtnRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [settingsOpen]);

  // Sync settings when broadcast from host
  useEffect(() => {
    if (remotePresentation?.settings) {
      setSettings((prev) => ({
        ...prev,
        ...remotePresentation.settings,
      }));
    }
  }, [remotePresentation?.settings, setSettings]);

  // Continuously sync slides from excalidrawAPI as scene elements load from room / server
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const syncSlides = () => {
      const els = excalidrawAPI.getSceneElementsIncludingDeleted();
      const currentSlides = getOrderedSlides(els);
      setSlides((prev) => {
        if (
          prev.length !== currentSlides.length ||
          prev.some((s, idx) => s.id !== currentSlides[idx]?.id)
        ) {
          return currentSlides;
        }
        return prev;
      });
    };

    syncSlides();
    const interval = setInterval(syncSlides, 600);
    return () => clearInterval(interval);
  }, [excalidrawAPI]);

  // Sync slide index from remote presentation broadcasts
  useEffect(() => {
    if (
      remotePresentation &&
      typeof remotePresentation.slideIndex === "number"
    ) {
      setCurrentSlideIndex(remotePresentation.slideIndex);
      if (remotePresentation.totalSlides && slides.length === 0) {
        const placeholderSlides = Array.from({
          length: remotePresentation.totalSlides,
        }).map((_, i) => ({
          id: `remote-slide-${i}`,
          type: "frame" as const,
          name: `Slide ${i + 1}`,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          angle: 0,
          strokeColor: "#000000",
          backgroundColor: "transparent",
          fillStyle: "solid" as const,
          strokeWidth: 2,
          strokeStyle: "solid" as const,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          frameId: null,
          roundness: null,
          seed: i,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
        })) as unknown as ExcalidrawFrameLikeElement[];
        setSlides(placeholderSlides);
      }
    }
  }, [remotePresentation, slides.length]);

  // Sync state over BroadcastChannel / localStorage for same-origin tabs
  useEffect(() => {
    const unsub = presentationSync.subscribe((msg) => {
      if (msg.type === "SYNC_STATE") {
        setCurrentSlideIndex(msg.slideIndex);
        if (msg.totalSlides && slides.length === 0) {
          const placeholderSlides = Array.from({
            length: msg.totalSlides,
          }).map((_, i) => ({
            id: msg.slideIds?.[i] || `remote-slide-${i}`,
            type: "frame" as const,
            name: `Slide ${i + 1}`,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            angle: 0,
            strokeColor: "#000000",
            backgroundColor: "transparent",
            fillStyle: "solid" as const,
            strokeWidth: 2,
            strokeStyle: "solid" as const,
            roughness: 1,
            opacity: 100,
            groupIds: [],
            frameId: null,
            roundness: null,
            seed: i,
            version: 1,
            versionNonce: 1,
            isDeleted: false,
            boundElements: null,
            updated: Date.now(),
            link: null,
            locked: false,
          })) as unknown as ExcalidrawFrameLikeElement[];
          setSlides(placeholderSlides);
        }
      } else if (msg.type === "NAVIGATE_SLIDE") {
        setCurrentSlideIndex(msg.slideIndex);
      } else if (msg.type === "UPDATE_SETTINGS" && msg.settings) {
        setSettings((prev) => ({ ...prev, ...msg.settings }));
      } else if (msg.type === "STOP_PRESENTATION") {
        setIsEnded(true);
        if (collabAPI && collabAPI.isCollaborating()) {
          collabAPI.stopCollaboration(false);
        }
      }
    });

    return unsub;
  }, [onExit, setSettings, slides.length, collabAPI]);

  const goToSlide = (index: number) => {
    if (!slides.length) {
      return;
    }
    const clamped = Math.max(0, Math.min(index, slides.length - 1));
    setCurrentSlideIndex(clamped);
    setPresentationState((prev) => ({
      ...prev,
      currentSlideIndex: clamped,
      totalSlides: slides.length,
    }));

    // Broadcast to same-machine tabs
    presentationSync.send({
      type: "NAVIGATE_SLIDE",
      slideIndex: clamped,
    });

    // Broadcast across devices over encrypted room socket
    collabAPI?.broadcastPresentationControl?.({
      action: "NAVIGATE_SLIDE",
      slideIndex: clamped,
    });
  };

  const handleNext = () => {
    goToSlide(currentSlideIndex + 1);
    collabAPI?.broadcastPresentationControl?.({
      action: "NEXT_SLIDE",
    });
  };

  const handlePrev = () => {
    goToSlide(currentSlideIndex - 1);
    collabAPI?.broadcastPresentationControl?.({
      action: "PREV_SLIDE",
    });
  };

  const handleSettingChange = (
    key: keyof PresentationSettings,
    value: boolean,
  ) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      presentationSync.send({
        type: "UPDATE_SETTINGS",
        settings: { [key]: value },
      });
      collabAPI?.broadcastPresentationControl?.({
        action: "UPDATE_SETTINGS",
        settings: { [key]: value },
      });
      return updated;
    });
  };

  const handleExitClick = () => {
    setConfirmEndOpen(true);
  };

  const handleConfirmEnd = async () => {
    setConfirmEndOpen(false);
    presentationSync.send({ type: "STOP_PRESENTATION" });
    try {
      collabAPI?.endPresentationSession?.();
      await collabAPI?.broadcastPresentationControl?.({
        action: "STOP_PRESENTATION",
      });
    } catch (err) {
      console.warn("Failed to broadcast STOP_PRESENTATION", err);
    }
    setPresentationState(DEFAULT_PRESENTATION_STATE);
    setRemotePresentation(null);
    setIsEnded(true);
    if (collabAPI && collabAPI.isCollaborating()) {
      collabAPI.stopCollaboration(false);
    }
  };

  const handleReturnToScene = () => {
    if (onExit) {
      onExit();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("presentation");
      window.location.href = url.toString();
    }
  };

  const handleReturnToDashboard = () => {
    appJotaiStore.set(dashboardOpenAtom, true);
    if (onExit) {
      onExit();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("presentation");
      window.location.href = url.toString();
    }
  };

  // If presentation has ended, display the end-of-presentation card
  if (isEnded) {
    return (
      <div className="presentation-remote presentation-remote--ended">
        <header className="presentation-remote__header">
          <h1 className="presentation-remote__title">{projectName}</h1>
        </header>

        <div className="presentation-remote__ended-content">
          <div className="presentation-remote__ended-icon-wrapper">
            <span className="presentation-remote__ended-icon">
              {presentationIcon}
            </span>
          </div>

          <h2 className="presentation-remote__ended-title">
            The presentation has now ended
          </h2>
          <p className="presentation-remote__ended-subtitle">
            The host has ended the presentation and this remote control link is
            closed.
          </p>

          <div className="presentation-remote__ended-card">
            <h3 className="presentation-remote__ended-card-title">
              You can now:
            </h3>
            <div className="presentation-remote__ended-actions">
              <button
                type="button"
                className="presentation-remote__ended-btn presentation-remote__ended-btn--primary"
                onClick={handleReturnToScene}
              >
                Return to scene
              </button>
              <button
                type="button"
                className="presentation-remote__ended-btn presentation-remote__ended-btn--secondary"
                onClick={handleReturnToDashboard}
              >
                Return to dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeSlide = slides[currentSlideIndex];
  const slideTitle = getSlideTitle(activeSlide, currentSlideIndex);
  const isFirstSlide = currentSlideIndex <= 0;
  const isLastSlide = currentSlideIndex >= slides.length - 1;

  return (
    <div className="presentation-remote">
      {/* Top Mobile App Header */}
      <header className="presentation-remote__header">
        <h1 className="presentation-remote__title">{projectName}</h1>
        <div className="presentation-remote__actions">
          <button
            ref={settingsBtnRef}
            type="button"
            className="presentation-remote__btn presentation-remote__btn--settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Settings"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            type="button"
            className="presentation-remote__btn presentation-remote__btn--exit"
            onClick={handleExitClick}
            title="Exit presentation"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2.5" />
            </svg>
          </button>
        </div>
      </header>

      {/* Settings Modal */}
      {settingsOpen && (
        <div
          className="presentation-remote__settings-modal"
          ref={settingsModalRef}
        >
          <div className="presentation-remote__settings-row">
            <span>Animate slide movement</span>
            <label className="presentation-toggle-switch">
              <input
                type="checkbox"
                checked={settings.animateSlideMovement}
                onChange={(e) =>
                  handleSettingChange("animateSlideMovement", e.target.checked)
                }
              />
              <span className="presentation-toggle-switch__slider" />
            </label>
          </div>
          <div className="presentation-remote__settings-row">
            <span>Show cursor</span>
            <label className="presentation-toggle-switch">
              <input
                type="checkbox"
                checked={settings.showCursor}
                onChange={(e) =>
                  handleSettingChange("showCursor", e.target.checked)
                }
              />
              <span className="presentation-toggle-switch__slider" />
            </label>
          </div>
          <div className="presentation-remote__settings-row">
            <span>Show slide title</span>
            <label className="presentation-toggle-switch">
              <input
                type="checkbox"
                checked={settings.showSlideTitle}
                onChange={(e) =>
                  handleSettingChange("showSlideTitle", e.target.checked)
                }
              />
              <span className="presentation-toggle-switch__slider" />
            </label>
          </div>
        </div>
      )}

      {/* Main Active Slide Preview Card */}
      <section className="presentation-remote__main-preview">
        {activeSlide ? (
          <SlideThumbnailCard
            slide={activeSlide}
            index={currentSlideIndex}
            totalSlides={slides.length}
            isSelected={true}
            excalidrawAPI={excalidrawAPI}
            collabAPI={collabAPI}
            onSelect={() => goToSlide(currentSlideIndex)}
            showActions={false}
            previewOnly={true}
          />
        ) : (
          <div className="presentation-remote__placeholder-card">
            <span>No Slide Preview</span>
          </div>
        )}
      </section>

      {/* Current Slide Label */}
      <div className="presentation-remote__current-label">
        Current slide: <strong>{slideTitle}</strong>
      </div>

      {/* Slide Thumbnails List */}
      <section className="presentation-remote__slides-section">
        <h2 className="presentation-remote__slides-header">
          Slides ({slides.length})
        </h2>
        <div className="presentation-remote__slides-list">
          {slides.map((slide, index) => {
            const isCurrent = index === currentSlideIndex;
            return (
              <div
                key={slide.id}
                className={`presentation-remote__slide-item ${
                  isCurrent ? "is-selected" : ""
                }`}
                onClick={() => goToSlide(index)}
              >
                <SlideThumbnailCard
                  slide={slide}
                  index={index}
                  totalSlides={slides.length}
                  isSelected={isCurrent}
                  excalidrawAPI={excalidrawAPI}
                  collabAPI={collabAPI}
                  onSelect={() => goToSlide(index)}
                  showActions={false}
                  previewOnly={false}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Bottom Circle Navigation Buttons (← and large →) */}
      <footer className="presentation-remote__footer">
        <button
          type="button"
          className="presentation-remote__nav-btn presentation-remote__nav-btn--prev"
          onClick={handlePrev}
          disabled={isFirstSlide}
          title="Previous slide"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <button
          type="button"
          className="presentation-remote__nav-btn presentation-remote__nav-btn--next"
          onClick={handleNext}
          disabled={isLastSlide}
          title="Next slide"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </footer>

      <PresentationEndConfirmDialog
        isOpen={confirmEndOpen}
        isPublic={settings.isPublic}
        onTogglePublic={(val) => handleSettingChange("isPublic", val)}
        onConfirmEnd={handleConfirmEnd}
        onCancel={() => setConfirmEndOpen(false)}
      />
    </div>
  );
};

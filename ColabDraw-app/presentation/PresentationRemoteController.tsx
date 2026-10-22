import React, { useEffect, useState } from "react";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom } from "../app-jotai";

import {
  activeRemotePresentationAtom,
  presentationModeAtom,
  presentationSettingsAtom,
} from "./presentationState";
import { presentationSync } from "./presentationSync";
import { getOrderedSlides, getSlideTitle } from "./presentationUtils";
import { SlideThumbnailCard } from "./SlideThumbnailCard";

import "./PresentationRemoteController.scss";

import type { CollabAPI } from "../collab/Collab";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remotePresentation] = useAtom(activeRemotePresentationAtom);

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
    }
  }, [remotePresentation]);

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
      } else if (msg.type === "STOP_PRESENTATION") {
        if (onExit) {
          onExit();
        }
      }
    });

    return unsub;
  }, [onExit, slides.length]);

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

  const handleExit = () => {
    presentationSync.send({ type: "STOP_PRESENTATION" });
    collabAPI?.broadcastPresentationControl?.({
      action: "STOP_PRESENTATION",
    });
    if (onExit) {
      onExit();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("presentation");
      window.location.href = url.toString();
    }
  };

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
            onClick={handleExit}
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
        <div className="presentation-remote__settings-modal">
          <div className="presentation-remote__settings-row">
            <span>Animate slide movement</span>
            <label className="presentation-toggle-switch">
              <input
                type="checkbox"
                checked={settings.animateSlideMovement}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    animateSlideMovement: e.target.checked,
                  }))
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
                  setSettings((prev) => ({
                    ...prev,
                    showCursor: e.target.checked,
                  }))
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
                  setSettings((prev) => ({
                    ...prev,
                    showSlideTitle: e.target.checked,
                  }))
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
    </div>
  );
};

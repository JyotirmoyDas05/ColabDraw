import React, { useEffect, useRef, useState } from "react";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom } from "../app-jotai";

import {
  activeRemotePresentationAtom,
  type PresentationModeState,
} from "./presentationState";
import { getSlideTitle } from "./presentationUtils";
import { SlideThumbnailCard } from "./SlideThumbnailCard";

import "./PresentationHUD.scss";

interface PresentationHUDProps {
  presentationState: PresentationModeState;
  slides: readonly ExcalidrawFrameLikeElement[];
  onNext: () => void;
  onPrev: () => void;
  onGoToSlide: (index: number) => void;
  onStop: () => void;
  onToggleLaser: () => void;
  onToggleFullscreen: () => void;
  onToggleLive: () => void;
  onJoinRemotePresentation?: (info: {
    presenterSocketId: string;
    presenterUsername: string;
  }) => void;
  onStopFollowing?: () => void;
  isLaserActive?: boolean;
  isCollaborating?: boolean;
  appTheme?: string;
  onToggleTheme?: () => void;
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
}

export const PresentationHUD: React.FC<PresentationHUDProps> = ({
  presentationState,
  slides,
  onNext,
  onPrev,
  onGoToSlide,
  onStop,
  onToggleLaser,
  onToggleFullscreen,
  onToggleLive,
  onJoinRemotePresentation,
  onStopFollowing,
  isLaserActive = false,
  isCollaborating = false,
  appTheme = "light",
  onToggleTheme,
  excalidrawAPI = null,
}) => {
  const [slidesDrawerOpen, setSlidesDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [remotePresentation, setRemotePresentation] = useAtom(
    activeRemotePresentationAtom,
  );

  const drawerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Close slides drawer and settings when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setSlidesDrawerOpen(false);
      }
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    if (slidesDrawerOpen || settingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [slidesDrawerOpen, settingsOpen]);

  const currentSlide = slides[presentationState.currentSlideIndex];
  const slideTitle = getSlideTitle(
    currentSlide,
    presentationState.currentSlideIndex,
  );
  const isFirstSlide = presentationState.currentSlideIndex <= 0;
  const isLastSlide = presentationState.currentSlideIndex >= slides.length - 1;

  // Remote presentation invitation toast for room participants who aren't presenting
  const showRemotePrompt =
    remotePresentation &&
    !presentationState.isActive &&
    !presentationState.isFollower;

  return (
    <>
      {/* Remote presentation invitation banner */}
      {showRemotePrompt && onJoinRemotePresentation && (
        <div className="presentation-live-notification">
          <span className="presentation-hud__pulse-dot" />
          <div className="presentation-live-notification__content">
            <span className="presentation-live-notification__title">
              {remotePresentation.presenterUsername} is presenting
            </span>
            <span className="presentation-live-notification__subtitle">
              {remotePresentation.slideTitle ||
                `Slide ${remotePresentation.slideIndex + 1} of ${
                  remotePresentation.totalSlides
                }`}
            </span>
          </div>
          <div className="presentation-live-notification__actions">
            <button
              type="button"
              className="presentation-live-notification__join-btn"
              onClick={() => {
                onJoinRemotePresentation({
                  presenterSocketId: remotePresentation.presenterSocketId,
                  presenterUsername: remotePresentation.presenterUsername,
                });
              }}
            >
              Join
            </button>
            <button
              type="button"
              className="presentation-live-notification__dismiss-btn"
              onClick={() => setRemotePresentation(null)}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Top slide title pill during active presentation */}
      {presentationState.isActive && (
        <div className="presentation-top-banner">
          <span className="presentation-top-banner__title">{slideTitle}</span>
        </div>
      )}

      {/* Follower bar if watching someone else's presentation */}
      {presentationState.isFollower && onStopFollowing && (
        <div className="presentation-hud">
          <span className="presentation-hud__pulse-dot" />
          <span style={{ fontSize: "13px", fontWeight: 500, padding: "0 6px" }}>
            Watching {presentationState.presenterUsername}&apos;s presentation
          </span>
          <button
            type="button"
            className="presentation-hud__button presentation-hud__button--exit"
            onClick={onStopFollowing}
          >
            Stop watching
          </button>
        </div>
      )}

      {/* Main presenter HUD island controls */}
      {presentationState.isActive && (
        <>
          <div className="presentation-hud">
            {/* Previous slide arrow button ← */}
            <button
              type="button"
              className="presentation-hud__button"
              onClick={onPrev}
              disabled={isFirstSlide}
              title="Previous slide (← / ↑ / PageUp)"
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

            {/* Slide counter pill with upward drawer trigger */}
            <div
              className="presentation-hud__slide-trigger-wrap"
              ref={drawerRef}
            >
              <button
                type="button"
                className={`presentation-hud__slide-pill ${
                  slidesDrawerOpen ? "is-active" : ""
                }`}
                onClick={() => setSlidesDrawerOpen(!slidesDrawerOpen)}
                title="View all slides"
              >
                <span>
                  Slide {presentationState.currentSlideIndex + 1}/
                  {slides.length}
                </span>
              </button>

              {/* Upward Slide Thumbnail Drawer Popover */}
              {slidesDrawerOpen && (
                <div className="presentation-hud-drawer">
                  <div className="presentation-hud-drawer__header">
                    Slides ({slides.length})
                  </div>
                  <div className="presentation-hud-drawer__list">
                    {slides.map((slide, index) => {
                      const isCurrent =
                        index === presentationState.currentSlideIndex;
                      return (
                        <div
                          key={slide.id}
                          className="presentation-hud-drawer__item"
                        >
                          <SlideThumbnailCard
                            slide={slide}
                            index={index}
                            totalSlides={slides.length}
                            isSelected={isCurrent}
                            excalidrawAPI={excalidrawAPI}
                            onSelect={() => {
                              onGoToSlide(index);
                              setSlidesDrawerOpen(false);
                            }}
                            showActions={false}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Next slide arrow button → */}
            <button
              type="button"
              className="presentation-hud__button"
              onClick={onNext}
              disabled={isLastSlide}
              title="Next slide (→ / ↓ / Space / PageDown)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            {/* Divider line | */}
            <div className="presentation-hud__divider" />

            {/* Follow / Collab live broadcast button 👤+ */}
            <button
              type="button"
              className={`presentation-hud__button ${
                presentationState.isLive ? "is-live" : ""
              }`}
              onClick={onToggleLive}
              title={
                isCollaborating
                  ? presentationState.isLive
                    ? "Live presenting to room (Click to stop broadcasting)"
                    : "Broadcast live presentation to room"
                  : "Collaborative live presenting"
              }
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </button>

            {/* Call / Room Audio button 📞 */}
            <button
              type="button"
              className="presentation-hud__button"
              title="Voice hangout (Feature disabled)"
              style={{ opacity: 0.65 }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>

            {/* Dark / Light mode toggle 🌙 / ☀️ */}
            <button
              type="button"
              className="presentation-hud__button"
              onClick={onToggleTheme}
              title={
                appTheme === "dark"
                  ? "Switch to Light Mode"
                  : "Switch to Dark Mode"
              }
            >
              {appTheme === "dark" ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            {/* Fullscreen toggle ⛶ */}
            <button
              type="button"
              className="presentation-hud__button"
              onClick={onToggleFullscreen}
              title={
                isFullscreen ? "Exit Fullscreen (F)" : "Enter Fullscreen (F)"
              }
            >
              {isFullscreen ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>

            {/* Settings gear icon ⚙ */}
            <div className="presentation-hud__settings-wrap" ref={settingsRef}>
              <button
                type="button"
                className={`presentation-hud__button ${
                  settingsOpen ? "is-active" : ""
                }`}
                onClick={() => setSettingsOpen(!settingsOpen)}
                title="Presentation settings"
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

              {settingsOpen && (
                <div className="presentation-hud-settings-menu">
                  <div className="presentation-hud-settings-menu__title">
                    Settings
                  </div>
                  <div className="presentation-hud-settings-menu__item">
                    <span>Keyboard shortcuts:</span>
                  </div>
                  <div className="presentation-hud-settings-menu__hint">
                    <div>Next: →, ↓, Space, PageDown</div>
                    <div>Prev: ←, ↑, PageUp</div>
                    <div>Laser pointer: L</div>
                    <div>Fullscreen: F</div>
                    <div>Exit: Esc</div>
                  </div>
                </div>
              )}
            </div>

            {/* Distinct Red Pill End presentation button ⏹ */}
            <button
              type="button"
              className="presentation-hud__end-btn"
              onClick={onStop}
              title="End presentation (Esc)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              <span>End presentation</span>
            </button>
          </div>

          {/* Floating Laser Pointer Wand Tool 🪄 at bottom-right corner */}
          <button
            type="button"
            className={`presentation-laser-floating-btn ${
              isLaserActive ? "is-active" : ""
            }`}
            onClick={onToggleLaser}
            title={
              isLaserActive
                ? "Laser pointer active (Click or press L to disable)"
                : "Laser pointer (L)"
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m14 10 7.5-7.5" />
              <path d="m8.5 15.5 3 3" />
              <path d="m2 22 7.5-7.5" />
              <path d="M6 3v3" />
              <path d="M4.5 4.5h3" />
              <path d="M18 15v3" />
              <path d="M16.5 16.5h3" />
            </svg>
          </button>
        </>
      )}
    </>
  );
};

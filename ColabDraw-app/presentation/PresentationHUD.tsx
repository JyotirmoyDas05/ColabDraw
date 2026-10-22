import React, { useEffect, useRef, useState } from "react";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";

import { useAtom } from "../app-jotai";

import {
  activeRemotePresentationAtom,
  type PresentationModeState,
} from "./presentationState";
import { getSlideTitle } from "./presentationUtils";
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
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [remotePresentation, setRemotePresentation] = useAtom(
    activeRemotePresentationAtom,
  );

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

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

      {/* Main presenter HUD controls */}
      {presentationState.isActive && (
        <div className="presentation-hud">
          {/* Previous Slide button */}
          <button
            type="button"
            className="presentation-hud__button"
            onClick={onPrev}
            disabled={isFirstSlide}
            title="Previous slide (← / ↑ / Space)"
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

          {/* Slide counter & jump dropdown */}
          <div className="presentation-hud__slide-selector" ref={dropdownRef}>
            <button
              type="button"
              className="presentation-hud__slide-trigger"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              title="Click to jump to a slide"
            >
              <span>
                {presentationState.currentSlideIndex + 1} / {slides.length}
              </span>
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="presentation-hud__dropdown">
                {slides.map((slide, index) => {
                  const title = getSlideTitle(slide, index);
                  const isCurrent =
                    index === presentationState.currentSlideIndex;
                  return (
                    <button
                      key={slide.id}
                      type="button"
                      className={`presentation-hud__dropdown-item ${
                        isCurrent ? "is-active" : ""
                      }`}
                      onClick={() => {
                        onGoToSlide(index);
                        setDropdownOpen(false);
                      }}
                    >
                      <span className="presentation-hud__dropdown-item__index">
                        {index + 1}.
                      </span>
                      <span className="presentation-hud__dropdown-item__title">
                        {title}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Next Slide button */}
          <button
            type="button"
            className="presentation-hud__button"
            onClick={onNext}
            disabled={isLastSlide}
            title="Next slide (→ / ↓ / Space)"
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

          <div className="presentation-hud__divider" />

          {/* Laser Pointer Tool button */}
          <button
            type="button"
            className={`presentation-hud__button ${
              isLaserActive ? "presentation-hud__button--active" : ""
            }`}
            onClick={onToggleLaser}
            title="Laser pointer (L)"
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
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
            </svg>
          </button>

          {/* Fullscreen button */}
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
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>

          {/* Live broadcast button (if in a collab room) */}
          {isCollaborating && (
            <button
              type="button"
              className={`presentation-hud__button presentation-hud__button--live ${
                presentationState.isLive ? "is-live" : ""
              }`}
              onClick={onToggleLive}
              title={
                presentationState.isLive
                  ? "Live presenting to room (Click to stop broadcasting)"
                  : "Broadcast presentation to collaborators in room"
              }
            >
              {presentationState.isLive && (
                <span className="presentation-hud__pulse-dot" />
              )}
              <span>{presentationState.isLive ? "Live" : "Go Live"}</span>
            </button>
          )}

          {/* Exit Presentation */}
          <button
            type="button"
            className="presentation-hud__button presentation-hud__button--exit"
            onClick={onStop}
            title="Exit presentation (Esc)"
          >
            <span>Exit</span>
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
};

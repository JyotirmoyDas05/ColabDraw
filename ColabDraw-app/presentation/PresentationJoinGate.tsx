import React, { useEffect, useState } from "react";
import { getRandomUsername } from "@excalidraw/random-username";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { appJotaiStore, useAtom } from "../app-jotai";
import { BrandMark } from "../components/BrandMark";

import { isCollaborationLink } from "../data";

import {
  activeRemotePresentationAtom,
  presentationModeAtom,
  rememberViewerPriorSceneId,
  viewerPresentationStateAtom,
} from "./presentationState";
import { cleanPresentationUrl, getOrderedSlides } from "./presentationUtils";
import { SlideThumbnailCard } from "./SlideThumbnailCard";

import "./PresentationJoinGate.scss";

import type { CollabAPI } from "../collab/Collab";

interface PresentationJoinGateProps {
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  collabAPI?: CollabAPI | null;
  hostName?: string | null;
  onJoin: () => void;
}

export const PresentationJoinGate: React.FC<PresentationJoinGateProps> = ({
  excalidrawAPI = null,
  collabAPI = null,
  hostName = null,
  onJoin,
}) => {
  const [, setPresentationMode] = useAtom(presentationModeAtom);
  const [remotePresentation] = useAtom(activeRemotePresentationAtom);

  const [username, setUsername] = useState<string>(() => {
    const existing = collabAPI?.getUsername?.();
    if (existing && existing.trim()) {
      return existing.trim();
    }
    return getRandomUsername();
  });

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

  // Sync slides as room scene loads
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const updateSlides = () => {
      const current = getOrderedSlides(
        excalidrawAPI.getSceneElementsIncludingDeleted(),
      );
      setSlides((prev) => {
        if (
          prev.length !== current.length ||
          prev.some((s, idx) => s.id !== current[idx]?.id)
        ) {
          return current;
        }
        return prev;
      });
    };

    updateSlides();
    const interval = setInterval(updateSlides, 500);
    return () => clearInterval(interval);
  }, [excalidrawAPI]);

  const currentSlideIndex = remotePresentation?.slideIndex ?? 0;
  const activeSlide = slides[currentSlideIndex] || slides[0];

  const effectiveHostName =
    hostName?.trim() || remotePresentation?.presenterUsername?.trim() || "Host";

  const hostInitial = effectiveHostName.charAt(0).toUpperCase();
  const hasValidRoom =
    typeof window !== "undefined" && isCollaborationLink(window.location.href);

  const handleJoin = (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    const trimmed = username.trim();
    if (!trimmed) {
      return;
    }

    rememberViewerPriorSceneId();

    if (collabAPI) {
      collabAPI.setUsername(trimmed);
    }

    const slideId = activeSlide?.id ?? null;

    setPresentationMode({
      isActive: false,
      currentSlideIndex,
      totalSlides: remotePresentation?.totalSlides ?? slides.length,
      currentSlideId: slideId,
      isLive: false,
      isFollower: true,
      presenterSocketId: remotePresentation?.presenterSocketId ?? null,
      presenterUsername: effectiveHostName,
    });

    appJotaiStore.set(viewerPresentationStateAtom, {
      isFollowing: true,
      currentSlideIndex,
      currentSlideId: slideId,
      isFilmstripPinned: false,
    });

    onJoin();
  };

  return (
    <div className="presentation-join-gate" role="dialog" aria-modal="true">
      {/* Top ColabDraw Brand Header */}
      <header className="presentation-join-gate__top-brand">
        <BrandMark />
      </header>

      {/* Main Split Container */}
      <div className="presentation-join-gate__card">
        {/* Left Side: Presentation Browser-Chrome Frame with Slide Preview */}
        <section className="presentation-join-gate__left">
          <div className="presentation-join-gate__badge">
            <span className="presentation-join-gate__badge-dot" />
            Presentation
          </div>

          <div className="presentation-join-gate__browser-frame">
            <div className="presentation-join-gate__browser-chrome">
              <div className="presentation-join-gate__chrome-dots">
                <span className="dot dot--red" />
                <span className="dot dot--yellow" />
                <span className="dot dot--green" />
              </div>
              <div className="presentation-join-gate__chrome-address">
                colabdraw.app/presentation
              </div>
            </div>

            <div className="presentation-join-gate__slide-viewport">
              {activeSlide ? (
                <SlideThumbnailCard
                  slide={activeSlide}
                  index={currentSlideIndex}
                  totalSlides={slides.length || 1}
                  isSelected={false}
                  excalidrawAPI={excalidrawAPI}
                  collabAPI={collabAPI}
                  showActions={false}
                  previewOnly={true}
                  onSelect={() => {}}
                />
              ) : (
                <div className="presentation-join-gate__slide-placeholder">
                  <div className="presentation-join-gate__placeholder-canvas">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                    <span>Loading presentation preview...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right Side: Join Presentation Form */}
        <section className="presentation-join-gate__right">
          <h1 className="presentation-join-gate__title">
            {hasValidRoom
              ? "Ready to join presentation?"
              : "Unable to Join Presentation"}
          </h1>

          <div className="presentation-join-gate__invite-subtext">
            <div className="presentation-join-gate__host-avatar">
              {hostInitial}
            </div>
            <span>
              {hasValidRoom ? (
                <>
                  You have been invited by <strong>{effectiveHostName}</strong>
                </>
              ) : (
                <>
                  This link is missing room details. Ask{" "}
                  <strong>{effectiveHostName}</strong> to share a new
                  presentation link.
                </>
              )}
            </span>
          </div>

          {hasValidRoom ? (
            <form
              className="presentation-join-gate__form"
              onSubmit={handleJoin}
            >
              <div className="presentation-join-gate__field">
                <label
                  htmlFor="presentation-join-username"
                  className="presentation-join-gate__label"
                >
                  Your name
                </label>
                <input
                  id="presentation-join-username"
                  type="text"
                  className="presentation-join-gate__input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your name"
                  autoComplete="off"
                  autoFocus
                  maxLength={40}
                />
              </div>

              <button
                type="submit"
                className="presentation-join-gate__btn"
                disabled={!username.trim()}
              >
                Join Presentation
              </button>
            </form>
          ) : (
            <div className="presentation-join-gate__form">
              <button
                type="button"
                className="presentation-join-gate__btn"
                onClick={() => {
                  cleanPresentationUrl();
                  onJoin();
                }}
              >
                Go to Canvas
              </button>
            </div>
          )}

          <p className="presentation-join-gate__terms">
            {hasValidRoom
              ? "By joining, you will follow the presenter's slides live."
              : "You can continue to your canvas."}
          </p>
        </section>
      </div>
    </div>
  );
};

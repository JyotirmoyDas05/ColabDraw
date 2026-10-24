import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  laserPointerToolIcon,
  presentationIcon,
} from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom } from "../app-jotai";
import { activeRoomLinkAtom, type CollabAPI } from "../collab/Collab";
import { QRCode } from "../share/QRCode";

import { PresentationEndConfirmDialog } from "./PresentationEndConfirmDialog";
import { PresentationFocusOverlay } from "./PresentationFocusOverlay";
import {
  exportPresentationToPdf,
  exportPresentationToPptx,
} from "./presentationExport";
import { buildPresentationJoinLink } from "./presentationLayout";
import { PresentationFollowPill } from "./PresentationFollowPill";
import { PresentationViewerFilmstrip } from "./PresentationViewerFilmstrip";
import {
  activeRemotePresentationAtom,
  clearViewerPriorSceneId,
  getViewerPriorSceneId,
  type PresentationModeState,
  presentationEndedAtom,
  presentationSettingsAtom,
  presentationStopConfirmAtom,
  viewerPresentationStateAtom,
} from "./presentationState";
import { presentationSync } from "./presentationSync";
import { getSlideTitle, restoreViewerOriginalScene } from "./presentationUtils";
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
  onOpenDashboard?: () => void;
  isLaserActive?: boolean;
  isCollaborating?: boolean;
  appTheme?: string;
  onToggleTheme?: () => void;
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  collabAPI?: CollabAPI | null;
  onViewerNext?: () => void;
  onViewerPrev?: () => void;
  onViewerGoToSlide?: (index: number) => void;
  onToggleViewerFollow?: () => void;
  onToggleFilmstripPinned?: () => void;
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
  onOpenDashboard,
  isLaserActive = false,
  isCollaborating = false,
  appTheme = "light",
  onToggleTheme,
  excalidrawAPI = null,
  collabAPI = null,
  onViewerNext,
  onViewerPrev,
  onViewerGoToSlide,
  onToggleViewerFollow,
  onToggleFilmstripPinned,
}) => {
  const [viewerState] = useAtom(viewerPresentationStateAtom);
  const [slidesDrawerOpen, setSlidesDrawerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remoteSectionOpen, setRemoteSectionOpen] = useState(true);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [copiedRemoteLink, setCopiedRemoteLink] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [remotePresentation, setRemotePresentation] = useAtom(
    activeRemotePresentationAtom,
  );
  const [settings, setSettings] = useAtom(presentationSettingsAtom);
  const [stopConfirm, setStopConfirm] = useAtom(presentationStopConfirmAtom);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [activeRoomLink] = useAtom(activeRoomLinkAtom);
  const [presentationEnded, setPresentationEnded] = useAtom(
    presentationEndedAtom,
  );

  const drawerRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);
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

  // Close popovers when clicking outside (using capture phase on window so canvas stopPropagation cannot block it)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node;
      if (drawerRef.current && !drawerRef.current.contains(target)) {
        setSlidesDrawerOpen(false);
      }
      if (shareRef.current && !shareRef.current.contains(target)) {
        setShareOpen(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(target)) {
        setSettingsOpen(false);
      }
    };
    if (slidesDrawerOpen || shareOpen || settingsOpen) {
      window.addEventListener("pointerdown", handleClickOutside, true);
    }
    return () => {
      window.removeEventListener("pointerdown", handleClickOutside, true);
    };
  }, [slidesDrawerOpen, shareOpen, settingsOpen]);

  const ensureCollabRoom = useCallback(async (): Promise<string> => {
    let link = activeRoomLink;
    if (!link && collabAPI) {
      if (
        !collabAPI.isCollaborating() &&
        !collabAPI.isPresentationOnlyRoom?.()
      ) {
        try {
          await collabAPI.startCollaboration(null, { forPresentation: true });
        } catch (err) {
          console.warn("Could not auto-start presentation room:", err);
        }
      }
      link = collabAPI.getActiveRoomLink() || window.location.href;
    }
    return link || window.location.href;
  }, [activeRoomLink, collabAPI]);

  // When share popover or remote control accordion is visible in settings, ensure a live presentation room exists
  useEffect(() => {
    if (
      (shareOpen || (settingsOpen && remoteSectionOpen)) &&
      collabAPI &&
      !collabAPI.isCollaborating() &&
      !collabAPI.isPresentationOnlyRoom?.()
    ) {
      collabAPI
        .startCollaboration(null, { forPresentation: true })
        .catch((err) => {
          console.warn(
            "Could not auto-start presentation room for share/remote",
            err,
          );
        });
    }
  }, [shareOpen, settingsOpen, remoteSectionOpen, collabAPI]);

  const currentSlide = slides[presentationState.currentSlideIndex];
  const activeViewerSlide = useMemo(() => {
    if (viewerState.currentSlideId) {
      const found = slides.find((s) => s.id === viewerState.currentSlideId);
      if (found) {
        return found;
      }
    }
    return slides[viewerState.currentSlideIndex] || null;
  }, [slides, viewerState.currentSlideId, viewerState.currentSlideIndex]);

  const activeOverlaySlide = presentationState.isFollower
    ? activeViewerSlide
    : currentSlide;
  const slideTitle = getSlideTitle(
    currentSlide,
    presentationState.currentSlideIndex,
  );
  const isFirstSlide = presentationState.currentSlideIndex <= 0;
  const isLastSlide = presentationState.currentSlideIndex >= slides.length - 1;

  // Collaborators in room
  const collaboratorsMap = excalidrawAPI?.getAppState().collaborators;
  const collaboratorsList =
    collabAPI?.isCollaborating() && collaboratorsMap
      ? Array.from(collaboratorsMap.entries()).map(([id, c]) => ({
          id,
          username: c.username,
        }))
      : [];

  const handleCopyPresentationLink = async () => {
    const baseUrl = await ensureCollabRoom();
    const joinLink = buildPresentationJoinLink({
      baseUrl,
      hostName: collabAPI?.getUsername?.(),
      isPublic: settings.isPublic,
    });
    navigator.clipboard.writeText(joinLink).then(() => {
      setCopiedShareLink(true);
      setTimeout(() => setCopiedShareLink(false), 3000);
    });
  };

  // Settings that affect the audience (cursor, public access, …) must be
  // broadcast, otherwise followers keep a stale copy.
  const updateSetting = (key: keyof typeof settings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    const patch = { [key]: value };
    presentationSync.send({ type: "UPDATE_SETTINGS", settings: patch });
    collabAPI?.broadcastPresentationControl?.({
      action: "UPDATE_SETTINGS",
      settings: patch,
    });
  };

  const remoteControlUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const currentLink = activeRoomLink || window.location.href;
    try {
      const url = new URL(currentLink);
      url.searchParams.set("presentation", "remote");
      return url.toString();
    } catch {
      const url = new URL(window.location.href);
      url.searchParams.set("presentation", "remote");
      return url.toString();
    }
  }, [activeRoomLink]);

  const handleCopyRemoteLink = async () => {
    const currentLink = await ensureCollabRoom();
    let remoteUrl = currentLink;
    try {
      const url = new URL(currentLink);
      url.searchParams.set("presentation", "remote");
      remoteUrl = url.toString();
    } catch {
      const url = new URL(window.location.href);
      url.searchParams.set("presentation", "remote");
      remoteUrl = url.toString();
    }
    navigator.clipboard.writeText(remoteUrl).then(() => {
      setCopiedRemoteLink(true);
      setTimeout(() => setCopiedRemoteLink(false), 3000);
    });
  };

  const [isExporting, setIsExporting] = useState<"pdf" | "pptx" | null>(null);

  const handleDownloadPDF = async () => {
    if (!excalidrawAPI || !slides.length) {
      return;
    }
    try {
      setIsExporting("pdf");
      await exportPresentationToPdf({
        excalidrawAPI,
        slides,
        onProgress: (p) => {
          excalidrawAPI.setToast({
            message: `Exporting PDF: slide ${p.current} of ${p.total}...`,
            duration: 2000,
          });
        },
      });
      excalidrawAPI.setToast({
        message: "PDF presentation exported successfully!",
        duration: 3000,
      });
    } catch (err: any) {
      console.error("PDF export failed:", err);
      excalidrawAPI.setToast({
        message: `PDF export failed: ${err.message || "Unknown error"}`,
        duration: 4000,
      });
    } finally {
      setIsExporting(null);
    }
  };

  const handleDownloadPPTX = async () => {
    if (!excalidrawAPI || !slides.length) {
      return;
    }
    try {
      setIsExporting("pptx");
      await exportPresentationToPptx({
        excalidrawAPI,
        slides,
        onProgress: (p) => {
          excalidrawAPI.setToast({
            message: `Exporting PPTX: slide ${p.current} of ${p.total}...`,
            duration: 2000,
          });
        },
      });
      excalidrawAPI.setToast({
        message: "PowerPoint presentation exported successfully!",
        duration: 3000,
      });
    } catch (err: any) {
      console.error("PPTX export failed:", err);
      excalidrawAPI.setToast({
        message: `PPTX export failed: ${err.message || "Unknown error"}`,
        duration: 4000,
      });
    } finally {
      setIsExporting(null);
    }
  };

  // Remote presentation invitation toast for room participants who aren't presenting
  const showRemotePrompt =
    remotePresentation &&
    !presentationState.isActive &&
    !presentationState.isFollower;

  return (
    <>
      {/* Complete slide isolation: opaque presentation stage backdrop around the focused slide */}
      <PresentationFocusOverlay
        excalidrawAPI={excalidrawAPI}
        slide={activeOverlaySlide}
        enabled={presentationState.isActive}
        isViewer={presentationState.isFollower}
        appTheme={appTheme === "dark" ? "dark" : "light"}
      />

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

      {/* Top slide title pill during active presentation (if enabled in settings) */}
      {presentationState.isActive && settings.showSlideTitle && (
        <div className="presentation-top-banner">
          <span className="presentation-top-banner__title">{slideTitle}</span>
        </div>
      )}

      {/* Viewer Left Filmstrip Sidebar */}
      {presentationState.isFollower && (
        <PresentationViewerFilmstrip
          slides={slides as ExcalidrawFrameLikeElement[]}
          activeViewerSlideIndex={viewerState.currentSlideIndex}
          hostSlideIndex={presentationState.currentSlideIndex}
          isPinned={viewerState.isFilmstripPinned}
          onTogglePin={onToggleFilmstripPinned || (() => {})}
          onSelectSlide={(slide, index) => {
            if (onViewerGoToSlide) {
              onViewerGoToSlide(index);
            }
          }}
          excalidrawAPI={excalidrawAPI}
          collabAPI={collabAPI}
        />
      )}

      {/* Viewer Top-Right Follow Presenter Pill */}
      {presentationState.isFollower && (
        <PresentationFollowPill
          presenterUsername={presentationState.presenterUsername || "Host"}
          isFollowing={viewerState.isFollowing}
          onToggleFollow={onToggleViewerFollow || (() => {})}
        />
      )}

      {/* Viewer Bottom Controls */}
      {presentationState.isFollower && (
        <div className="presentation-hud presentation-hud--viewer">
          <div className="presentation-hud__viewer-nav">
            <button
              type="button"
              className="presentation-hud__btn"
              onClick={onViewerPrev}
              disabled={viewerState.currentSlideIndex <= 0}
              title="Previous slide (Left arrow)"
              aria-label="Previous slide"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="presentation-hud__slide-counter">
              {viewerState.currentSlideIndex + 1} / {slides.length || 1}
            </span>
            <button
              type="button"
              className="presentation-hud__btn"
              onClick={onViewerNext}
              disabled={viewerState.currentSlideIndex >= slides.length - 1}
              title="Next slide (Right arrow / Space)"
              aria-label="Next slide"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div className="presentation-hud__divider" />

          {onToggleFullscreen && (
            <button
              type="button"
              className="presentation-hud__btn"
              onClick={onToggleFullscreen}
              title={
                isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {isFullscreen ? (
                  <>
                    <polyline points="4 14 10 14 10 20" />
                    <polyline points="20 10 14 10 14 4" />
                    <line x1="14" y1="10" x2="21" y2="3" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </>
                ) : (
                  <>
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </>
                )}
              </svg>
            </button>
          )}

          {onStopFollowing && (
            <button
              type="button"
              className="presentation-hud__stop-btn"
              onClick={onStopFollowing}
              title="Stop watching"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              <span>Stop watching</span>
            </button>
          )}
        </div>
      )}

      {/* Host-only reminder that the audience cannot see the cursor */}
      {presentationState.isActive && !settings.showCursor && (
        <div className="presentation-cursor-reminder">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          </svg>
          <span>Cursor hidden from viewers</span>
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

            {/* Presentation Sharing and Audience popover trigger 👤+ */}
            <div className="presentation-hud__share-wrap" ref={shareRef}>
              <button
                type="button"
                className={`presentation-hud__button ${
                  shareOpen ? "is-active" : ""
                } ${presentationState.isLive ? "is-live" : ""}`}
                onClick={() => setShareOpen(!shareOpen)}
                title="Audience & sharing"
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

              {/* Sharing Popover (Members only vs Public) */}
              {shareOpen && (
                <div className="presentation-hud-share-popover">
                  <div className="presentation-hud-share-popover__header">
                    <span className="presentation-hud-share-popover__label">
                      Public
                    </span>
                    <div className="presentation-hud-share-popover__toggle-group">
                      <span
                        className={`presentation-hud-share-popover__status ${
                          settings.isPublic ? "is-enabled" : ""
                        }`}
                      >
                        {settings.isPublic ? "Enabled" : "Disabled"}
                      </span>
                      <label className="presentation-toggle-switch">
                        <input
                          type="checkbox"
                          checked={settings.isPublic}
                          onChange={(e) => {
                            updateSetting("isPublic", e.target.checked);
                            setCopiedShareLink(false);
                          }}
                        />
                        <span className="presentation-toggle-switch__slider" />
                      </label>
                    </div>
                  </div>

                  <div className="presentation-hud-share-popover__desc">
                    {settings.isPublic
                      ? "Everyone with the link can view this presentation."
                      : "Only members with access to this scene can see this presentation."}
                  </div>

                  <div className="presentation-hud-share-popover__divider" />

                  {/* Center Attendees Section */}
                  <div className="presentation-hud-share-popover__attendees">
                    {collaboratorsList.length > 0 ? (
                      <div className="presentation-hud-share-popover__attendees-list">
                        {collaboratorsList.map((c) => (
                          <div
                            key={c.id}
                            className="presentation-hud-share-popover__attendee-row"
                          >
                            <span className="presentation-hud-share-popover__attendee-avatar">
                              {c.username ? c.username[0].toUpperCase() : "U"}
                            </span>
                            <span className="presentation-hud-share-popover__attendee-name">
                              {c.username || "Collaborator"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="presentation-hud-share-popover__empty-attendees">
                        <svg
                          className="presentation-hud-share-popover__empty-avatar"
                          viewBox="0 0 64 64"
                          fill="none"
                          stroke="#868e96"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="32" cy="22" r="12" />
                          <path d="M12 54c0-11 9-20 20-20s20 9 20 20" />
                        </svg>
                        <div className="presentation-hud-share-popover__empty-text">
                          No one else here yet
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Copy presentation link button & feedback */}
                  <div className="presentation-hud-share-popover__footer">
                    {copiedShareLink && (
                      <div className="presentation-hud-share-popover__copied-text">
                        Link copied!
                      </div>
                    )}
                    <button
                      type="button"
                      className="presentation-hud-share-popover__copy-btn"
                      onClick={handleCopyPresentationLink}
                    >
                      Copy presentation link
                    </button>
                  </div>
                </div>
              )}
            </div>

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

              {/* Settings Popover per Excalidraw Promo Video */}
              {settingsOpen && (
                <div className="presentation-hud-settings-popover">
                  {/* Animate slide movement */}
                  <div className="presentation-hud-settings-popover__row">
                    <span>Animate slide movement</span>
                    <label className="presentation-toggle-switch">
                      <input
                        type="checkbox"
                        checked={settings.animateSlideMovement}
                        onChange={(e) =>
                          updateSetting(
                            "animateSlideMovement",
                            e.target.checked,
                          )
                        }
                      />
                      <span className="presentation-toggle-switch__slider" />
                    </label>
                  </div>

                  {/* Show cursor */}
                  <div className="presentation-hud-settings-popover__row">
                    <span>Show cursor</span>
                    <label className="presentation-toggle-switch">
                      <input
                        type="checkbox"
                        checked={settings.showCursor}
                        onChange={(e) =>
                          updateSetting("showCursor", e.target.checked)
                        }
                      />
                      <span className="presentation-toggle-switch__slider" />
                    </label>
                  </div>

                  {/* Show slide title */}
                  <div className="presentation-hud-settings-popover__row">
                    <span>Show slide title</span>
                    <label className="presentation-toggle-switch">
                      <input
                        type="checkbox"
                        checked={settings.showSlideTitle}
                        onChange={(e) =>
                          updateSetting("showSlideTitle", e.target.checked)
                        }
                      />
                      <span className="presentation-toggle-switch__slider" />
                    </label>
                  </div>

                  {/* Download as: */}
                  <div className="presentation-hud-settings-popover__download-section">
                    <div className="presentation-hud-settings-popover__download-label">
                      Download as:
                    </div>
                    <div className="presentation-hud-settings-popover__download-buttons">
                      <button
                        type="button"
                        className="presentation-hud-settings-popover__download-btn"
                        onClick={handleDownloadPDF}
                        disabled={isExporting !== null || !slides.length}
                      >
                        {isExporting === "pdf" ? "Exporting..." : "PDF"}
                      </button>
                      <button
                        type="button"
                        className="presentation-hud-settings-popover__download-btn"
                        onClick={handleDownloadPPTX}
                        disabled={isExporting !== null || !slides.length}
                      >
                        {isExporting === "pptx" ? "Exporting..." : "PPTX"}
                      </button>
                    </div>
                  </div>

                  <div className="presentation-hud-settings-popover__divider" />

                  {/* Remote control section with collapsible chevron */}
                  <div className="presentation-hud-settings-popover__remote-section">
                    <div
                      className="presentation-hud-settings-popover__remote-header"
                      onClick={() => setRemoteSectionOpen(!remoteSectionOpen)}
                    >
                      <span>Remote control</span>
                      <svg
                        className={`presentation-hud-settings-popover__chevron ${
                          !remoteSectionOpen ? "is-collapsed" : ""
                        }`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </div>

                    {remoteSectionOpen && (
                      <div className="presentation-hud-settings-popover__remote-body">
                        <div className="presentation-hud-settings-popover__remote-desc">
                          Scan the QR code below with your mobile device to
                          remote control the presentation
                        </div>

                        <div className="presentation-hud-settings-popover__qr-wrap">
                          <QRCode value={remoteControlUrl} />
                        </div>

                        {copiedRemoteLink && (
                          <div className="presentation-hud-settings-popover__copied-text">
                            Link copied!
                          </div>
                        )}
                        <button
                          type="button"
                          className="presentation-hud-settings-popover__remote-copy-btn"
                          onClick={handleCopyRemoteLink}
                        >
                          Copy remote control link
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Distinct Red Pill End presentation button ⏹ */}
            <button
              type="button"
              className="presentation-hud__end-btn"
              onClick={() => setConfirmEndOpen(true)}
              title="End presentation (Esc)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              <span>End presentation</span>
            </button>
          </div>

          {/* Floating Laser Wand Tool at bottom-right corner */}
          <button
            type="button"
            className={`presentation-laser-floating-btn ${
              isLaserActive ? "is-active" : ""
            }`}
            onClick={onToggleLaser}
            title={
              isLaserActive ? "Laser pointer active (L)" : "Laser pointer (L)"
            }
          >
            {laserPointerToolIcon}
          </button>
        </>
      )}

      {/* Presentation ended card — shown to the presenter and the audience */}
      {presentationEnded && (
        <div className="presentation-ended-overlay">
          <div
            className={`presentation-ended-card ${
              presentationEnded.wasFollower
                ? "presentation-ended-card--audience"
                : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="Presentation ended"
          >
            <span className="presentation-ended-card__icon">
              {presentationIcon}
            </span>
            <h2 className="presentation-ended-card__title">
              {presentationEnded.wasFollower
                ? presentationEnded.reason === "stopped"
                  ? "You have left the presentation"
                  : "The presentation has ended"
                : "The presentation has now ended"}
            </h2>
            <p className="presentation-ended-card__subtitle">
              {presentationEnded.wasFollower
                ? "Choose where you would like to go next:"
                : "Thank you for presenting!"}
            </p>

            {presentationEnded.wasFollower ? (
              <div className="presentation-ended-card__choices">
                <button
                  type="button"
                  className="presentation-ended-card__action-btn presentation-ended-card__action-btn--dashboard"
                  onClick={async () => {
                    setPresentationEnded(null);
                    if (excalidrawAPI) {
                      const priorId = getViewerPriorSceneId();
                      await restoreViewerOriginalScene(excalidrawAPI, priorId);
                      clearViewerPriorSceneId();
                    }
                    onOpenDashboard?.();
                  }}
                >
                  <div className="presentation-ended-card__action-icon">
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1.5" />
                      <rect x="14" y="3" width="7" height="7" rx="1.5" />
                      <rect x="14" y="14" width="7" height="7" rx="1.5" />
                      <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    </svg>
                  </div>
                  <div className="presentation-ended-card__action-content">
                    <span className="presentation-ended-card__action-title">
                      Go to Dashboard
                    </span>
                    <span className="presentation-ended-card__action-desc">
                      View and manage all your saved scenes
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  className="presentation-ended-card__action-btn presentation-ended-card__action-btn--scene"
                  onClick={async () => {
                    setPresentationEnded(null);
                    if (excalidrawAPI) {
                      const priorId = getViewerPriorSceneId();
                      await restoreViewerOriginalScene(excalidrawAPI, priorId);
                      clearViewerPriorSceneId();
                    }
                  }}
                >
                  <div className="presentation-ended-card__action-icon">
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </div>
                  <div className="presentation-ended-card__action-content">
                    <span className="presentation-ended-card__action-title">
                      Return to My Scene
                    </span>
                    <span className="presentation-ended-card__action-desc">
                      Resume working on your local canvas
                    </span>
                  </div>
                </button>
              </div>
            ) : (
              <div className="presentation-ended-card__choices">
                {presentationEnded.shareUrl && (
                  <a
                    className="presentation-ended-card__link"
                    href={presentationEnded.shareUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View the slides
                  </a>
                )}
                <button
                  type="button"
                  className="presentation-ended-card__action-btn presentation-ended-card__action-btn--dashboard"
                  onClick={() => {
                    setPresentationEnded(null);
                    onOpenDashboard?.();
                  }}
                >
                  <div className="presentation-ended-card__action-icon">
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1.5" />
                      <rect x="14" y="3" width="7" height="7" rx="1.5" />
                      <rect x="14" y="14" width="7" height="7" rx="1.5" />
                      <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    </svg>
                  </div>
                  <div className="presentation-ended-card__action-content">
                    <span className="presentation-ended-card__action-title">
                      Go to Dashboard
                    </span>
                    <span className="presentation-ended-card__action-desc">
                      View and manage all your saved scenes
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  className="presentation-ended-card__action-btn presentation-ended-card__action-btn--scene"
                  onClick={() => setPresentationEnded(null)}
                >
                  <div className="presentation-ended-card__action-icon">
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </div>
                  <div className="presentation-ended-card__action-content">
                    <span className="presentation-ended-card__action-title">
                      Return to Scene
                    </span>
                    <span className="presentation-ended-card__action-desc">
                      Resume working on your canvas
                    </span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <PresentationEndConfirmDialog
        isOpen={confirmEndOpen || stopConfirm}
        isPublic={settings.isPublic}
        onTogglePublic={(val) => updateSetting("isPublic", val)}
        onConfirmEnd={() => {
          setConfirmEndOpen(false);
          setStopConfirm(false);
          collabAPI?.endPresentationSession?.();
          onStop();
        }}
        onCancel={() => {
          setConfirmEndOpen(false);
          setStopConfirm(false);
        }}
      />
    </>
  );
};

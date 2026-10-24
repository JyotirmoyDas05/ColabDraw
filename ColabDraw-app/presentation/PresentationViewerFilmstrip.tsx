import React, { useState } from "react";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { SlideThumbnailCard } from "./SlideThumbnailCard";

import "./PresentationViewerFilmstrip.scss";

import type { CollabAPI } from "../collab/Collab";

interface PresentationViewerFilmstripProps {
  slides: ExcalidrawFrameLikeElement[];
  activeViewerSlideIndex: number;
  hostSlideIndex: number;
  isPinned: boolean;
  onTogglePin: () => void;
  onSelectSlide: (slide: ExcalidrawFrameLikeElement, index: number) => void;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  collabAPI?: CollabAPI | null;
}

export const PresentationViewerFilmstrip: React.FC<
  PresentationViewerFilmstripProps
> = ({
  slides,
  activeViewerSlideIndex,
  hostSlideIndex,
  isPinned,
  onTogglePin,
  onSelectSlide,
  excalidrawAPI,
  collabAPI,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const isVisible = isPinned || isHovered;

  return (
    <>
      {/* Invisible hover detection zone on the left screen edge */}
      <div
        className="presentation-viewer-filmstrip__edge-trigger"
        onMouseEnter={() => setIsHovered(true)}
        aria-hidden="true"
      />

      {/* Main filmstrip sidebar */}
      <aside
        className={`presentation-viewer-filmstrip ${
          isVisible ? "is-visible" : ""
        } ${isPinned ? "is-pinned" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label="Presentation slide thumbnails"
      >
        <header className="presentation-viewer-filmstrip__header">
          <div className="presentation-viewer-filmstrip__title-group">
            <span className="presentation-viewer-filmstrip__title">Slides</span>
            <span className="presentation-viewer-filmstrip__count">
              {slides.length}
            </span>
          </div>

          <button
            type="button"
            className={`presentation-viewer-filmstrip__pin-btn ${
              isPinned ? "is-active" : ""
            }`}
            onClick={onTogglePin}
            title={isPinned ? "Unpin filmstrip" : "Pin filmstrip open"}
            aria-pressed={isPinned}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a2 2 0 0 1 2-2V2H7v1a2 2 0 0 1 2 2z" />
            </svg>
            <span className="presentation-viewer-filmstrip__pin-text">
              {isPinned ? "Pinned" : "Pin"}
            </span>
          </button>
        </header>

        <div className="presentation-viewer-filmstrip__list">
          {slides.map((slide, index) => {
            const isSelected = index === activeViewerSlideIndex;
            const isHostActive = index === hostSlideIndex;

            return (
              <div
                key={slide.id}
                className={`presentation-viewer-filmstrip__item ${
                  isSelected ? "is-selected" : ""
                } ${isHostActive ? "is-host-active" : ""}`}
                onClick={() => onSelectSlide(slide, index)}
              >
                {isHostActive && (
                  <div
                    className="presentation-viewer-filmstrip__host-badge"
                    title="Presenter is currently on this slide"
                  >
                    HOST
                  </div>
                )}
                <SlideThumbnailCard
                  slide={slide}
                  index={index}
                  totalSlides={slides.length}
                  isSelected={isSelected}
                  excalidrawAPI={excalidrawAPI}
                  collabAPI={collabAPI}
                  onSelect={() => onSelectSlide(slide, index)}
                  previewOnly
                  showActions={false}
                />
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
};

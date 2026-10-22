import React, { useEffect, useRef, useState } from "react";
import { getNonDeletedElements } from "@excalidraw/element";
// eslint-disable-next-line no-restricted-imports
import { exportToCanvas } from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getSlideTitle } from "./presentationUtils";

import "./SlideThumbnailCard.scss";

// Global cache for generated slide preview URLs
const thumbnailCache = new Map<string, string>();

interface SlideThumbnailCardProps {
  slide: ExcalidrawFrameLikeElement;
  index: number;
  totalSlides: number;
  isSelected?: boolean;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onSelect: () => void;
  onStartPresentation?: (index: number) => void;
  onDuplicate?: (slide: ExcalidrawFrameLikeElement) => void;
  onRename?: (slide: ExcalidrawFrameLikeElement, newName: string) => void;
  onAddBelow?: (slide: ExcalidrawFrameLikeElement) => void;
  onDelete?: (slide: ExcalidrawFrameLikeElement) => void;
  showActions?: boolean;
  previewOnly?: boolean;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent, index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDrop?: (e: React.DragEvent, index: number) => void;
  onEditingChange?: (isEditing: boolean) => void;
  onMenuOpenChange?: (isOpen: boolean) => void;
}

export const SlideThumbnailCard: React.FC<SlideThumbnailCardProps> = ({
  slide,
  index,
  totalSlides: _totalSlides,
  isSelected = false,
  excalidrawAPI,
  onSelect,
  onStartPresentation,
  onDuplicate,
  onRename,
  onAddBelow,
  onDelete,
  showActions = true,
  previewOnly = false,
  isDraggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onEditingChange,
  onMenuOpenChange,
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const title = getSlideTitle(slide, index);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        onMenuOpenChange?.(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen, onMenuOpenChange]);

  // Focus and select input text when entering rename mode
  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingName]);

  // Generate thumbnail for the frame elements
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    let isCancelled = false;
    const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const appState = excalidrawAPI.getAppState();
    const isDark = appState.theme === "dark";

    // Gather elements inside this frame
    const frameChildren = elements.filter(
      (el) => !el.isDeleted && el.frameId === slide.id,
    );

    const cacheKey = `${slide.id}_${slide.version}_${slide.width}_${
      slide.height
    }_${isDark ? "dark" : "light"}_${frameChildren
      .map((e) => `${e.id}:${e.version}`)
      .join(";")}`;

    if (thumbnailCache.has(cacheKey)) {
      setThumbnailUrl(thumbnailCache.get(cacheKey)!);
      return;
    }

    const renderElements: readonly ExcalidrawElement[] = [
      slide,
      ...frameChildren,
    ];

    exportToCanvas({
      elements: getNonDeletedElements(renderElements),
      appState: {
        ...appState,
        exportBackground: true,
        viewBackgroundColor:
          appState.viewBackgroundColor || (isDark ? "#121212" : "#ffffff"),
        exportWithDarkMode: isDark,
      },
      files: excalidrawAPI.getFiles() || {},
      exportingFrame: slide as NonDeleted<ExcalidrawFrameLikeElement>,
      maxWidthOrHeight: 360,
      exportPadding: 0,
    })
      .then((canvas) => {
        if (!isCancelled && canvas) {
          const url = canvas.toDataURL("image/webp", 0.7);
          thumbnailCache.set(cacheKey, url);
          setThumbnailUrl(url);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setThumbnailUrl(null);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [excalidrawAPI, slide]);

  const handleSaveRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== title && onRename) {
      onRename(slide, trimmed);
    }
    setIsEditingName(false);
    onEditingChange?.(false);
  };

  const handleStartRename = () => {
    setNameDraft(slide.name?.trim() || `Slide ${index + 1}`);
    setIsEditingName(true);
    onEditingChange?.(true);
    setMenuOpen(false);
    onMenuOpenChange?.(false);
  };

  const handleToggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOpen = !menuOpen;
    if (nextOpen && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      // If near bottom of the viewport, position dropdown menu upwards
      setOpenUpwards(rect.bottom + 220 > window.innerHeight);
    }
    setMenuOpen(nextOpen);
    onMenuOpenChange?.(nextOpen);
  };

  if (previewOnly) {
    return (
      <div
        className={`presentation-slide-card presentation-slide-card--preview-only ${
          isSelected ? "is-selected" : ""
        }`}
        onClick={onSelect}
      >
        <div className="presentation-slide-card__preview">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title}
              className="presentation-slide-card__img"
              draggable={false}
            />
          ) : (
            <div className="presentation-slide-card__placeholder">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`presentation-slide-card ${isSelected ? "is-selected" : ""} ${
        isDraggable ? "is-draggable" : ""
      } ${menuOpen ? "has-menu-open" : ""}`}
      onClick={onSelect}
      draggable={!onEditingChange && isDraggable && !isEditingName}
      onDragStart={(e) => onDragStart?.(e, index)}
      onDragOver={(e) => onDragOver?.(e, index)}
      onDrop={(e) => onDrop?.(e, index)}
    >
      {/* Thumbnail visual canvas preview */}
      <div className="presentation-slide-card__preview">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="presentation-slide-card__img"
            draggable={false}
          />
        ) : (
          <div className="presentation-slide-card__placeholder">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
      </div>

      {/* Top right 3-dots trigger button */}
      {showActions && (
        <div
          className="presentation-slide-card__menu-wrapper"
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="presentation-slide-card__more-btn"
            onClick={handleToggleMenu}
            title="Slide options"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>

          {/* Context menu dropdown */}
          {menuOpen && (
            <div
              className={`presentation-slide-menu ${
                openUpwards ? "presentation-slide-menu--upwards" : ""
              }`}
            >
              <button
                type="button"
                className="presentation-slide-menu__item"
                onClick={() => {
                  setMenuOpen(false);
                  onMenuOpenChange?.(false);
                  onStartPresentation?.(index);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Start presentation</span>
              </button>

              <button
                type="button"
                className="presentation-slide-menu__item"
                onClick={() => {
                  setMenuOpen(false);
                  onMenuOpenChange?.(false);
                  onDuplicate?.(slide);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Duplicate slide</span>
              </button>

              <button
                type="button"
                className="presentation-slide-menu__item"
                onClick={handleStartRename}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
                <span>Rename slide</span>
              </button>

              <button
                type="button"
                className="presentation-slide-menu__item"
                onClick={() => {
                  setMenuOpen(false);
                  onMenuOpenChange?.(false);
                  onAddBelow?.(slide);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Add slide below</span>
              </button>

              <div className="presentation-slide-menu__divider" />

              <button
                type="button"
                className="presentation-slide-menu__item presentation-slide-menu__item--danger"
                onClick={() => {
                  setMenuOpen(false);
                  onMenuOpenChange?.(false);
                  onDelete?.(slide);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span>Remove slide</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom frosted glass bar overlay */}
      <div
        className="presentation-slide-card__bottom-bar"
        onClick={(e) => {
          if (isEditingName) {
            e.stopPropagation();
          }
        }}
        onPointerDown={(e) => {
          if (isEditingName) {
            e.stopPropagation();
          }
        }}
      >
        {isEditingName ? (
          <input
            ref={inputRef}
            type="text"
            className="presentation-slide-card__rename-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSaveRename();
              } else if (e.key === "Escape") {
                setIsEditingName(false);
                onEditingChange?.(false);
              }
            }}
            onBlur={handleSaveRename}
          />
        ) : (
          <span className="presentation-slide-card__title" title={title}>
            {title}
          </span>
        )}
      </div>
    </div>
  );
};

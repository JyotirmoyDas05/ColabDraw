import React, { useMemo, useRef, useState } from "react";
import { newFrameElement } from "@excalidraw/element";
// eslint-disable-next-line no-restricted-imports
import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import { Reorder } from "framer-motion";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom } from "../app-jotai";
import { presentationSlideOrderAtom } from "../presentation/presentationState";
import { getOrderedSlides } from "../presentation/presentationUtils";
import { SlideThumbnailCard } from "../presentation/SlideThumbnailCard";

import "./PresentationSidebarTab.scss";

interface PresentationSidebarTabProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onStartPresentation: (startIndex?: number, isLive?: boolean) => void;
  isCollaborating?: boolean;
}

export const PresentationSidebarTab: React.FC<PresentationSidebarTabProps> = ({
  excalidrawAPI,
  onStartPresentation,
  isCollaborating = false,
}) => {
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [editingSlideId, setEditingSlideId] = useState<string | null>(null);
  const [menuOpenSlideId, setMenuOpenSlideId] = useState<string | null>(null);
  const [customSlideOrder, setCustomSlideOrder] = useAtom(
    presentationSlideOrderAtom,
  );

  const headerMenuRef = useRef<HTMLDivElement>(null);

  const elements = excalidrawAPI?.getSceneElementsIncludingDeleted();

  // Natural ordered slides with custom drag & drop reorder preserved
  const slides = useMemo(
    () => getOrderedSlides(elements, customSlideOrder),
    [elements, customSlideOrder],
  );

  const handleSelectSlide = (slide: ExcalidrawFrameLikeElement) => {
    if (!excalidrawAPI) {
      return;
    }
    setSelectedSlideId(slide.id);
    excalidrawAPI.setViewport({
      target: slide.id,
      fit: "contain",
      animation: true,
    });
    excalidrawAPI.updateScene({
      appState: {
        selectedElementIds: { [slide.id]: true },
      },
    });
  };

  /**
   * Creates a new slide frame.
   * If canvas elements are currently selected, frames the selection.
   * Otherwise creates a standard 16:9 slide (1920x1080) adjacent to existing slides.
   */
  const handleCreateSlide = () => {
    if (!excalidrawAPI) {
      return;
    }

    const allElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const appState = excalidrawAPI.getAppState();
    const selectedIds = appState.selectedElementIds || {};

    const selectedElements = allElements.filter(
      (el) => !el.isDeleted && selectedIds[el.id] && el.type !== "frame",
    );

    const nextSlideNumber = slides.length + 1;
    let newFrame: ExcalidrawFrameLikeElement;
    let nextElements: readonly ExcalidrawElement[] = [...allElements];

    if (selectedElements.length > 0) {
      // Frame around current selection
      const minX = Math.min(...selectedElements.map((e) => e.x));
      const minY = Math.min(...selectedElements.map((e) => e.y));
      const maxX = Math.max(...selectedElements.map((e) => e.x + e.width));
      const maxY = Math.max(...selectedElements.map((e) => e.y + e.height));
      const padding = 60;

      newFrame = newFrameElement({
        x: minX - padding,
        y: minY - padding,
        width: Math.max(320, maxX - minX + padding * 2),
        height: Math.max(180, maxY - minY + padding * 2),
        name: `Slide ${nextSlideNumber}`,
      });

      // Bind selected elements to new frame
      nextElements = nextElements
        .map((el) => {
          if (selectedIds[el.id] && el.type !== "frame") {
            return { ...el, frameId: newFrame.id };
          }
          return el;
        })
        .concat(newFrame);
    } else {
      // Standard 16:9 slide
      const width = 1920;
      const height = 1080;
      let x = 0;
      let y = 0;

      if (slides.length > 0) {
        const maxX = Math.max(...slides.map((s) => s.x + s.width));
        const refY = slides[slides.length - 1]?.y ?? 0;
        x = maxX + 120;
        y = refY;
      } else {
        // Place in center of current viewport
        x =
          -appState.scrollX +
          appState.width / (2 * appState.zoom.value) -
          width / 2;
        y =
          -appState.scrollY +
          appState.height / (2 * appState.zoom.value) -
          height / 2;
      }

      newFrame = newFrameElement({
        x,
        y,
        width,
        height,
        name: `Slide ${nextSlideNumber}`,
      });
      nextElements = nextElements.concat(newFrame);
    }

    const restored = restoreElements(nextElements, null);

    excalidrawAPI.updateScene({
      elements: restored,
      appState: {
        selectedElementIds: { [newFrame.id]: true },
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    setSelectedSlideId(newFrame.id);
    setCustomSlideOrder((prev) => [...prev, newFrame.id]);

    excalidrawAPI.setViewport({
      target: newFrame.id,
      fit: "contain",
      animation: true,
    });
  };

  /**
   * Duplicates a slide and all its contained elements.
   */
  const handleDuplicateSlide = (slide: ExcalidrawFrameLikeElement) => {
    if (!excalidrawAPI) {
      return;
    }

    const allElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const children = allElements.filter(
      (el) => !el.isDeleted && el.frameId === slide.id,
    );

    const deltaX = slide.width + 100;
    const deltaY = 0;

    const newFrameId = `frame_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const newFrame: ExcalidrawFrameLikeElement = {
      ...slide,
      id: newFrameId,
      x: slide.x + deltaX,
      y: slide.y + deltaY,
      name: `${slide.name || "Slide"} (Copy)`,
      version: slide.version + 1,
      versionNonce: Math.floor(Math.random() * 1000000000),
    };

    const newChildren: ExcalidrawElement[] = children.map((child) => ({
      ...child,
      id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      frameId: newFrameId,
      x: child.x + deltaX,
      y: child.y + deltaY,
      version: child.version + 1,
      versionNonce: Math.floor(Math.random() * 1000000000),
    }));

    const nextElements = [...allElements, newFrame, ...newChildren];
    const restored = restoreElements(nextElements, null);

    excalidrawAPI.updateScene({
      elements: restored,
      appState: {
        selectedElementIds: { [newFrame.id]: true },
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    setSelectedSlideId(newFrame.id);
    setCustomSlideOrder((prev) => {
      const idx = prev.indexOf(slide.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy.splice(idx + 1, 0, newFrame.id);
        return copy;
      }
      return [...slides.map((s) => s.id), newFrame.id];
    });

    excalidrawAPI.setViewport({
      target: newFrame.id,
      fit: "contain",
      animation: true,
    });
  };

  /**
   * Renames a slide.
   */
  const handleRenameSlide = (
    slide: ExcalidrawFrameLikeElement,
    newName: string,
  ) => {
    if (!excalidrawAPI) {
      return;
    }

    const allElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const updated = allElements.map((el) =>
      el.id === slide.id ? { ...el, name: newName } : el,
    );

    const restored = restoreElements(updated, null);

    excalidrawAPI.updateScene({
      elements: restored,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  /**
   * Adds a new slide directly below the specified slide.
   */
  const handleAddSlideBelow = (slide: ExcalidrawFrameLikeElement) => {
    if (!excalidrawAPI) {
      return;
    }

    const allElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const newFrame = newFrameElement({
      x: slide.x,
      y: slide.y + slide.height + 100,
      width: slide.width,
      height: slide.height,
      name: `Slide ${slides.length + 1}`,
    });

    const nextElements = [...allElements, newFrame];
    const restored = restoreElements(nextElements, null);

    excalidrawAPI.updateScene({
      elements: restored,
      appState: {
        selectedElementIds: { [newFrame.id]: true },
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    setSelectedSlideId(newFrame.id);
    setCustomSlideOrder((prev) => {
      const idx = prev.indexOf(slide.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy.splice(idx + 1, 0, newFrame.id);
        return copy;
      }
      return [...slides.map((s) => s.id), newFrame.id];
    });

    excalidrawAPI.setViewport({
      target: newFrame.id,
      fit: "contain",
      animation: true,
    });
  };

  /**
   * Removes a slide frame and unlinks its enclosed elements.
   */
  const handleDeleteSlide = (slide: ExcalidrawFrameLikeElement) => {
    if (!excalidrawAPI) {
      return;
    }

    const allElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const nextElements = allElements.map((el) => {
      if (el.id === slide.id) {
        return { ...el, isDeleted: true };
      }
      if (el.frameId === slide.id) {
        return { ...el, frameId: null };
      }
      return el;
    });

    const restored = restoreElements(nextElements, null);

    excalidrawAPI.updateScene({
      elements: restored,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    setCustomSlideOrder((prev) => prev.filter((id) => id !== slide.id));
    if (selectedSlideId === slide.id) {
      setSelectedSlideId(null);
    }
  };

  /**
   * Auto-arranges all slides in a clean horizontal sequence.
   */
  const handleAutoArrangeHorizontal = () => {
    if (!excalidrawAPI || slides.length === 0) {
      return;
    }

    const allElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    let currentX = slides[0].x;
    const baseY = slides[0].y;
    const spacing = 120;

    const deltaMap = new Map<string, { dx: number; dy: number }>();

    for (const slide of slides) {
      const dx = currentX - slide.x;
      const dy = baseY - slide.y;
      deltaMap.set(slide.id, { dx, dy });
      currentX += slide.width + spacing;
    }

    const updated = allElements.map((el) => {
      if (el.isDeleted) {
        return el;
      }
      if (el.type === "frame" && deltaMap.has(el.id)) {
        const { dx, dy } = deltaMap.get(el.id)!;
        return { ...el, x: el.x + dx, y: el.y + dy };
      }
      if (el.frameId && deltaMap.has(el.frameId)) {
        const { dx, dy } = deltaMap.get(el.frameId)!;
        return { ...el, x: el.x + dx, y: el.y + dy };
      }
      return el;
    });

    const restored = restoreElements(updated, null);

    excalidrawAPI.updateScene({
      elements: restored,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const handleReorder = (newSlides: ExcalidrawFrameLikeElement[]) => {
    setCustomSlideOrder(newSlides.map((s) => s.id));
  };

  return (
    <div className="presentation-sidebar-tab">
      {/* Sidebar header */}
      <div className="presentation-sidebar-tab__header">
        <div className="presentation-sidebar-tab__title">Presentation</div>

        <div className="presentation-sidebar-tab__header-actions">
          {/* + Create slide button */}
          <button
            type="button"
            className="presentation-sidebar-tab__create-btn"
            onClick={handleCreateSlide}
            title="Create a new slide (or frame selected elements)"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Create slide</span>
          </button>

          {/* More options menu ⋮ */}
          <div
            className="presentation-sidebar-tab__menu-wrapper"
            ref={headerMenuRef}
          >
            <button
              type="button"
              className="presentation-sidebar-tab__more-btn"
              onClick={() => setHeaderMenuOpen(!headerMenuOpen)}
              title="More presentation options"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>

            {headerMenuOpen && (
              <div className="presentation-slide-menu">
                <button
                  type="button"
                  className="presentation-slide-menu__item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    handleCreateSlide();
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
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  <span>Frame selection</span>
                </button>

                <button
                  type="button"
                  className="presentation-slide-menu__item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    handleAutoArrangeHorizontal();
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
                    <rect x="2" y="7" width="6" height="10" rx="1" />
                    <rect x="9" y="7" width="6" height="10" rx="1" />
                    <rect x="16" y="7" width="6" height="10" rx="1" />
                  </svg>
                  <span>Arrange horizontally</span>
                </button>

                <div className="presentation-slide-menu__divider" />

                <button
                  type="button"
                  className="presentation-slide-menu__item presentation-slide-menu__item--danger"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    if (
                      window.confirm(
                        "Are you sure you want to remove all presentation slides?",
                      )
                    ) {
                      for (const slide of slides) {
                        handleDeleteSlide(slide);
                      }
                      setCustomSlideOrder([]);
                    }
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
                  <span>Remove all slides</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subheader: Slides (N) */}
      <div className="presentation-sidebar-tab__subheading">
        Slides ({slides.length})
      </div>

      {/* Slide cards scrollable list with smooth Framer Motion reordering */}
      <div className="presentation-sidebar-tab__content">
        {slides.length > 0 ? (
          <Reorder.Group
            axis="y"
            values={slides}
            onReorder={handleReorder}
            className="presentation-sidebar-tab__list"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {slides.map((slide, index) => {
              const isSelected = selectedSlideId === slide.id;
              return (
                <Reorder.Item
                  key={slide.id}
                  value={slide}
                  dragListener={editingSlideId !== slide.id}
                  className={`presentation-slide-reorder-item ${
                    menuOpenSlideId === slide.id ? "has-menu-open" : ""
                  }`}
                  whileDrag={{
                    scale: 1.02,
                    boxShadow:
                      "0 14px 30px rgba(0, 0, 0, 0.22), 0 0 0 2px var(--color-primary, #6965db)",
                    zIndex: 100,
                    cursor: "grabbing",
                  }}
                  transition={{ duration: 0.15 }}
                >
                  <SlideThumbnailCard
                    slide={slide}
                    index={index}
                    totalSlides={slides.length}
                    isSelected={isSelected}
                    excalidrawAPI={excalidrawAPI}
                    onSelect={() => handleSelectSlide(slide)}
                    onStartPresentation={(startIdx) =>
                      onStartPresentation(startIdx, false)
                    }
                    onDuplicate={handleDuplicateSlide}
                    onRename={handleRenameSlide}
                    onAddBelow={handleAddSlideBelow}
                    onDelete={handleDeleteSlide}
                    showActions={true}
                    isDraggable={true}
                    onEditingChange={(isEditing) =>
                      setEditingSlideId(isEditing ? slide.id : null)
                    }
                    onMenuOpenChange={(isOpen) =>
                      setMenuOpenSlideId(isOpen ? slide.id : null)
                    }
                  />
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        ) : (
          <div className="presentation-sidebar-tab__empty">
            <div className="presentation-sidebar-tab__empty-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="presentation-sidebar-tab__empty-title">
              No presentation slides yet
            </div>
            <p className="presentation-sidebar-tab__empty-desc">
              Frames on the canvas act as slides. Select existing drawings to
              frame them, or create a new slide from scratch.
            </p>
            <button
              type="button"
              className="presentation-sidebar-tab__empty-btn"
              onClick={handleCreateSlide}
            >
              + Create slide
            </button>
          </div>
        )}
      </div>

      {/* Fixed bottom action area with full-width Start Presentation button */}
      {slides.length > 0 && (
        <div className="presentation-sidebar-tab__footer">
          <button
            type="button"
            className="presentation-sidebar-tab__start-btn"
            onClick={() => {
              const startIdx = selectedSlideId
                ? Math.max(
                    0,
                    slides.findIndex((s) => s.id === selectedSlideId),
                  )
                : 0;
              onStartPresentation(startIdx, false);
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
            <span>Start presentation</span>
          </button>

          {isCollaborating && (
            <button
              type="button"
              className="presentation-sidebar-tab__live-btn"
              onClick={() => {
                const startIdx = selectedSlideId
                  ? Math.max(
                      0,
                      slides.findIndex((s) => s.id === selectedSlideId),
                    )
                  : 0;
                onStartPresentation(startIdx, true);
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
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Present to audience</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

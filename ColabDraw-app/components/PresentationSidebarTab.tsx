import React, { useMemo } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { presentationIcon } from "@excalidraw/excalidraw/components/icons";
import {
  getOrderedSlides,
  getSlideTitle,
} from "../presentation/presentationUtils";
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
  const elements = excalidrawAPI?.getSceneElementsIncludingDeleted();
  const slides = useMemo(() => getOrderedSlides(elements), [elements]);

  const handleSelectSlide = (slide: typeof slides[0]) => {
    if (!excalidrawAPI) {
      return;
    }
    excalidrawAPI.setViewport({
      target: slide,
      fit: "contain",
      animation: true,
    });
    // Select the frame element
    excalidrawAPI.updateScene({
      appState: {
        selectedElementIds: { [slide.id]: true },
      },
    });
  };

  const handleCreateFrame = () => {
    if (!excalidrawAPI) {
      return;
    }
    excalidrawAPI.setActiveTool({ type: "frame" });
    excalidrawAPI.setToast({
      message: "Click and drag anywhere on the canvas to draw a frame slide.",
      closable: true,
      duration: 5000,
    });
  };

  return (
    <div className="presentation-sidebar">
      <div className="presentation-sidebar__header">
        <div className="presentation-sidebar__title">
          {presentationIcon}
          <span>Presentation</span>
        </div>
        <span className="presentation-sidebar__badge">
          {slides.length} {slides.length === 1 ? "slide" : "slides"}
        </span>
      </div>

      {slides.length > 0 ? (
        <>
          <div className="presentation-sidebar__actions">
            <button
              type="button"
              className="presentation-sidebar__start-btn"
              onClick={() => onStartPresentation(0, false)}
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
              <span>Start Presentation</span>
            </button>

            {isCollaborating && (
              <button
                type="button"
                className="presentation-sidebar__live-btn"
                onClick={() => onStartPresentation(0, true)}
              >
                <span>Present to Room (Live)</span>
              </button>
            )}
          </div>

          <ul className="presentation-sidebar__list">
            {slides.map((slide, index) => {
              const title = getSlideTitle(slide, index);
              const width = Math.round(slide.width);
              const height = Math.round(slide.height);

              return (
                <li
                  key={slide.id}
                  className="presentation-sidebar__item"
                  onClick={() => handleSelectSlide(slide)}
                  title="Click to zoom to slide"
                >
                  <div className="presentation-sidebar__item__info">
                    <span className="presentation-sidebar__item__number">
                      {index + 1}
                    </span>
                    <div className="presentation-sidebar__item__details">
                      <span className="presentation-sidebar__item__name">
                        {title}
                      </span>
                      <span className="presentation-sidebar__item__size">
                        {width} × {height}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="presentation-sidebar__play-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartPresentation(index, false);
                    }}
                    title="Present from this slide"
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
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="presentation-sidebar__empty">
          <div className="presentation-sidebar__empty__icon">
            {presentationIcon}
          </div>
          <div className="presentation-sidebar__empty__title">
            No presentation slides yet
          </div>
          <p className="presentation-sidebar__empty__desc">
            Frames on the canvas act as slides in presentation mode. Group your
            drawings, diagrams, or wireframes into frames to present them.
          </p>
          <button
            type="button"
            className="presentation-sidebar__empty__btn"
            onClick={handleCreateFrame}
          >
            Create a frame (F)
          </button>
        </div>
      )}
    </div>
  );
};

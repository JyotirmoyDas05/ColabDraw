import React from "react";
import { presentationIcon } from "@excalidraw/excalidraw/components/icons";
import { Tooltip } from "@excalidraw/excalidraw/components/Tooltip";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom } from "../app-jotai";

import { presentationModeAtom } from "./presentationState";
import { getOrderedSlides } from "./presentationUtils";

import "./PresentationFooterButton.scss";

interface PresentationFooterButtonProps {
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  onStartPresentation?: () => void;
}

export const PresentationFooterButton: React.FC<
  PresentationFooterButtonProps
> = ({ excalidrawAPI, onStartPresentation }) => {
  const [presentationState, setPresentationState] =
    useAtom(presentationModeAtom);

  const handleClick = () => {
    if (presentationState.isActive) {
      setPresentationState((prev) => ({ ...prev, isActive: false }));
      return;
    }

    if (!excalidrawAPI) {
      onStartPresentation?.();
      return;
    }

    const appState = excalidrawAPI.getAppState();
    const isPresentationSidebarOpen =
      appState.openSidebar?.name === "default" &&
      appState.openSidebar?.tab === "presentation";

    const slides = getOrderedSlides(
      excalidrawAPI.getSceneElementsIncludingDeleted(),
    );

    if (isPresentationSidebarOpen && slides.length > 0) {
      onStartPresentation?.();
    } else {
      excalidrawAPI.toggleSidebar({ name: "default", tab: "presentation" });
    }
  };

  return (
    <div className="presentation-footer-button-wrap">
      <Tooltip label="Presentation" delay>
        <button
          type="button"
          className={`presentation-footer-button ${
            presentationState.isActive ? "is-active" : ""
          }`}
          onClick={handleClick}
          aria-label="Presentation"
          data-testid="presentation-footer-button"
        >
          {presentationIcon}
        </button>
      </Tooltip>
    </div>
  );
};

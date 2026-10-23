import React, { useEffect, useState } from "react";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  computeSpotlightLayout,
  getSlideRectInViewport,
  type ViewportSnapshot,
} from "./presentationLayout";

import "./PresentationFocusOverlay.scss";

interface PresentationFocusOverlayProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  slide: ExcalidrawFrameLikeElement | null | undefined;
  enabled?: boolean;
}

const getViewportSnapshot = (
  appState: ReturnType<ExcalidrawImperativeAPI["getAppState"]>,
): ViewportSnapshot => ({
  scrollX: appState.scrollX,
  scrollY: appState.scrollY,
  zoom: appState.zoom.value,
  offsetLeft: appState.offsetLeft,
  offsetTop: appState.offsetTop,
  width: appState.width,
  height: appState.height,
});

/**
 * Dims and blurs everything around the focused slide so neighbouring frames
 * never compete with the slide currently being presented.
 */
export const PresentationFocusOverlay: React.FC<
  PresentationFocusOverlayProps
> = ({ excalidrawAPI, slide, enabled = true }) => {
  const [viewport, setViewport] = useState<ViewportSnapshot | null>(null);

  useEffect(() => {
    if (!enabled || !excalidrawAPI) {
      setViewport(null);
      return;
    }

    const sync = () => {
      try {
        setViewport(getViewportSnapshot(excalidrawAPI.getAppState()));
      } catch {
        // the API can be destroyed while unmounting
      }
    };

    sync();

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = excalidrawAPI.onStateChange(
        (appState) =>
          [
            appState.scrollX,
            appState.scrollY,
            appState.zoom.value,
            appState.offsetLeft,
            appState.offsetTop,
            appState.width,
            appState.height,
          ].join(","),
        () => sync(),
      );
    } catch {
      // onStateChange is unavailable on destroyed APIs
    }

    return () => {
      unsubscribe?.();
    };
  }, [enabled, excalidrawAPI]);

  if (!enabled || !viewport || !slide) {
    return null;
  }

  const slideRect = getSlideRectInViewport(slide, viewport);
  const layout = computeSpotlightLayout(slideRect, viewport);

  if (layout.spotlight.width < 8 || layout.spotlight.height < 8) {
    return null;
  }

  const panelStyle = (rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): React.CSSProperties => ({
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });

  return (
    <div className="presentation-focus-overlay" aria-hidden="true">
      <div
        className="presentation-focus-overlay__mask"
        style={panelStyle(layout.top)}
      />
      <div
        className="presentation-focus-overlay__mask"
        style={panelStyle(layout.bottom)}
      />
      <div
        className="presentation-focus-overlay__mask"
        style={panelStyle(layout.left)}
      />
      <div
        className="presentation-focus-overlay__mask"
        style={panelStyle(layout.right)}
      />
      <div
        className="presentation-focus-overlay__spotlight"
        style={panelStyle(layout.spotlight)}
      />
    </div>
  );
};

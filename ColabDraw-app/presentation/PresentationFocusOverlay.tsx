import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";

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
  isViewer?: boolean;
  appTheme?: "light" | "dark";
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
 * Creates an isolated presentation theater stage around the focused slide.
 * Opaque stage curtains mask out all neighbouring canvas frames, drawings,
 * and whiteboard background, replicating the isolated slide mental model
 * found in Google Slides and Figma Slides.
 */
export const PresentationFocusOverlay: React.FC<
  PresentationFocusOverlayProps
> = ({
  excalidrawAPI,
  slide,
  enabled = true,
  isViewer = false,
  appTheme = "light",
}) => {
  const [viewport, setViewport] = useState<ViewportSnapshot | null>(null);
  const [transitionKey, setTransitionKey] = useState(0);
  const prevSlideIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      prevSlideIdRef.current &&
      slide?.id &&
      prevSlideIdRef.current !== slide.id
    ) {
      setTransitionKey((prev) => prev + 1);
    }
    prevSlideIdRef.current = slide?.id ?? null;
  }, [slide?.id]);

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
    <div
      className={clsx(
        "presentation-focus-overlay",
        isViewer
          ? "presentation-focus-overlay--viewer"
          : "presentation-focus-overlay--host",
        appTheme && `presentation-focus-overlay--${appTheme}`,
      )}
      aria-hidden="true"
    >
      <div
        className="presentation-focus-overlay__mask presentation-focus-overlay__mask--top"
        style={panelStyle(layout.top)}
      />
      <div
        className="presentation-focus-overlay__mask presentation-focus-overlay__mask--bottom"
        style={panelStyle(layout.bottom)}
      />
      <div
        className="presentation-focus-overlay__mask presentation-focus-overlay__mask--left"
        style={panelStyle(layout.left)}
      />
      <div
        className="presentation-focus-overlay__mask presentation-focus-overlay__mask--right"
        style={panelStyle(layout.right)}
      />
      <div
        className="presentation-focus-overlay__spotlight"
        style={panelStyle(layout.spotlight)}
      >
        {transitionKey > 0 && (
          <div
            key={transitionKey}
            className="presentation-focus-overlay__dissolve"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
};

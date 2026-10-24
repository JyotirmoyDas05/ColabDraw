export interface ViewportSnapshot {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SpotlightLayout {
  /** the focused slide, clamped to the viewport */
  spotlight: Rect;
  top: Rect;
  bottom: Rect;
  left: Rect;
  right: Rect;
}

interface SlideBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Converts a scene-space rect (such as a frame element) into page coordinates,
 * matching what Excalidraw uses internally for pointer/collaborator positions.
 */
export const getSlideRectInViewport = (
  slide: SlideBounds,
  viewport: ViewportSnapshot,
): Rect => {
  return {
    left: (slide.x + viewport.scrollX) * viewport.zoom + viewport.offsetLeft,
    top: (slide.y + viewport.scrollY) * viewport.zoom + viewport.offsetTop,
    width: slide.width * viewport.zoom,
    height: slide.height * viewport.zoom,
  };
};

/**
 * Builds the four dimmed panels surrounding the focused slide plus the
 * spotlight rect itself. Panels are clamped so a slide that is partially (or
 * entirely) off-screen never produces negative sizes.
 */
export const computeSpotlightLayout = (
  slideRect: Rect,
  viewport: Pick<
    ViewportSnapshot,
    "width" | "height" | "offsetLeft" | "offsetTop"
  >,
): SpotlightLayout => {
  const viewportLeft = viewport.offsetLeft;
  const viewportTop = viewport.offsetTop;
  const viewportRight = Math.max(
    viewportLeft + viewport.width,
    typeof window !== "undefined" ? window.innerWidth : viewport.width,
  );
  const viewportBottom = Math.max(
    viewportTop + viewport.height,
    typeof window !== "undefined" ? window.innerHeight : viewport.height,
  );

  const left = clamp(
    slideRect.left,
    viewportLeft,
    Math.max(viewportLeft, viewportRight),
  );
  const top = clamp(
    slideRect.top,
    viewportTop,
    Math.max(viewportTop, viewportBottom),
  );
  const right = clamp(
    slideRect.left + slideRect.width,
    left,
    Math.max(left, viewportRight),
  );
  const bottom = clamp(
    slideRect.top + slideRect.height,
    top,
    Math.max(top, viewportBottom),
  );

  const spotlight: Rect = {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };

  const totalWidth = viewportRight - viewportLeft;

  return {
    spotlight,
    top: {
      left: viewportLeft,
      top: viewportTop,
      width: totalWidth,
      height: Math.max(0, top - viewportTop + 1),
    },
    bottom: {
      left: viewportLeft,
      top: Math.max(viewportTop, bottom - 1),
      width: totalWidth,
      height: Math.max(0, viewportBottom - bottom + 1),
    },
    left: {
      left: viewportLeft,
      top: Math.max(viewportTop, top - 1),
      width: Math.max(0, left - viewportLeft + 1),
      height: Math.max(0, bottom - top + 2),
    },
    right: {
      left: Math.max(viewportLeft, right - 1),
      top: Math.max(viewportTop, top - 1),
      width: Math.max(0, viewportRight - right + 1),
      height: Math.max(0, bottom - top + 2),
    },
  };
};

export const PRESENTATION_JOIN_MODE = "join";
export const PRESENTATION_REMOTE_MODE = "remote";
export const PRESENTATION_AUTOSTART_MODES = ["1", "public"] as const;

export type PresentationLinkMode = "remote" | "join" | "autostart" | null;

/** Classifies the `?presentation=` param of a URL search string. */
export const getPresentationLinkMode = (
  search: string,
): PresentationLinkMode => {
  const mode = new URLSearchParams(search).get("presentation");
  if (!mode) {
    return null;
  }
  if (mode === PRESENTATION_REMOTE_MODE) {
    return "remote";
  }
  if (mode === PRESENTATION_JOIN_MODE) {
    return "join";
  }
  if ((PRESENTATION_AUTOSTART_MODES as readonly string[]).includes(mode)) {
    return "autostart";
  }
  return null;
};

export const getPresentationJoinHost = (search: string): string | null => {
  const host = new URLSearchParams(search).get("host")?.trim();
  return host || null;
};

/**
 * Builds the link the presenter shares with the audience. It keeps the room
 * (and its key in the hash) intact, marks it as a join link and carries the
 * presenter's name so the join gate can greet the viewer immediately.
 */
export const buildPresentationJoinLink = ({
  baseUrl,
  hostName,
  isPublic,
}: {
  baseUrl: string;
  hostName?: string | null;
  isPublic?: boolean;
}): string => {
  const url = new URL(baseUrl);
  url.searchParams.set("presentation", PRESENTATION_JOIN_MODE);
  const trimmedHost = hostName?.trim();
  if (trimmedHost) {
    url.searchParams.set("host", trimmedHost);
  } else {
    url.searchParams.delete("host");
  }
  if (isPublic) {
    url.searchParams.set("access", "public");
  } else {
    url.searchParams.delete("access");
  }
  return url.toString();
};

/** The scene / room URL without any presentation-only params. */
export const stripPresentationParams = (href: string): string => {
  const url = new URL(href);
  url.searchParams.delete("presentation");
  url.searchParams.delete("host");
  return url.toString();
};

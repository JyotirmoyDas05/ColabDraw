import { isFrameLikeElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "@excalidraw/element/types";

/**
 * Extracts a numeric prefix or slide number from a frame name if present.
 * Matches patterns like "1", "02", "Slide 1", "Slide-2", "#3".
 */
export const extractSlideNumber = (
  name: string | null | undefined,
): number | null => {
  if (!name) {
    return null;
  }
  const trimmed = name.trim();
  const match = trimmed.match(/^(?:slide[\s_-]*|#\s*)?(\d+)/i);
  if (match) {
    const num = parseInt(match[1], 10);
    return Number.isFinite(num) ? num : null;
  }
  return null;
};

/**
 * Sorts frames visually in reading order: top-to-bottom, left-to-right.
 * Frames with top Y within ROW_TOLERANCE_PX are considered in the same row
 * and ordered horizontally.
 */
const ROW_TOLERANCE_PX = 50;

export const sortFramesGeometrically = (
  a: ExcalidrawFrameLikeElement,
  b: ExcalidrawFrameLikeElement,
): number => {
  const yDiff = a.y - b.y;
  if (Math.abs(yDiff) > ROW_TOLERANCE_PX) {
    return yDiff;
  }
  return a.x - b.x;
};

/**
 * Retrieves all valid presentation slides (non-deleted frames) from scene elements,
 * sorted in natural presentation order.
 *
 * If frames have numeric names (e.g. "Slide 1", "Slide 2" or "1", "2"), they are sorted
 * numerically. Otherwise, they are ordered in geometric reading order (row by row, left-to-right).
 */
export const getOrderedSlides = (
  elements: readonly ExcalidrawElement[] | undefined | null,
): ExcalidrawFrameLikeElement[] => {
  if (!elements || !elements.length) {
    return [];
  }

  const frames = elements.filter(
    (el): el is ExcalidrawFrameLikeElement =>
      !el.isDeleted && isFrameLikeElement(el),
  );

  if (frames.length <= 1) {
    return frames;
  }

  // Check if at least 2 frames or majority of frames have explicit slide numbers
  const framesWithNumbers = frames.map((frame) => ({
    frame,
    num: extractSlideNumber(frame.name),
  }));

  const numericCount = framesWithNumbers.filter(
    (item) => item.num !== null,
  ).length;
  const useNumericSort = numericCount >= 2 && numericCount >= frames.length / 2;

  if (useNumericSort) {
    return [...frames].sort((a, b) => {
      const numA = extractSlideNumber(a.name);
      const numB = extractSlideNumber(b.name);

      if (numA !== null && numB !== null) {
        if (numA !== numB) {
          return numA - numB;
        }
        return sortFramesGeometrically(a, b);
      }
      if (numA !== null) {
        return -1;
      }
      if (numB !== null) {
        return 1;
      }
      return sortFramesGeometrically(a, b);
    });
  }

  return [...frames].sort(sortFramesGeometrically);
};

/**
 * Returns a display title for a slide frame.
 */
export const getSlideTitle = (
  frame: ExcalidrawFrameLikeElement | null | undefined,
  index: number,
): string => {
  if (!frame) {
    return `Slide ${index + 1}`;
  }
  const name = frame.name?.trim();
  return name && name.length > 0 ? name : `Slide ${index + 1}`;
};

/**
 * Finds the index of a frame by its element ID.
 */
export const findSlideIndexById = (
  slides: readonly ExcalidrawFrameLikeElement[],
  frameId: string | null | undefined,
): number => {
  if (!frameId || !slides.length) {
    return -1;
  }
  return slides.findIndex((slide) => slide.id === frameId);
};

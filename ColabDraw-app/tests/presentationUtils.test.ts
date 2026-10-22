import { describe, expect, it } from "vitest";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";

import {
  extractSlideNumber,
  findSlideIndexById,
  getOrderedSlides,
  getSlideTitle,
} from "../presentation/presentationUtils";

const createMockFrame = (
  id: string,
  opts: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    name?: string | null;
    isDeleted?: boolean;
    type?: "frame" | "magicframe";
  } = {},
): ExcalidrawFrameLikeElement => {
  return {
    id,
    type: opts.type ?? "frame",
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: opts.width ?? 800,
    height: opts.height ?? 600,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: opts.isDeleted ?? false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData: undefined,
    name: opts.name !== undefined ? opts.name : `Frame ${id}`,
  } as unknown as ExcalidrawFrameLikeElement;
};

describe("presentationUtils", () => {
  describe("extractSlideNumber", () => {
    it("extracts numeric numbers from frame names", () => {
      expect(extractSlideNumber("1")).toBe(1);
      expect(extractSlideNumber("42")).toBe(42);
      expect(extractSlideNumber("Slide 1")).toBe(1);
      expect(extractSlideNumber("Slide-3")).toBe(3);
      expect(extractSlideNumber("#5 Overview")).toBe(5);
      expect(extractSlideNumber("slide 12: Architecture")).toBe(12);
    });

    it("returns null when no number is found", () => {
      expect(extractSlideNumber(null)).toBeNull();
      expect(extractSlideNumber("")).toBeNull();
      expect(extractSlideNumber("Introduction")).toBeNull();
      expect(extractSlideNumber("System Architecture")).toBeNull();
    });
  });

  describe("getOrderedSlides", () => {
    it("returns empty array for empty elements", () => {
      expect(getOrderedSlides([])).toEqual([]);
      expect(getOrderedSlides(null)).toEqual([]);
    });

    it("filters out deleted frames and non-frame elements", () => {
      const activeFrame = createMockFrame("f1");
      const deletedFrame = createMockFrame("f2", { isDeleted: true });
      const regularRect = {
        id: "r1",
        type: "rectangle",
        isDeleted: false,
      } as any;

      const slides = getOrderedSlides([activeFrame, deletedFrame, regularRect]);
      expect(slides).toHaveLength(1);
      expect(slides[0].id).toBe("f1");
    });

    it("orders frames geometrically in visual reading order (row by row)", () => {
      // Row 1: y ~ 0
      const frame1 = createMockFrame("f1", { x: 0, y: 0, name: "Alpha" });
      const frame2 = createMockFrame("f2", { x: 900, y: 10, name: "Beta" });
      // Row 2: y ~ 700
      const frame3 = createMockFrame("f3", { x: 0, y: 700, name: "Gamma" });
      const frame4 = createMockFrame("f4", { x: 900, y: 720, name: "Delta" });

      // Pass them in scrambled order
      const slides = getOrderedSlides([frame4, frame1, frame3, frame2]);
      expect(slides.map((s) => s.id)).toEqual(["f1", "f2", "f3", "f4"]);
    });

    it("orders frames by numeric name when slides are explicitly numbered", () => {
      const frame3 = createMockFrame("f3", { x: 0, y: 0, name: "Slide 3" });
      const frame1 = createMockFrame("f1", { x: 0, y: 1500, name: "Slide 1" });
      const frame2 = createMockFrame("f2", { x: 0, y: 800, name: "Slide 2" });

      const slides = getOrderedSlides([frame3, frame1, frame2]);
      expect(slides.map((s) => s.id)).toEqual(["f1", "f2", "f3"]);
    });
  });

  describe("getSlideTitle", () => {
    it("returns frame name when present", () => {
      const frame = createMockFrame("f1", { name: "System Design" });
      expect(getSlideTitle(frame, 0)).toBe("System Design");
    });

    it("falls back to Slide index when name is absent or empty", () => {
      const frame = createMockFrame("f1", { name: "" });
      expect(getSlideTitle(frame, 2)).toBe("Slide 3");
      expect(getSlideTitle(null, 0)).toBe("Slide 1");
    });
  });

  describe("findSlideIndexById", () => {
    it("returns the correct index or -1 if not found", () => {
      const f1 = createMockFrame("f1");
      const f2 = createMockFrame("f2");
      const slides = [f1, f2];

      expect(findSlideIndexById(slides, "f1")).toBe(0);
      expect(findSlideIndexById(slides, "f2")).toBe(1);
      expect(findSlideIndexById(slides, "unknown")).toBe(-1);
      expect(findSlideIndexById(slides, null)).toBe(-1);
    });
  });
});

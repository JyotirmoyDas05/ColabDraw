import { describe, expect, it } from "vitest";
import { appJotaiStore } from "../app-jotai";
import {
  activeRemotePresentationAtom,
  DEFAULT_PRESENTATION_STATE,
  presentationModeAtom,
} from "../presentation/presentationState";
import {
  findSlideIndexById,
  getOrderedSlides,
  getSlideTitle,
} from "../presentation/presentationUtils";

describe("presentationState & integration", () => {
  it("has correct default presentation state", () => {
    expect(DEFAULT_PRESENTATION_STATE).toEqual({
      isActive: false,
      currentSlideIndex: 0,
      totalSlides: 0,
      currentSlideId: null,
      isLive: false,
      isFollower: false,
      presenterSocketId: null,
      presenterUsername: null,
    });
  });

  it("updates and resets presentationModeAtom in Jotai store", () => {
    appJotaiStore.set(presentationModeAtom, {
      isActive: true,
      currentSlideIndex: 2,
      totalSlides: 5,
      currentSlideId: "frame-3",
      isLive: true,
      isFollower: false,
      presenterSocketId: null,
      presenterUsername: null,
    });

    const activeState = appJotaiStore.get(presentationModeAtom);
    expect(activeState.isActive).toBe(true);
    expect(activeState.currentSlideIndex).toBe(2);
    expect(activeState.totalSlides).toBe(5);
    expect(activeState.isLive).toBe(true);

    // Reset back
    appJotaiStore.set(presentationModeAtom, DEFAULT_PRESENTATION_STATE);
    expect(appJotaiStore.get(presentationModeAtom)).toEqual(
      DEFAULT_PRESENTATION_STATE,
    );
  });

  it("manages remote presentation invitations", () => {
    expect(appJotaiStore.get(activeRemotePresentationAtom)).toBeNull();

    appJotaiStore.set(activeRemotePresentationAtom, {
      presenterSocketId: "user-123",
      presenterUsername: "Alice",
      slideIndex: 0,
      totalSlides: 4,
      slideTitle: "Intro",
    });

    const remote = appJotaiStore.get(activeRemotePresentationAtom);
    expect(remote).not.toBeNull();
    expect(remote?.presenterUsername).toBe("Alice");
    expect(remote?.slideIndex).toBe(0);

    // Dismiss or end
    appJotaiStore.set(activeRemotePresentationAtom, null);
    expect(appJotaiStore.get(activeRemotePresentationAtom)).toBeNull();
  });

  it("correctly simulates slide navigation clamping", () => {
    const mockElements = [
      {
        id: "s1",
        type: "frame",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        name: "Slide 1",
        isDeleted: false,
      },
      {
        id: "s2",
        type: "frame",
        x: 1000,
        y: 0,
        width: 800,
        height: 600,
        name: "Slide 2",
        isDeleted: false,
      },
      {
        id: "s3",
        type: "frame",
        x: 2000,
        y: 0,
        width: 800,
        height: 600,
        name: "Slide 3",
        isDeleted: false,
      },
    ] as any[];

    const slides = getOrderedSlides(mockElements);
    expect(slides).toHaveLength(3);

    // Helper to clamp index
    const clampIndex = (idx: number) =>
      Math.max(0, Math.min(idx, slides.length - 1));

    expect(clampIndex(-1)).toBe(0);
    expect(clampIndex(0)).toBe(0);
    expect(clampIndex(1)).toBe(1);
    expect(clampIndex(2)).toBe(2);
    expect(clampIndex(5)).toBe(2);

    expect(getSlideTitle(slides[0], 0)).toBe("Slide 1");
    expect(findSlideIndexById(slides, "s2")).toBe(1);
  });
});

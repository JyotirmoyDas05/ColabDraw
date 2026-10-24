import { describe, expect, it, vi } from "vitest";

import { appJotaiStore } from "../app-jotai";
import {
  DEFAULT_PRESENTATION_SETTINGS,
  DEFAULT_PRESENTATION_STATE,
  activeRemotePresentationAtom,
  presentationModeAtom,
  presentationSettingsAtom,
} from "../presentation/presentationState";
import { presentationSync } from "../presentation/presentationSync";
import {
  clampSlideIndex,
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

  it("has correct default presentation settings", () => {
    expect(DEFAULT_PRESENTATION_SETTINGS).toEqual({
      animateSlideMovement: true,
      showCursor: true,
      showSlideTitle: false,
      isPublic: false,
    });
    expect(appJotaiStore.get(presentationSettingsAtom)).toEqual(
      DEFAULT_PRESENTATION_SETTINGS,
    );
  });

  it("updates presentationSettingsAtom in Jotai store", () => {
    appJotaiStore.set(presentationSettingsAtom, {
      animateSlideMovement: false,
      showCursor: true,
      showSlideTitle: true,
      isPublic: true,
    });

    expect(appJotaiStore.get(presentationSettingsAtom)).toEqual({
      animateSlideMovement: false,
      showCursor: true,
      showSlideTitle: true,
      isPublic: true,
    });

    // Reset back
    appJotaiStore.set(presentationSettingsAtom, DEFAULT_PRESENTATION_SETTINGS);
  });

  it("broadcasts and receives messages through presentationSync", () => {
    const listener = vi.fn();
    const unsub = presentationSync.subscribe(listener);

    presentationSync.send({
      type: "SYNC_STATE",
      slideIndex: 1,
      totalSlides: 3,
      slideTitle: "Slide 2",
      isActive: true,
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SYNC_STATE",
        slideIndex: 1,
        totalSlides: 3,
        slideTitle: "Slide 2",
        isActive: true,
      }),
    );

    unsub();
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
    ] as any;

    const slides = getOrderedSlides(mockElements);
    expect(slides.length).toBe(3);

    expect(clampSlideIndex(-1, slides.length)).toBe(0);
    expect(clampSlideIndex(0, slides.length)).toBe(0);
    expect(clampSlideIndex(1, slides.length)).toBe(1);
    expect(clampSlideIndex(2, slides.length)).toBe(2);
    expect(clampSlideIndex(3, slides.length)).toBe(2);
    expect(clampSlideIndex(10, slides.length)).toBe(2);

    expect(getSlideTitle(slides[0], 0)).toBe("Slide 1");
    expect(getSlideTitle(slides[1], 1)).toBe("Slide 2");
    expect(getSlideTitle(slides[2], 2)).toBe("Slide 3");
  });

  it("supports custom drag-and-drop slide reordering", () => {
    const mockElements = [
      { id: "s1", type: "frame", x: 0, y: 0, name: "Intro", isDeleted: false },
      { id: "s2", type: "frame", x: 500, y: 0, name: "Demo", isDeleted: false },
      {
        id: "s3",
        type: "frame",
        x: 1000,
        y: 0,
        name: "Summary",
        isDeleted: false,
      },
    ] as any;

    // Default reading order
    let slides = getOrderedSlides(mockElements);
    expect(slides.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);

    // Custom order (e.g. user dragged s3 to the front)
    slides = getOrderedSlides(mockElements, ["s3", "s1", "s2"]);
    expect(slides.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
  });

  it("isolates presentation mode from collaboration session", () => {
    expect(appJotaiStore.get(presentationModeAtom).isActive).toBe(false);
    appJotaiStore.set(presentationModeAtom, {
      ...DEFAULT_PRESENTATION_STATE,
      isActive: true,
      currentSlideIndex: 0,
      totalSlides: 3,
    });
    expect(appJotaiStore.get(presentationModeAtom).isActive).toBe(true);
    appJotaiStore.set(presentationModeAtom, DEFAULT_PRESENTATION_STATE);
    expect(appJotaiStore.get(presentationModeAtom).isActive).toBe(false);
  });
});

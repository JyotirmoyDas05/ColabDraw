import { describe, expect, it, vi } from "vitest";

import { appJotaiStore } from "../app-jotai";
import {
  activeRemotePresentationAtom,
  DEFAULT_PRESENTATION_SETTINGS,
  DEFAULT_PRESENTATION_STATE,
  presentationModeAtom,
  presentationSettingsAtom,
} from "../presentation/presentationState";
import { presentationSync } from "../presentation/presentationSync";
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

  it("has correct default presentation settings", () => {
    expect(DEFAULT_PRESENTATION_SETTINGS).toEqual({
      animateSlideMovement: true,
      showCursor: false,
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

  it("supports custom drag-and-drop slide reordering", () => {
    const mockElements = [
      {
        id: "s1",
        type: "frame",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        name: "First",
        isDeleted: false,
      },
      {
        id: "s2",
        type: "frame",
        x: 1000,
        y: 0,
        width: 800,
        height: 600,
        name: "Second",
        isDeleted: false,
      },
      {
        id: "s3",
        type: "frame",
        x: 2000,
        y: 0,
        width: 800,
        height: 600,
        name: "Third",
        isDeleted: false,
      },
    ] as any[];

    const natural = getOrderedSlides(mockElements);
    expect(natural.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);

    // Move index 0 to index 2: [s2, s3, s1]
    const currentOrder = natural.map((s) => s.id);
    const moved = currentOrder.splice(0, 1)[0];
    currentOrder.splice(2, 0, moved);

    expect(currentOrder).toEqual(["s2", "s3", "s1"]);

    const slideMap = new Map(natural.map((s) => [s.id, s]));
    const reordered = currentOrder.map((id) => slideMap.get(id)!);

    expect(reordered[0].name).toBe("Second");
    expect(reordered[1].name).toBe("Third");
    expect(reordered[2].name).toBe("First");
  });
});

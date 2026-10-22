# Presentation mode — design

Date: 2026-10-22 Status: in-progress

## Context

ColabDraw roadmap Phase 3 calls for **Presentation mode**: "Each frame becomes a slide, with arrow keys and Esc. A later step adds live presenting, where viewers follow the presenter's slide."

Currently:

- The canvas supports frames (`isFrameLikeElement`: type `frame` or `magicframe`).
- Upstream Excalidraw only had a marketing placeholder in the sidebar for Excalidraw+ presentations.
- Collaboration rooms have follow/unfollow capability and binary relaying for follower-bound viewport messages (`USER_VISIBLE_SCENE_BOUNDS`), but no dedicated presentation orchestration, slide list, or live presentation prompt.

## Goal

Provide a presentation experience where:

1. **Frames become slides**: Any frame on the canvas is treated as a presentation slide, ordered in natural reading order (top-to-bottom, left-to-right, or numeric title order).
2. **Presentation navigation**: Clean fullscreen or presentation view navigated with arrow keys, space, page up/down, home/end, and escape, smoothly fitting each frame into the viewport with frame clipping enabled.
3. **Presentation HUD**: A minimal, non-intrusive bottom control bar showing slide count, slide title, next/previous buttons, laser pointer toggle, fullscreen toggle, quick slide jump menu, and exit button.
4. **Presentation sidebar**: A dedicated sidebar tab replacing the old promo tab, displaying the list of slides with names and ordering, a "Start presentation" button, and an empty state guiding the user to create frames with shortcut `F`.
5. **Live presenting**: In collaboration rooms, presenters can broadcast their presentation session to all room participants. Viewers receive a "Join presentation" prompt and automatically follow the presenter's slide transitions and laser pointer.

## Architecture

```
Canvas Elements (Frames)
         │
         ▼
[getOrderedSlides] ──► [PresentationStateAtom] ──► [PresentationHUD]
                               │                           │
                               ▼                           ▼
                 [usePresentationController]       [Sidebar Tab: Slides]
                 - Keyboard handlers (← / → / Esc)
                 - excalidrawAPI.setViewport()
                 - frameRendering clipping
                               │
                (if collaborating & live)
                               ▼
                        [Collab / Portal]
                  - WS PRESENTATION_BROADCAST
                  - setUserToFollow
                  - relayVisibleSceneBounds
```

### Slide Discovery and Ordering

- Elements are scanned for `!element.isDeleted && isFrameLikeElement(element)`.
- Frames are sorted:
  - If frames have numeric titles (e.g. "1", "2", "Slide 1", "Slide 2"), natural alphanumeric sorting is applied.
  - Otherwise, geometric ordering is used: primary sort by Y coordinate (with a 40px vertical tolerance row band), secondary sort by X coordinate (left-to-right).
- Each slide has an index, frame id, title (`frame.name || `Slide ${index + 1}``), and dimensions.

### Presentation Mode State & Controls

- Stored in Jotai atom `presentationModeAtom`: `{ isActive: boolean; currentSlideIndex: number; isLive: boolean; presenterSocketId: string | null }`
- On Enter:
  - Saves current viewport and tool state.
  - Enables frame clipping (`frameRendering: { enabled: true, clip: true, name: false }`).
  - Sets viewport to first slide (or chosen slide) with `fit: "contain"`.
  - Enables laser pointer or pointer tool.
- On Slide Transition:
  - `setViewport({ target: frame, fit: "contain", animation: true })`.
  - If live, broadcasts slide index and title to followers.
- On Exit:
  - Restores previous frame rendering and UI state.
  - If live presenter, broadcasts presentation ended.

### Live Collaboration Integration

- New socket subtype in `WS_SUBTYPES`: `PRESENTATION_BROADCAST`.
- When presenter toggles "Present to Room":
  - Presenter broadcasts `{ isLive: true, slideIndex, totalSlides, slideTitle }`.
  - Collaborators receive notification toast / banner: `"{username} is presenting. [Join Presentation]"`.
  - Joining follows the presenter via `setUserToFollow(presenterSocketId)`.
  - Viewers automatically track viewport bounds and laser pointer strokes.
  - When presenter ends presentation (`isLive: false`), followers are cleanly detached.

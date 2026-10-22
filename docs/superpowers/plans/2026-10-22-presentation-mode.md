# Presentation mode — implementation plan

Date: 2026-10-22 Status: in-progress

## Steps

### Step 1: Slide extraction and ordering utilities

- Create `ColabDraw-app/presentation/presentationUtils.ts`:
  - `getOrderedSlides(elements)`: Finds non-deleted frame elements, sorts them naturally/geometrically.
  - `getSlideTitle(frame, index)`: Extracts or generates readable title.
  - `findNextSlideIndex(currentIndex, totalSlides)` / `findPrevSlideIndex(currentIndex)`
- Write unit tests in `ColabDraw-app/tests/presentationUtils.test.ts`.

### Step 2: Presentation state management

- Create `ColabDraw-app/presentation/presentationState.ts`:
  - Atoms for presentation state: `presentationModeAtom`, `presentationBroadcastAtom`.
  - Helpers: `startPresentation`, `stopPresentation`, `goToSlide`, `nextSlide`, `prevSlide`.

### Step 3: Presentation controller and keyboard shortcuts

- Create `ColabDraw-app/presentation/usePresentationController.ts`:
  - Handles arrow keys (Left/Right/Up/Down), Space, PageUp/PageDown, Home, End, Escape.
  - Updates viewport smoothly using `excalidrawAPI.setViewport({ target: frame, fit: "contain", animation: true })`.
  - Adjusts `frameRendering` on enter/exit (`clip: true, name: false`).
  - Fullscreen toggle helper (`requestFullscreen` / `exitFullscreen`).
  - Laser pointer shortcut (`L`).

### Step 4: Presentation HUD overlay UI

- Create `ColabDraw-app/presentation/PresentationHUD.tsx` & `PresentationHUD.scss`:
  - Bottom floating controls: Previous, Next, Slide counter (e.g. "Slide 3 / 8"), Quick slide jump selector dropdown, Laser pointer toggle, Fullscreen toggle, Live presentation toggle, Exit button.
  - Top or bottom slide title banner.
  - Clean styling matching ColabDraw's dark/light design system.

### Step 5: Presentation sidebar tab

- Create `ColabDraw-app/components/PresentationSidebarTab.tsx` & SCSS:
  - Sidebar tab with `presentationIcon`.
  - Slide list showing ordered slides, names, dimensions.
  - Click to jump / zoom to slide in canvas.
  - "Start presentation" button.
  - Empty state when no frames exist, with "Add a frame" action (`activeTool: { type: 'frame' }`).
- Update `ColabDraw-app/components/AppSidebar.tsx` to include `PresentationSidebarTab`.

### Step 6: Main Menu & Toolbar entry point

- Add "Presentation mode" to `ColabDraw-app/components/AppMainMenu.tsx` with `presentationIcon`.
- Integrate presentation mode triggering into canvas or action bar.

### Step 7: Live presenting in collaboration rooms

- Extend `app_constants.ts` and `data/index.ts` with `WS_SUBTYPES.PRESENTATION_BROADCAST`.
- Add presentation broadcast handler in `ColabDraw-app/collab/Collab.tsx` and `Portal.tsx`.
- Show "Join presentation" toast/banner for room collaborators when someone presents.

### Step 8: Verification & testing

- Run all unit tests (`vitest run`).
- Run TypeScript typecheck (`bun run test:typecheck`).
- Verify build (`bun run build`).
- Commit and open pull request with `link_pull_request`.

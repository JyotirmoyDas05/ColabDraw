# ColabDraw roadmap

Features inspired by Excalidraw Plus, built for a free app with no paid backend.
One phase per PR; each is tested by hand before the next starts.

## Planned (in order)

1. **Scenes and dashboard** — unlimited local scenes in IndexedDB; a dashboard in the style of Excalidraw Plus (collections, drag to organise, quick search, pinned scenes, trash, import, an in-editor scene sidebar).
2. **View-only links** — the room server ignores edits from viewers. Viewers still hold the decryption key, so this is enforcement, not secrecy.
3. **Presentation mode** — frames become slides; later, live presenting where viewers follow the presenter.
4. **PDF and PPTX export** — one page or slide per frame (jsPDF, PptxGenJS, both lazy-loaded).
5. **Backup**
   - Local backup folder first (File System Access API: Chrome, Edge and other Chromium browsers).
   - Browsers without that API (Firefox, Safari): prompt to download a backup file regularly, or to connect a cloud drive.
   - Then cloud storage the user connects with a normal sign-in, provider-agnostic: Google Drive (hidden app folder), OneDrive, Dropbox.
6. **Comments** — styled like Excalidraw Plus: avatar bubbles pinned on the canvas that open a thread popover, plus a comments side panel (search, sort by date or unread, show resolved, mark all read). Not the editor's sticky-note element. Stored separately from the drawing.

## Later

- **Voice hangout and screen sharing** — parked. Not being designed or built for now.
- **Account system** — needed for real cloud sync, per-account dashboards and background sync. Until then everything is per device or key-in-link, and backup is how scenes reach other devices.

## Deliberately skipped

Accounts and roles, a REST API, SOC 2 compliance, team libraries and shared folders. These need a paid backend.

## Known limits

- A browser-only Google Drive connection gets tokens that last about an hour, so users reconnect once per session and nothing syncs in the background until there is an account system.
- OneDrive's app-folder permission works for personal Microsoft accounts only.

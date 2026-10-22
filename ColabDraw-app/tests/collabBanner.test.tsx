import { render, screen } from "@excalidraw/excalidraw/tests/test-utils";
import { describe, expect, it, vi } from "vitest";

import ExcalidrawApp from "../App";
import { appJotaiStore } from "../app-jotai";
import { isCollaboratingAtom, syncUnavailableAtom } from "../collab/Collab";

vi.mock("../data/backend.ts", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  BACKEND_URL: "http://localhost:8787",
}));

describe("degraded collaboration", () => {
  it("explains that live sync is unavailable while edits are still saved", async () => {
    window.location.hash = "#room=0123456789abcdef0123,0123456789012345678901";
    appJotaiStore.set(isCollaboratingAtom, true);
    appJotaiStore.set(syncUnavailableAtom, true);

    await render(<ExcalidrawApp />);

    expect(await screen.findByText(/live sync is unavailable/i)).toBeTruthy();
  });
});

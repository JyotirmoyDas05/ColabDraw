import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileId } from "@excalidraw/element/types";

import {
  BackendError,
  loadFromBackend,
  saveFilesToBackend,
} from "../data/backend";

afterEach(() => vi.unstubAllGlobals());

describe("loadFromBackend", () => {
  it("propagates a network failure instead of returning an empty scene", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await expect(loadFromBackend("room", "key", null)).rejects.toThrow(
      "Failed to fetch",
    );
  });

  it("propagates a server error with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );

    const error = await loadFromBackend("room", "key", null).catch((e) => e);

    expect(error).toBeInstanceOf(BackendError);
    expect(error.status).toBe(500);
  });

  it("returns null for a 404, which means the room was never saved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    await expect(loadFromBackend("room", "key", null)).resolves.toBeNull();
  });
});

describe("file storage keys", () => {
  it("scopes each upload to its encryption owner, so a share link cannot overwrite room bytes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    // A file id is the SHA-1 of the plaintext, so it is identical everywhere.
    const id = "a".repeat(40) as FileId;
    const files = [{ id, buffer: new Uint8Array([1, 2, 3]) }];

    await saveFilesToBackend({ files, ownerId: "room123" });
    await saveFilesToBackend({ files, ownerId: "share456" });

    const [roomUrl, shareUrl] = fetchMock.mock.calls.map(([input]) =>
      String(input),
    );

    expect(roomUrl).toContain(`/files/room123_${id}`);
    expect(shareUrl).toContain(`/files/share456_${id}`);
    expect(roomUrl).not.toBe(shareUrl);
  });
});

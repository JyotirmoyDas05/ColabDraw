import { afterEach, describe, expect, it, vi } from "vitest";

import { BackendError, loadFromBackend } from "../data/backend";

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

    await expect(loadFromBackend("room", "key", null)).rejects.toBeInstanceOf(
      BackendError,
    );
  });

  it("returns null for a 404, which means the room was never saved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    await expect(loadFromBackend("room", "key", null)).resolves.toBeNull();
  });
});

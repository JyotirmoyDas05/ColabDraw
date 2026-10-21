import { describe, expect, it } from "vitest";

import { describeShareLinkError } from "../data";

describe("describeShareLinkError", () => {
  it("reports a too-large payload for a 413", () => {
    const error = Object.assign(new Error("PUT /share-links/x failed"), {
      status: 413,
    });

    expect(describeShareLinkError(error)).toMatch(/too big/i);
  });

  it("falls back to the generic message for a network failure", () => {
    expect(describeShareLinkError(new TypeError("Failed to fetch"))).toBe(
      "Couldn't create shareable link.",
    );
  });

  it("falls back to the generic message for a 500", () => {
    const error = Object.assign(new Error("PUT /share-links/x failed"), {
      status: 500,
    });

    expect(describeShareLinkError(error)).toBe(
      "Couldn't create shareable link.",
    );
  });
});

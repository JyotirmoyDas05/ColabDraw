import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "../data/appwrite";

describe("bytesToBase64", () => {
  it("encodes small payloads", () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 253, 254, 255]))).toBe(
      "AAEC/f7/",
    );
  });

  it("encodes payloads larger than the call stack limit", () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }

    expect(() => bytesToBase64(bytes)).not.toThrow();
    expect(bytesToBase64(bytes).length).toBe(Math.ceil(bytes.length / 3) * 4);
  });
});

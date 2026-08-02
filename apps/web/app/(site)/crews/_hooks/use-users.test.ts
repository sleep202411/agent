import { describe, expect, it } from "vitest";
import { chunkUserDisplayIds } from "./use-users";

describe("chunkUserDisplayIds", () => {
  it("keeps every roster member while respecting the BFF batch limit", () => {
    const ids = Array.from({ length: 121 }, (_, index) => `user-${index + 1}`);
    const chunks = chunkUserDisplayIds(ids);

    expect(chunks.map((chunk) => chunk.length)).toEqual([50, 50, 21]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("does not issue an empty batch", () => {
    expect(chunkUserDisplayIds([])).toEqual([]);
  });
});

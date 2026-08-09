import { describe, expect, it } from "vitest";
import { hasTextGameCoverAspect } from "./text-game-cover";

describe("hasTextGameCoverAspect", () => {
  it("accepts standard 16:9 cover dimensions", () => {
    expect(hasTextGameCoverAspect(1920, 1080)).toBe(true);
    expect(hasTextGameCoverAspect(1280, 720)).toBe(true);
  });

  it("allows minor export rounding", () => {
    expect(hasTextGameCoverAspect(1919, 1080)).toBe(true);
  });

  it("rejects portrait, square, invalid, and materially different landscape ratios", () => {
    expect(hasTextGameCoverAspect(1080, 1920)).toBe(false);
    expect(hasTextGameCoverAspect(1200, 1200)).toBe(false);
    expect(hasTextGameCoverAspect(1600, 1000)).toBe(false);
    expect(hasTextGameCoverAspect(0, 1080)).toBe(false);
  });
});

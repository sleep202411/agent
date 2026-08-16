import { describe, expect, it } from "vitest";
import { normalizeStageRect } from "./story-hotspot-stage";

describe("story hotspot stage coordinates", () => {
  it("converts a transformed Konva rectangle back to normalized video coordinates", () => {
    expect(
      normalizeStageRect({ x: 160, y: 112.5, width: 240, height: 112.5 }, 800, 450, 0.035)
    ).toEqual({ x: 0.2, y: 0.25, width: 0.3, height: 0.25 });
  });

  it("keeps transformed hotspots inside the video and above the minimum size", () => {
    expect(normalizeStageRect({ x: 790, y: 440, width: 2, height: 2 }, 800, 450, 0.035)).toEqual({
      x: 0.965,
      y: 0.965,
      width: 0.035,
      height: 0.035,
    });
  });
});

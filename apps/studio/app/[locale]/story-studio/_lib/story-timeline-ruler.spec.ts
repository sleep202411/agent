import { describe, expect, it } from "vitest";
import { createStoryTimelineRulerTicks, storyTimelineRulerStep } from "./story-timeline-ruler";

describe("story timeline ruler", () => {
  it("increases ruler precision as the editor zooms in", () => {
    expect(storyTimelineRulerStep(18)).toEqual({ minor: 5, major: 20 });
    expect(storyTimelineRulerStep(44)).toEqual({ minor: 1, major: 5 });
    expect(storyTimelineRulerStep(96)).toEqual({ minor: 0.5, major: 2 });
  });

  it("creates bounded ticks and identifies major time marks", () => {
    const ticks = createStoryTimelineRulerTicks(12.5, 1, 5);

    expect(ticks.at(0)).toEqual({ seconds: 0, major: true });
    expect(ticks.find((tick) => tick.seconds === 5)).toEqual({ seconds: 5, major: true });
    expect(ticks.find((tick) => tick.seconds === 6)).toEqual({ seconds: 6, major: false });
    expect(ticks.at(-1)?.seconds).toBe(12);
  });

  it("rejects invalid ruler inputs", () => {
    expect(createStoryTimelineRulerTicks(Number.NaN, 1, 5)).toEqual([]);
    expect(createStoryTimelineRulerTicks(10, 0, 5)).toEqual([]);
  });
});

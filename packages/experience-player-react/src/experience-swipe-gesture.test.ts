import { describe, expect, it } from "vitest";
import { evaluateExperienceSwipe, type ExperienceSwipeGesture } from "./experience-swipe-gesture";

const gesture: ExperienceSwipeGesture = {
  gestureId: "swipe-right",
  kind: "swipe",
  inputActionId: "action.swipe-right",
  anchorId: "anchor.hotspot",
  directions: ["right"],
  minimumDistance: 0.08,
  maximumDurationMs: 1_000,
};

describe("evaluateExperienceSwipe", () => {
  it("completes the authored direction using a viewport-normalized distance", () => {
    expect(
      evaluateExperienceSwipe(gesture, {
        deltaX: 100,
        deltaY: 12,
        durationMs: 420,
        viewportWidth: 1_000,
        viewportHeight: 600,
      })
    ).toEqual(
      expect.objectContaining({
        completed: true,
        direction: "right",
        distance: expect.closeTo(Math.hypot(100, 12) / 1_000),
        durationMs: 420,
      })
    );
  });

  it.each([
    {
      name: "wrong direction",
      sample: { deltaX: -100, deltaY: 0, durationMs: 300 },
      direction: "left",
    },
    {
      name: "insufficient distance",
      sample: { deltaX: 40, deltaY: 0, durationMs: 300 },
      direction: "right",
    },
    {
      name: "excessive duration",
      sample: { deltaX: 100, deltaY: 0, durationMs: 1_001 },
      direction: "right",
    },
  ])("cancels $name", ({ sample, direction }) => {
    expect(
      evaluateExperienceSwipe(gesture, {
        ...sample,
        viewportWidth: 1_000,
        viewportHeight: 600,
      })
    ).toEqual(expect.objectContaining({ completed: false, direction }));
  });
});

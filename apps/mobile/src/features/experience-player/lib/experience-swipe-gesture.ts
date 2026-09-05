import type { ExperienceGesture } from "@repo/shared/experience-runtime";

export type ExperienceSwipeGesture = Extract<ExperienceGesture, { kind: "swipe" }>;
export type ExperienceSwipeDirection = ExperienceSwipeGesture["directions"][number];

export interface ExperienceSwipeSample {
  deltaX: number;
  deltaY: number;
  durationMs: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ExperienceSwipeEvaluation {
  completed: boolean;
  direction: ExperienceSwipeDirection;
  distance: number;
  durationMs: number;
}

/**
 * Evaluates a pointer trace in normalized viewport space so the same authored
 * swipe threshold behaves consistently across phones, tablets and desktops.
 */
export function evaluateExperienceSwipe(
  gesture: ExperienceSwipeGesture,
  sample: ExperienceSwipeSample
): ExperienceSwipeEvaluation {
  const durationMs = Math.max(0, Math.round(sample.durationMs));
  const direction = dominantSwipeDirection(sample.deltaX, sample.deltaY);
  const distance =
    Math.hypot(sample.deltaX, sample.deltaY) /
    Math.max(sample.viewportWidth, sample.viewportHeight, 1);
  return {
    completed:
      distance >= gesture.minimumDistance &&
      durationMs <= gesture.maximumDurationMs &&
      gesture.directions.includes(direction),
    direction,
    distance,
    durationMs,
  };
}

function dominantSwipeDirection(deltaX: number, deltaY: number): ExperienceSwipeDirection {
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX >= 0 ? "right" : "left";
  return deltaY >= 0 ? "down" : "up";
}

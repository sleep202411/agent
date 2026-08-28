export interface StoryTimelineRulerStep {
  minor: number;
  major: number;
}

export interface StoryTimelineRulerTick {
  seconds: number;
  major: boolean;
}

export function storyTimelineRulerStep(pixelsPerSecond: number): StoryTimelineRulerStep {
  if (pixelsPerSecond >= 80) return { minor: 0.5, major: 2 };
  if (pixelsPerSecond >= 40) return { minor: 1, major: 5 };
  if (pixelsPerSecond >= 24) return { minor: 2, major: 10 };
  return { minor: 5, major: 20 };
}

export function createStoryTimelineRulerTicks(
  durationSeconds: number,
  minorStep: number,
  majorStep: number
): StoryTimelineRulerTick[] {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0 ||
    !Number.isFinite(minorStep) ||
    minorStep <= 0 ||
    !Number.isFinite(majorStep) ||
    majorStep <= 0
  ) {
    return [];
  }

  const ticks: StoryTimelineRulerTick[] = [];
  for (let seconds = 0; seconds <= durationSeconds + Number.EPSILON; seconds += minorStep) {
    const roundedSeconds = Number(seconds.toFixed(3));
    ticks.push({
      seconds: roundedSeconds,
      major: Math.abs(roundedSeconds / majorStep - Math.round(roundedSeconds / majorStep)) < 0.001,
    });
  }
  return ticks;
}

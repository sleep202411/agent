export interface StoryTimelineSpan {
  startMs: number;
  durationMs: number;
}

export function storyTimelineItemAtTime<T extends StoryTimelineSpan>(
  items: readonly T[],
  timeMs: number
): T | null {
  if (!Number.isFinite(timeMs) || items.length === 0) return null;
  const last = items.at(-1) ?? null;
  return (
    items.find((item) => timeMs >= item.startMs && timeMs < item.startMs + item.durationMs) ??
    (last && timeMs === last.startMs + last.durationMs ? last : null)
  );
}

export function advanceStoryTimelinePlayback(
  startMs: number,
  elapsedMs: number,
  durationMs: number
): { timeMs: number; ended: boolean } {
  const safeDuration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  const safeStart = Math.min(safeDuration, Math.max(0, Number.isFinite(startMs) ? startMs : 0));
  const safeElapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const timeMs = Math.min(safeDuration, safeStart + safeElapsed);
  return { timeMs, ended: timeMs >= safeDuration };
}

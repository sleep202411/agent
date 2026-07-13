import type { StoryCanvasPosition } from "@/lib/story-projects-api";

export type StoryCanvasLayoutPositions = Record<string, StoryCanvasPosition>;

export function layoutPositionSignature(positions: StoryCanvasLayoutPositions): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(positions).sort(([left], [right]) => left.localeCompare(right))
    )
  );
}

/** Keeps only a payload that is newer than the request already in flight. */
export function coalesceQueuedLayout(
  inFlightSignature: string | null,
  next: StoryCanvasLayoutPositions
): StoryCanvasLayoutPositions | null {
  return layoutPositionSignature(next) === inFlightSignature ? null : next;
}

/** A user edit queued during a failed request always supersedes that failure. */
export function selectLatestLayoutPayload(
  failed: StoryCanvasLayoutPositions,
  queued: StoryCanvasLayoutPositions | null
): StoryCanvasLayoutPositions {
  return queued ?? failed;
}

export function layoutRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt), 30_000);
}

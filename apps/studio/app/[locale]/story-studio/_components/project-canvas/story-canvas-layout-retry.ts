import type { StoryCanvasLayout, StoryCanvasPosition } from "@/lib/story-projects-api";

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

export function confirmsOwnCanvasLayoutWrite(
  current: StoryCanvasLayout,
  sessionId: string,
  expectedSignature: string
): boolean {
  return (
    current.updatedBySessionId === sessionId &&
    layoutPositionSignature(current.nodePositions) === expectedSignature
  );
}

export function layoutRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt), 30_000);
}

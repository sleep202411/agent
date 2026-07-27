import type { StoryCanvasLayout, StoryCanvasPosition } from "@/lib/story-projects-api";

export type StoryCanvasLayoutPositions = Record<string, StoryCanvasPosition>;

export interface StoryCanvasLayoutPayload {
  nodePositions: StoryCanvasLayoutPositions;
}

export function layoutPositionSignature(positions: StoryCanvasLayoutPositions): string {
  return JSON.stringify(canonicalNodePositions(positions));
}

export function layoutPayloadSignature(payload: StoryCanvasLayoutPayload): string {
  return JSON.stringify({
    nodePositions: canonicalNodePositions(payload.nodePositions),
  });
}

export function unsavedDesiredLayout(
  desired: StoryCanvasLayoutPayload | null,
  savedSignature: string
): StoryCanvasLayoutPayload | null {
  return desired && layoutPayloadSignature(desired) !== savedSignature ? desired : null;
}

export function confirmsOwnCanvasLayoutWrite(
  current: StoryCanvasLayout,
  sessionId: string,
  expectedSignature: string
): boolean {
  return (
    current.updatedBySessionId === sessionId &&
    layoutPayloadSignature({
      nodePositions: current.nodePositions,
    }) === expectedSignature
  );
}

export function layoutRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt), 30_000);
}

export function shouldAdoptAuthoritativeCanvasLayout(input: {
  authoritativeRevision: number;
  currentRevision: number;
  hasConflict: boolean;
  hasLocalChanges: boolean;
  hydrated: boolean;
}): boolean {
  return (
    input.hydrated &&
    input.authoritativeRevision > input.currentRevision &&
    !input.hasConflict &&
    !input.hasLocalChanges
  );
}

function canonicalNodePositions(positions: StoryCanvasLayoutPositions): StoryCanvasLayoutPositions {
  return Object.fromEntries(
    Object.entries(positions).sort(([left], [right]) => left.localeCompare(right))
  );
}

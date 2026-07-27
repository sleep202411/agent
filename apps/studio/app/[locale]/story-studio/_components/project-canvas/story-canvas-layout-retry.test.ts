import { describe, expect, it } from "vitest";
import {
  confirmsOwnCanvasLayoutWrite,
  layoutPayloadSignature,
  layoutPositionSignature,
  layoutRetryDelay,
  shouldAdoptAuthoritativeCanvasLayout,
  unsavedDesiredLayout,
  type StoryCanvasLayoutPayload,
  type StoryCanvasLayoutPositions,
} from "./story-canvas-layout-retry";

describe("story canvas layout retry state", () => {
  it("uses a stable signature independent of node insertion order", () => {
    expect(layoutPositionSignature({ second: { x: 2, y: 3 }, first: { x: 0, y: 1 } })).toBe(
      layoutPositionSignature({ first: { x: 0, y: 1 }, second: { x: 2, y: 3 } })
    );
  });

  it("discards a stale queued move after the creator returns to the recovered state", () => {
    const moved = payload(layout("node", 40));
    const original = payload(layout("node", 10));
    // The move fails, Undo becomes the newer intent, then Redo returns to the
    // failed payload before its retry succeeds. Only the final intent matters.
    const latestDesired = [moved, original, moved].at(-1) ?? null;

    expect(unsavedDesiredLayout(latestDesired, layoutPayloadSignature(moved))).toBeNull();
  });

  it("recognizes a lost response only when the server head matches this session and payload", () => {
    const positions = layout("node", 10);
    const current = {
      projectId: "project",
      chapterId: "chapter",
      schemaVersion: "story-canvas-layout-v3" as const,
      nodePositions: positions,
      revision: 4,
      updatedByUserId: "user",
      updatedBySessionId: "session",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      confirmsOwnCanvasLayoutWrite(current, "session", layoutPayloadSignature(payload(positions)))
    ).toBe(true);
    expect(
      confirmsOwnCanvasLayoutWrite(
        current,
        "other-session",
        layoutPayloadSignature(payload(positions))
      )
    ).toBe(false);
    expect(
      confirmsOwnCanvasLayoutWrite(
        current,
        "session",
        layoutPayloadSignature(payload(layout("node", 20)))
      )
    ).toBe(false);
  });

  it("backs off exponentially and caps retries at thirty seconds", () => {
    expect([0, 1, 2, 5, 20].map(layoutRetryDelay)).toEqual([1_000, 2_000, 4_000, 30_000, 30_000]);
  });

  it("adopts a newer authoritative layout only when the local canvas is clean", () => {
    const clean = {
      authoritativeRevision: 9,
      currentRevision: 8,
      hasConflict: false,
      hasLocalChanges: false,
      hydrated: true,
    };

    expect(shouldAdoptAuthoritativeCanvasLayout(clean)).toBe(true);
    expect(shouldAdoptAuthoritativeCanvasLayout({ ...clean, hasLocalChanges: true })).toBe(false);
    expect(shouldAdoptAuthoritativeCanvasLayout({ ...clean, hasConflict: true })).toBe(false);
    expect(shouldAdoptAuthoritativeCanvasLayout({ ...clean, hydrated: false })).toBe(false);
    expect(shouldAdoptAuthoritativeCanvasLayout({ ...clean, authoritativeRevision: 8 })).toBe(
      false
    );
  });
});

function layout(nodeId: string, x: number): StoryCanvasLayoutPositions {
  return { [nodeId]: { x, y: x + 1 } };
}

function payload(nodePositions: StoryCanvasLayoutPositions): StoryCanvasLayoutPayload {
  return { nodePositions };
}

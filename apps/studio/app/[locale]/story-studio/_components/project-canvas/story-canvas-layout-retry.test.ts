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

  it("treats Story World presence as part of the atomic layout payload", () => {
    const visible = payload(layout("node", 10), true);
    const hidden = payload(layout("node", 10), false);

    expect(layoutPayloadSignature(visible)).not.toBe(layoutPayloadSignature(hidden));
    expect(unsavedDesiredLayout(hidden, layoutPayloadSignature(visible))).toBe(hidden);
  });

  it("discards stale queued visibility after the creator returns to the recovered state", () => {
    const hidden = payload({}, false);
    const visible = payload({ __story_root__: { x: 10, y: 20 } }, true);
    // Delete fails, Undo becomes the newer intent, then Redo returns to the
    // failed payload before its retry succeeds. Only the final intent matters.
    const latestDesired = [hidden, visible, hidden].at(-1) ?? null;

    expect(unsavedDesiredLayout(latestDesired, layoutPayloadSignature(hidden))).toBeNull();
  });

  it("recognizes a lost response only when the server head matches this session and payload", () => {
    const positions = layout("node", 10);
    const current = {
      projectId: "project",
      chapterId: "chapter",
      schemaVersion: "story-canvas-layout-v2" as const,
      nodePositions: positions,
      storyWorldNodePresent: true,
      revision: 4,
      updatedByUserId: "user",
      updatedBySessionId: "session",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      confirmsOwnCanvasLayoutWrite(
        current,
        "session",
        layoutPayloadSignature(payload(positions, true))
      )
    ).toBe(true);
    expect(
      confirmsOwnCanvasLayoutWrite(
        current,
        "other-session",
        layoutPayloadSignature(payload(positions, true))
      )
    ).toBe(false);
    expect(
      confirmsOwnCanvasLayoutWrite(
        current,
        "session",
        layoutPayloadSignature(payload(layout("node", 20), true))
      )
    ).toBe(false);
    expect(
      confirmsOwnCanvasLayoutWrite(
        current,
        "session",
        layoutPayloadSignature(payload(positions, false))
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

function payload(
  nodePositions: StoryCanvasLayoutPositions,
  storyWorldNodePresent: boolean
): StoryCanvasLayoutPayload {
  return { nodePositions, storyWorldNodePresent };
}

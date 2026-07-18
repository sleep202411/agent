import { describe, expect, it } from "vitest";
import {
  coalesceQueuedLayout,
  confirmsOwnCanvasLayoutWrite,
  layoutPositionSignature,
  layoutRetryDelay,
  type StoryCanvasLayoutPositions,
} from "./story-canvas-layout-retry";

describe("story canvas layout retry state", () => {
  it("uses a stable signature independent of node insertion order", () => {
    expect(layoutPositionSignature({ second: { x: 2, y: 3 }, first: { x: 0, y: 1 } })).toBe(
      layoutPositionSignature({ first: { x: 0, y: 1 }, second: { x: 2, y: 3 } })
    );
  });

  it("coalesces repeated in-flight input but queues a genuinely newer layout", () => {
    const inFlight = layout("node", 10);
    const newer = layout("node", 20);
    const signature = layoutPositionSignature(inFlight);

    expect(coalesceQueuedLayout(signature, inFlight)).toBeNull();
    expect(coalesceQueuedLayout(signature, newer)).toBe(newer);
  });

  it("recognizes a lost response only when the server head matches this session and payload", () => {
    const positions = layout("node", 10);
    const current = {
      projectId: "project",
      schemaVersion: "story-canvas-layout-v1" as const,
      nodePositions: positions,
      revision: 4,
      updatedByUserId: "user",
      updatedBySessionId: "session",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      confirmsOwnCanvasLayoutWrite(current, "session", layoutPositionSignature(positions))
    ).toBe(true);
    expect(
      confirmsOwnCanvasLayoutWrite(current, "other-session", layoutPositionSignature(positions))
    ).toBe(false);
    expect(
      confirmsOwnCanvasLayoutWrite(current, "session", layoutPositionSignature(layout("node", 20)))
    ).toBe(false);
  });

  it("backs off exponentially and caps retries at thirty seconds", () => {
    expect([0, 1, 2, 5, 20].map(layoutRetryDelay)).toEqual([1_000, 2_000, 4_000, 30_000, 30_000]);
  });
});

function layout(nodeId: string, x: number): StoryCanvasLayoutPositions {
  return { [nodeId]: { x, y: x + 1 } };
}

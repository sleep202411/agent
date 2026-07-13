import { describe, expect, it } from "vitest";
import {
  coalesceQueuedLayout,
  layoutPositionSignature,
  layoutRetryDelay,
  selectLatestLayoutPayload,
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

  it("lets the latest queued layout supersede an older failed payload", () => {
    const failed = layout("node", 10);
    const newer = layout("node", 30);

    expect(selectLatestLayoutPayload(failed, newer)).toBe(newer);
    expect(selectLatestLayoutPayload(failed, null)).toBe(failed);
  });

  it("backs off exponentially and caps retries at thirty seconds", () => {
    expect([0, 1, 2, 5, 20].map(layoutRetryDelay)).toEqual([1_000, 2_000, 4_000, 30_000, 30_000]);
  });
});

function layout(nodeId: string, x: number): StoryCanvasLayoutPositions {
  return { [nodeId]: { x, y: x + 1 } };
}

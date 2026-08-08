import { describe, expect, it } from "vitest";
import {
  nextShotPosition,
  SHOT_NODE_TYPE,
  SHOT_NODE_WIDTH,
  SHOT_STRIP_GAP,
  SHOT_STRIP_OFFSET_Y,
} from "./storyboard-shot.js";

const shot = (x: number, y: number) => ({
  type: SHOT_NODE_TYPE,
  position: { x, y },
});
const other = (x: number, y: number, height?: number) => ({
  type: "generation",
  position: { x, y },
  height,
});

describe("nextShotPosition", () => {
  it("starts at the origin on a genuinely empty board", () => {
    expect(nextShotPosition([])).toEqual({ x: 0, y: 0 });
  });

  it("continues the strip to the right of the rightmost shot", () => {
    expect(nextShotPosition([shot(0, 40), shot(344, 40)])).toEqual({
      x: 344 + SHOT_NODE_WIDTH + SHOT_STRIP_GAP,
      y: 40,
    });
  });

  it("follows the rightmost shot regardless of map order", () => {
    // Node maps have no ordering guarantee; the rightmost must win either way.
    expect(nextShotPosition([shot(900, 12), shot(0, 999)])).toEqual({
      x: 900 + SHOT_NODE_WIDTH + SHOT_STRIP_GAP,
      y: 12,
    });
  });

  it("dodges existing work when the board has no shots yet", () => {
    // The regression: placing the first shot at the origin drops it on top of
    // whatever the user already has on the canvas.
    const position = nextShotPosition([other(120, 80, 300), other(500, 40, 100)]);
    expect(position).toEqual({ x: 120, y: 80 + 300 + SHOT_STRIP_OFFSET_Y });
    expect(position).not.toEqual({ x: 0, y: 0 });
  });

  it("assumes a height for nodes the client never measured", () => {
    const position = nextShotPosition([other(0, 0)]);
    expect(position.y).toBeGreaterThan(SHOT_STRIP_OFFSET_Y);
  });

  it("ignores nodes that carry no position at all", () => {
    expect(nextShotPosition([{ type: "note", position: null }])).toEqual({
      x: 0,
      y: 0,
    });
  });
});

import { expect, it } from "vitest";
import { hotspotRect, placeHotspot } from "./story-hotspot-geometry";
const rect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
it("moves and resizes inside the frame even when the gesture leaves it", () => {
  expect(placeHotspot("move", rect, { x: 0.5, y: 0.5 }, { x: 2, y: -1 })).toEqual({
    ...rect,
    x: 0.5,
    y: 0,
  });
  expect(placeHotspot("resize", rect, { x: 0.5, y: 0.5 }, { x: 2, y: 2 })).toEqual({
    ...rect,
    width: 0.75,
    height: 0.75,
  });
  expect(placeHotspot("resize", rect, { x: 0.5, y: 0.5 }, { x: -1, y: -1 })).toEqual({
    ...rect,
    width: 0.035,
    height: 0.035,
  });
});
it("draws in reverse and protects minimum size at frame edges", () => {
  expect(placeHotspot("draw", rect, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.3 })).toMatchObject({
    x: 0.2,
    y: 0.3,
    height: 0.5,
  });
  const edge = placeHotspot("draw", rect, { x: 1, y: 1 }, { x: 1, y: 1 });
  expect(edge.x + edge.width).toBeLessThanOrEqual(1);
  expect(edge.y + edge.height).toBeLessThanOrEqual(1);
  expect(edge.width).toBe(0.035);
  expect(() => placeHotspot("draw", rect, { x: NaN, y: 0 }, { x: 0, y: 0 })).toThrow();
});
it("does not disguise invalid numeric drafts as a valid rectangle", () => {
  expect(hotspotRect({ ...rect, x: "-" })).toBeNull();
  expect(hotspotRect({ ...rect, x: null })).toBeNull();
  expect(hotspotRect({ ...rect, width: 0 })).toBeNull();
  expect(hotspotRect({ ...rect, x: 0.8 })).toBeNull();
  expect(hotspotRect({ ...rect, x: "0.2" })).toEqual({ ...rect, x: 0.2 });
});

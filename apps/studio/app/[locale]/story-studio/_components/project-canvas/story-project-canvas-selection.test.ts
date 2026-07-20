import { describe, expect, it } from "vitest";
import {
  nextStoryCanvasFocusedNodeId,
  reconcileStoryCanvasSelectedIds,
} from "./story-project-canvas-selection";

describe("story canvas selection", () => {
  it("preserves every selected node that still exists after a model refresh", () => {
    expect([
      ...reconcileStoryCanvasSelectedIds(["a", "b", "c"], new Set(["a", "c", "gone"]), null),
    ]).toEqual(["a", "c"]);
  });

  it("atomically replaces selection when a pending programmatic node appears", () => {
    expect([
      ...reconcileStoryCanvasSelectedIds(["a", "created"], new Set(["a"]), "created"),
    ]).toEqual(["created"]);
  });

  it("retains the pending request until its node exists", () => {
    expect([...reconcileStoryCanvasSelectedIds(["a"], new Set(["a"]), "created")]).toEqual(["a"]);
  });

  it("prefers the clicked node, then keeps focus in the selection, then chooses the latest node", () => {
    expect(nextStoryCanvasFocusedNodeId("a", ["a", "b"], "b")).toBe("b");
    expect(nextStoryCanvasFocusedNodeId("a", ["a", "b"])).toBe("a");
    expect(nextStoryCanvasFocusedNodeId("gone", ["a", "b"])).toBe("b");
    expect(nextStoryCanvasFocusedNodeId("gone", [])).toBeNull();
  });
});

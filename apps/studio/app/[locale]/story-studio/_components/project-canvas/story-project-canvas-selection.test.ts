import { describe, expect, it } from "vitest";
import {
  nextStoryCanvasFocusedNodeId,
  reconcileStoryCanvasSelectedIds,
  resolveStoryCanvasNodeClick,
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

  it("prefers the clicked node, keeps the still-selected focus, and otherwise focuses nothing", () => {
    expect(nextStoryCanvasFocusedNodeId("a", ["a", "b"], "b")).toBe("b");
    expect(nextStoryCanvasFocusedNodeId("a", ["a", "b"])).toBe("a");
    // Without a clicked (preferred) node and no surviving focus, selection alone
    // must NOT auto-focus a node — a marquee selection can't open the inspector.
    expect(nextStoryCanvasFocusedNodeId("gone", ["a", "b"])).toBeNull();
    expect(nextStoryCanvasFocusedNodeId(null, ["a", "b"])).toBeNull();
    expect(nextStoryCanvasFocusedNodeId("gone", [])).toBeNull();
  });
});

describe("resolveStoryCanvasNodeClick", () => {
  it("suppresses the click that ends a drag so it never opens the inspector", () => {
    expect(
      resolveStoryCanvasNodeClick({
        nodeId: "a",
        nodeSelected: true,
        shiftKey: false,
        didDrag: true,
        currentSelection: ["a"],
      })
    ).toEqual({ kind: "drag-suppressed" });
  });

  it("focuses the node on a plain click", () => {
    expect(
      resolveStoryCanvasNodeClick({
        nodeId: "a",
        nodeSelected: false,
        shiftKey: false,
        didDrag: false,
        currentSelection: [],
      })
    ).toEqual({ kind: "focus", nodeId: "a" });
  });

  it("toggles a selected node out of the multi-selection on shift-click", () => {
    expect(
      resolveStoryCanvasNodeClick({
        nodeId: "b",
        nodeSelected: true,
        shiftKey: true,
        didDrag: false,
        currentSelection: ["a", "b"],
      })
    ).toEqual({ kind: "toggle-off", remainingNodeIds: ["a"] });
  });

  it("focuses (adds) an unselected node on shift-click", () => {
    expect(
      resolveStoryCanvasNodeClick({
        nodeId: "c",
        nodeSelected: false,
        shiftKey: true,
        didDrag: false,
        currentSelection: ["a", "b"],
      })
    ).toEqual({ kind: "focus", nodeId: "c" });
  });
});

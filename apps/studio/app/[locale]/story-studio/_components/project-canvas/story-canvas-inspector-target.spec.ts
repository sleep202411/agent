import { describe, expect, it } from "vitest";
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  reconcileStoryCanvasInspectorTarget,
  storyCanvasInspectorNodeId,
  storyNodeInspectorTarget,
} from "./story-canvas-inspector-target";

describe("story canvas inspector target", () => {
  it("starts and remains closed when the canvas has no selection", () => {
    expect(reconcileStoryCanvasInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR, [])).toEqual({
      kind: "closed",
    });
  });

  it("opens a node inspector on an explicit node click (preferred id)", () => {
    expect(
      reconcileStoryCanvasInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR, ["clip:a"], "clip:a")
    ).toEqual({
      kind: "node",
      nodeId: "clip:a",
    });
  });

  it("never opens a node inspector from a marquee selection alone", () => {
    // A box/marquee selection carries no preferred (clicked) node, so it must
    // not pop the drawer open on a node the user did not click.
    expect(reconcileStoryCanvasInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR, ["clip:a"])).toEqual({
      kind: "closed",
    });
    expect(
      reconcileStoryCanvasInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR, ["clip:a", "clip:b"])
    ).toEqual({ kind: "closed" });
  });

  it("keeps the focused node inspector while that node stays selected", () => {
    expect(
      reconcileStoryCanvasInspectorTarget(storyNodeInspectorTarget("clip:a"), ["clip:a", "clip:b"])
    ).toEqual({ kind: "node", nodeId: "clip:a" });
  });

  it("closes when the focused node is removed from the selection", () => {
    expect(reconcileStoryCanvasInspectorTarget(storyNodeInspectorTarget("clip:a"), [])).toEqual({
      kind: "closed",
    });
    // A marquee that reselects other nodes drops the previously focused node.
    expect(
      reconcileStoryCanvasInspectorTarget(storyNodeInspectorTarget("clip:a"), ["clip:b"])
    ).toEqual({ kind: "closed" });
  });

  it("exposes a node id only for node inspectors", () => {
    expect(storyCanvasInspectorNodeId(storyNodeInspectorTarget("clip:a"))).toBe("clip:a");
    expect(storyCanvasInspectorNodeId(CLOSED_STORY_CANVAS_INSPECTOR)).toBeNull();
  });
});

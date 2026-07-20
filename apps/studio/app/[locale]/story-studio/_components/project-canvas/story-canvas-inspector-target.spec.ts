import { describe, expect, it } from "vitest";
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  STORY_WORLD_INSPECTOR,
  reconcileStoryCanvasInspectorTarget,
  storyCanvasInspectorNodeId,
  storyNodeInspectorTarget,
} from "./story-canvas-inspector-target";
import { STORY_ROOT_NODE_ID } from "./story-project-canvas-model";

describe("story canvas inspector target", () => {
  it("starts and remains closed when the canvas has no selection", () => {
    expect(reconcileStoryCanvasInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR, [])).toEqual({
      kind: "closed",
    });
  });

  it("keeps the world library open while node selection stays empty", () => {
    expect(reconcileStoryCanvasInspectorTarget(STORY_WORLD_INSPECTOR, [])).toBe(
      STORY_WORLD_INSPECTOR
    );
  });

  it("replaces the world library only on an explicit node click (preferred id)", () => {
    expect(
      reconcileStoryCanvasInspectorTarget(STORY_WORLD_INSPECTOR, ["clip:a"], "clip:a")
    ).toEqual({
      kind: "node",
      nodeId: "clip:a",
    });
  });

  it("never opens a node inspector from a marquee selection alone", () => {
    // A box/marquee selection carries no preferred (clicked) node, so it must
    // not pop the drawer open on a node the user did not click.
    expect(reconcileStoryCanvasInspectorTarget(STORY_WORLD_INSPECTOR, ["clip:a"])).toBe(
      STORY_WORLD_INSPECTOR
    );
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

  it("routes a character node selection to its node inspector, not the world panel", () => {
    expect(storyNodeInspectorTarget("character:hero")).toEqual({
      kind: "node",
      nodeId: "character:hero",
    });
  });

  it("exposes a node id only for node inspectors", () => {
    expect(storyCanvasInspectorNodeId(storyNodeInspectorTarget("clip:a"))).toBe("clip:a");
    expect(storyCanvasInspectorNodeId(STORY_WORLD_INSPECTOR)).toBeNull();
    expect(storyCanvasInspectorNodeId(CLOSED_STORY_CANVAS_INSPECTOR)).toBeNull();
  });

  it("routes the mandatory Story World root to the Story Bible panel, not a node inspector", () => {
    expect(storyNodeInspectorTarget(STORY_ROOT_NODE_ID)).toBe(STORY_WORLD_INSPECTOR);
    expect(storyCanvasInspectorNodeId(storyNodeInspectorTarget(STORY_ROOT_NODE_ID))).toBeNull();
  });

  it("opens the Story Bible panel when the root node is explicitly clicked", () => {
    // An explicit click names the root as the preferred node; a marquee that
    // merely sweeps the root does not open the panel.
    expect(
      reconcileStoryCanvasInspectorTarget(
        CLOSED_STORY_CANVAS_INSPECTOR,
        [STORY_ROOT_NODE_ID],
        STORY_ROOT_NODE_ID
      )
    ).toBe(STORY_WORLD_INSPECTOR);
    expect(
      reconcileStoryCanvasInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR, [STORY_ROOT_NODE_ID])
    ).toEqual({ kind: "closed" });
  });
});

import { describe, expect, it } from "vitest";
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  STORY_WORLD_INSPECTOR,
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

  it("keeps the world library open while node selection stays empty", () => {
    expect(reconcileStoryCanvasInspectorTarget(STORY_WORLD_INSPECTOR, [])).toBe(
      STORY_WORLD_INSPECTOR
    );
  });

  it("replaces the world library with an explicitly selected node", () => {
    expect(reconcileStoryCanvasInspectorTarget(STORY_WORLD_INSPECTOR, ["clip:a"])).toEqual({
      kind: "node",
      nodeId: "clip:a",
    });
  });

  it("closes when the focused node is removed from the selection", () => {
    expect(reconcileStoryCanvasInspectorTarget(storyNodeInspectorTarget("clip:a"), [])).toEqual({
      kind: "closed",
    });
  });

  it("exposes a node id only for node inspectors", () => {
    expect(storyCanvasInspectorNodeId(storyNodeInspectorTarget("clip:a"))).toBe("clip:a");
    expect(storyCanvasInspectorNodeId(STORY_WORLD_INSPECTOR)).toBeNull();
    expect(storyCanvasInspectorNodeId(CLOSED_STORY_CANVAS_INSPECTOR)).toBeNull();
  });
});

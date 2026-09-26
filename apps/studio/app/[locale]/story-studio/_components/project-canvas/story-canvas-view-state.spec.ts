import { describe, expect, it } from "vitest";
import { CLOSED_STORY_CANVAS_INSPECTOR } from "./story-canvas-inspector-target";
import {
  STORY_CANVAS_COLD_VIEWPORT,
  resolveStoryCanvasCamera,
  storyCanvasHydrationSelection,
  storyCanvasInspectorToRestore,
  storyCanvasViewKey,
  type StoryCanvasViewState,
} from "./story-canvas-view-state";

const saved: StoryCanvasViewState = {
  viewport: { x: 240, y: -80, zoom: 0.62 },
  selectedNodeIds: ["clip:scene-2"],
  inspectorTarget: { kind: "node", nodeId: "clip:scene-2" },
};

describe("story canvas view state", () => {
  it("keys a view by project and chapter", () => {
    expect(storyCanvasViewKey("project-1", "chapter-9")).toBe("project-1:chapter-9");
  });

  it("fits a chapter the author has not visited", () => {
    expect(resolveStoryCanvasCamera(null)).toEqual({
      defaultViewport: STORY_CANVAS_COLD_VIEWPORT,
      fitView: true,
    });
  });

  it("restores a saved camera instead of fitting", () => {
    expect(resolveStoryCanvasCamera(saved)).toEqual({
      defaultViewport: saved.viewport,
      fitView: false,
    });
  });

  it("seeds the first hydration from the saved selection", () => {
    expect(
      storyCanvasHydrationSelection(
        ["clip:scene-1", "clip:scene-2"],
        ["clip:scene-1"],
        saved.selectedNodeIds,
        null,
        false
      )
    ).toEqual(new Set(["clip:scene-2"]));
  });

  it("keeps the live selection once the chapter is hydrated", () => {
    expect(
      storyCanvasHydrationSelection(
        ["clip:scene-1", "clip:scene-2"],
        ["clip:scene-1"],
        saved.selectedNodeIds,
        null,
        true
      )
    ).toEqual(new Set(["clip:scene-1"]));
  });

  it("lets an explicit pending node win over the saved selection", () => {
    expect(
      storyCanvasHydrationSelection(
        ["clip:scene-1", "clip:scene-2"],
        [],
        saved.selectedNodeIds,
        "clip:scene-1",
        false
      )
    ).toEqual(new Set(["clip:scene-1"]));
  });

  it("reopens the inspector when its node is selected again", () => {
    expect(storyCanvasInspectorToRestore(saved.inspectorTarget, new Set(["clip:scene-2"]))).toEqual(
      saved.inspectorTarget
    );
  });

  it("drops a remembered inspector whose node is gone", () => {
    expect(storyCanvasInspectorToRestore(saved.inspectorTarget, new Set(["clip:scene-1"]))).toBe(
      CLOSED_STORY_CANVAS_INSPECTOR
    );
  });
});

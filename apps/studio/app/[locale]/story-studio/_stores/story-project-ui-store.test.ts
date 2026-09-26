import { beforeEach, describe, expect, it } from "vitest";
import { CLOSED_STORY_CANVAS_INSPECTOR } from "../_components/project-canvas/story-canvas-inspector-target";
import type { StoryCanvasViewState } from "../_components/project-canvas/story-canvas-view-state";
import { useStoryProjectUiStore } from "./story-project-ui-store";

describe("Story project FizzAgent composer bridge", () => {
  beforeEach(() => {
    useStoryProjectUiStore.setState({
      mobileView: "work",
      composerPrefillSequence: 0,
      composerPrefillRequest: null,
    });
  });

  it("switches phones to chat and publishes a one-shot natural-language prefill", () => {
    useStoryProjectUiStore.getState().openAgentComposer("Prepare Asset Specs for review.");

    expect(useStoryProjectUiStore.getState()).toMatchObject({
      mobileView: "chat",
      composerPrefillSequence: 1,
      composerPrefillRequest: { id: 1, text: "Prepare Asset Specs for review." },
    });
  });

  it("only consumes the matching request and keeps ids monotonic", () => {
    useStoryProjectUiStore.getState().openAgentComposer("First");
    useStoryProjectUiStore.getState().consumeComposerPrefill(99);
    expect(useStoryProjectUiStore.getState().composerPrefillRequest?.text).toBe("First");

    useStoryProjectUiStore.getState().consumeComposerPrefill(1);
    expect(useStoryProjectUiStore.getState().composerPrefillRequest).toBeNull();

    useStoryProjectUiStore.getState().openAgentComposer("Second");
    expect(useStoryProjectUiStore.getState().composerPrefillRequest).toEqual({
      id: 2,
      text: "Second",
    });
  });
});

describe("Story canvas view state", () => {
  beforeEach(() => {
    useStoryProjectUiStore.setState({ canvasViews: {} });
  });

  it("keeps each chapter camera without overwriting the others", () => {
    const chapterA: StoryCanvasViewState = {
      viewport: { x: 10, y: 20, zoom: 0.5 },
      selectedNodeIds: ["clip:scene-1"],
      inspectorTarget: { kind: "node", nodeId: "clip:scene-1" },
    };
    const chapterB: StoryCanvasViewState = {
      viewport: { x: 30, y: 40, zoom: 0.8 },
      selectedNodeIds: [],
      inspectorTarget: CLOSED_STORY_CANVAS_INSPECTOR,
    };

    useStoryProjectUiStore.getState().saveCanvasView("project:chapter-a", chapterA);
    useStoryProjectUiStore.getState().saveCanvasView("project:chapter-b", chapterB);
    useStoryProjectUiStore.getState().saveCanvasView("project:chapter-a", {
      ...chapterA,
      viewport: { x: 99, y: 20, zoom: 0.5 },
    });

    expect(useStoryProjectUiStore.getState().canvasViews["project:chapter-a"]?.viewport.x).toBe(99);
    expect(useStoryProjectUiStore.getState().canvasViews["project:chapter-b"]).toEqual(chapterB);
  });
});

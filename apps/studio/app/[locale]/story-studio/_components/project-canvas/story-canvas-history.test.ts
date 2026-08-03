import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { StoryCanvasHistory, type StoryCanvasHistorySnapshot } from "./story-canvas-history";

describe("StoryCanvasHistory", () => {
  it("keeps structural changes as distinct undo steps", () => {
    const history = new StoryCanvasHistory();
    history.capture(snapshot("first"), { now: 0 });
    history.capture(snapshot("second"), { now: 1 });

    expect(history.undo(snapshot("current"))?.content.storyBible.logline).toBe("second");
    expect(history.undo(snapshot("second"))?.content.storyBible.logline).toBe("first");
  });

  it("coalesces consecutive edits to the same field", () => {
    const history = new StoryCanvasHistory();
    history.capture(snapshot("before typing"), { mergeKey: "foundation:logline", now: 0 });
    history.capture(snapshot("b"), { mergeKey: "foundation:logline", now: 100 });
    history.capture(snapshot("be"), { mergeKey: "foundation:logline", now: 200 });

    expect(history.undo(snapshot("best"))?.content.storyBible.logline).toBe("before typing");
    expect(history.canUndo).toBe(false);
  });

  it("restores the complete layout state and clears redo after a new change", () => {
    const history = new StoryCanvasHistory();
    history.capture(snapshot("before", { scene: { x: 10, y: 20 } }));
    const previous = history.undo(snapshot("after", { scene: { x: 80, y: 90 } }));

    expect(previous?.nodePositions.scene).toEqual({ x: 10, y: 20 });
    expect(history.canRedo).toBe(true);

    history.capture(snapshot("new branch"));
    expect(history.canRedo).toBe(false);
  });
});

function snapshot(
  logline: string,
  nodePositions: StoryCanvasHistorySnapshot["nodePositions"] = {}
): StoryCanvasHistorySnapshot {
  return { content: draft(logline), nodePositions };
}

function draft(logline: string): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline,
      synopsis: "",
      characters: [],
    },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
}

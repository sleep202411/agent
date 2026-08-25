import { describe, expect, it } from "vitest";
import type { StoryProductionState } from "@/lib/story-production-api";
import { storyApplyingActivityKey } from "./story-production-activity";

describe("storyApplyingActivityKey", () => {
  it("does not claim downstream work before the approved Script is current", () => {
    expect(storyApplyingActivityKey(null, 4)).toBe("savingScript");
    expect(
      storyApplyingActivityKey(state({ script: "missing", sequence: null, ready: false }), 4)
    ).toBe("savingScript");
  });

  it("does not mistake the proposal's cached base Script for the newly approved Script", () => {
    expect(
      storyApplyingActivityKey(state({ script: "current", sequence: 4, ready: true }), 4)
    ).toBe("savingScript");
    expect(
      storyApplyingActivityKey(state({ script: "current", sequence: 5, ready: false }), null)
    ).toBe("savingScript");
  });

  it("distinguishes authoritative downstream building from completion", () => {
    expect(
      storyApplyingActivityKey(state({ script: "current", sequence: 5, ready: false }), 4)
    ).toBe("buildingProduction");
    expect(
      storyApplyingActivityKey(state({ script: "current", sequence: 5, ready: true }), 4)
    ).toBe("finalizingProduction");
  });
});

function state(input: {
  script: StoryProductionState["script"]["status"];
  sequence: number | null;
  ready: boolean;
}): StoryProductionState {
  return {
    projectId: "project-1",
    chapterId: "chapter-1",
    profile: { status: "current" },
    script: { status: input.script, documentId: null, sequence: input.sequence },
    plotTree: { status: input.ready ? "current" : "missing", nodeCount: 0 },
    assets: { status: input.ready ? "current" : "missing", currentCount: 0, staleCount: 0 },
    storyboard: {
      status: input.ready ? "current" : "missing",
      sequenceCount: 0,
      staleCount: 0,
      missingPlotNodeIds: [],
    },
    ready: input.ready,
  };
}

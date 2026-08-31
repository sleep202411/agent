import { describe, expect, it } from "vitest";
import type { StoryProductionState, StoryProductionStatus } from "@/lib/story-production-api";
import {
  storyAssetsStageGuidance,
  storyAssetsStageHasStaleContent,
} from "./story-production-stage-guidance";

function productionState({
  plot = "current",
  assets = "current",
  storyboard = "current",
}: {
  plot?: StoryProductionStatus;
  assets?: StoryProductionStatus;
  storyboard?: StoryProductionStatus;
} = {}): StoryProductionState {
  return {
    projectId: "project-1",
    chapterId: "chapter-1",
    profile: { status: "current" },
    script: { status: "current", documentId: "document-1", sequence: 1 },
    plotTree: { status: plot, nodeCount: 2 },
    assets: { status: assets, currentCount: 1, staleCount: 0 },
    storyboard: {
      status: storyboard,
      sequenceCount: 2,
      staleCount: 0,
      missingPlotNodeIds: [],
    },
    ready: plot === "current" && assets === "current" && storyboard === "current",
  };
}

describe("story production stage guidance", () => {
  it("requires the approved Plot before Asset Specs", () => {
    expect(storyAssetsStageGuidance(productionState({ plot: "missing" }), 0)).toBe("plotRequired");
    expect(storyAssetsStageGuidance(productionState({ plot: "stale" }), 2)).toBe("plotRequired");
    expect(
      storyAssetsStageGuidance(productionState({ plot: "missing", assets: "missing" }), 0)
    ).toBe("plotRequired");
  });

  it("requires current Asset Specs and treats an approved empty plan honestly", () => {
    expect(storyAssetsStageGuidance(productionState({ assets: "stale" }), 2)).toBe(
      "assetsRequired"
    );
    expect(storyAssetsStageGuidance(productionState(), 0)).toBe("noAssets");
    expect(storyAssetsStageGuidance(productionState(), 2)).toBeNull();
  });

  it("preserves stale Asset rows only when there is real stale content to reconcile", () => {
    const stale = productionState({ assets: "stale" });
    stale.assets.staleCount = 1;
    expect(storyAssetsStageHasStaleContent(stale, 2)).toBe(true);
    expect(storyAssetsStageHasStaleContent(stale, 0)).toBe(false);
    stale.assets.staleCount = 0;
    expect(storyAssetsStageHasStaleContent(stale, 2)).toBe(false);
  });
});

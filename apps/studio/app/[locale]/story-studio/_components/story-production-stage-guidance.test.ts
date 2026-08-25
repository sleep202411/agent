import { describe, expect, it } from "vitest";
import type { StoryProductionState, StoryProductionStatus } from "@/lib/story-production-api";
import {
  storyAssetsStageGuidance,
  storyAssetsStageHasStaleContent,
  storyStoryboardStageGuidance,
  storyStoryboardStageHasStaleContent,
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
  it("keeps Asset Specs independent of the later Plot Tree stage", () => {
    expect(storyAssetsStageGuidance(productionState({ plot: "missing" }), 0)).toBe("noAssets");
    expect(storyAssetsStageGuidance(productionState({ plot: "stale" }), 2)).toBeNull();
    expect(
      storyAssetsStageGuidance(productionState({ plot: "missing", assets: "missing" }), 0)
    ).toBe("assetsRequired");
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

  it("requires every current upstream stage before Storyboard", () => {
    expect(storyStoryboardStageGuidance(productionState({ plot: "stale" }), 2)).toBe(
      "plotRequired"
    );
    expect(storyStoryboardStageGuidance(productionState({ assets: "stale" }), 2)).toBe(
      "assetsRequired"
    );
    expect(storyStoryboardStageGuidance(productionState({ storyboard: "stale" }), 2)).toBe(
      "storyboardRequired"
    );
  });

  it("distinguishes a current empty Plot Tree from a missing Storyboard", () => {
    expect(storyStoryboardStageGuidance(productionState(), 0)).toBe("noScenes");
    expect(storyStoryboardStageGuidance(productionState(), 2)).toBeNull();
  });

  it("preserves stale Storyboard sequences only when a stale sequence exists", () => {
    const stale = productionState({ storyboard: "stale" });
    stale.storyboard.staleCount = 1;
    expect(storyStoryboardStageHasStaleContent(stale, 2)).toBe(true);
    expect(storyStoryboardStageHasStaleContent(stale, 0)).toBe(false);
    stale.storyboard.staleCount = 0;
    expect(storyStoryboardStageHasStaleContent(stale, 2)).toBe(false);
  });
});

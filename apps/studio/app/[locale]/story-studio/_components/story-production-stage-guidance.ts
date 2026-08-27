import type { StoryProductionState } from "@/lib/story-production-api";

export type StoryAssetsStageGuidance = "plotRequired" | "assetsRequired" | "noAssets" | null;
export type StoryStoryboardStageGuidance =
  | "plotRequired"
  | "assetsRequired"
  | "storyboardRequired"
  | "noScenes"
  | null;

/**
 * Derive page guidance exclusively from durable production state. These are
 * navigation hints, not workflow state and never stand in for Agent approval.
 */
export function storyAssetsStageGuidance(
  production: StoryProductionState,
  assetCount: number
): StoryAssetsStageGuidance {
  if (production.plotTree.status !== "current") return "plotRequired";
  if (production.assets.status !== "current") return "assetsRequired";
  if (assetCount === 0) return "noAssets";
  return null;
}

/**
 * A stale aggregate may contain creator-edited rows that only the explicit
 * conflict resolver can reconcile. Those rows must remain visible even though
 * the stage itself is not current and media generation is blocked.
 */
export function storyAssetsStageHasStaleContent(
  production: StoryProductionState,
  assetCount: number
): boolean {
  return production.assets.status === "stale" && production.assets.staleCount > 0 && assetCount > 0;
}

export function storyStoryboardStageGuidance(
  production: StoryProductionState,
  sceneCount: number
): StoryStoryboardStageGuidance {
  if (production.plotTree.status !== "current") return "plotRequired";
  if (production.assets.status !== "current") return "assetsRequired";
  if (production.storyboard.status !== "current") return "storyboardRequired";
  if (sceneCount === 0) return "noScenes";
  return null;
}

/** See storyAssetsStageHasStaleContent. Storyboard conflicts have the same UI invariant. */
export function storyStoryboardStageHasStaleContent(
  production: StoryProductionState,
  sequenceCount: number
): boolean {
  return (
    production.storyboard.status === "stale" &&
    production.storyboard.staleCount > 0 &&
    sequenceCount > 0
  );
}

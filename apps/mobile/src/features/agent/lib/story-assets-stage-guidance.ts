import type { StoryProductionState } from "@/features/agent/api/story-production-api";

export type StoryAssetsStageGuidance = "plotRequired" | "assetsRequired" | "noAssets" | null;

/** Mirror H5 `storyAssetsStageGuidance` — durable production state only. */
export function storyAssetsStageGuidance(
  production: StoryProductionState,
  assetCount: number
): StoryAssetsStageGuidance {
  if (production.plotTree.status !== "current") return "plotRequired";
  if (production.assets.status !== "current") return "assetsRequired";
  if (assetCount === 0) return "noAssets";
  return null;
}

/** Mirror H5 — stale aggregate with visible rows stays reviewable. */
export function storyAssetsStageHasStaleContent(
  production: StoryProductionState,
  assetCount: number
): boolean {
  return production.assets.status === "stale" && production.assets.staleCount > 0 && assetCount > 0;
}

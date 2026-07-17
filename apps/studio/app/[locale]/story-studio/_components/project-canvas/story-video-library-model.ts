import type { FilmClipSummary, StoryVideoLibraryItem } from "@/lib/story-projects-api";

export type StoryVideoLibraryIssue =
  | "preview_unavailable"
  | "dimensions_unknown"
  | "dimensions_mismatch"
  | "duration_unknown"
  | "duration_mismatch";

export interface StoryVideoLibraryItemState {
  current: boolean;
  selectable: boolean;
  technicallyCompatible: boolean;
  issues: StoryVideoLibraryIssue[];
}

type StoryVideoOutputContract = FilmClipSummary["outputContract"];

/**
 * Resolves selection eligibility from the exact variant metadata returned by
 * the library. The client mirrors the production contract so a creator cannot
 * deliberately bind a result that the build pipeline would reject.
 */
export function resolveStoryVideoLibraryItemState(
  item: StoryVideoLibraryItem,
  outputContract: StoryVideoOutputContract,
  current: { assetId: string; variantId: string } | null
): StoryVideoLibraryItemState {
  const issues: StoryVideoLibraryIssue[] = [];
  const width = item.width ?? item.asset.width;
  const height = item.height ?? item.asset.height;
  const durationSeconds = item.durationSeconds ?? item.asset.durationSeconds;

  if (!item.asset.previewUrl) issues.push("preview_unavailable");
  if (width === null || height === null) {
    issues.push("dimensions_unknown");
  } else if (width !== outputContract.width || height !== outputContract.height) {
    issues.push("dimensions_mismatch");
  }

  if (durationSeconds === null) {
    issues.push("duration_unknown");
  } else {
    const durationDeltaMs = Math.abs(durationSeconds * 1_000 - outputContract.durationMs);
    if (durationDeltaMs > Math.max(0, outputContract.durationToleranceMs)) {
      issues.push("duration_mismatch");
    }
  }

  const technicallyCompatible = !issues.some(
    (issue) =>
      issue === "dimensions_unknown" ||
      issue === "dimensions_mismatch" ||
      issue === "duration_unknown" ||
      issue === "duration_mismatch"
  );
  const selectionAvailable = !issues.includes("preview_unavailable");

  return {
    current: Boolean(
      current && current.assetId === item.asset.id && current.variantId === item.variantId
    ),
    selectable: technicallyCompatible && selectionAvailable,
    technicallyCompatible,
    issues,
  };
}

export function storyVideoLibraryItemKey(item: StoryVideoLibraryItem): string {
  return `${item.asset.id}:${item.variantId}`;
}

export function mergeStoryVideoLibraryItems(
  current: StoryVideoLibraryItem[],
  incoming: StoryVideoLibraryItem[]
): StoryVideoLibraryItem[] {
  const merged = new Map(current.map((item) => [storyVideoLibraryItemKey(item), item]));
  for (const item of incoming) merged.set(storyVideoLibraryItemKey(item), item);
  return [...merged.values()];
}

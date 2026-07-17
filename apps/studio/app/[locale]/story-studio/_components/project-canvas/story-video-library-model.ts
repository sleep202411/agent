import type { StoryVideoLibraryItem } from "@/lib/story-projects-api";

export type StoryVideoLibraryIssue =
  | "preview_unavailable"
  | "dimensions_unknown"
  | "dimensions_mismatch";

export interface StoryVideoLibraryItemState {
  current: boolean;
  selectable: boolean;
  technicallyCompatible: boolean;
  issues: StoryVideoLibraryIssue[];
}

export interface StoryVideoFrameContract {
  width: number;
  height: number;
}

/**
 * Existing videos keep their real duration. Selection only checks the fixed
 * project frame, while the server remains authoritative for asset readiness,
 * ownership, moderation, and exact variant metadata.
 */
export function resolveStoryVideoLibraryItemState(
  item: StoryVideoLibraryItem,
  frameContract: StoryVideoFrameContract,
  current: { assetId: string; variantId: string } | null
): StoryVideoLibraryItemState {
  const issues: StoryVideoLibraryIssue[] = [];
  const width = item.width ?? item.asset.width;
  const height = item.height ?? item.asset.height;

  if (!item.asset.previewUrl) issues.push("preview_unavailable");
  if (width === null || height === null) {
    issues.push("dimensions_unknown");
  } else if (width !== frameContract.width || height !== frameContract.height) {
    issues.push("dimensions_mismatch");
  }

  const technicallyCompatible = !issues.some(
    (issue) => issue === "dimensions_unknown" || issue === "dimensions_mismatch"
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

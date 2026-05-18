"use client";

/**
 * Draft asset marker — used by CharacterCard / SceneCard / PropCard to
 * flag entries that came from Step 2's LLM extraction but haven't been
 * committed to Java yet. The page page splats drafts into the same
 * `assets[kind]` list as committed rows; the only structural signal is
 * the synthetic `draft_*` id prefix. We surface that as:
 *
 *   - a yellow ring around the card edge (subtle, peripheral)
 *   - a "草稿" badge pinned to the thumbnail's top-right corner
 *   - a disabled image-generate button (assetId is fake until commit)
 *
 * Once the user clicks 保存继续 → step2/commit, Java assigns real ids
 * and the page reloads — the `draft_*` rows disappear, real rows take
 * their place, and the markers vanish naturally.
 */

import { IconSparkles } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { ProduceJavaAsset } from "@/src/lib/produce/java-produce-data";

/** True when an asset was synthesised client-side from a Step 2 draft. */
export function isDraftAsset(asset: { id: string }): boolean {
  return asset.id.startsWith("draft_");
}

/** className additions applied to the Card root for draft entries. */
export const draftCardClass = "ring-1 ring-amber-500/40 bg-amber-500/[0.02]";

/** Pinned-to-thumbnail-corner badge. Caller positions it absolutely. */
export function DraftBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none flex items-center gap-1 rounded-full bg-amber-500/95 px-1.5 py-0.5 text-[10px] font-medium text-amber-950 shadow",
        className
      )}
    >
      <IconSparkles className="size-2.5" />
      草稿
    </span>
  );
}

export type DraftAware = ProduceJavaAsset;

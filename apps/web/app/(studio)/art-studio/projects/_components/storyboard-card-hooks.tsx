"use client";

import { useCallback, useState, type ReactElement } from "react";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { persistValueList } from "@/app/(studio)/art-studio/projects/_components/storyboard/cells/cell-utils";
import { useStoryboardDialog } from "@/app/(studio)/art-studio/projects/_components/storyboard/storyboard-dialog-context";

/**
 * Atomic hooks for the storyboard card view's action row. Each hook owns
 * exactly one user action. Image/video picker hooks return both a trigger
 * and the rendered dialog element; AI-generate hooks only return a
 * trigger since those dialogs are already lifted to
 * `storyboard-dialog-context` (see storyboard-lifted-dialogs.tsx).
 *
 * Why hooks vs. direct dialog use:
 *   - callers don't need to know which dialog is used or where it's mounted
 *   - swap the dialog implementation without touching the action row
 *   - persist-on-select logic stays atomic per media type
 */

interface MediaCellTarget {
  shotId: string;
  shotColumnId: string;
}

interface AssetPickerHookResult {
  open: () => void;
  element: ReactElement;
}

/**
 * Opens the asset picker for images. On select, persists the chosen
 * paths to this shot's image cell (sets `values` + `files` metadata) and
 * posts to Java. Re-uses `persistValueList` from cell-utils, same save
 * path the table view uses — so switching views or opening the list view
 * right after a card-view select shows consistent state.
 */
export function useImageAssetPicker({
  shotId,
  shotColumnId,
}: MediaCellTarget): AssetPickerHookResult {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (paths: string[]) => {
      const cleaned = paths.filter(Boolean);
      void persistValueList(shotId, shotColumnId, cleaned, {
        files: cleaned.map((path) => ({ path })),
      });
    },
    [shotId, shotColumnId]
  );

  const element = (
    <AssetPickerDialog open={open} onOpenChange={setOpen} assetType="img" onSelect={handleSelect} />
  );

  return { open: () => setOpen(true), element };
}

/** Video asset picker — same shape as image but uploads as SHOT_VALUE_VIDEO. */
export function useVideoAssetPicker({
  shotId,
  shotColumnId,
}: MediaCellTarget): AssetPickerHookResult {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (paths: string[]) => {
      const cleaned = paths.filter(Boolean);
      void persistValueList(shotId, shotColumnId, cleaned, {
        files: cleaned.map((path) => ({ path })),
      });
    },
    [shotId, shotColumnId]
  );

  const element = (
    <AssetPickerDialog
      open={open}
      onOpenChange={setOpen}
      assetType="video"
      onSelect={handleSelect}
    />
  );

  return { open: () => setOpen(true), element };
}

/**
 * Thin wrapper over `openImageDialog` from the storyboard dialog context.
 * The AI image generator dialog is lifted and rendered once in
 * `storyboard-lifted-dialogs.tsx`; we only need to ask it to focus a
 * specific {shotId, shotColumnId} pair. Returned callback is stable.
 */
export function useAiImageTrigger({ shotId, shotColumnId }: MediaCellTarget): () => void {
  const { openImageDialog } = useStoryboardDialog();
  return useCallback(() => {
    openImageDialog(shotId, shotColumnId);
  }, [openImageDialog, shotId, shotColumnId]);
}

/** Same wrapper but for the lifted AI video generator dialog. */
export function useAiVideoTrigger({ shotId, shotColumnId }: MediaCellTarget): () => void {
  const { openVideoDialog } = useStoryboardDialog();
  return useCallback(() => {
    openVideoDialog(shotId, shotColumnId);
  }, [openVideoDialog, shotId, shotColumnId]);
}

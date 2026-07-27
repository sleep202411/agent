"use client";

import { useTranslations } from "next-intl";
import { modeLabel } from "./generation-api";

/**
 * Translated generation-mode label (e.g. `image_to_video` → 图生视频). Falls
 * back to the English `modeLabel()` for any mode not in the `modes` catalog,
 * so a newly-added mode degrades gracefully instead of showing a raw key.
 */
export function useModeLabel(): (mode: string) => string {
  const t = useTranslations("modes");
  return (mode: string) => (mode && t.has(mode) ? t(mode) : modeLabel(mode));
}

/**
 * Translated operation label for a node's `opType` (Upscale / Remove BG / …).
 * Returns undefined when there's no opType or no catalog entry, so the caller
 * can fall back to its own default title.
 */
export function useOperationLabel(): (opType: string | undefined) => string | undefined {
  const t = useTranslations("operations");
  return (opType) => (opType && t.has(opType) ? t(opType) : undefined);
}

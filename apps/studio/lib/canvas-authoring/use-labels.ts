"use client";

import { useTranslations } from "next-intl";
import { modeLabel } from "./generation-api";
import { isOmniTaskModeValue, splitOmniTaskModeValue } from "./omni-task-modes";

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
 * Translated Seedance 2.5 omni-reference task-type label (auto / reference /
 * edit / extend — the `omni_reference_task_type` values). Falls back to the
 * raw enum token when untranslated, same graceful-degradation contract as
 * {@link useModeLabel}.
 */
export function useOmniTaskTypeLabel(): (value: string) => string {
  const t = useTranslations("omniTaskTypes");
  return (value: string) => (value && t.has(value) ? t(value) : value);
}

/**
 * Mode label for composer pills/menus, aware of the UI-only omni sub-intent
 * entries (`multimodal_to_video::edit` → "Edit Video"). Pure resolution —
 * plain `multimodal_to_video` ALWAYS reads "Omni Reference", including inside
 * the menu while an edit/extend sub-intent is active. The pill shows the
 * sub-intent by feeding it `menuValueForMode(mode, taskType)` (the composite
 * value), never by relabeling the plain mode.
 */
export function useComposerModeLabel(): (mode: string) => string {
  const t = useTranslations("modes");
  const tl = useOmniTaskTypeLabel();
  return (mode: string) => {
    if (isOmniTaskModeValue(mode)) return tl(splitOmniTaskModeValue(mode).taskType);
    return mode && t.has(mode) ? t(mode) : modeLabel(mode);
  };
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

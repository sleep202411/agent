import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { ModelSettings } from "@/lib/canvas-authoring/generation-api";

export type ProductionModality = "image" | "video";

/** A committed model choice; null lets the server resolve the catalog default. */
export interface ProductionModelSelection {
  modelId: string;
  schemaVersion: string;
}

interface ModalitySettings {
  selection: ProductionModelSelection | null;
  options: ModelSettings;
}

/**
 * Page-level generation defaults chosen in the production-page header. Every
 * quick-generate on the assets and storyboard boards submits with the matching
 * modality's model + options; null selection defers to the server's catalog
 * default. View state only — the server remains the billing/validation
 * authority, per the state convention in apps/studio/AGENTS.md.
 */
interface StoryProductionSettingsState {
  image: ModalitySettings;
  video: ModalitySettings;
  setModel: (modality: ProductionModality, selection: ProductionModelSelection | null) => void;
  setOptions: (modality: ProductionModality, options: ModelSettings) => void;
}

const EMPTY: ModalitySettings = { selection: null, options: {} };

export const useStoryProductionSettingsStore = create<StoryProductionSettingsState>()(
  devtools(
    (set) => ({
      image: EMPTY,
      video: EMPTY,
      setModel: (modality, selection) =>
        // A model switch discards the previous model's options: option keys are
        // schema-specific and must never leak across models.
        set({ [modality]: { selection, options: {} } }, false, "setModel"),
      setOptions: (modality, options) =>
        set((state) => ({ [modality]: { ...state[modality], options } }), false, "setOptions"),
    }),
    { name: "story-production-settings" }
  )
);

/**
 * Options in the shape the Story generation command accepts: scalar or
 * scalar-array values only, undefined dropped. Prompt/reference/media keys
 * never appear here — schemaFields excludes them at the source, and the
 * server's options schema rejects them defensively.
 */
export function storyGenerationOptions(
  options: ModelSettings
): Record<string, boolean | number | string | Array<boolean | number | string>> {
  const out: Record<string, boolean | number | string | Array<boolean | number | string>> = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.every((item) => ["boolean", "number", "string"].includes(typeof item))) {
        out[key] = value as Array<boolean | number | string>;
      }
      continue;
    }
    if (["boolean", "number", "string"].includes(typeof value)) {
      out[key] = value as boolean | number | string;
    }
  }
  return out;
}

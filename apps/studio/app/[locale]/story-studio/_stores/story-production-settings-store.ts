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
 * Page-session generation overrides chosen in the production-page header.
 * Persisted project defaults live in AgentOsModelPreference and are resolved
 * directly by useStoryProductionGenerationDefaults; they are never copied into
 * this view store. Null therefore means "follow the cross-device default".
 */
interface StoryProductionSettingsState {
  byProject: Record<string, Record<ProductionModality, ModalitySettings>>;
  setModel: (
    projectId: string,
    modality: ProductionModality,
    selection: ProductionModelSelection | null
  ) => void;
  setOptions: (projectId: string, modality: ProductionModality, options: ModelSettings) => void;
}

export const EMPTY_PRODUCTION_MODALITY_SETTINGS: ModalitySettings = {
  selection: null,
  options: {},
};

function projectSettings(
  state: StoryProductionSettingsState,
  projectId: string
): Record<ProductionModality, ModalitySettings> {
  return (
    state.byProject[projectId] ?? {
      image: EMPTY_PRODUCTION_MODALITY_SETTINGS,
      video: EMPTY_PRODUCTION_MODALITY_SETTINGS,
    }
  );
}

export const useStoryProductionSettingsStore = create<StoryProductionSettingsState>()(
  devtools(
    (set) => ({
      byProject: {},
      setModel: (projectId, modality, selection) =>
        // A model switch discards the previous model's options: option keys are
        // schema-specific and must never leak across models.
        set(
          (state) => ({
            byProject: {
              ...state.byProject,
              [projectId]: {
                ...projectSettings(state, projectId),
                [modality]: { selection, options: {} },
              },
            },
          }),
          false,
          "setModel"
        ),
      setOptions: (projectId, modality, options) =>
        set(
          (state) => ({
            byProject: {
              ...state.byProject,
              [projectId]: {
                ...projectSettings(state, projectId),
                [modality]: {
                  ...projectSettings(state, projectId)[modality],
                  options,
                },
              },
            },
          }),
          false,
          "setOptions"
        ),
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

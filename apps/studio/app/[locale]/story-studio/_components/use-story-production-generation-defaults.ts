"use client";

import { useMemo } from "react";
import { useAgentOsModelPreferences } from "@/components/agent-os/use-agent-os-model-preferences";
import {
  defaultSettingsForModel,
  isOperationOnlyModel,
  type FizzAiModel,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import {
  EMPTY_PRODUCTION_MODALITY_SETTINGS,
  useStoryProductionSettingsStore,
  type ProductionModality,
  type ProductionModelSelection,
} from "../_stores/story-production-settings-store";

/**
 * Resolves a generation model without copying server preferences into a view
 * store. Priority is: explicit page-session override → persisted project
 * preference → first currently usable catalog model. This same resolver feeds
 * quick generation and detail dialogs, so every entry point agrees.
 */
export function useStoryProductionGenerationDefaults(
  projectId: string,
  modality: ProductionModality
): {
  models: FizzAiModel[];
  model: FizzAiModel | undefined;
  selection: ProductionModelSelection | null;
  options: ModelSettings;
  loading: boolean;
} {
  const catalog = useAiCatalog();
  const preferences = useAgentOsModelPreferences(projectId);
  const pageOverride = useStoryProductionSettingsStore(
    (state) => state.byProject[projectId]?.[modality] ?? EMPTY_PRODUCTION_MODALITY_SETTINGS
  );
  const models = useMemo(
    () =>
      usableModelsByModality(catalog.data, modality).filter(
        (model) => !isOperationOnlyModel(model) && !/hunyuan|panorama/i.test(model.id)
      ),
    [catalog.data, modality]
  );
  const preferenceId =
    modality === "image" ? preferences.data?.imageModelId : preferences.data?.videoModelId;
  const model =
    models.find((candidate) => candidate.id === pageOverride.selection?.modelId) ??
    models.find((candidate) => candidate.id === preferenceId) ??
    models[0];
  const selection = model ? { modelId: model.id, schemaVersion: model.schemaVersion } : null;
  const overrideApplies = pageOverride.selection?.modelId === model?.id;

  return {
    models,
    model,
    selection,
    options: overrideApplies ? pageOverride.options : defaultSettingsForModel(model),
    loading: catalog.isPending || preferences.isPending,
  };
}

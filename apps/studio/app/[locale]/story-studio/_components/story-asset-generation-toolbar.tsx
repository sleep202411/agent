"use client";

import { IconBolt } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { ComposerQuickSettings } from "@/components/canvas/authoring/composer-quick-settings";
import { ModelPicker } from "@/components/canvas/authoring/model-picker";
import {
  defaultSettingsForModel,
  estimateModelSellPoints,
  type FizzAiModel,
  hasSchemaProperty,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import type { ProductionModelSelection } from "../_stores/story-production-settings-store";
import { useStoryProductionGenerationDefaults } from "./use-story-production-generation-defaults";

interface StoryAssetGenerationSettings {
  selection: ProductionModelSelection | null;
  options: ModelSettings;
}

/**
 * One asset row owns its model choices. They start from the project default,
 * but changing a character never mutates the controls on another row.
 */
export function StoryAssetGenerationToolbar({
  projectId,
  prompt = "",
  children,
  requireImageReference = false,
  align = "left",
}: {
  projectId: string;
  prompt?: string;
  children: (settings: StoryAssetGenerationSettings) => React.ReactNode;
  requireImageReference?: boolean;
  align?: "left" | "right";
}) {
  const defaults = useStoryProductionGenerationDefaults(projectId, "image");
  const [override, setOverride] = useState<{
    modelId: string;
    options: ModelSettings;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const models = requireImageReference
    ? defaults.models.filter((candidate) => hasSchemaProperty(candidate, "referenceImages"))
    : defaults.models;
  const model =
    models.find((candidate) => candidate.id === override?.modelId) ??
    models.find((candidate) => candidate.id === defaults.model?.id) ??
    models[0];
  const options =
    override && override.modelId === model?.id
      ? override.options
      : model?.id === defaults.model?.id
        ? defaults.options
        : model
          ? defaultSettingsForModel(model)
          : defaults.options;
  const selection = model ? { modelId: model.id, schemaVersion: model.schemaVersion } : null;
  const estimatedPoints = model
    ? (estimateModelSellPoints(model, {
        text: prompt,
        numOutputs: Number(options.numOutputs ?? options.n ?? 1) || 1,
        resolution: options.resolution != null ? String(options.resolution) : undefined,
        quality: options.quality != null ? String(options.quality) : undefined,
        referenceImageCount: requireImageReference ? 1 : undefined,
      })?.sellPoints ?? null)
    : null;

  useEffect(() => {
    if (!pickerOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerOpen]);

  const chooseModel = (next: FizzAiModel) => {
    setOverride({ modelId: next.id, options: defaultSettingsForModel(next) });
    setPickerOpen(false);
  };

  const action = children({ selection, options });

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div ref={pickerRef} className="relative max-w-28 shrink-0">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="flex h-9 max-w-28 items-center text-xs text-white/78 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/35"
        >
          <span className="min-w-0 truncate">{model?.name ?? "…"}</span>
        </button>
        {pickerOpen ? (
          <ModelPicker
            catalog={{ models }}
            modality="image"
            selectedId={model?.id}
            placement="top"
            align={align}
            onSelect={chooseModel}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}
      </div>
      {model ? (
        <ComposerQuickSettings
          model={model}
          settings={options}
          onChange={(next) => setOverride({ modelId: model.id, options: next })}
          placement="above"
          align={align}
          appearance="plain"
          className="[&>button]:h-9 [&>button]:text-xs"
        />
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {estimatedPoints != null ? (
          <span className="flex items-center gap-1 text-xs tabular-nums text-white/68">
            <IconBolt className="size-4" stroke={1.8} aria-hidden="true" />
            {estimatedPoints}
          </span>
        ) : null}
        {action}
      </div>
    </div>
  );
}

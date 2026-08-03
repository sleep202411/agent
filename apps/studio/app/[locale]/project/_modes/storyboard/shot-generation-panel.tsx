"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import { useGeneration } from "@/lib/canvas-authoring/use-canvas-generation";
import {
  canvasDefaultMode,
  canvasDefaultModel,
  defaultSettingsForModel,
  estimateModelSellPoints,
  hasSchemaProperty,
  mergeCompatibleSettings,
  referenceFieldsForMode,
  type FizzAiModel,
} from "@/lib/canvas-authoring/generation-api";
import type { GenerationNodeData } from "@/components/canvas/authoring/generation-card";
import {
  GenerationPromptComposer,
  type GenerationPromptComposerPanel,
} from "@/app/[locale]/_components/generation/generation-prompt-composer";

/**
 * The generation controls for one picture source, inline in the storyboard
 * drawer.
 *
 * It edits the generation card wired into the shot — the same node, the same
 * fields, the same submit path as the canvas — so a run started from the table
 * is indistinguishable from one started on the board, and its output lands in
 * the shot's slot through the ordinary completion back-fill. This panel owns no
 * chrome: whatever surface hosts it draws the frame.
 */
export function ShotGenerationPanel({ nodeId }: { nodeId: string }) {
  const t = useTranslations("canvasOps");
  const { nodes, patchNodeData, canEdit } = useCanvasGraphContext();
  const { data: catalog } = useAiCatalog();
  const { submit, cancel, canSubmit, disabledReason } = useGeneration();
  const [panel, setPanel] = useState<GenerationPromptComposerPanel>(null);

  const node = nodes.find((candidate) => candidate.id === nodeId);
  const data = useMemo(() => (node?.data ?? {}) as GenerationNodeData, [node?.data]);
  const modality = node?.type === "video" ? "video" : "image";
  const model = useMemo(
    () => catalog?.models.find((candidate) => candidate.id === data.modelId),
    [catalog, data.modelId]
  );
  const settings = useMemo(() => data.settings ?? {}, [data.settings]);
  const mode = data.mode ?? canvasDefaultMode(model);
  const generation = data.generation;
  const busy =
    generation?.status === "submitting" ||
    generation?.status === "queued" ||
    generation?.status === "generating";

  // Same default-model rule as the card: a picture source is generation-ready
  // without forcing a pick. Idempotent, editor-only, converges across peers.
  useEffect(() => {
    if (!node || data.modelId || !canEdit || !catalog) return;
    const fallback =
      canvasDefaultModel(catalog, modality) ?? usableModelsByModality(catalog, modality)[0];
    if (!fallback) return;
    patchNodeData(nodeId, {
      modelId: fallback.id,
      modelName: fallback.name,
      mode: canvasDefaultMode(fallback),
      settings: defaultSettingsForModel(fallback),
    });
  }, [canEdit, catalog, data.modelId, modality, node, nodeId, patchNodeData]);

  const cost = useMemo(() => {
    if (!model) return null;
    const referenceCount = referenceFieldsForMode(model, mode).reduce(
      (count, field) => count + (data.references?.[field.field]?.length ?? 0),
      0
    );
    return (
      estimateModelSellPoints(model, {
        numOutputs: Number(settings.numOutputs ?? settings.n ?? 1) || 1,
        resolution: settings.resolution != null ? String(settings.resolution) : undefined,
        quality: settings.quality != null ? String(settings.quality) : undefined,
        duration: settings.duration != null ? String(settings.duration) : undefined,
        durationSeconds:
          typeof settings.durationSeconds === "number" ? settings.durationSeconds : undefined,
        referenceImageCount: referenceCount || undefined,
      })?.sellPoints ?? null
    );
  }, [data.references, mode, model, settings]);

  if (!node) return null;

  const onSelectModel = (selected: FizzAiModel) =>
    patchNodeData(nodeId, {
      modelId: selected.id,
      modelName: selected.name,
      mode: selected.generationModes?.some((candidate) => candidate === data.mode)
        ? data.mode
        : canvasDefaultMode(selected),
      settings: mergeCompatibleSettings(selected, settings),
    });

  return (
    <GenerationPromptComposer
      // The composer is a fixed 680px card on the canvas; in the drawer it runs
      // fluid (tailwind-merge lets the caller's width win).
      className="w-full rounded-2xl p-3"
      ariaLabel={t("generate")}
      modality={modality}
      catalog={catalog}
      model={model}
      modelFallbackLabel={data.modelName}
      onSelectModel={onSelectModel}
      prompt={data.prompt ?? ""}
      onPromptCommit={(prompt) => patchNodeData(nodeId, { prompt })}
      promptPlaceholder={t("promptPlaceholderDefault")}
      promptAriaLabel={t("promptPlaceholderDefault")}
      promptRows={3}
      showPrompt={!model || hasSchemaProperty(model, "prompt")}
      mode={mode}
      modes={model?.generationModes ?? []}
      onSelectMode={(nextMode) => patchNodeData(nodeId, { mode: nextMode })}
      settings={settings}
      onSettingsChange={(next) => patchNodeData(nodeId, { settings: next })}
      panel={panel}
      onPanelChange={setPanel}
      cost={cost}
      canSubmit={canEdit && canSubmit}
      submitting={busy}
      onSubmit={() => submit(nodeId)}
      onCancel={() => cancel(nodeId)}
      submitLabel={t("generate")}
      cancelLabel={t("cancelGeneration")}
      disabledReason={disabledReason}
    />
  );
}

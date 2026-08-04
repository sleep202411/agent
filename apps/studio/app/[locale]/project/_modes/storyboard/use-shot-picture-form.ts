"use client";

import { useCallback, useMemo, useState } from "react";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import { useGeneration } from "@/lib/canvas-authoring/use-canvas-generation";
import {
  canvasDefaultMode,
  canvasDefaultModel,
  defaultSettingsForModel,
  isTerminalGenerationStatus,
  mergeCompatibleSettings,
  type FizzAiModel,
  type GenerationState,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import type { GenerationNodeData } from "@/components/canvas/authoring/generation-card";
import type { ShotSlotKind } from "./storyboard-types";
import type { ShotPictureSeed, ShotRow } from "./use-storyboard";

export interface ShotPictureForm {
  model: FizzAiModel | undefined;
  mode: string | undefined;
  prompt: string;
  settings: ModelSettings;
  /** A run is in flight for this slot. */
  busy: boolean;
  canSubmit: boolean;
  disabledReason: string | null;
  setPrompt: (next: string) => void;
  selectModel: (model: FizzAiModel) => void;
  setSettings: (next: ModelSettings) => void;
  generate: () => void;
  cancel: () => void;
}

/**
 * The picture cell's form state, wherever it currently lives.
 *
 * A slot's values belong to the generation card wired into it — that card is
 * the shared, collaborative, undoable thing, and editing it here is the same
 * edit as editing it on the canvas. But a slot starts EMPTY, with no card to
 * write to, and creating one the moment a drawer opens would litter the board
 * with blank cards nobody asked for.
 *
 * So: bind to the card when there is one, keep a local draft when there isn't,
 * and let Generate be the moment the draft becomes a real card. The draft is
 * deliberately not persisted — until you commit, nothing exists.
 */
export function useShotPictureForm(
  row: ShotRow,
  slot: ShotSlotKind,
  createSource: (shotId: string, modality: ShotSlotKind, seed?: ShotPictureSeed) => string | null
): ShotPictureForm {
  const { nodes, patchNodeData } = useCanvasGraphContext();
  const { data: catalog } = useAiCatalog();
  const { submit, cancel, canSubmit, disabledReason } = useGeneration();

  // The card feeding this slot, if the picture came from a generation at all
  // (an uploaded or hand-picked one has no form to edit).
  const picture = row.pictures.find((candidate) => candidate.kind === slot);
  const nodeId = picture?.generationModality ? picture.sourceNodeId : null;
  const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : undefined;
  const bound = node?.data as GenerationNodeData | undefined;

  const [draft, setDraft] = useState<ShotPictureSeed>({});

  const fallbackModel = useMemo(() => canvasDefaultModel(catalog, slot), [catalog, slot]);
  const model = useMemo(() => {
    const id = bound?.modelId ?? draft.modelId;
    return (
      (id ? catalog?.models.find((candidate) => candidate.id === id) : undefined) ?? fallbackModel
    );
  }, [bound?.modelId, catalog, draft.modelId, fallbackModel]);

  const mode = bound?.mode ?? draft.mode ?? canvasDefaultMode(model);
  const prompt = bound?.prompt ?? draft.prompt ?? "";
  const settings = (bound?.settings ??
    draft.settings ??
    defaultSettingsForModel(model)) as ModelSettings;

  const generation: GenerationState | undefined = bound?.generation;
  const busy = Boolean(generation && !isTerminalGenerationStatus(generation.status));

  /** One write path: the card if it exists, the draft until it does. */
  const write = useCallback(
    (patch: ShotPictureSeed) => {
      if (nodeId) patchNodeData(nodeId, patch as Record<string, unknown>);
      else setDraft((current) => ({ ...current, ...patch }));
    },
    [nodeId, patchNodeData]
  );

  const setPrompt = useCallback((next: string) => write({ prompt: next }), [write]);
  const setSettings = useCallback((next: ModelSettings) => write({ settings: next }), [write]);

  const selectModel = useCallback(
    (next: FizzAiModel) => {
      if (nodeId) {
        // The card carries the model's NAME too, so it still reads correctly on
        // the canvas while the catalog is loading.
        patchNodeData(nodeId, {
          modelId: next.id,
          modelName: next.name,
          mode: next.generationModes?.some((candidate) => candidate === mode)
            ? mode
            : canvasDefaultMode(next),
          settings: mergeCompatibleSettings(next, settings),
        });
        return;
      }
      setDraft((current) => ({
        ...current,
        modelId: next.id,
        mode: next.generationModes?.some((candidate) => candidate === mode)
          ? mode
          : canvasDefaultMode(next),
        settings: mergeCompatibleSettings(next, settings),
      }));
    },
    [mode, nodeId, patchNodeData, settings]
  );

  const generate = useCallback(() => {
    if (nodeId) {
      submit(nodeId);
      return;
    }
    // First run for this slot: the draft becomes a real card, wired into the
    // shot, and that card is what runs.
    const created = createSource(row.id, slot, { prompt, modelId: model?.id, mode, settings });
    if (created) submit(created);
  }, [createSource, mode, model?.id, nodeId, prompt, row.id, settings, slot, submit]);

  const doCancel = useCallback(() => {
    if (nodeId) cancel(nodeId);
  }, [cancel, nodeId]);

  return {
    model,
    mode,
    prompt,
    settings,
    busy,
    canSubmit,
    disabledReason,
    setPrompt,
    selectModel,
    setSettings,
    generate,
    cancel: doCancel,
  };
}

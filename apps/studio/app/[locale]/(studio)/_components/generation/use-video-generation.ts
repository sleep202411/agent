"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  buildPromptDocument,
  compactFizzAiInput,
  defaultMode,
  defaultSettingsForModel,
  estimateModelSellPoints,
  filterFizzAiInput,
  referenceFieldsForMode,
  type FizzAiModel,
  type FizzAiReferenceBinding,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import { useGenerationFeed } from "./use-generation-feed";
import { useReferenceUploads, type ReferenceUpload } from "./use-reference-uploads";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";

/** Single-value frame fields (startFrame/endFrame) vs array reference fields. */
const SINGLE_FIELDS = new Set(["startFrame", "firstFrame", "endFrame", "lastFrame"]);

/** Default video mode: Omni Reference when the model offers it (web parity). */
function defaultVideoMode(model: FizzAiModel): string | undefined {
  return model.generationModes?.includes("multimodal_to_video")
    ? "multimodal_to_video"
    : defaultMode(model);
}

/** Stable key for the unmet-input reason, resolved to a message at render. */
type ModeInputReasonKey = "needStartImage" | "needFirstLastFrame" | "needVisualWithAudio";

/** Whether the active mode's required inputs are satisfied. */
function modeInputsSatisfied(
  mode: string | undefined,
  fields: { field: string }[],
  ready: ReferenceUpload[]
): { ok: boolean; reasonKey?: ModeInputReasonKey } {
  const has = (name: string) => ready.some((item) => item.field === name);
  if (mode === "image_to_video") {
    const field = fields[0]?.field;
    if (field && !has(field)) return { ok: false, reasonKey: "needStartImage" };
  }
  if (mode === "first_last_frame_to_video") {
    const missing = fields.filter((f) => !has(f.field));
    if (missing.length > 0) {
      return { ok: false, reasonKey: "needFirstLastFrame" };
    }
  }
  if (mode === "multimodal_to_video" && ready.length > 0) {
    const hasVisual = ready.some((item) => item.kind !== "audio");
    if (!hasVisual) return { ok: false, reasonKey: "needVisualWithAudio" };
  }
  return { ok: true };
}

/**
 * Video-generation controller: mode-driven (text / image / first-last-frame /
 * omni) generation state + wiring, decoupled from UI so it drives both the
 * /video studio and the home composer. Server-backed feed scoped by sourceSurface.
 */
export function useVideoGeneration() {
  const t = useTranslations("studioModes");
  const { data: catalog } = useAiCatalog();
  const feed = useGenerationFeed("video", "fizzstudio-video-studio");
  const { data: wallet } = useComputeWalletBalance();
  const uploads = useReferenceUploads();

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<FizzAiModel | undefined>(undefined);
  const [settings, setSettings] = useState<ModelSettings>({});
  const [mode, setMode] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (model || !catalog) return;
    const first = usableModelsByModality(catalog, "video")[0];
    if (!first) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setModel(first);
      setSettings(defaultSettingsForModel(first));
      setMode(defaultVideoMode(first));
    });
    return () => {
      cancelled = true;
    };
  }, [catalog, model]);

  const onSelectModel = (selected: FizzAiModel) => {
    setModel(selected);
    setSettings(defaultSettingsForModel(selected));
    // Keep the mode when the new model offers it; else fall back to default.
    setMode((current) =>
      current && selected.generationModes?.includes(current as never)
        ? current
        : defaultVideoMode(selected)
    );
  };

  const modes = model?.generationModes ?? [];
  const referenceFields = useMemo(() => referenceFieldsForMode(model, mode), [model, mode]);
  const activeFieldNames = useMemo(
    () => new Set(referenceFields.map((field) => field.field)),
    [referenceFields]
  );
  const activeUploads = useMemo(
    () => uploads.items.filter((item) => activeFieldNames.has(item.field)),
    [uploads.items, activeFieldNames]
  );
  const readyUploads = useMemo(() => activeUploads.filter((item) => item.url), [activeUploads]);

  const cost = useMemo(() => {
    if (!model) return null;
    const duration = settings.duration ?? settings.durationSeconds;
    const estimate = estimateModelSellPoints(model, {
      duration: typeof duration === "string" ? duration : undefined,
      durationSeconds: typeof duration === "number" ? duration : undefined,
      resolution: typeof settings.resolution === "string" ? settings.resolution : undefined,
      numOutputs: 1,
    });
    return estimate?.sellPoints ?? null;
  }, [model, settings]);

  const uploadsPending = activeUploads.some((item) => item.uploading);
  const inputsCheck = modeInputsSatisfied(mode, referenceFields, readyUploads);
  const canSubmit =
    Boolean(model && prompt.trim()) && !submitting && !uploadsPending && inputsCheck.ok;

  const submit = async (): Promise<{ ok: boolean }> => {
    if (!model || !canSubmit) return { ok: false };
    setSubmitting(true);
    setSubmitError(null);
    if (cost != null && wallet && wallet.available < BigInt(Math.ceil(cost))) {
      setSubmitError(t("error.insufficientCredits"));
      setSubmitting(false);
      return { ok: false };
    }

    // Map ready uploads into their schema fields: frames are single values,
    // reference sets are arrays; filterFizzAiInput drops undeclared fields.
    const referenceInput: Record<string, unknown> = {};
    for (const field of referenceFields) {
      const items = readyUploads.filter((item) => item.field === field.field);
      if (items.length === 0) continue;
      referenceInput[field.field] = SINGLE_FIELDS.has(field.field)
        ? { url: items[0].url!, assetId: items[0].mediaAssetId }
        : items.map((item) => ({
            url: item.url!,
            refId: item.id,
            assetId: item.mediaAssetId,
          }));
    }
    const bindings: FizzAiReferenceBinding[] = readyUploads.map((item, order) => ({
      refId: item.id,
      kind: item.kind,
      label: item.label,
      order,
      url: item.url,
      assetId: item.mediaAssetId,
    }));
    const input = compactFizzAiInput(
      filterFizzAiInput(model, { ...settings, ...referenceInput, prompt })
    );
    const result = await feed.submit({
      prompt,
      modelId: model.id,
      schemaVersion: model.schemaVersion,
      input,
      promptDocument: buildPromptDocument(prompt, bindings),
      referenceBindings: bindings.length ? bindings : undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error ?? t("error.generationFailed"));
      return { ok: false };
    }
    return { ok: true };
  };

  // Composer-facing error: a submit error, or the unmet mode-input hint.
  const error =
    submitError ??
    (!inputsCheck.ok && prompt.trim() && inputsCheck.reasonKey
      ? t(`video.modeInput.${inputsCheck.reasonKey}`)
      : null);

  return {
    catalog,
    feed,
    prompt,
    setPrompt,
    model,
    onSelectModel,
    settings,
    setSettings,
    mode,
    setMode,
    modes,
    referenceFields,
    activeUploads,
    uploads,
    cost,
    canSubmit,
    submitting,
    error,
    submit,
  };
}

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
  generationInputHasBlockingIssues,
  referenceFieldsForMode,
  validateModelGenerationInput,
  type FizzAiModel,
  type FizzAiReferenceBinding,
  type ModelSettings,
  type ValidationIssue,
} from "@/lib/canvas-authoring/generation-api";
import { formatValidationIssue } from "@/lib/canvas-authoring/format-validation-issue";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import { useGenerationFeed } from "./use-generation-feed";
import { useReferenceUploads } from "./use-reference-uploads";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";

/**
 * Image-generation controller: all the state + wiring for the image composer,
 * decoupled from any UI so it can drive both the /images studio (with feed) and
 * the home's bespoke rail+panel composer. The feed is server-backed and scoped
 * by sourceSurface, so a job submitted from the home shows up on /images.
 */
export function useImageGeneration() {
  const t = useTranslations("studioModes");
  const tv = useTranslations("generation");
  const { data: catalog } = useAiCatalog();
  const feed = useGenerationFeed("image", "fizzstudio-image-studio");
  const { data: wallet } = useComputeWalletBalance();
  const uploads = useReferenceUploads();

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<FizzAiModel | undefined>(undefined);
  const [settings, setSettings] = useState<ModelSettings>({});
  const [mode, setMode] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);

  // Auto-select the first usable model with its schema defaults.
  useEffect(() => {
    if (model || !catalog) return;
    const first = usableModelsByModality(catalog, "image")[0];
    if (!first) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setModel(first);
      setSettings(defaultSettingsForModel(first));
      setMode(defaultMode(first));
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
        : defaultMode(selected)
    );
  };

  const modes = model?.generationModes ?? [];
  // Reference uploads are gated by the active mode (image_to_image), matching
  // the explicit Text-to-Image / Image-to-Image toggle.
  const referenceFields = useMemo(() => referenceFieldsForMode(model, mode), [model, mode]);
  const activeFieldNames = useMemo(
    () => new Set(referenceFields.map((field) => field.field)),
    [referenceFields]
  );
  const activeUploads = useMemo(
    () => uploads.items.filter((item) => activeFieldNames.has(item.field)),
    [uploads.items, activeFieldNames]
  );

  const cost = useMemo(() => {
    if (!model) return null;
    const estimate = estimateModelSellPoints(model, {
      quality: typeof settings.quality === "string" ? settings.quality : undefined,
      resolution: typeof settings.resolution === "string" ? settings.resolution : undefined,
      numOutputs: typeof settings.numOutputs === "number" ? settings.numOutputs : 1,
      referenceImageCount: activeUploads.length,
    });
    return estimate?.sellPoints ?? null;
  }, [model, settings, activeUploads.length]);

  const uploadsPending = activeUploads.some((item) => item.uploading);
  const canSubmit = Boolean(model && prompt.trim()) && !submitting && !uploadsPending;

  const submit = async (): Promise<{ ok: boolean }> => {
    if (!model || !canSubmit) return { ok: false };
    setSubmitting(true);
    setSubmitError(null);
    setValidationIssues([]);
    if (cost != null && wallet && wallet.available < BigInt(Math.ceil(cost))) {
      setSubmitError(t("error.insufficientCredits"));
      setSubmitting(false);
      return { ok: false };
    }
    const ready = activeUploads.filter((item) => item.url);
    const bindings: FizzAiReferenceBinding[] = ready.map((item, order) => ({
      refId: item.id,
      kind: item.kind,
      label: item.label,
      order,
      url: item.url,
      assetId: item.mediaAssetId,
    }));
    const referenceInput =
      ready.length > 0
        ? {
            referenceImages: ready.map((item) => ({
              url: item.url!,
              refId: item.id,
              label: item.label,
              assetId: item.mediaAssetId,
              ...(typeof item.bytes === "number" ? { bytes: item.bytes } : {}),
            })),
          }
        : {};
    const input = compactFizzAiInput(
      filterFizzAiInput(model, { ...settings, ...referenceInput, prompt })
    );
    const preflight = validateModelGenerationInput(model, input);
    if (generationInputHasBlockingIssues(preflight)) {
      setValidationIssues(preflight);
      const first = preflight.find((issue) => issue.severity === "error");
      setSubmitError(first ? formatValidationIssue(tv, first) : t("error.generationFailed"));
      setSubmitting(false);
      return { ok: false };
    }
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
    submitError,
    validationIssues,
    clearValidation: () => {
      setValidationIssues([]);
      setSubmitError(null);
    },
    submit,
  };
}

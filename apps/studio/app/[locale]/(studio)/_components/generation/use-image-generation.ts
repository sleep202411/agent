"use client";

import { useComposerDraft } from "./use-composer-draft";
import { useComposerSubmission } from "./use-composer-submission";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  buildPromptDocument,
  buildReferenceInputForMode,
  buildPromptReferenceBindingsForMode,
  mediaSnapshotsForMode,
  ReferenceInputError,
  normalizeFizzAiError,
  compactFizzAiInput,
  defaultMode,
  defaultSettingsForModel,
  estimateModelSellPoints,
  filterFizzAiInput,
  generationInputHasBlockingIssues,
  referenceFieldsForMode,
  validateModelGenerationInput,
  type FizzAiModel,
  type ValidationIssue,
} from "@/lib/canvas-authoring/generation-api";
import { formatValidationIssue } from "@/lib/canvas-authoring/format-validation-issue";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import { useGenerationFeed } from "./use-generation-feed";
import { generationReferencesFromUploads, useReferenceUploads } from "./use-reference-uploads";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";

/**
 * Image-generation controller: all the state + wiring for the image composer,
 * decoupled from any UI so it can drive both the /images studio (with feed) and
 * the home's bespoke rail+panel composer. The feed is server-backed and scoped
 * by sourceSurface, so a job submitted from the home shows up on /images.
 */
export function useImageGeneration() {
  return useStudioGeneration("image");
}

export function useAudioGeneration() {
  return useStudioGeneration("audio");
}

function useStudioGeneration(modality: "image" | "audio") {
  const t = useTranslations("studioModes");
  const tv = useTranslations("generation");
  const tc = useTranslations("canvasOps");
  const { data: catalog } = useAiCatalog();
  const feed = useGenerationFeed(modality, `fizzstudio-${modality}-studio`);
  const { data: wallet } = useComputeWalletBalance();
  const uploads = useReferenceUploads(modality);

  const draft = useComposerDraft(modality);
  const { prompt, setPrompt, setSettings, setMode } = draft;
  const models = usableModelsByModality(catalog, modality);
  const model = models.find((entry) => entry.id === draft.modelId) ?? models[0];
  const matchesModel = model?.id === draft.modelId;
  const settings = useMemo(
    () =>
      matchesModel && draft.settings ? draft.settings : model ? defaultSettingsForModel(model) : {},
    [matchesModel, draft.settings, model]
  );
  const mode =
    matchesModel && draft.mode && model?.generationModes?.includes(draft.mode as never)
      ? draft.mode
      : model
        ? defaultMode(model)
        : undefined;
  const operation = useComposerSubmission();
  const { submitting } = operation;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);

  const onSelectModel = (selected: FizzAiModel) => {
    draft.setModelId(selected.id);
    setSettings(defaultSettingsForModel(selected));
    setMode(
      mode && selected.generationModes?.includes(mode as never) ? mode : defaultMode(selected)
    );
  };

  // Store the model identity alongside edits to defaults so both surfaces agree.
  const updateSettings = (next: typeof settings) => {
    if (model) draft.setModelId(model.id);
    setSettings(next);
  };
  const updateMode = (next: string) => {
    if (model) {
      draft.setModelId(model.id);
      setSettings(settings);
    }
    setMode(next);
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
      durationSeconds:
        typeof settings.durationSeconds === "number"
          ? settings.durationSeconds
          : typeof settings.duration === "number"
            ? settings.duration
            : undefined,
      duration: typeof settings.duration === "string" ? settings.duration : undefined,
      quality: typeof settings.quality === "string" ? settings.quality : undefined,
      resolution: typeof settings.resolution === "string" ? settings.resolution : undefined,
      numOutputs: typeof settings.numOutputs === "number" ? settings.numOutputs : 1,
      text: prompt,
      referenceImageCount: activeUploads.filter((item) => item.kind === "image").length,
    });
    return estimate?.sellPoints ?? null;
  }, [model, settings, activeUploads, prompt]);

  const uploadsPending = activeUploads.some((item) => item.uploading);
  const canSubmit =
    Boolean(model && prompt.trim()) &&
    !submitting &&
    !feed.submissionRecovery?.pending &&
    !uploadsPending;

  const submit = async (): Promise<{ ok: boolean }> => {
    if (!model || !canSubmit) return { ok: false };
    const run = operation.start();
    if (!run) return { ok: false };
    setSubmitError(null);
    setValidationIssues([]);
    if (cost != null && wallet && wallet.available < BigInt(Math.ceil(cost))) {
      setSubmitError(t("error.insufficientCredits"));
      operation.finish(run);
      return { ok: false };
    }
    try {
      const references = generationReferencesFromUploads(activeUploads);
      const referenceInput = buildReferenceInputForMode(model, mode, references);
      const bindings = buildPromptReferenceBindingsForMode(model, mode, references);
      const media = mediaSnapshotsForMode(model, mode, references);
      const input = compactFizzAiInput(
        filterFizzAiInput(model, { ...settings, ...referenceInput, prompt })
      );
      const preflight = validateModelGenerationInput(model, input, media);
      if (generationInputHasBlockingIssues(preflight)) {
        setValidationIssues(preflight);
        const first = preflight.find((issue) => issue.severity === "error");
        setSubmitError(first ? formatValidationIssue(tv, first) : t("error.generationFailed"));
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
      if (!operation.isCurrent(run)) return { ok: false };
      if (!result.ok) {
        setSubmitError(result.error ?? t("error.generationFailed"));
        return { ok: false };
      }
      return { ok: true };
    } catch (error) {
      if (!operation.isCurrent(run)) return { ok: false };
      setSubmitError(
        error instanceof ReferenceInputError
          ? tc(error.messageKey)
          : normalizeFizzAiError(error, t("error.generationFailed"))
      );
      return { ok: false };
    } finally {
      operation.finish(run);
    }
  };

  return {
    catalog,
    feed,
    prompt,
    setPrompt,
    model,
    onSelectModel,
    settings,
    setSettings: updateSettings,
    mode,
    setMode: updateMode,
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

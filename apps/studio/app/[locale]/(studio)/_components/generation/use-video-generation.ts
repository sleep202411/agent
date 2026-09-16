"use client";

import { useComposerSubmission } from "./use-composer-submission";
import { useEffect, useMemo, useState } from "react";
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
  type ModelSettings,
  type ValidationIssue,
} from "@/lib/canvas-authoring/generation-api";
import { formatValidationIssue } from "@/lib/canvas-authoring/format-validation-issue";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import { useGenerationFeed } from "./use-generation-feed";
import {
  generationReferencesFromUploads,
  useReferenceUploads,
  type ReferenceUpload,
} from "./use-reference-uploads";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";

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
  fields: { field: string; kind?: string; audioRequiresVisual?: boolean }[],
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
  if (
    mode === "multimodal_to_video" &&
    ready.length > 0 &&
    fields.some((field) => field.kind === "audio" && field.audioRequiresVisual)
  ) {
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
  const tv = useTranslations("generation");
  const tc = useTranslations("canvasOps");
  const { data: catalog } = useAiCatalog();
  const feed = useGenerationFeed("video", "fizzstudio-video-studio");
  const { data: wallet } = useComputeWalletBalance();
  const uploads = useReferenceUploads();

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<FizzAiModel | undefined>(undefined);
  const [settings, setSettings] = useState<ModelSettings>({});
  const [mode, setMode] = useState<string | undefined>(undefined);
  const operation = useComposerSubmission();
  const { submitting } = operation;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);

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
      generateAudio:
        typeof settings.generateAudio === "boolean" ? settings.generateAudio : undefined,
      numOutputs: 1,
      referenceImageCount: readyUploads.filter((item) => item.kind === "image").length || undefined,
      referenceVideoSeconds:
        readyUploads
          .filter((item) => item.kind === "video")
          .reduce(
            (seconds, item) =>
              seconds +
              (typeof item.durationSeconds === "number" && Number.isFinite(item.durationSeconds)
                ? item.durationSeconds
                : 0),
            0
          ) || undefined,
      // Seedance 2.5 edit keeps the source video's duration — the auto quote
      // follows the combined reference-video length (mirrors the server hold).
      outputDurationFollowsReferenceVideos: settings.omniReferenceTaskType === "edit",
    });
    return estimate?.sellPoints ?? null;
  }, [model, readyUploads, settings]);

  const uploadsPending = activeUploads.some((item) => item.uploading);
  const inputsCheck = modeInputsSatisfied(mode, referenceFields, readyUploads);
  const canSubmit =
    Boolean(model && (prompt.trim() || readyUploads.length > 0)) &&
    !submitting &&
    !uploadsPending &&
    inputsCheck.ok;

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
      // Catalog-driven preflight (same kernel as canvas + server). No model ifs.
      const preflight = validateModelGenerationInput(model, input, media);
      if (generationInputHasBlockingIssues(preflight)) {
        setValidationIssues(preflight);
        const first = preflight.find((issue) => issue.severity === "error");
        setSubmitError(first ? formatValidationIssue(tv, first) : t("error.generationFailed"));
        return { ok: false };
      }
      setValidationIssues([]);
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
    validationIssues,
    clearValidation: () => {
      setValidationIssues([]);
      setSubmitError(null);
    },
    submit,
  };
}

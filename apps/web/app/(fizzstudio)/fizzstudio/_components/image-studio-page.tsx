"use client";

import { useCurrentUser } from "@/src/hooks/use-user";
import {
  useGenerationSubmission,
  UncertainGenerationSubmissionError,
} from "../../_hooks/use-generation-submission";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconClock,
  IconDownload,
  IconLoader2,
} from "@tabler/icons-react";
import type { AiJobUpdatePayload, AssetEvent } from "@repo/shared";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import { useAppDispatch } from "@/src/store";
import { touchCredits } from "@/src/store/slices/userSlice";
import {
  useAiCatalog,
  usableModelsByModality,
  type StudioModality,
} from "../../_hooks/use-ai-catalog";
import { computeBillingKeys } from "../../_hooks/use-billing";
import {
  buildPromptDocument,
  compactFizzAiInput,
  defaultSettingsForModel,
  errorMessageFromJob,
  estimateModelSellPoints,
  filterFizzAiInput,
  generationIdempotencyKey,
  generationStatusFromRaw,
  getFizzAiJob,
  isTerminalGenerationStatus,
  listFizzAiJobs,
  maxReferenceImages,
  normalizeFizzAiError,
  retryFizzAiJob,
  type FizzAiGenerationStatus,
  type FizzAiJobView,
  type FizzAiModel,
  type FizzAiReferenceBinding,
  type FizzAiSubmitResponse,
  type ModelSettings,
} from "../../_lib/generation-api";
import { openAssetsRealtime } from "../../_lib/assets-realtime";
import { FizzStudioShell, useFizzStudioWorkspace } from "./fizzstudio-shell";
import { getModelLabel, modelById } from "./model-settings-panel";
import { StudioComposer, type StudioReferenceImage } from "./studio-composer";
import { StudioResultLightbox, type StudioResultLightboxItem } from "./studio-result-lightbox";

type ImageStudioTab = "history" | "community";

const IMAGE_STUDIO_TABS: ImageStudioTab[] = ["history", "community"];

const POLL_INTERVAL_MS = 2200;
const HISTORY_LIMIT = 60;

type ImageStudioT = ReturnType<typeof useTranslations>;

/** Local row tracking one submitted job through its lifecycle. */
interface ResultJob {
  localId: string;
  jobId: string;
  modelId?: string;
  schemaVersion?: string;
  prompt: string;
  input?: Record<string, unknown>;
  status: FizzAiGenerationStatus;
  stage: string;
  progress: number | null;
  queuePosition: number | null;
  estimatedWaitSeconds: number | null;
  estimatedRunSeconds: number | null;
  estimatedTotalSeconds: number | null;
  etaConfidence: "high" | "low" | "medium";
  images: Array<{ height?: number | null; id: string; url: string; width?: number | null }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  error?: string;
}

type ReferenceImage = StudioReferenceImage;

export const IMAGE_FEED = [
  {
    key: "dogPortrait",
    imageUrl:
      "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[1.02]",
    objectPosition: "center",
  },
  {
    key: "catInterior",
    imageUrl:
      "https://images.unsplash.com/photo-1574158622682-e40e69881006?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.42]",
    objectPosition: "center 42%",
  },
  {
    key: "sunlitCat",
    imageUrl:
      "https://images.unsplash.com/photo-1518791841217-8f162f1e1131?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[1.12]",
    objectPosition: "center",
  },
  {
    key: "botanical",
    imageUrl:
      "https://images.unsplash.com/photo-1463320726281-696a485928c7?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[0.8]",
    objectPosition: "center",
  },
  {
    key: "glassOrb",
    imageUrl:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=85&w=1100&auto=format&fit=crop",
    className: "aspect-[1.35]",
    objectPosition: "center",
  },
  {
    key: "productLight",
    imageUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.15]",
    objectPosition: "center",
  },
  {
    key: "portraitFashion",
    imageUrl:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[0.72]",
    objectPosition: "center 36%",
  },
  {
    key: "warmRoom",
    imageUrl:
      "https://images.unsplash.com/photo-1513694203232-719a280e022f?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.48]",
    objectPosition: "center",
  },
  {
    key: "neonAbstract",
    imageUrl:
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.08]",
    objectPosition: "center",
  },
  {
    key: "mountain",
    imageUrl:
      "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?q=85&w=1100&auto=format&fit=crop",
    className: "aspect-[1.62]",
    objectPosition: "center",
  },
  {
    key: "studioFood",
    imageUrl:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.2]",
    objectPosition: "center",
  },
  {
    key: "cinematicRoad",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.35]",
    objectPosition: "center 42%",
  },
];

export function ImageStudioPage({
  modality = "image",
}: {
  modality?: StudioModality;
} = {}) {
  const workspaceState = useFizzStudioWorkspace();
  const { user } = useCurrentUser();

  return (
    <FizzStudioShell
      className="overflow-x-hidden bg-[#09090a]"
      headerVariant="enterprise"
      mainClassName="max-w-none px-0 pt-0"
      sidebarVariant="enterprise"
      workspaceState={workspaceState}
    >
      <ImageStudioSurface
        key={JSON.stringify([user?.id, workspaceState.workspaceId])}
        modality={modality}
        workspaceId={workspaceState.workspaceId}
      />
    </FizzStudioShell>
  );
}

function ImageStudioSurface({
  workspaceId,
  modality,
}: {
  workspaceId: string;
  modality: StudioModality;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const catalogQuery = useAiCatalog();

  const [activeTab, setActiveTab] = useState<ImageStudioTab>("community");
  const [modelId, setModelId] = useState("");
  const [settings, setSettings] = useState<ModelSettings>({});
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [referenceUploadError, setReferenceUploadError] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [jobs, setJobs] = useState<ResultJob[]>([]);
  const {
    submit: submitGeneration,
    isCurrent: submissionIsCurrent,
    ready: submissionReady,
    recovery,
  } = useGenerationSubmission({
    workspaceId,
    surface: "fizzstudio-image-studio",
    onRecovered: (job, receipt) => {
      setJobs((previous) =>
        mergeResultJob(
          previous.filter((row) => row.localId !== receipt.target.localId),
          jobViewToResultJob(job, t)
        )
      );
      setSubmitError(null);
      setActiveTab("history");
      dispatch(touchCredits());
      void queryClient.invalidateQueries({ queryKey: computeBillingKeys.all });
    },
  });

  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const historyRequestSeqRef = useRef(0);

  const imageModels = useMemo(
    () => (catalogQuery.data?.models ?? []).filter((model) => model.type === modality),
    [catalogQuery.data, modality]
  );

  // Seed the default model + its schema defaults once the catalog resolves.
  useEffect(() => {
    if (modelId || !catalogQuery.data) return;
    const usable = usableModelsByModality(catalogQuery.data, modality);
    const first = usable[0];
    if (!first) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setModelId(first.id);
      setSettings(defaultSettingsForModel(first));
    });
    return () => {
      cancelled = true;
    };
  }, [catalogQuery.data, modelId, modality]);

  const selectedModel = useMemo<FizzAiModel | undefined>(
    () => modelById(imageModels, modelId),
    [imageModels, modelId]
  );
  const referenceLimit = maxReferenceImages(selectedModel);
  const supportsReferences = referenceLimit > 0;
  const chargeableReferenceCount = supportsReferences
    ? referenceImages.filter((image) => !image.error).length
    : 0;

  // Cost params read directly off the flat settings bag (schema property names).
  const variationsValue = numericSetting(settings.numOutputs, 1);
  const qualityValue = stringSetting(settings.quality);
  const resolutionValue = stringSetting(settings.resolution);

  // Switching models resets the settings bag to the new model's schema defaults
  // and trims the reference list to the new model's limit.
  const selectModel = useCallback(
    (id: string) => {
      const model = modelById(imageModels, id);
      const nextLimit = maxReferenceImages(model);
      setReferenceImages((prev) => (prev.length > nextLimit ? prev.slice(0, nextLimit) : prev));
      setModelId(id);
      setSettings(defaultSettingsForModel(model));
    },
    [imageModels]
  );

  useEffect(() => {
    if (referenceImages.length <= referenceLimit) return;
    setReferenceImages((prev) => prev.slice(0, referenceLimit));
  }, [referenceImages.length, referenceLimit]);

  // Live 积分 price for the selected model + output count. Recomputes on model
  // switch and count change; null when the model carries no real pricing.
  const priceEstimate = useMemo(
    () =>
      estimateModelSellPoints(selectedModel, {
        numOutputs: variationsValue,
        quality: qualityValue,
        referenceImageCount: chargeableReferenceCount,
        resolution: resolutionValue,
      }),
    [selectedModel, variationsValue, qualityValue, resolutionValue, chargeableReferenceCount]
  );

  const activeJobIds = useMemo(
    () =>
      jobs
        .filter((job) => job.jobId && !isTerminalGenerationStatus(job.status))
        .map((job) => job.jobId),
    [jobs]
  );
  const activeJobKey = useMemo(() => [...activeJobIds].sort().join("|"), [activeJobIds]);
  const hasUploadingReferences = referenceImages.some((image) => image.uploading);
  const detailItems = useMemo(() => flattenResultImageItems(jobs), [jobs]);
  // Same props/data the inline overlay consumed, mapped into the shared
  // lightbox item shape (kind drives the media element + metadata rows).
  const lightboxItems = useMemo<StudioResultLightboxItem[]>(
    () =>
      detailItems.map((item) => ({
        id: item.id,
        kind: "image" as const,
        url: item.image.url,
        prompt: item.job.prompt,
        createdAt: item.job.completedAt ?? item.job.createdAt,
        modelLabel:
          item.job.modelId && imageModels.length > 0
            ? getModelLabel(imageModels, item.job.modelId)
            : (item.job.modelId ?? t("detail.modelFallback")),
        width: item.image.width,
        height: item.image.height,
        fallbackRatio: aspectRatioForImage(item.job, item.image),
      })),
    [detailItems, imageModels, t]
  );
  const hasSelectedDetail =
    selectedDetailId != null && lightboxItems.some((item) => item.id === selectedDetailId);
  const refreshComputeBilling = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: computeBillingKeys.all });
  }, [queryClient]);

  const mergeJob = useCallback((job: ResultJob) => {
    setJobs((prev) => mergeResultJob(prev, job));
  }, []);

  const reconcileHistory = useCallback(
    async (mode: "merge" | "replace" = "merge") => {
      const requestWorkspaceId = workspaceId;
      const requestSeq = ++historyRequestSeqRef.current;
      // Audio runs on the separate Java voice service, not the catalog/job
      // system, so there is no job history to reconcile for it yet.
      if (!requestWorkspaceId || modality === "audio") {
        setJobs([]);
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(true);
      try {
        const response = await listFizzAiJobs({
          limit: HISTORY_LIMIT,
          sourceSurface: "fizzstudio-image-studio",
          type: modality,
        });
        if (historyRequestSeqRef.current !== requestSeq) return;
        const incoming = response.jobs.map((job) => jobViewToResultJob(job, t));
        setJobs((prev) => mergeResultJobs(incoming, mode === "replace" ? [] : prev));
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[fizzstudio-images] history reconcile failed", err);
        }
      } finally {
        if (historyRequestSeqRef.current === requestSeq) setHistoryLoading(false);
      }
    },
    [t, workspaceId, modality]
  );

  useEffect(() => {
    historyRequestSeqRef.current += 1;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setJobs([]);
      setSelectedDetailId(null);
      if (!workspaceId) {
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(true);
      void reconcileHistory("replace");
    });
    return () => {
      cancelled = true;
    };
  }, [reconcileHistory, workspaceId]);

  const handleAssetEvent = useCallback(
    (event: AssetEvent) => {
      if (event.kind !== "ai_job_update") return;
      const job = event.job;
      if (job.type !== modality) return;
      if (job.sourceSurface !== "fizzstudio-image-studio") return;
      mergeJob(jobUpdateToResultJob(job, t));
      if (isTerminalGenerationStatus(generationStatusFromRaw(job.status))) {
        dispatch(touchCredits());
        refreshComputeBilling();
      }
    },
    [dispatch, mergeJob, modality, refreshComputeBilling, t]
  );

  useEffect(() => {
    if (!workspaceId) return;
    let hasConnectedBefore = false;
    const client = openAssetsRealtime(
      {
        onConnected: () => {
          if (hasConnectedBefore) void reconcileHistory();
          hasConnectedBefore = true;
        },
        onEvent: handleAssetEvent,
        onDisconnected: (reason) => {
          if (process.env.NODE_ENV !== "production") {
            console.log(`[fizzstudio-assets-realtime] disconnected: ${reason}`);
          }
        },
      },
      { workspaceId }
    );
    return () => client.close();
  }, [handleAssetEvent, reconcileHistory, workspaceId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcileHistory();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reconcileHistory]);

  // Poll all in-flight jobs on a fixed cadence until each reaches a terminal state.
  const pollInFlightRef = useRef(false);
  useEffect(() => {
    if (activeJobIds.length === 0) return;
    let cancelled = false;

    const poll = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const results = await Promise.allSettled(activeJobIds.map((jobId) => getFizzAiJob(jobId)));
        if (cancelled) return;

        const byId = new Map<string, FizzAiJobView>();
        for (const result of results) {
          if (result.status === "fulfilled") byId.set(result.value.id, result.value);
        }

        let anyTerminal = false;
        setJobs((prev) =>
          prev.map((row) => {
            const job = byId.get(row.jobId);
            if (!job) return row;
            const status = generationStatusFromRaw(job.status);
            if (isTerminalGenerationStatus(status)) anyTerminal = true;
            return {
              ...row,
              status,
              stage: job.stage,
              progress: job.progress ?? null,
              queuePosition: job.queuePosition ?? null,
              estimatedWaitSeconds: job.estimatedWaitSeconds ?? null,
              estimatedRunSeconds: job.estimatedRunSeconds ?? null,
              estimatedTotalSeconds: job.estimatedTotalSeconds ?? null,
              etaConfidence: job.etaConfidence ?? "low",
              images: resultImages(job.outputs),
              updatedAt: job.updatedAt,
              completedAt: job.completedAt ?? null,
              error:
                status === "failed" || status === "cancelled"
                  ? errorMessageFromJob(job, t("results.failed"))
                  : undefined,
            };
          })
        );
        if (anyTerminal) {
          if (!submissionIsCurrent()) return;
          dispatch(touchCredits());
          refreshComputeBilling();
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // activeJobKey collapses the id list into a stable dep so the interval only
    // resets when the set of in-flight jobs actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobKey, dispatch, refreshComputeBilling, t]);

  const submit = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (
      !submissionReady ||
      !trimmedPrompt ||
      !selectedModel ||
      submitting ||
      recovery.pending ||
      hasUploadingReferences
    )
      return;

    setSubmitting(true);
    setSubmitError(null);
    setActiveTab("history");
    const localId = generationIdempotencyKey("local");
    const now = new Date().toISOString();
    const estimatedRunSeconds = optimisticRunSeconds(settings);
    const validReferenceImages = supportsReferences
      ? referenceImages.filter((image) => image.url && !image.error)
      : [];
    const referenceBindings = buildReferenceBindings(validReferenceImages, (index) =>
      t("referenceMention.label", { number: index + 1 })
    );
    const promptDocument = buildPromptDocument(trimmedPrompt, referenceBindings);
    const input = filterFizzAiInput(
      selectedModel,
      buildImageInput(settings, trimmedPrompt, validReferenceImages, referenceBindings)
    );

    setJobs((prev) => [
      {
        localId,
        jobId: "",
        modelId: selectedModel.id,
        schemaVersion: selectedModel.schemaVersion,
        prompt: trimmedPrompt,
        input,
        status: "queued",
        stage: "submitting",
        progress: null,
        queuePosition: null,
        estimatedWaitSeconds: null,
        estimatedRunSeconds,
        estimatedTotalSeconds: estimatedRunSeconds,
        etaConfidence: "low",
        images: [],
        createdAt: now,
        updatedAt: now,
      },
      ...prev,
    ]);

    try {
      const response = await submitGeneration(
        {
          context: {
            workspaceId,
            projectId: "",
            documentId: "",
            documentBlockId: "",
            sourceSurface: "fizzstudio-image-studio",
          },
          idempotencyKey: generationIdempotencyKey(`fizzstudio:image-studio:${workspaceId}`),
          input,
          promptDocument,
          referenceBindings,
          modelId: selectedModel.id,
          schemaVersion: selectedModel.schemaVersion,
        },
        "image",
        { localId: localId }
      );
      if (!submissionIsCurrent()) return;
      dispatch(touchCredits());
      refreshComputeBilling();
      const status = generationStatusFromRaw(response.status);
      setJobs((prev) =>
        prev.map((row) =>
          row.localId === localId
            ? {
                ...row,
                jobId: response.request_id,
                status: status === "done" ? "generating" : status,
                stage: response.stage,
                progress: response.progress,
                queuePosition: response.queue_position,
                estimatedWaitSeconds: response.estimated_wait_seconds,
                estimatedRunSeconds: response.estimated_run_seconds,
                estimatedTotalSeconds: response.estimated_total_seconds,
                etaConfidence: response.eta_confidence,
                updatedAt: new Date().toISOString(),
              }
            : row
        )
      );
    } catch (error) {
      if (!submissionIsCurrent()) return;
      const message = normalizeFizzAiError(error, t("results.failed"));
      setSubmitError(message);
      setJobs((prev) =>
        prev.map((row) =>
          row.localId === localId
            ? {
                ...row,
                status: error instanceof UncertainGenerationSubmissionError ? "queued" : "failed",
                stage:
                  error instanceof UncertainGenerationSubmissionError
                    ? "submission_unconfirmed"
                    : "failed",
                error: message,
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : row
        )
      );
    } finally {
      if (submissionIsCurrent()) setSubmitting(false);
    }
  }, [
    submitGeneration,
    submissionIsCurrent,
    submissionReady,
    recovery.pending,
    dispatch,
    refreshComputeBilling,
    hasUploadingReferences,
    prompt,
    referenceImages,
    selectedModel,
    settings,
    submitting,
    supportsReferences,
    t,
    workspaceId,
  ]);

  const uploadReferenceImages = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || referenceLimit <= 0) return;
      setReferenceUploadError(null);
      const remaining = Math.max(0, referenceLimit - referenceImages.length);
      const selected = Array.from(files).slice(0, remaining);
      if (selected.length === 0) return;

      for (const file of selected) {
        const id = generationIdempotencyKey("ref");
        setReferenceImages((prev) => [
          ...prev,
          { id, name: file.name, progress: 0, uploading: true },
        ]);
        try {
          const uploaded = await uploadFileViaSignedUrl(file, {
            kind: "ai_reference_image",
            onProgress: (progress) => {
              setReferenceImages((prev) =>
                prev.map((image) => (image.id === id ? { ...image, progress } : image))
              );
            },
          });
          setReferenceImages((prev) =>
            prev.map((image) =>
              image.id === id
                ? {
                    ...image,
                    assetId: uploaded.mediaAssetId,
                    progress: 100,
                    uploading: false,
                    url: uploaded.url,
                  }
                : image
            )
          );
        } catch (error) {
          if (isUploadAbort(error)) {
            setReferenceImages((prev) => prev.filter((image) => image.id !== id));
            continue;
          }
          const message = normalizeFizzAiError(error, t("referenceUpload.failed"));
          setReferenceUploadError(message);
          setReferenceImages((prev) =>
            prev.map((image) =>
              image.id === id ? { ...image, uploading: false, error: message } : image
            )
          );
        }
      }
    },
    [referenceImages.length, referenceLimit, t]
  );

  const removeReferenceImage = useCallback((id: string) => {
    setReferenceImages((prev) => prev.filter((image) => image.id !== id));
  }, []);

  const retryJob = useCallback(
    (localId: string) => {
      if (submitting || recovery.pending) return;
      const failed = jobs.find((row) => row.localId === localId);
      if (!failed) return;

      // Server-side retry whenever the job actually reached the server: the
      // server resubmits its own stored input + prompt document + bindings.
      // Local re-submit is ONLY for rows that never got a jobId (the original
      // submit request itself failed) — and it must be contract-complete.
      let runRetry: (() => Promise<FizzAiSubmitResponse>) | null = null;
      let retryModelId = failed.modelId;
      let retrySchemaVersion = failed.schemaVersion;

      if (failed.jobId) {
        const jobId = failed.jobId;
        runRetry = () => retryFizzAiJob(jobId);
      } else {
        const model = failed.modelId ? modelById(imageModels, failed.modelId) : undefined;
        const retryInput = failed.input;
        if (!model || !retryInput || model.schemaVersion !== failed.schemaVersion) {
          setPrompt(failed.prompt);
          setSubmitError(t("results.retryUnavailable"));
          return;
        }
        retryModelId = model.id;
        retrySchemaVersion = model.schemaVersion;
        const referenceBindings = bindingsFromInputReferences(retryInput, (index) =>
          t("referenceMention.label", { number: index + 1 })
        );
        const promptDocument = buildPromptDocument(failed.prompt, referenceBindings);
        runRetry = () =>
          submitGeneration(
            {
              context: {
                workspaceId,
                projectId: "",
                documentId: "",
                documentBlockId: "",
                sourceSurface: "fizzstudio-image-studio",
              },
              idempotencyKey: generationIdempotencyKey(
                `fizzstudio:image-studio-retry:${workspaceId}`
              ),
              input: retryInput,
              promptDocument,
              referenceBindings: referenceBindings.length > 0 ? referenceBindings : undefined,
              modelId: model.id,
              schemaVersion: model.schemaVersion,
            },
            "image",
            { localId: retryLocalId }
          );
      }

      setSubmitting(true);
      setSubmitError(null);
      setActiveTab("history");
      const retryLocalId = generationIdempotencyKey("retry");
      const now = new Date().toISOString();
      const estimatedRunSeconds = failed.estimatedRunSeconds ?? optimisticRunSeconds(settings);

      setJobs((prev) => [
        {
          ...failed,
          localId: retryLocalId,
          jobId: "",
          modelId: retryModelId,
          schemaVersion: retrySchemaVersion,
          status: "queued",
          stage: "submitting",
          progress: null,
          queuePosition: null,
          estimatedWaitSeconds: null,
          estimatedRunSeconds,
          estimatedTotalSeconds: estimatedRunSeconds,
          etaConfidence: "low",
          images: [],
          error: undefined,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
        ...prev.filter((row) => row.localId !== localId),
      ]);

      void (async () => {
        try {
          const response = await runRetry();
          if (!submissionIsCurrent()) return;
          dispatch(touchCredits());
          refreshComputeBilling();
          const status = generationStatusFromRaw(response.status);
          setJobs((prev) =>
            prev.map((row) =>
              row.localId === retryLocalId
                ? {
                    ...row,
                    jobId: response.request_id,
                    status: status === "done" ? "generating" : status,
                    stage: response.stage,
                    progress: response.progress,
                    queuePosition: response.queue_position,
                    estimatedWaitSeconds: response.estimated_wait_seconds,
                    estimatedRunSeconds: response.estimated_run_seconds,
                    estimatedTotalSeconds: response.estimated_total_seconds,
                    etaConfidence: response.eta_confidence,
                    updatedAt: new Date().toISOString(),
                  }
                : row
            )
          );
        } catch (error) {
          if (!submissionIsCurrent()) return;
          const message = normalizeFizzAiError(error, t("results.failed"));
          setSubmitError(message);
          if (failed.jobId) {
            // Keep the original server retry target if its response is lost.
            // Repeating that endpoint recovers the same child; a fresh submit
            // would lose its identity and could reserve another paid job.
            setJobs((previous) =>
              previous.map((row) =>
                row.localId === retryLocalId ? { ...failed, error: message } : row
              )
            );
            return;
          }
          setJobs((prev) =>
            prev.map((row) =>
              row.localId === retryLocalId
                ? {
                    ...row,
                    status:
                      error instanceof UncertainGenerationSubmissionError ? "queued" : "failed",
                    stage:
                      error instanceof UncertainGenerationSubmissionError
                        ? "submission_unconfirmed"
                        : "failed",
                    error: message,
                    completedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }
                : row
            )
          );
        } finally {
          if (submissionIsCurrent()) setSubmitting(false);
        }
      })();
    },
    [
      submitGeneration,
      submissionIsCurrent,
      recovery.pending,
      dispatch,
      imageModels,
      jobs,
      refreshComputeBilling,
      settings,
      submitting,
      t,
      workspaceId,
    ]
  );

  return (
    <div className="relative min-h-[calc(100svh-64px)] pb-[430px] text-white md:pb-56">
      <ImageStudioTopBar activeTab={activeTab} onTabChange={setActiveTab} />

      <section className="px-4 pb-10 pt-5 sm:px-6 xl:px-8">
        <div className="mx-auto max-w-none">
          {activeTab === "history" ? (
            <ResultsStrip
              jobs={jobs}
              loading={historyLoading}
              onRetry={retryJob}
              onOpenImage={setSelectedDetailId}
            />
          ) : (
            <ImageMasonry items={IMAGE_FEED} />
          )}
        </div>
      </section>

      <StudioComposer
        submissionRecovery={recovery}
        models={imageModels}
        catalogLoading={catalogQuery.isLoading}
        catalogError={catalogQuery.isError}
        selectedModelId={modelId}
        settings={settings}
        prompt={prompt}
        submitting={submitting}
        submitError={submitError}
        priceEstimate={priceEstimate}
        canSubmit={Boolean(
          prompt.trim() && selectedModel && !submitting && !hasUploadingReferences
        )}
        onPromptChange={setPrompt}
        onSubmit={submit}
        onSelectModel={selectModel}
        onSettingsChange={setSettings}
        onRetryCatalog={() => void catalogQuery.refetch()}
        references={{
          images: referenceImages,
          limit: referenceLimit,
          uploadError: referenceUploadError,
          onFiles: uploadReferenceImages,
          onRemove: removeReferenceImage,
        }}
      />

      {hasSelectedDetail && selectedDetailId ? (
        <StudioResultLightbox
          items={lightboxItems}
          activeId={selectedDetailId}
          onClose={() => setSelectedDetailId(null)}
          onSelect={setSelectedDetailId}
        />
      ) : null}
    </div>
  );
}

function ResultsStrip({
  jobs,
  loading,
  onOpenImage,
  onRetry,
}: {
  jobs: ResultJob[];
  loading: boolean;
  onOpenImage: (detailId: string) => void;
  onRetry: (localId: string) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const hasActiveJobs = jobs.some((job) => !isTerminalGenerationStatus(job.status));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs]);

  return (
    <div>
      <div className="mb-4">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.01em] text-white/88">
            {t("results.title")}
          </h2>
          <p className="mt-1 text-xs font-medium text-white/42">
            {hasActiveJobs ? t("results.liveHint") : t("results.historyHint")}
          </p>
        </div>
      </div>
      {loading && jobs.length === 0 ? <HistoryLoadingState /> : null}
      {!loading && jobs.length === 0 ? <HistoryEmptyState /> : null}
      {jobs.length > 0 ? (
        <ResultsMasonry jobs={jobs} nowMs={nowMs} onOpenImage={onOpenImage} onRetry={onRetry} />
      ) : null}
    </div>
  );
}

function ResultsMasonry({
  jobs,
  nowMs,
  onOpenImage,
  onRetry,
}: {
  jobs: ResultJob[];
  nowMs: number;
  onOpenImage: (detailId: string) => void;
  onRetry: (localId: string) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const items = useMemo(() => flattenResultItems(jobs, t), [jobs, t]);

  return (
    <div className="columns-2 gap-2 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 min-[1880px]:columns-7">
      {items.map((item) => {
        if (item.kind === "image") {
          return (
            <ResultImageTile
              key={item.id}
              image={item.image}
              job={item.job}
              outputIndex={item.outputIndex}
              ratio={item.ratio}
              onOpen={() => onOpenImage(item.id)}
            />
          );
        }
        if (item.kind === "failed") {
          return (
            <FailedTile
              key={item.id}
              job={item.job}
              message={item.message}
              onRetry={() => onRetry(item.job.localId)}
              ratio={item.ratio}
            />
          );
        }
        return <PendingTile key={item.id} job={item.job} nowMs={nowMs} ratio={item.ratio} />;
      })}
    </div>
  );
}

type ResultMasonryItem =
  | {
      id: string;
      image: ResultJob["images"][number];
      job: ResultJob;
      kind: "image";
      outputIndex: number;
      ratio: string;
    }
  | {
      id: string;
      job: ResultJob;
      kind: "pending";
      ratio: string;
    }
  | {
      id: string;
      job: ResultJob;
      kind: "failed";
      message: string;
      ratio: string;
    };

type ResultImageDetailItem = Extract<ResultMasonryItem, { kind: "image" }>;

function flattenResultItems(jobs: ResultJob[], t: ImageStudioT): ResultMasonryItem[] {
  return jobs.flatMap((job): ResultMasonryItem[] => {
    if (job.status === "failed" || job.status === "cancelled") {
      return [
        {
          id: `${job.localId}:failed`,
          job,
          kind: "failed",
          message: job.error ?? t("results.failed"),
          ratio: aspectRatioForJob(job),
        },
      ];
    }

    if (job.images.length > 0) {
      return job.images.map((image, outputIndex) => ({
        id: `${job.localId}:${image.id}`,
        image,
        job,
        kind: "image",
        outputIndex,
        ratio: aspectRatioForImage(job, image),
      }));
    }

    if (job.status === "done") {
      return [
        {
          id: `${job.localId}:no-output`,
          job,
          kind: "failed",
          message: t("results.noOutput"),
          ratio: aspectRatioForJob(job),
        },
      ];
    }

    return [
      {
        id: `${job.localId}:pending`,
        job,
        kind: "pending",
        ratio: aspectRatioForJob(job),
      },
    ];
  });
}

function flattenResultImageItems(jobs: ResultJob[]): ResultImageDetailItem[] {
  return jobs.flatMap((job): ResultImageDetailItem[] =>
    job.images.map((image, outputIndex) => ({
      id: `${job.localId}:${image.id}`,
      image,
      job,
      kind: "image",
      outputIndex,
      ratio: aspectRatioForImage(job, image),
    }))
  );
}

function ResultImageTile({
  image,
  job,
  onOpen,
  outputIndex,
  ratio,
}: {
  image: ResultJob["images"][number];
  job: ResultJob;
  onOpen: () => void;
  outputIndex: number;
  ratio: string;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <figure
      className="group relative mb-2 break-inside-avoid overflow-hidden rounded-[12px] bg-[#151517] shadow-[0_12px_32px_rgba(0,0,0,.28)]"
      style={{ aspectRatio: ratio }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block size-full text-left"
        aria-label={t("detail.open")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={t("results.alt")}
          loading="lazy"
          className="size-full object-cover transition duration-500 group-hover:scale-[1.025]"
        />
      </button>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/0 via-black/0 to-black/72 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <figcaption className="pointer-events-none absolute inset-x-2.5 bottom-2.5 translate-y-2 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/52 px-2 py-0.5 text-[10px] font-semibold text-white/88 backdrop-blur-md">
            <IconCircleCheck className="size-3 text-emerald-200" stroke={2} />
            {t("results.done")}
          </span>
          {job.images.length > 1 ? (
            <span className="rounded-full bg-black/52 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/72 backdrop-blur-md">
              {outputIndex + 1}/{job.images.length}
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-[11px] font-medium leading-4 text-white">{job.prompt}</p>
        <p className="mt-1 text-[10px] font-medium text-white/55">
          {formatRelativeTime(job.completedAt ?? job.updatedAt, t)}
        </p>
      </figcaption>
      <a
        href={image.url}
        download
        aria-label={t("results.download")}
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/52 text-white opacity-0 backdrop-blur-md transition hover:bg-black/72 group-hover:opacity-100"
      >
        <IconDownload className="size-3.5" stroke={1.9} />
      </a>
    </figure>
  );
}

function PendingTile({ job, nowMs, ratio }: { job: ResultJob; nowMs: number; ratio: string }) {
  const t = useTranslations("fizzStudio.imageStudio");
  const statusMeta = pendingStatusMeta(job, nowMs, t);
  const progress = pendingProgress(job, nowMs);

  return (
    <article
      className="relative mb-2 break-inside-avoid overflow-hidden rounded-[12px] bg-[#151517] p-3 shadow-[0_12px_32px_rgba(0,0,0,.24)]"
      style={{ aspectRatio: ratio }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.055)_48%,rgba(255,255,255,0)_100%)] bg-[length:220%_100%] [animation:gallery-shimmer_2.6s_linear_infinite]" />
      <div className="relative flex size-full min-h-[150px] flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-white/82">
            <IconLoader2 className="size-3 animate-spin" stroke={1.9} />
            {statusMeta.title}
          </div>
          <span className="shrink-0 rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/58">
            {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="mt-auto space-y-2.5 pt-6">
          <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-[#E52227] transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="grid gap-1.5 text-[11px] text-white/52">
            <div className="flex items-center justify-between gap-3">
              <span>{statusMeta.detail}</span>
              <span className="font-semibold tabular-nums text-white/76">{statusMeta.time}</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function FailedTile({
  job,
  message,
  onRetry,
  ratio,
}: {
  job: ResultJob;
  message: string;
  onRetry: () => void;
  ratio: string;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  return (
    <article
      className="relative mb-2 flex break-inside-avoid flex-col justify-between overflow-hidden rounded-[12px] bg-[#1a1011] p-3 shadow-[0_12px_32px_rgba(0,0,0,.24)]"
      style={{ aspectRatio: ratio }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(229,34,39,0.18),transparent_36%)]" />
      <div className="relative">
        <IconAlertTriangle className="size-4 text-[#ff8a8d]" stroke={1.9} />
        <p className="mt-2 line-clamp-4 text-[11px] font-medium leading-4 text-white/72">
          {message}
        </p>
        <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-white/42">{job.prompt}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="relative mt-4 h-7 self-start rounded-full bg-white/[0.08] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/[0.12]"
      >
        {t("results.retry")}
      </button>
    </article>
  );
}

function HistoryLoadingState() {
  return (
    <div className="grid min-h-[220px] place-items-center sm:min-h-[260px]">
      <IconLoader2 className="size-6 animate-spin text-white/48" stroke={1.9} />
    </div>
  );
}

function HistoryEmptyState() {
  const t = useTranslations("fizzStudio.imageStudio");
  return (
    <div className="grid min-h-[220px] place-items-center px-6 text-center sm:min-h-[260px]">
      <div>
        <div className="mx-auto mb-3 grid size-10 place-items-center text-white/50">
          <IconClock className="size-5" stroke={1.8} />
        </div>
        <p className="text-sm font-semibold text-white/82">{t("results.emptyTitle")}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-white/42">{t("results.emptyBody")}</p>
      </div>
    </div>
  );
}

function jobViewToResultJob(job: FizzAiJobView, t: ImageStudioT): ResultJob {
  const status = generationStatusFromRaw(job.status);
  return {
    localId: job.id,
    jobId: job.id,
    modelId: job.modelId,
    prompt: job.prompt,
    input: job.input,
    status,
    stage: job.stage || stageFromStatus(status),
    progress: job.progress ?? null,
    queuePosition: job.queuePosition ?? null,
    estimatedWaitSeconds: job.estimatedWaitSeconds ?? null,
    estimatedRunSeconds: job.estimatedRunSeconds ?? null,
    estimatedTotalSeconds: job.estimatedTotalSeconds ?? null,
    etaConfidence: job.etaConfidence ?? "low",
    images: resultImages(job.outputs),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
    error:
      status === "failed" || status === "cancelled"
        ? errorMessageFromJob(job, t("results.failed"))
        : undefined,
  };
}

function jobUpdateToResultJob(job: AiJobUpdatePayload, t: ImageStudioT): ResultJob {
  const status = generationStatusFromRaw(job.status);
  return {
    localId: job.id,
    jobId: job.id,
    modelId: job.modelId,
    prompt: job.prompt,
    input: job.input,
    status,
    stage: job.stage || stageFromStatus(status),
    progress: job.progress ?? null,
    queuePosition: job.queuePosition ?? null,
    estimatedWaitSeconds: job.estimatedWaitSeconds ?? null,
    estimatedRunSeconds: job.estimatedRunSeconds ?? null,
    estimatedTotalSeconds: job.estimatedTotalSeconds ?? null,
    etaConfidence: job.etaConfidence ?? "low",
    images: resultImages(job.outputs),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
    error:
      status === "failed" || status === "cancelled"
        ? (job.error?.userMessage ?? t("results.failed"))
        : undefined,
  };
}

function resultImages(
  outputs: Array<{
    height?: number | null;
    id: string;
    type: "image" | "video" | "audio";
    url: string;
    width?: number | null;
  }>
): ResultJob["images"] {
  return outputs
    .filter((output) => output.type === "image" && Boolean(output.url))
    .map((output) => ({
      height: output.height ?? null,
      id: output.id,
      url: output.url,
      width: output.width ?? null,
    }));
}

function aspectRatioForImage(job: ResultJob, image: ResultJob["images"][number]): string {
  if (
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    image.width > 0 &&
    image.height > 0
  ) {
    return `${image.width} / ${image.height}`;
  }
  return aspectRatioForJob(job);
}

function aspectRatioForJob(job: ResultJob): string {
  return (
    aspectRatioFromInputValue(job.input?.aspectRatio) ??
    aspectRatioFromInputValue(job.input?.aspect_ratio) ??
    aspectRatioFromInputValue(job.input?.imageSize) ??
    aspectRatioFromInputValue(job.input?.size) ??
    "1 / 1"
  );
}

function aspectRatioFromInputValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();
  const numeric = normalized.match(/(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)/);
  if (numeric) {
    const width = Number(numeric[1]);
    const height = Number(numeric[2]);
    if (width > 0 && height > 0) return `${width} / ${height}`;
  }

  const token = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string, string> = {
    square: "1 / 1",
    square_hd: "1 / 1",
    landscape: "4 / 3",
    landscape_4_3: "4 / 3",
    landscape_hd: "16 / 9",
    landscape_16_9: "16 / 9",
    portrait: "3 / 4",
    portrait_4_3: "3 / 4",
    portrait_9_16: "9 / 16",
    portrait_16_9: "9 / 16",
    widescreen: "16 / 9",
  };
  return aliases[token] ?? null;
}

function mergeResultJobs(incoming: ResultJob[], existing: ResultJob[]): ResultJob[] {
  return incoming.reduce((acc, job) => mergeResultJob(acc, job), existing);
}

function mergeResultJob(existing: ResultJob[], incoming: ResultJob): ResultJob[] {
  const index = existing.findIndex((job) => sameLogicalJob(job, incoming));
  const next =
    index >= 0
      ? existing.map((job, i) => (i === index ? mergeResultJobRow(job, incoming) : job))
      : [incoming, ...existing];
  return next.sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
}

function sameLogicalJob(a: ResultJob, b: ResultJob): boolean {
  if (a.jobId && b.jobId && a.jobId === b.jobId) return true;
  if (a.localId && b.localId && a.localId === b.localId) return true;
  if (a.jobId || !b.jobId || a.prompt !== b.prompt) return false;
  if (isTerminalGenerationStatus(a.status)) return false;
  const aCreated = timestampMs(a.createdAt);
  const bCreated = timestampMs(b.createdAt);
  return Math.abs(aCreated - bCreated) < 5 * 60 * 1000;
}

function mergeResultJobRow(current: ResultJob, incoming: ResultJob): ResultJob {
  const incomingIsNewer =
    (!current.jobId && Boolean(incoming.jobId)) ||
    timestampMs(incoming.updatedAt) >= timestampMs(current.updatedAt);
  const primary = incomingIsNewer ? incoming : current;
  const fallback = incomingIsNewer ? current : incoming;
  return {
    ...fallback,
    ...primary,
    localId: current.localId || incoming.localId,
    jobId: incoming.jobId || current.jobId,
    prompt: primary.prompt || fallback.prompt,
    images: incoming.images.length > 0 ? incoming.images : current.images,
    createdAt: incoming.createdAt || current.createdAt,
    updatedAt: primary.updatedAt || fallback.updatedAt,
    completedAt: incoming.completedAt ?? current.completedAt ?? null,
    error: incoming.error ?? current.error,
  };
}

function buildReferenceBindings(
  images: ReferenceImage[],
  labelForIndex: (index: number) => string
): FizzAiReferenceBinding[] {
  return images
    .filter((image): image is ReferenceImage & { url: string } => Boolean(image.url))
    .map((image, index) => {
      const binding: FizzAiReferenceBinding = {
        refId: image.id,
        kind: "image",
        label: labelForIndex(index),
        order: index + 1,
        url: image.url,
      };
      if (image.assetId) binding.assetId = image.assetId;
      return binding;
    });
}

/**
 * Rebuild contract-complete reference bindings from a failed job's stored
 * `input.referenceImages` (used by the local re-submit fallback when the
 * original submit never reached the server, so there is no jobId to retry).
 */
function bindingsFromInputReferences(
  input: Record<string, unknown>,
  labelForIndex: (index: number) => string
): FizzAiReferenceBinding[] {
  const raw = input.referenceImages;
  if (!Array.isArray(raw)) return [];
  const bindings: FizzAiReferenceBinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" && record.url ? record.url : undefined;
    if (!url) continue;
    const index = bindings.length;
    bindings.push({
      refId:
        typeof record.refId === "string" && record.refId
          ? record.refId
          : generationIdempotencyKey("ref"),
      kind: "image",
      label: typeof record.label === "string" && record.label ? record.label : labelForIndex(index),
      order: index + 1,
      url,
      ...(typeof record.assetId === "string" && record.assetId ? { assetId: record.assetId } : {}),
    });
  }
  return bindings;
}

/** Read a numeric value off the flat settings bag, falling back when absent. */
function numericSetting(value: ModelSettings[string] | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Read a string value off the flat settings bag, or "" when absent / non-string. */
function stringSetting(value: ModelSettings[string] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Build the submit `input` from the flat settings bag. Preserves the exact
 * key contract of the legacy composer: the aspect-ratio token is broadcast
 * under four keys (imageSize / size / aspectRatio / aspect_ratio), the output
 * count under two (n / numOutputs), `seed` floored to an integer, and 0-valued
 * guidance / steps dropped. Every other schema field flows through verbatim and
 * `filterFizzAiInput` (called by the caller) trims keys absent from the schema.
 */
function buildImageInput(
  settings: ModelSettings,
  prompt: string,
  validReferenceImages: ReferenceImage[],
  referenceBindings: FizzAiReferenceBinding[]
): Record<string, unknown> {
  const sizeToken = stringSetting(settings.imageSize) || stringSetting(settings.aspectRatio);
  const variations = numericSetting(settings.numOutputs, 1);
  const guidanceScale = numericSetting(settings.guidanceScale, 0);
  const inferenceSteps = numericSetting(settings.inferenceSteps, 0);
  return compactFizzAiInput({
    ...settings,
    prompt,
    guidanceScale: guidanceScale || undefined,
    imageSize: sizeToken,
    inferenceSteps: inferenceSteps || undefined,
    size: sizeToken,
    aspectRatio: sizeToken,
    aspect_ratio: sizeToken,
    referenceImages:
      validReferenceImages.length > 0
        ? validReferenceImages.map((image) => ({
            url: image.url,
            refId: image.id,
            label: referenceBindings.find((binding) => binding.refId === image.id)?.label,
            assetId: image.assetId,
          }))
        : undefined,
    seed: seedInputValue(settings.seed),
    n: variations,
    numOutputs: variations,
  });
}

function optimisticRunSeconds(settings: ModelSettings): number {
  const quality = stringSetting(settings.quality);
  const count = Math.max(1, numericSetting(settings.numOutputs, 1));
  const qualityFactor = quality === "high" ? 1.35 : quality === "low" ? 0.8 : 1;
  const resolution = stringSetting(settings.resolution).toLowerCase();
  const resolutionFactor = resolution.includes("4k") ? 1.55 : resolution.includes("2k") ? 1.2 : 1;
  const inferenceSteps = numericSetting(settings.inferenceSteps, 0);
  const stepFactor = inferenceSteps > 0 ? Math.min(1.8, Math.max(0.8, inferenceSteps / 28)) : 1;
  return Math.ceil(72 * count * qualityFactor * resolutionFactor * stepFactor);
}

function seedInputValue(value: ModelSettings[string] | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? Math.floor(value) : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function pendingProgress(job: ResultJob, nowMs: number): number {
  if (typeof job.progress === "number") {
    return clamp(job.progress, 0.04, 0.97);
  }

  const elapsed = elapsedSeconds(job.updatedAt, nowMs);
  if (job.stage === "submitting" || job.stage === "created" || job.stage === "validating") {
    return clamp(0.04 + elapsed / 45, 0.04, 0.18);
  }
  if (job.stage === "queued" || job.stage === "provider_queued") {
    const wait = waitEstimateSeconds(job);
    const ratio = wait ? elapsed / wait : 0.35;
    return clamp(0.12 + ratio * 0.24, 0.12, 0.36);
  }
  if (job.stage === "calling_provider") {
    return clamp(0.22 + elapsed / 90, 0.22, 0.4);
  }
  if (job.stage === "fetching_output") return 0.88;
  if (job.stage === "uploading_to_oss") return 0.94;

  const run = job.estimatedRunSeconds ?? job.estimatedTotalSeconds ?? 90;
  return clamp(0.38 + (elapsed / run) * 0.48, 0.38, 0.86);
}

function pendingStatusMeta(job: ResultJob, nowMs: number, t: ImageStudioT) {
  if (job.stage === "submitting" || job.stage === "created" || job.stage === "validating") {
    return {
      title: t("results.preparing"),
      detail: t("results.submittingDetail"),
      time: t("results.estimating"),
    };
  }

  if (job.stage === "queued" || job.stage === "provider_queued" || job.status === "queued") {
    const remaining = remainingFromAnchor(waitEstimateSeconds(job), job.updatedAt, nowMs);
    const position =
      typeof job.queuePosition === "number"
        ? t("results.queuePosition", { position: job.queuePosition + 1 })
        : t("results.queueStartingSoon");
    return {
      title: t("results.queued"),
      detail: position,
      time:
        remaining && remaining > 3
          ? t("results.queueEta", { time: formatDuration(remaining, t) })
          : t("results.queueStartingSoon"),
    };
  }

  if (job.stage === "fetching_output" || job.stage === "uploading_to_oss") {
    return {
      title: t("results.uploading"),
      detail: t("results.finalizingDetail"),
      time: t("results.almostDone"),
    };
  }

  const remaining = remainingFromAnchor(
    job.estimatedRunSeconds ?? job.estimatedTotalSeconds,
    job.updatedAt,
    nowMs
  );
  return {
    title: t("results.generating"),
    detail: t("results.generatingDetail"),
    time:
      remaining && remaining > 3
        ? t("results.generatingEta", { time: formatDuration(remaining, t) })
        : t("results.almostDone"),
  };
}

function waitEstimateSeconds(job: ResultJob): number | null {
  if (typeof job.estimatedWaitSeconds === "number") {
    return Math.max(0, job.estimatedWaitSeconds);
  }
  if (typeof job.queuePosition === "number" && typeof job.estimatedRunSeconds === "number") {
    return Math.max(0, job.queuePosition * job.estimatedRunSeconds);
  }
  return null;
}

function stageFromStatus(status: FizzAiGenerationStatus): string {
  if (status === "done") return "completed";
  return status;
}

function formatDuration(seconds: number, t: ImageStudioT): string {
  const totalSeconds = Math.max(1, Math.ceil(seconds));
  if (totalSeconds < 60) return t("results.duration.seconds", { seconds: totalSeconds });
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (remainingSeconds === 0 || minutes >= 3) {
    return t("results.duration.minutes", { minutes: Math.ceil(totalSeconds / 60) });
  }
  return t("results.duration.minuteSeconds", {
    minutes,
    seconds: remainingSeconds,
  });
}

function formatRelativeTime(value: string, t: ImageStudioT): string {
  const elapsed = Math.max(0, Date.now() - timestampMs(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t("results.relative.justNow");
  if (minutes < 60) return t("results.relative.minutesAgo", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("results.relative.hoursAgo", { hours });
  return t("results.relative.daysAgo", { days: Math.floor(hours / 24) });
}

function remainingFromAnchor(
  seconds: number | null | undefined,
  anchorIso: string,
  nowMs: number
): number | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return Math.max(0, seconds - elapsedSeconds(anchorIso, nowMs));
}

function elapsedSeconds(anchorIso: string, nowMs: number): number {
  return Math.max(0, (nowMs - timestampMs(anchorIso)) / 1000);
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ImageStudioTopBar({
  activeTab,
  onTabChange,
}: {
  activeTab: ImageStudioTab;
  onTabChange: (tab: ImageStudioTab) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <div className="sticky top-16 z-30 border-b border-white/[0.06] bg-[#09090a]/88 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6 xl:px-8">
        <div className="shrink-0 text-base font-semibold text-white">{t("title")}</div>
        <div
          role="tablist"
          aria-label={t("modeTabsLabel")}
          className="flex h-8 rounded-[14px] bg-white/[0.04] p-1"
        >
          {IMAGE_STUDIO_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                "h-6 min-w-[78px] rounded-[10px] px-3 text-sm font-semibold transition-colors",
                activeTab === tab ? "bg-white/12 text-white" : "text-white/42 hover:text-white"
              )}
            >
              {t(`modeTabs.${tab}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ImageMasonry({ items }: { items: typeof IMAGE_FEED }) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <div className="columns-2 gap-2.5 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6">
      {items.map((item, index) => (
        <article
          key={`${item.key}-${index}`}
          className={cn(
            "group relative mb-2.5 break-inside-avoid overflow-hidden rounded-[12px] bg-[#171719] shadow-[0_12px_32px_rgba(0,0,0,.28)] ring-1 ring-white/[0.08]",
            item.className
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={t(`galleryAlt.${item.key}`)}
            className="size-full object-cover transition duration-500 group-hover:scale-[1.035]"
            style={{ objectPosition: item.objectPosition }}
          />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/0 via-black/0 to-black/32 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-between gap-2 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <span className="rounded-full bg-black/48 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md">
              {t("recreate")}
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#111]">
              {t("edit")}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

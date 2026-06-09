"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconArrowsMaximize,
  IconChevronDown,
  IconCircleCheck,
  IconClock,
  IconDownload,
  IconInfoCircle,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconSend,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import type { AiJobUpdatePayload, AssetEvent } from "@repo/shared";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import { useAppDispatch } from "@/src/store";
import { touchCredits } from "@/src/store/slices/userSlice";
import { useAiCatalog, usableImageModels } from "../../_hooks/use-ai-catalog";
import { computeBillingKeys } from "../../_hooks/use-billing";
import {
  compactFizzAiInput,
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
  submitFizzAiJob,
  type FizzAiGenerationStatus,
  type FizzAiJobView,
  type FizzAiModel,
  type FizzAiPromptDocument,
  type FizzAiReferenceBinding,
} from "../../_lib/generation-api";
import { openAssetsRealtime } from "../../_lib/assets-realtime";
import { FizzStudioShell, useFizzStudioWorkspace } from "./fizzstudio-shell";
import {
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  getImageModelLabel,
  ImageSettingsPanel,
  modelById,
  settingsForModel,
  type ImageGenerationSettings,
} from "./image-settings-panel";

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

interface ReferenceImage {
  assetId?: string;
  id: string;
  name: string;
  progress: number;
  uploading: boolean;
  url?: string;
  error?: string;
}

interface ReferenceMentionOption {
  id: string;
  image: ReferenceImage;
  label: string;
}

interface PromptMentionRange {
  end: number;
  query: string;
  start: number;
}

const IMAGE_FEED = [
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

export function ImageStudioPage() {
  const workspaceState = useFizzStudioWorkspace();

  return (
    <FizzStudioShell
      className="overflow-x-hidden bg-[#09090a]"
      headerVariant="enterprise"
      mainClassName="max-w-none px-0 pt-0"
      sidebarVariant="enterprise"
      workspaceState={workspaceState}
    >
      <ImageStudioSurface workspaceId={workspaceState.workspaceId} />
    </FizzStudioShell>
  );
}

function ImageStudioSurface({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("fizzStudio.imageStudio");
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const catalogQuery = useAiCatalog();

  const [activeTab, setActiveTab] = useState<ImageStudioTab>("community");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ImageGenerationSettings>(
    DEFAULT_IMAGE_GENERATION_SETTINGS
  );
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [referenceUploadError, setReferenceUploadError] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [jobs, setJobs] = useState<ResultJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const historyRequestSeqRef = useRef(0);

  const imageModels = useMemo(
    () => (catalogQuery.data?.models ?? []).filter((model) => model.type === "image"),
    [catalogQuery.data]
  );

  // Seed the default model + its schema defaults once the catalog resolves.
  useEffect(() => {
    if (settings.model || !catalogQuery.data) return;
    const usable = usableImageModels(catalogQuery.data);
    const first = usable[0];
    if (!first) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSettings((prev) => settingsForModel(first, prev));
    });
    return () => {
      cancelled = true;
    };
  }, [catalogQuery.data, settings.model]);

  const selectedModel = useMemo<FizzAiModel | undefined>(
    () => modelById(imageModels, settings.model),
    [imageModels, settings.model]
  );
  const referenceLimit = maxReferenceImages(selectedModel);
  const supportsReferences = referenceLimit > 0;
  const chargeableReferenceCount = supportsReferences
    ? referenceImages.filter((image) => !image.error).length
    : 0;

  const applySettings = useCallback(
    (next: ImageGenerationSettings) => {
      const nextLimit = maxReferenceImages(modelById(imageModels, next.model));
      setReferenceImages((prev) => (prev.length > nextLimit ? prev.slice(0, nextLimit) : prev));
      setSettings(next);
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
        numOutputs: settings.variations,
        quality: settings.quality,
        referenceImageCount: chargeableReferenceCount,
        resolution: settings.resolution,
      }),
    [
      selectedModel,
      settings.variations,
      settings.quality,
      settings.resolution,
      chargeableReferenceCount,
    ]
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
  const selectedDetailIndex = selectedDetailId
    ? detailItems.findIndex((item) => item.id === selectedDetailId)
    : -1;
  const selectedDetail = selectedDetailIndex >= 0 ? detailItems[selectedDetailIndex] : null;
  const selectedDetailModelLabel =
    selectedDetail?.job.modelId && imageModels.length > 0
      ? getImageModelLabel(imageModels, selectedDetail.job.modelId)
      : (selectedDetail?.job.modelId ?? t("detail.modelFallback"));
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
      if (!requestWorkspaceId) {
        setJobs([]);
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(true);
      try {
        const response = await listFizzAiJobs({
          limit: HISTORY_LIMIT,
          type: "image",
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
    [t, workspaceId]
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
      if (job.type !== "image") return;
      mergeJob(jobUpdateToResultJob(job, t));
      if (isTerminalGenerationStatus(generationStatusFromRaw(job.status))) {
        dispatch(touchCredits());
        refreshComputeBilling();
      }
    },
    [dispatch, mergeJob, refreshComputeBilling, t]
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
    if (!trimmedPrompt || !selectedModel || submitting || hasUploadingReferences) return;

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
    const rawInput = compactFizzAiInput({
      prompt: trimmedPrompt,
      guidanceScale: settings.guidanceScale || undefined,
      imageSize: settings.aspectRatio,
      inferenceSteps: settings.inferenceSteps || undefined,
      size: settings.aspectRatio,
      aspectRatio: settings.aspectRatio,
      aspect_ratio: settings.aspectRatio,
      negativePrompt: settings.negativePrompt,
      outputFormat: settings.outputFormat,
      promptExtend: settings.promptExtend,
      quality: settings.quality,
      referenceImages:
        validReferenceImages.length > 0
          ? validReferenceImages.map((image) => ({
              url: image.url,
              refId: image.id,
              label: referenceBindings.find((binding) => binding.refId === image.id)?.label,
              assetId: image.assetId,
            }))
          : undefined,
      resolution: settings.resolution,
      seed: seedInputValue(settings.seed),
      thinkingMode: settings.thinkingMode,
      watermark: settings.watermark,
      n: settings.variations,
      numOutputs: settings.variations,
    });
    const input = filterFizzAiInput(selectedModel, rawInput);

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
      const response = await submitFizzAiJob({
        context: {
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
      });
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
      const message = normalizeFizzAiError(error, t("results.failed"));
      setSubmitError(message);
      setJobs((prev) =>
        prev.map((row) =>
          row.localId === localId
            ? {
                ...row,
                status: "failed",
                stage: "failed",
                error: message,
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : row
        )
      );
    } finally {
      setSubmitting(false);
    }
  }, [
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

  const moveSelectedDetail = useCallback(
    (direction: -1 | 1) => {
      if (detailItems.length === 0 || selectedDetailIndex < 0) return;
      const nextIndex = (selectedDetailIndex + direction + detailItems.length) % detailItems.length;
      setSelectedDetailId(detailItems[nextIndex]?.id ?? null);
    },
    [detailItems, selectedDetailIndex]
  );

  const retryJob = useCallback(
    (localId: string) => {
      if (submitting) return;
      const failed = jobs.find((row) => row.localId === localId);
      if (!failed) return;
      const model =
        (failed.modelId ? modelById(imageModels, failed.modelId) : undefined) ?? selectedModel;
      const retryInput = failed.input;
      if (!model || !retryInput) {
        setPrompt(failed.prompt);
        setSubmitError(t("results.retryUnavailable"));
        return;
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
          modelId: model.id,
          schemaVersion: model.schemaVersion,
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
          const response = await submitFizzAiJob({
            context: {
              projectId: "",
              documentId: "",
              documentBlockId: "",
              sourceSurface: "fizzstudio-image-studio",
            },
            idempotencyKey: generationIdempotencyKey(
              `fizzstudio:image-studio-retry:${workspaceId}`
            ),
            input: retryInput,
            modelId: model.id,
            schemaVersion: model.schemaVersion,
          });
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
          const message = normalizeFizzAiError(error, t("results.failed"));
          setSubmitError(message);
          setJobs((prev) =>
            prev.map((row) =>
              row.localId === retryLocalId
                ? {
                    ...row,
                    status: "failed",
                    stage: "failed",
                    error: message,
                    completedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }
                : row
            )
          );
        } finally {
          setSubmitting(false);
        }
      })();
    },
    [
      dispatch,
      imageModels,
      jobs,
      refreshComputeBilling,
      selectedModel,
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

      <ImagePromptComposer
        models={imageModels}
        catalogLoading={catalogQuery.isLoading}
        catalogError={catalogQuery.isError}
        prompt={prompt}
        settings={settings}
        settingsOpen={settingsOpen}
        submitting={submitting}
        submitError={submitError}
        priceEstimate={priceEstimate}
        referenceImages={referenceImages}
        referenceLimit={referenceLimit}
        supportsReferences={supportsReferences}
        referenceUploadError={referenceUploadError}
        canSubmit={Boolean(
          prompt.trim() && selectedModel && !submitting && !hasUploadingReferences
        )}
        onReferenceFiles={uploadReferenceImages}
        onRemoveReferenceImage={removeReferenceImage}
        onPromptChange={setPrompt}
        onSubmit={submit}
        onOpenSettingsChange={setSettingsOpen}
        onRetryCatalog={() => void catalogQuery.refetch()}
        onSettingsChange={applySettings}
      />

      {selectedDetail ? (
        <ImageDetailOverlay
          item={selectedDetail}
          modelLabel={selectedDetailModelLabel}
          showNavigation={detailItems.length > 1}
          onClose={() => setSelectedDetailId(null)}
          onNext={() => moveSelectedDetail(1)}
          onPrevious={() => moveSelectedDetail(-1)}
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

function ImageDetailOverlay({
  item,
  modelLabel,
  onClose,
  onNext,
  onPrevious,
  showNavigation,
}: {
  item: ResultImageDetailItem;
  modelLabel: string;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  showNavigation: boolean;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const [promptCopyState, setPromptCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const promptCopyResetRef = useRef<number | null>(null);
  const createdAt = item.job.completedAt ?? item.job.createdAt;
  const resolution = imageResolutionLabel(item.image, t);
  const ratio = imageRatioLabel(item.job, item.image);
  const promptCopyLabel =
    promptCopyState === "copied"
      ? t("detail.promptCopied")
      : promptCopyState === "failed"
        ? t("detail.promptCopyFailed")
        : t("detail.copyPrompt");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!showNavigation) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onNext, onPrevious, showNavigation]);

  useEffect(() => {
    return () => {
      if (promptCopyResetRef.current) window.clearTimeout(promptCopyResetRef.current);
    };
  }, []);

  const copyPrompt = useCallback(async () => {
    const copied = await copyTextToClipboard(item.job.prompt);
    setPromptCopyState(copied ? "copied" : "failed");
    if (promptCopyResetRef.current) window.clearTimeout(promptCopyResetRef.current);
    promptCopyResetRef.current = window.setTimeout(() => setPromptCopyState("idle"), 1600);
  }, [item.job.prompt]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("detail.title")}
      className="fixed inset-0 z-[999] overflow-hidden bg-black text-white duration-150 animate-in fade-in-0"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.image.url}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full scale-110 object-cover opacity-[0.22] blur-3xl"
      />
      <div className="absolute inset-0 bg-black/78 bg-[radial-gradient(circle_at_18%_10%,rgba(45,212,191,0.12),transparent_30%),radial-gradient(circle_at_78%_92%,rgba(124,58,237,0.18),transparent_34%)]" />

      <div className="relative flex h-[100svh] min-h-0 flex-col gap-4 p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:p-7">
        <section className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-20 pt-8 sm:px-10 lg:px-16 lg:pb-24 lg:pt-10">
            {showNavigation ? (
              <>
                <button
                  type="button"
                  onClick={onPrevious}
                  aria-label={t("detail.previous")}
                  className="absolute left-0 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full text-white/64 transition hover:bg-white/[0.08] hover:text-white md:grid"
                >
                  <IconArrowLeft className="size-5" stroke={1.8} />
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  aria-label={t("detail.next")}
                  className="absolute right-0 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full text-white/64 transition hover:bg-white/[0.08] hover:text-white md:grid"
                >
                  <IconArrowRight className="size-5" stroke={1.8} />
                </button>
              </>
            ) : null}

            <div className="relative max-h-full max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image.url}
                alt={t("results.alt")}
                className="max-h-[calc(100svh-210px)] max-w-full rounded-[10px] object-contain shadow-[0_30px_90px_rgba(0,0,0,.48)] lg:max-h-[calc(100svh-170px)]"
              />
              <a
                href={item.image.url}
                target="_blank"
                rel="noreferrer"
                aria-label={t("detail.expand")}
                className="absolute right-3 top-3 grid size-10 place-items-center rounded-full bg-black/48 text-white backdrop-blur-md transition hover:bg-black/68"
              >
                <IconArrowsMaximize className="size-5" stroke={1.8} />
              </a>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-2 flex justify-center px-3 lg:bottom-4">
            <div className="flex max-w-full items-center gap-2 overflow-x-auto rounded-[18px] border border-white/[0.08] bg-black/34 p-2 shadow-[0_18px_55px_rgba(0,0,0,.38)] backdrop-blur-xl">
              <DetailActionButton
                icon={IconSparkles}
                label={promptCopyLabel}
                onClick={copyPrompt}
              />
              <DetailActionButton
                href={item.image.url}
                icon={IconDownload}
                label={t("detail.download")}
              />
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-[24px] border border-white/[0.08] bg-[#0d0d0f]/96 p-5 shadow-[0_24px_80px_rgba(0,0,0,.52)] backdrop-blur-xl lg:h-full">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <a
              href={item.image.url}
              download
              className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-white/[0.1] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.07]"
            >
              <IconDownload className="size-4" stroke={1.8} />
              {t("detail.download")}
            </a>
            <div className="relative flex items-center gap-1.5">
              <button
                type="button"
                aria-label={t("detail.close")}
                onClick={onClose}
                className="grid size-9 place-items-center rounded-full text-white/76 transition hover:bg-white/[0.08] hover:text-white"
              >
                <IconX className="size-5" stroke={1.8} />
              </button>
            </div>
          </div>

          <div className="mt-7 flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-full bg-[#9a6336] text-white">
              <IconSparkles className="size-3.5" stroke={2} />
            </span>
            <p className="text-sm font-semibold text-white/88">{t("detail.byYou")}</p>
          </div>
          <p className="mt-3 text-sm font-medium text-white/48">
            {t("detail.created", { time: formatRelativeTime(createdAt, t) })}
          </p>

          <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
            <section className="rounded-[18px] border border-white/[0.08] p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="inline-flex items-center gap-2 text-base font-semibold text-white/88">
                  <IconInfoCircle className="size-4" stroke={1.8} />
                  {t("detail.prompt")}
                </h3>
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[11px] bg-white/[0.08] px-3 text-xs font-semibold text-white/86 transition hover:bg-white/[0.13] hover:text-white"
                >
                  <IconSparkles className="size-3.5" stroke={1.8} />
                  {promptCopyLabel}
                </button>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-white/86">
                {item.job.prompt}
              </p>
            </section>

            <div className="mt-4 flex justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1 text-xs font-semibold text-white/82">
                <IconSparkles className="size-3.5" stroke={1.8} />
                {modelLabel}
                <IconInfoCircle className="size-3.5 text-white/52" stroke={1.8} />
              </span>
            </div>

            <div className="mt-5 rounded-[18px] border border-white/[0.08] p-4">
              <h3 className="text-base font-semibold text-white/88">{t("detail.metadata")}</h3>
              <div className="mt-4 space-y-3">
                <DetailMetadataRow label={t("detail.resolution")} value={resolution} />
                <DetailMetadataRow label={t("detail.ratio")} value={ratio} />
                <DetailMetadataRow label={t("detail.model")} value={modelLabel} />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DetailActionButton({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href?: string;
  icon: ComponentType<{ className?: string; stroke?: number }>;
  label: string;
  onClick?: () => void;
}) {
  const className =
    "inline-flex h-10 shrink-0 items-center gap-2 rounded-[14px] border border-white/[0.08] bg-white/[0.05] px-3 text-sm font-semibold text-white/86 transition hover:bg-white/[0.1] hover:text-white";
  const content = (
    <>
      <Icon className="size-4" stroke={1.8} />
      <span>{label}</span>
    </>
  );
  if (href) {
    return (
      <a href={href} download className={className}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function DetailMetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-white/42">{label}</span>
      <span className="min-w-0 truncate font-semibold text-white/82">{value}</span>
    </div>
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
    type: "image" | "video";
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

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (copyTextWithSelection(text)) return true;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function copyTextWithSelection(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function imageResolutionLabel(image: ResultJob["images"][number], t: ImageStudioT): string {
  if (
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    image.width > 0 &&
    image.height > 0
  ) {
    return `${Math.round(image.width)} x ${Math.round(image.height)}`;
  }
  return t("detail.unknownResolution");
}

function imageRatioLabel(job: ResultJob, image: ResultJob["images"][number]): string {
  if (
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    image.width > 0 &&
    image.height > 0
  ) {
    const divisor = greatestCommonDivisor(Math.round(image.width), Math.round(image.height));
    return `${Math.round(image.width) / divisor}:${Math.round(image.height) / divisor}`;
  }
  return aspectRatioForImage(job, image).replace(/\s*\/\s*/g, ":");
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
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

function buildPromptDocument(
  prompt: string,
  references: FizzAiReferenceBinding[]
): FizzAiPromptDocument {
  const nodes = promptDocumentNodesFromMentions(prompt, references);
  return {
    version: 1,
    nodes: nodes.length > 0 ? nodes : [{ type: "text", text: prompt }],
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

function findPromptMentionRange(value: string, caret: number): PromptMentionRange | null {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.lastIndexOf("@");
  if (start < 0) return null;
  const query = beforeCaret.slice(start + 1);
  if (query.includes("\n") || query.length > 32) return null;
  const previous = start > 0 ? value[start - 1] : "";
  if (previous && !/\s|[\u3000([{"'“‘，。；：！？、]/.test(previous)) return null;
  return {
    start,
    end: caret,
    query,
  };
}

function normalizeMentionQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function promptDocumentNodesFromMentions(
  prompt: string,
  references: FizzAiReferenceBinding[]
): FizzAiPromptDocument["nodes"] {
  if (!prompt || references.length === 0) return [];

  const matches: Array<{ binding: FizzAiReferenceBinding; end: number; start: number }> = [];
  for (const binding of references) {
    const token = `@${binding.label}`;
    let cursor = 0;
    while (cursor < prompt.length) {
      const start = prompt.indexOf(token, cursor);
      if (start < 0) break;
      matches.push({ binding, start, end: start + token.length });
      cursor = start + token.length;
    }
  }

  if (matches.length === 0) return [];
  matches.sort((a, b) =>
    a.start === b.start ? b.end - b.start - (a.end - a.start) : a.start - b.start
  );

  const nodes: FizzAiPromptDocument["nodes"] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) {
      nodes.push({ type: "text", text: prompt.slice(cursor, match.start) });
    }
    nodes.push({
      type: "asset_ref",
      refId: match.binding.refId,
      label: match.binding.label,
    });
    cursor = match.end;
  }
  if (cursor < prompt.length) nodes.push({ type: "text", text: prompt.slice(cursor) });
  return nodes;
}

function optimisticRunSeconds(settings: ImageGenerationSettings): number {
  const count = Math.max(1, settings.variations || 1);
  const qualityFactor = settings.quality === "high" ? 1.35 : settings.quality === "low" ? 0.8 : 1;
  const resolution = settings.resolution.toLowerCase();
  const resolutionFactor = resolution.includes("4k") ? 1.55 : resolution.includes("2k") ? 1.2 : 1;
  const stepFactor =
    settings.inferenceSteps > 0 ? Math.min(1.8, Math.max(0.8, settings.inferenceSteps / 28)) : 1;
  return Math.ceil(72 * count * qualityFactor * resolutionFactor * stepFactor);
}

function seedInputValue(value: string): number | undefined {
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

function ImageMasonry({ items }: { items: typeof IMAGE_FEED }) {
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

function ImagePromptComposer({
  models,
  catalogLoading,
  catalogError,
  prompt,
  settings,
  settingsOpen,
  submitting,
  submitError,
  priceEstimate,
  referenceImages,
  referenceLimit,
  supportsReferences,
  referenceUploadError,
  canSubmit,
  onPromptChange,
  onSubmit,
  onOpenSettingsChange,
  onRetryCatalog,
  onReferenceFiles,
  onRemoveReferenceImage,
  onSettingsChange,
}: {
  models: FizzAiModel[];
  catalogLoading: boolean;
  catalogError: boolean;
  prompt: string;
  settings: ImageGenerationSettings;
  settingsOpen: boolean;
  submitting: boolean;
  submitError: string | null;
  priceEstimate: { sellPoints: number } | null;
  referenceImages: ReferenceImage[];
  referenceLimit: number;
  supportsReferences: boolean;
  referenceUploadError: string | null;
  canSubmit: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onOpenSettingsChange: (open: boolean) => void;
  onRetryCatalog: () => void;
  onReferenceFiles: (files: FileList | null) => void;
  onRemoveReferenceImage: (id: string) => void;
  onSettingsChange: (settings: ImageGenerationSettings) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionRange, setMentionRange] = useState<PromptMentionRange | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const modelLabel = settings.model
    ? getImageModelLabel(models, settings.model)
    : t("noModelSelected");
  const mentionOptions = useMemo<ReferenceMentionOption[]>(
    () =>
      referenceImages
        .filter((image) => image.url && !image.error)
        .map((image, index) => ({
          id: image.id,
          image,
          label: t("referenceMention.label", { number: index + 1 }),
        })),
    [referenceImages, t]
  );
  const filteredMentionOptions = useMemo(() => {
    if (!mentionRange) return [];
    const query = normalizeMentionQuery(mentionRange.query);
    if (!query) return mentionOptions;
    return mentionOptions.filter((option) =>
      normalizeMentionQuery(`${option.label} ${option.image.name}`).includes(query)
    );
  }, [mentionOptions, mentionRange]);
  const mentionOpen = Boolean(mentionRange && supportsReferences);

  const syncMentionRange = useCallback(
    (value: string, caret: number | null | undefined) => {
      if (!supportsReferences || caret == null) {
        setMentionRange(null);
        return;
      }
      const range = findPromptMentionRange(value, caret);
      setMentionRange(range);
      setActiveMentionIndex(0);
    },
    [supportsReferences]
  );

  const insertReferenceMention = useCallback(
    (option: ReferenceMentionOption) => {
      if (!mentionRange) return;
      const before = prompt.slice(0, mentionRange.start);
      const after = prompt.slice(mentionRange.end);
      const leading = before && !/\s$/.test(before) ? " " : "";
      const trailing = after && /^\s/.test(after) ? "" : " ";
      const insert = `${leading}@${option.label}${trailing}`;
      const nextPrompt = `${before}${insert}${after}`;
      const nextCaret = before.length + insert.length;
      onPromptChange(nextPrompt);
      setMentionRange(null);
      window.requestAnimationFrame(() => {
        promptInputRef.current?.focus();
        promptInputRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [mentionRange, onPromptChange, prompt]
  );

  useEffect(() => {
    if (!mentionRange) return;
    setActiveMentionIndex((index) =>
      filteredMentionOptions.length === 0 ? 0 : Math.min(index, filteredMentionOptions.length - 1)
    );
  }, [filteredMentionOptions.length, mentionRange]);

  return (
    <>
      {settingsOpen ? (
        <button
          type="button"
          aria-label="Close settings"
          onClick={() => onOpenSettingsChange(false)}
          className="fixed inset-0 z-[39] cursor-default bg-black/55 duration-150 animate-in fade-in-0"
        />
      ) : null}
      <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-[960px] lg:left-[72px] lg:right-6">
        <ImageSettingsPanel
          open={settingsOpen}
          models={models}
          isLoading={catalogLoading}
          error={catalogError}
          settings={settings}
          onOpenChange={onOpenSettingsChange}
          onRetry={onRetryCatalog}
          onSettingsChange={onSettingsChange}
        />
        <div className="relative z-10 w-full overflow-visible rounded-[16px] border border-white/[0.08] bg-[#141416] text-white shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="min-w-0 p-4">
            {supportsReferences ? (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => {
                  onReferenceFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            ) : null}
            <div
              className={cn(
                "relative min-h-[98px]",
                supportsReferences &&
                  (referenceLimit > 4 ? "pl-[238px] sm:pl-[260px]" : "pl-[184px] sm:pl-[202px]")
              )}
            >
              {supportsReferences ? (
                <ReferenceStack
                  images={referenceImages}
                  limit={referenceLimit}
                  addLabel={t("addReferenceImage")}
                  removeLabel={t("removeReferenceImage")}
                  overflowLabel={(count) => t("referenceOverflow", { count })}
                  onAdd={() => fileInputRef.current?.click()}
                  onRemove={onRemoveReferenceImage}
                />
              ) : null}
              <label className="sr-only" htmlFor="image-prompt">
                {t("promptLabel")}
              </label>
              <textarea
                ref={promptInputRef}
                id="image-prompt"
                maxLength={800}
                value={prompt}
                onChange={(event) => {
                  onPromptChange(event.target.value);
                  syncMentionRange(event.target.value, event.target.selectionStart);
                }}
                onKeyDown={(event) => {
                  if (mentionOpen) {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setMentionRange(null);
                      return;
                    }
                    if (event.key === "ArrowDown" && filteredMentionOptions.length > 0) {
                      event.preventDefault();
                      setActiveMentionIndex((index) => (index + 1) % filteredMentionOptions.length);
                      return;
                    }
                    if (event.key === "ArrowUp" && filteredMentionOptions.length > 0) {
                      event.preventDefault();
                      setActiveMentionIndex(
                        (index) =>
                          (index - 1 + filteredMentionOptions.length) %
                          filteredMentionOptions.length
                      );
                      return;
                    }
                    if (event.key === "Enter" && filteredMentionOptions[activeMentionIndex]) {
                      event.preventDefault();
                      insertReferenceMention(filteredMentionOptions[activeMentionIndex]);
                      return;
                    }
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
                onSelect={(event) =>
                  syncMentionRange(event.currentTarget.value, event.currentTarget.selectionStart)
                }
                onBlur={() => {
                  window.setTimeout(() => setMentionRange(null), 120);
                }}
                placeholder={t("promptPlaceholder")}
                className="h-[98px] w-full resize-none bg-transparent text-sm leading-7 text-white outline-none placeholder:text-white/40"
              />
              {mentionOpen ? (
                <ReferenceMentionMenu
                  options={filteredMentionOptions}
                  activeIndex={activeMentionIndex}
                  emptyLabel={t("referenceMention.empty")}
                  addLabel={t("referenceMention.add")}
                  canAdd={referenceImages.length < referenceLimit}
                  onAdd={() => fileInputRef.current?.click()}
                  onSelect={insertReferenceMention}
                />
              ) : null}
            </div>
            {referenceUploadError ? (
              <p className="mt-1 text-xs font-medium text-[#ff8a8d]">{referenceUploadError}</p>
            ) : null}
            {submitError ? (
              <p className="mt-1 text-xs font-medium text-[#ff8a8d]">{submitError}</p>
            ) : null}
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-expanded={settingsOpen}
                  onClick={() => onOpenSettingsChange(!settingsOpen)}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
                >
                  <IconAdjustmentsHorizontal className="size-4" stroke={1.8} />
                  {modelLabel}
                  {settings.aspectRatio ? ` / ${settings.aspectRatio}` : ""}
                  {settings.resolution ? ` / ${settings.resolution}` : ""}
                  <IconChevronDown className="size-4 text-white/48" stroke={1.9} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                {priceEstimate ? (
                  <span className="text-sm font-semibold tabular-nums text-white/70">
                    {t("priceEstimate", { points: priceEstimate.sellPoints })}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={onSubmit}
                  className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[16px] bg-[#E52227] px-9 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(229,34,39,0.28)] transition hover:bg-[#c91d22] hover:scale-[1.01] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                >
                  {submitting ? t("creating") : t("create")}
                  {submitting ? (
                    <IconLoader2 className="size-5 animate-spin" stroke={1.9} />
                  ) : (
                    <IconSend className="size-5" stroke={1.9} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ReferenceMentionMenu({
  options,
  activeIndex,
  emptyLabel,
  addLabel,
  canAdd,
  onAdd,
  onSelect,
}: {
  options: ReferenceMentionOption[];
  activeIndex: number;
  emptyLabel: string;
  addLabel: string;
  canAdd: boolean;
  onAdd: () => void;
  onSelect: (option: ReferenceMentionOption) => void;
}) {
  return (
    <div className="absolute left-[184px] top-8 z-[70] w-[270px] overflow-hidden rounded-[14px] border border-white/[0.1] bg-[#202124]/95 p-1.5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.48)] backdrop-blur-xl sm:left-[202px]">
      {options.length > 0 ? (
        <div className="max-h-[214px] overflow-y-auto">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(option);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors",
                index === activeIndex ? "bg-white/[0.1]" : "hover:bg-white/[0.07]"
              )}
            >
              <span className="relative flex size-10 shrink-0 overflow-hidden rounded-[8px] bg-white/[0.06] ring-1 ring-white/[0.12]">
                {option.image.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={option.image.url} alt="" className="size-full object-cover" />
                ) : (
                  <IconPhoto className="m-auto size-4 text-white/50" stroke={1.8} />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">
                  @{option.label}
                </span>
                <span className="block truncate text-xs text-white/45">{option.image.name}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2.5 text-xs font-medium text-white/48">{emptyLabel}</div>
      )}
      {canAdd ? (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onAdd();
          }}
          className="mt-1 flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.04] text-xs font-semibold text-white/78 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconPlus className="size-4" stroke={1.8} />
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}

function ReferenceUploadProgress({ progress }: { progress: number }) {
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 text-white/70">
      <IconLoader2 className="size-5 animate-spin" stroke={1.9} />
      <span className="text-xs font-semibold tabular-nums">{Math.round(progress)}%</span>
    </span>
  );
}

function ReferenceStack({
  images,
  limit,
  addLabel,
  removeLabel,
  overflowLabel,
  onAdd,
  onRemove,
}: {
  images: ReferenceImage[];
  limit: number;
  addLabel: string;
  removeLabel: string;
  overflowLabel: (count: number) => string;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleImages = images.slice(0, 4);
  const overflowCount = Math.max(0, images.length - visibleImages.length);
  const canAdd = images.length < limit;

  if (visibleImages.length === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="absolute left-0 top-0 flex h-[72px] w-[54px] rotate-[-5deg] items-center justify-center rounded-[9px] border-2 border-white/[0.16] bg-[#30343d] text-white/62 shadow-[0_16px_42px_rgba(0,0,0,0.32)] transition-colors hover:border-white/[0.26] hover:bg-[#3a3f49] hover:text-white"
        aria-label={addLabel}
      >
        <IconPlus className="size-6" stroke={1.8} />
      </button>
    );
  }

  return (
    <div
      className="group/stack absolute left-0 top-0 z-10 h-[92px] w-[248px] overflow-visible"
      onMouseEnter={() => setExpanded(true)}
      onMouseMove={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onPointerEnter={() => setExpanded(true)}
      onPointerMove={() => setExpanded(true)}
      onPointerLeave={() => setExpanded(false)}
    >
      {visibleImages.map((image, index) => {
        const compactLeft = index * 24;
        const expandedLeft = index * 42;
        const compactTop = [8, 0, 8, 4][index] ?? 6;
        const expandedTop = [6, 2, 6, 3][index] ?? 6;
        const compactRotate = ["-8deg", "4deg", "-3deg", "6deg"][index] ?? "0deg";
        const expandedRotate = ["-6deg", "-2deg", "2deg", "6deg"][index] ?? "0deg";
        const isLastVisible = index === visibleImages.length - 1;
        return (
          <div
            key={image.id}
            className="group/card absolute h-[72px] w-[54px] overflow-visible rounded-[9px] border-2 border-white/90 bg-[#202022] shadow-[0_16px_42px_rgba(0,0,0,0.35)] transition-[left,top,rotate,translate] duration-200 ease-out hover:z-30 hover:-translate-y-1 hover:rotate-0"
            style={{
              left: expanded ? expandedLeft : compactLeft,
              top: expanded ? expandedTop : compactTop,
              rotate: expanded ? expandedRotate : compactRotate,
              zIndex: 10 + index,
            }}
          >
            <ReferenceStackMedia image={image} />
            {overflowCount > 0 && isLastVisible ? (
              <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/62 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                {overflowLabel(overflowCount)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(image.id);
              }}
              className={cn(
                "absolute -right-2.5 -top-2.5 z-50 flex size-6 items-center justify-center rounded-full bg-[#27292e] text-white shadow-[0_8px_22px_rgba(0,0,0,0.5)] ring-1 ring-white/25 transition-opacity duration-150 group-hover/card:opacity-100",
                expanded ? "opacity-100" : "opacity-0"
              )}
              aria-label={removeLabel}
            >
              <IconX className="size-3.5" stroke={2.2} />
            </button>
          </div>
        );
      })}
      {canAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="absolute top-[6px] flex h-[72px] w-[54px] rotate-[5deg] items-center justify-center rounded-[9px] border-2 border-white/[0.12] bg-[#30343d] text-white/68 shadow-[0_16px_38px_rgba(0,0,0,0.28)] transition-colors hover:border-white/[0.22] hover:bg-[#3a3f49] hover:text-white"
          style={{
            left: (expanded ? visibleImages.length * 42 : visibleImages.length * 24) + 12,
            zIndex: 20 + visibleImages.length,
          }}
          aria-label={addLabel}
        >
          <IconPlus className="size-6" stroke={1.8} />
        </button>
      ) : null}
    </div>
  );
}

function ReferenceStackMedia({ image }: { image: ReferenceImage }) {
  return (
    <div className="size-full overflow-hidden rounded-[7px]">
      {image.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url} alt="" className="size-full object-cover" />
      ) : image.uploading ? (
        <ReferenceUploadProgress progress={image.progress} />
      ) : (
        <span className="flex size-full items-center justify-center text-[#ff8a8d]">
          <IconPhoto className="size-4" stroke={1.8} />
        </span>
      )}
    </div>
  );
}

"use client";

import { useCurrentUser } from "@/src/hooks/use-user";
import {
  useGenerationSubmission,
  UncertainGenerationSubmissionError,
} from "../../_hooks/use-generation-submission";

import type { UploadKind } from "@repo/shared/media-upload";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconClock,
  IconDownload,
  IconLoader2,
  IconMaximize,
  IconMovie,
} from "@tabler/icons-react";
import type { AiJobUpdatePayload, AssetEvent } from "@repo/shared";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import { useAppDispatch } from "@/src/store";
import { touchCredits } from "@/src/store/slices/userSlice";
import { useAiCatalog, usableModelsByModality } from "../../_hooks/use-ai-catalog";
import { computeBillingKeys } from "../../_hooks/use-billing";
import {
  buildPromptDocument,
  cheapestSellPoints,
  compactFizzAiInput,
  defaultSettingsForModel,
  errorMessageFromJob,
  estimateModelSellPoints,
  filterFizzAiInput,
  generationIdempotencyKey,
  generationStatusFromRaw,
  getFizzAiJob,
  hasSchemaProperty,
  isTerminalGenerationStatus,
  listFizzAiJobs,
  normalizeFizzAiError,
  referenceFieldConstraints,
  retryFizzAiJob,
  type FizzAiGenerationStatus,
  type FizzAiJobView,
  type FizzAiModel,
  type FizzAiReferenceBinding,
  type FizzAiReferenceFieldConstraints,
  type FizzAiReferenceKind,
  type FizzAiSubmitResponse,
  type ModelSettings,
} from "../../_lib/generation-api";
import { openAssetsRealtime } from "../../_lib/assets-realtime";
import {
  SLOT_SCHEMA_FIELD,
  VIDEO_MODES,
  type StudioModeKey,
  type StudioSlotKind,
} from "../../_lib/studio-modes";
import { FizzStudioShell, useFizzStudioWorkspace } from "./fizzstudio-shell";
import { getModelLabel, modelById } from "./model-settings-panel";
import {
  StudioComposer,
  type StudioComposerReferenceCards,
  type StudioReferenceCard,
  type StudioReferenceItem,
} from "./studio-composer";
import { StudioResultLightbox, type StudioResultLightboxItem } from "./studio-result-lightbox";

type VideoTab = "history" | "community";
const VIDEO_TABS: VideoTab[] = ["history", "community"];

const POLL_INTERVAL_MS = 2600;
const HISTORY_LIMIT = 60;

type VideoStudioT = ReturnType<typeof useTranslations>;

/** Direct-to-storage upload kind per reference media kind (server allowlist). */
const UPLOAD_KIND_BY_REFERENCE: Record<FizzAiReferenceKind, UploadKind> = {
  image: "ai_reference_image",
  video: "ai_reference_video",
  audio: "ai_reference_audio",
};

/** Browser mime quirks → the canonical types the catalog/server allow-list. */
const MIME_ALIASES: Record<string, string> = {
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/mp3": "audio/mpeg",
  "video/x-m4v": "video/mp4",
};

// Seedance's reference-video band is fuzzy ("~480p (640×640) – ~720p
// (834×1112)"); validate by pixel count with tolerance at both ends so we
// reject clear violations without false-failing borderline encodes.
const RESOLUTION_BAND_MIN_PIXELS = 300_000; // ≈ 640×480
const RESOLUTION_BAND_MAX_PIXELS = 1_000_000; // ≈ 834×1112 / 1280×720

/** One uploaded (or in-flight) file inside a slot. Labels are derived at render. */
interface UploadedSlotItem {
  id: string;
  name: string;
  progress: number;
  uploading: boolean;
  url?: string;
  assetId?: string;
  error?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  sizeBytes: number;
}

/** Local row tracking one submitted video job through its lifecycle. */
interface VideoResultJob {
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
  videos: Array<{
    durationSeconds?: number | null;
    height?: number | null;
    id: string;
    url: string;
    width?: number | null;
  }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  error?: string;
}

export function VideoStudioPage() {
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
      <VideoStudioSurface
        key={JSON.stringify([user?.id, workspaceState.workspaceId])}
        workspaceId={workspaceState.workspaceId}
      />
    </FizzStudioShell>
  );
}

function VideoStudioSurface({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("fizzStudio.videoStudio");
  const modesT = useTranslations("fizzStudio.videoStudio.modes");
  const composerT = useTranslations("fizzStudio.studioComposer");
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const catalogQuery = useAiCatalog();

  const [activeTab, setActiveTab] = useState<VideoTab>("history");
  const [activeMode, setActiveMode] = useState<StudioModeKey>("reference_to_video");
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [settings, setSettings] = useState<ModelSettings>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [slotItems, setSlotItems] = useState<Record<string, UploadedSlotItem[]>>({});
  const [jobs, setJobs] = useState<VideoResultJob[]>([]);
  const {
    submit: submitGeneration,
    isCurrent: submissionIsCurrent,
    ready: submissionReady,
    recovery,
  } = useGenerationSubmission({
    workspaceId,
    surface: "fizzstudio-video-studio",
    onRecovered: (job, receipt) => {
      setJobs((previous) =>
        mergeVideoJob(
          previous.filter((row) => row.localId !== receipt.target.localId),
          jobViewToVideoJob(job, t)
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
  const slotItemsRef = useRef(slotItems);
  useEffect(() => {
    slotItemsRef.current = slotItems;
  }, [slotItems]);

  const mode = useMemo(
    () => VIDEO_MODES.find((m) => m.key === activeMode) ?? VIDEO_MODES[0],
    [activeMode]
  );

  // All usable video models (the settings list); the mode selects inputs, not models.
  const videoModels = useMemo(
    () => usableModelsByModality(catalogQuery.data, "video"),
    [catalogQuery.data]
  );
  // Seed the model + its schema-default settings once the catalog loads.
  useEffect(() => {
    if (modelId || videoModels.length === 0) return;
    setModelId(videoModels[0].id);
    setSettings(defaultSettingsForModel(videoModels[0]));
  }, [videoModels, modelId]);
  const selectedModel = useMemo(
    () => videoModels.find((m) => m.id === modelId),
    [videoModels, modelId]
  );

  const selectModel = useCallback(
    (id: string) => {
      const model = modelById(videoModels, id);
      setModelId(id);
      setSettings(defaultSettingsForModel(model));
      // Trim slot uploads down to the new model's per-field limits.
      setSlotItems((prev) => {
        const next: Record<string, UploadedSlotItem[]> = {};
        for (const [field, items] of Object.entries(prev)) {
          const constraints = referenceFieldConstraints(model, field);
          next[field] =
            constraints && items.length > constraints.maxItems
              ? items.slice(0, constraints.maxItems)
              : items;
        }
        return next;
      });
    },
    [videoModels]
  );

  // Live 积分 cost for the current model + settings. Seedance prices per
  // second: the string `duration` enum ('auto' quotes the ceiling) and the
  // legacy numeric `durationSeconds` both flow into the estimator. Reference
  // videos switch the meter (Seedance 2.5 charges input + output seconds at
  // the reference rate), so ready reference uploads must feed the estimate —
  // only items that would actually be submitted count.
  const cost = useMemo(() => {
    if (!selectedModel) return null;
    const duration = typeof settings.duration === "string" ? settings.duration : undefined;
    const durationSeconds =
      typeof settings.durationSeconds === "number" ? settings.durationSeconds : undefined;
    const resolution = typeof settings.resolution === "string" ? settings.resolution : undefined;
    const readyVideos = (slotItems.referenceVideos ?? []).filter(
      (item) => Boolean(item.url) && !item.error
    );
    const referenceVideoSeconds = readyVideos.reduce(
      (seconds, item) =>
        seconds +
        (typeof item.durationSeconds === "number" && Number.isFinite(item.durationSeconds)
          ? item.durationSeconds
          : 0),
      0
    );
    return (
      estimateModelSellPoints(selectedModel, {
        duration,
        durationSeconds,
        resolution,
        generateAudio:
          typeof settings.generateAudio === "boolean" ? settings.generateAudio : undefined,
        numOutputs: 1,
        referenceImageCount:
          (slotItems.referenceImages ?? []).filter((item) => Boolean(item.url) && !item.error)
            .length || undefined,
        referenceVideoSeconds: referenceVideoSeconds > 0 ? referenceVideoSeconds : undefined,
        // Seedance 2.5 edit keeps the source video's duration — the auto quote
        // follows the combined reference-video length (mirrors the server hold).
        outputDurationFollowsReferenceVideos: settings.omniReferenceTaskType === "edit",
      })?.sellPoints ?? cheapestSellPoints(selectedModel)
    );
  }, [
    selectedModel,
    slotItems,
    settings.duration,
    settings.durationSeconds,
    settings.generateAudio,
    settings.omniReferenceTaskType,
    settings.resolution,
  ]);

  const uploadSlots = useMemo(
    () =>
      mode.inputSlots.filter(
        (slot): slot is Exclude<StudioSlotKind, "prompt"> => slot !== "prompt"
      ),
    [mode]
  );

  /* ── reference uploads (schema-driven cards) ──────────────────────────── */

  const removeSlotItem = useCallback((field: string, id: string) => {
    setSlotItems((prev) => ({
      ...prev,
      [field]: (prev[field] ?? []).filter((item) => item.id !== id),
    }));
  }, []);

  /** Items across the multimodal arrays that count toward maxTotalFiles. */
  const countTotalReferences = useCallback((): number => {
    const items = slotItemsRef.current;
    return ["referenceImages", "referenceVideos", "referenceAudios"].reduce(
      (sum, field) => sum + (items[field]?.length ?? 0),
      0
    );
  }, []);

  const handleSlotFiles = useCallback(
    async (field: string, constraints: FizzAiReferenceFieldConstraints, files: FileList | null) => {
      if (!files || files.length === 0) return;
      setReferenceError(null);

      const current = slotItemsRef.current[field] ?? [];
      const currentValid = current.filter((item) => !item.error);
      const totalNow = constraints.maxTotalFiles != null ? countTotalReferences() : 0;
      const typeRemaining = Math.max(0, constraints.maxItems - current.length);
      const totalRemaining =
        constraints.maxTotalFiles != null
          ? Math.max(0, constraints.maxTotalFiles - totalNow)
          : Number.POSITIVE_INFINITY;
      const selected = Array.from(files).slice(0, Math.min(typeRemaining, totalRemaining));
      if (selected.length === 0) return;

      // Running combined tallies (existing valid items + accepted picks).
      let combinedBytes = currentValid.reduce((sum, item) => sum + item.sizeBytes, 0);
      let combinedSeconds = currentValid.reduce(
        (sum, item) => sum + (item.durationSeconds ?? 0),
        0
      );

      for (const file of selected) {
        // 1. format (accept + file.type)
        if (!fileMatchesAccept(file, constraints.accept, constraints.acceptFormats)) {
          setReferenceError(
            t("referenceErrors.format", {
              formats: constraints.acceptFormats.join(" / ").toUpperCase(),
            })
          );
          continue;
        }
        // 2. per-file size
        if (
          constraints.maxFileSizeMb != null &&
          file.size > constraints.maxFileSizeMb * 1024 * 1024
        ) {
          setReferenceError(t("referenceErrors.fileTooLarge", { max: constraints.maxFileSizeMb }));
          continue;
        }
        // 3. combined size (videos)
        if (
          constraints.maxCombinedFileSizeMb != null &&
          combinedBytes + file.size > constraints.maxCombinedFileSizeMb * 1024 * 1024
        ) {
          setReferenceError(
            t("referenceErrors.combinedSizeTooLarge", { max: constraints.maxCombinedFileSizeMb })
          );
          continue;
        }
        // 4. duration + resolution probing (offscreen <video>/<audio>)
        let probed: { durationSeconds: number; height?: number; width?: number } | null = null;
        if (constraints.kind === "video" || constraints.kind === "audio") {
          try {
            probed = await probeMediaMetadata(file, constraints.kind);
          } catch {
            setReferenceError(t("referenceErrors.probeFailed"));
            continue;
          }
          if (
            constraints.maxCombinedDurationSeconds != null &&
            combinedSeconds + probed.durationSeconds > constraints.maxCombinedDurationSeconds
          ) {
            setReferenceError(
              constraints.kind === "video"
                ? t("referenceErrors.videoCombinedDuration", {
                    min: constraints.minCombinedDurationSeconds ?? 0,
                    max: constraints.maxCombinedDurationSeconds,
                  })
                : t("referenceErrors.audioCombinedDuration", {
                    max: constraints.maxCombinedDurationSeconds,
                  })
            );
            continue;
          }
          if (
            constraints.kind === "video" &&
            constraints.resolutionBand &&
            violatesResolutionBand(probed.width, probed.height)
          ) {
            setReferenceError(
              t("referenceErrors.resolutionBand", { band: constraints.resolutionBand })
            );
            continue;
          }
        }

        combinedBytes += file.size;
        combinedSeconds += probed?.durationSeconds ?? 0;

        const id = generationIdempotencyKey("ref");
        const optimistic: UploadedSlotItem = {
          id,
          name: file.name,
          progress: 0,
          uploading: true,
          sizeBytes: file.size,
          durationSeconds: probed?.durationSeconds,
          width: probed?.width,
          height: probed?.height,
        };
        setSlotItems((prev) => ({ ...prev, [field]: [...(prev[field] ?? []), optimistic] }));

        try {
          const uploaded = await uploadFileViaSignedUrl(file, {
            kind: UPLOAD_KIND_BY_REFERENCE[constraints.kind],
            // Send the alias-normalized mime (audio/x-wav→audio/wav etc.) so the
            // server's allowlist sees the same canonical type the client accepted.
            contentType: file.type
              ? (MIME_ALIASES[file.type.toLowerCase()] ?? file.type)
              : undefined,
            onProgress: (progress) => {
              setSlotItems((prev) => ({
                ...prev,
                [field]: (prev[field] ?? []).map((item) =>
                  item.id === id ? { ...item, progress } : item
                ),
              }));
            },
          });
          setSlotItems((prev) => ({
            ...prev,
            [field]: (prev[field] ?? []).map((item) =>
              item.id === id
                ? {
                    ...item,
                    assetId: uploaded.mediaAssetId,
                    progress: 100,
                    uploading: false,
                    url: uploaded.url,
                  }
                : item
            ),
          }));
        } catch (error) {
          if (isUploadAbort(error)) {
            setSlotItems((prev) => ({
              ...prev,
              [field]: (prev[field] ?? []).filter((item) => item.id !== id),
            }));
            combinedBytes -= file.size;
            combinedSeconds -= probed?.durationSeconds ?? 0;
            continue;
          }
          const message = normalizeFizzAiError(error, t("referenceErrors.uploadFailed"));
          setReferenceError(message);
          setSlotItems((prev) => ({
            ...prev,
            [field]: (prev[field] ?? []).map((item) =>
              item.id === id ? { ...item, uploading: false, error: message } : item
            ),
          }));
          combinedBytes -= file.size;
          combinedSeconds -= probed?.durationSeconds ?? 0;
        }
      }
    },
    [countTotalReferences, t]
  );

  const readyItems = useCallback(
    (field: string): UploadedSlotItem[] =>
      (slotItems[field] ?? []).filter((item) => Boolean(item.url) && !item.error),
    [slotItems]
  );

  const hasVisualReference =
    readyItems("referenceImages").length + readyItems("referenceVideos").length > 0 ||
    (slotItems.referenceImages ?? []).some((item) => item.uploading) ||
    (slotItems.referenceVideos ?? []).some((item) => item.uploading);

  // Build the schema-driven upload cards: one per reference field the active
  // mode requests AND the selected model declares. Mention labels follow the
  // schema's promptRefPrefix (Image1 / Video1 / Audio1).
  const referenceCardsBundle = useMemo<StudioComposerReferenceCards | null>(() => {
    if (uploadSlots.length === 0) return null;
    const cards: StudioReferenceCard[] = [];
    const mentionable: StudioReferenceItem[] = [];
    let totalMax: number | null = null;
    let totalCount = 0;

    for (const slot of uploadSlots) {
      const field = SLOT_SCHEMA_FIELD[slot];
      const constraints = referenceFieldConstraints(selectedModel, field);
      if (!constraints) continue;
      const rawItems = slotItems[field] ?? [];
      const prefix = constraints.promptRefPrefix?.replace(/^@/, "") ?? "";
      const items: StudioReferenceItem[] = rawItems.map((item, index) => ({
        id: item.id,
        kind: constraints.kind,
        label: prefix ? `${prefix}${index + 1}` : "",
        name: item.name,
        progress: item.progress,
        uploading: item.uploading,
        url: item.url,
        assetId: item.assetId,
        error: item.error,
        durationSeconds: item.durationSeconds,
      }));

      const countsTowardTotal = constraints.maxTotalFiles != null;
      if (countsTowardTotal) {
        totalMax = constraints.maxTotalFiles ?? totalMax;
        totalCount += rawItems.length;
      }

      const audioBlocked =
        constraints.kind === "audio" && constraints.audioRequiresVisual && !hasVisualReference;
      const atTypeMax = rawItems.length >= constraints.maxItems;
      const addDisabledReason = audioBlocked
        ? composerT("references.audioNeedsVisual")
        : atTypeMax
          ? composerT("references.typeAtMax")
          : null;

      cards.push({
        slot: field,
        kind: constraints.kind,
        title: cardTitleForField(field, composerT),
        items,
        max: constraints.maxItems,
        accept: constraints.accept,
        multiple: constraints.maxItems > 1,
        addDisabledReason,
        onFiles: (files) => void handleSlotFiles(field, constraints, files),
        onRemove: (id) => removeSlotItem(field, id),
      });
      if (prefix) mentionable.push(...items);
    }

    if (cards.length === 0) return null;

    // Apply the cross-type ceiling AFTER counting every card.
    if (totalMax != null && totalCount >= totalMax) {
      for (const card of cards) {
        if (card.addDisabledReason == null && card.items.length < card.max) {
          card.addDisabledReason = composerT("references.totalAtMax", { max: totalMax });
        }
      }
    }

    return {
      cards,
      totalCount,
      totalMax,
      uploadError: referenceError,
      mentionable,
    };
  }, [
    composerT,
    handleSlotFiles,
    hasVisualReference,
    referenceError,
    removeSlotItem,
    selectedModel,
    slotItems,
    uploadSlots,
  ]);

  /* ── submit validity ──────────────────────────────────────────────────── */

  // Only uploads for the ACTIVE mode's fields gate submit — a leftover
  // in-flight upload from a previously-active mode can't affect this payload.
  const uploadsInFlight = uploadSlots.some((slot) =>
    (slotItems[SLOT_SCHEMA_FIELD[slot]] ?? []).some((item) => item.uploading)
  );

  // Mode-required inputs: i2v needs a start frame, first/last needs both,
  // multimodal forbids audio-only reference sets. A mode whose required field
  // the selected model doesn't declare is NOT satisfiable — submitting would
  // silently drop the input (filterFizzAiInput strips undeclared fields).
  const modeInputsSatisfied = useMemo(() => {
    if (mode.key === "image_to_video") {
      return hasSchemaProperty(selectedModel, "startFrame") && readyItems("startFrame").length > 0;
    }
    if (mode.key === "first_last_frame_to_video") {
      return (
        hasSchemaProperty(selectedModel, "startFrame") &&
        hasSchemaProperty(selectedModel, "endFrame") &&
        readyItems("startFrame").length > 0 &&
        readyItems("endFrame").length > 0
      );
    }
    if (mode.key === "reference_to_video") {
      const audios = readyItems("referenceAudios").length;
      const visuals = readyItems("referenceImages").length + readyItems("referenceVideos").length;
      return !(audios > 0 && visuals === 0);
    }
    return true;
  }, [mode.key, readyItems, selectedModel]);

  // Combined reference-video duration must reach the schema minimum (2s) by
  // submit time — a single short clip can be valid mid-edit but not submitted.
  const videoDurationShortfall = useMemo(() => {
    if (!uploadSlots.includes("referenceVideos")) return null;
    const constraints = referenceFieldConstraints(selectedModel, "referenceVideos");
    if (!constraints || constraints.minCombinedDurationSeconds == null) return null;
    const ready = readyItems("referenceVideos");
    if (ready.length === 0) return null;
    const combined = ready.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);
    if (combined >= constraints.minCombinedDurationSeconds) return null;
    return t("referenceErrors.videoCombinedDuration", {
      min: constraints.minCombinedDurationSeconds,
      max: constraints.maxCombinedDurationSeconds ?? constraints.minCombinedDurationSeconds,
    });
  }, [readyItems, selectedModel, t, uploadSlots]);

  const canSubmit = Boolean(
    selectedModel &&
    prompt.trim() &&
    !submitting &&
    !uploadsInFlight &&
    modeInputsSatisfied &&
    !videoDurationShortfall
  );

  /* ── history + realtime + polling (mirrors the image studio) ─────────── */

  const refreshComputeBilling = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: computeBillingKeys.all });
  }, [queryClient]);

  const mergeJob = useCallback((job: VideoResultJob) => {
    setJobs((prev) => mergeVideoJob(prev, job));
  }, []);

  const reconcileHistory = useCallback(
    async (reconcileMode: "merge" | "replace" = "merge") => {
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
          sourceSurface: "fizzstudio-video-studio",
          type: "video",
        });
        if (historyRequestSeqRef.current !== requestSeq) return;
        const incoming = response.jobs.map((job) => jobViewToVideoJob(job, t));
        setJobs((prev) =>
          incoming.reduce(
            (acc, job) => mergeVideoJob(acc, job),
            reconcileMode === "replace" ? [] : prev
          )
        );
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[fizzstudio-video] history reconcile failed", err);
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
      if (job.type !== "video") return;
      if (job.sourceSurface !== "fizzstudio-video-studio") return;
      mergeJob(jobUpdateToVideoJob(job, t));
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
            console.log(`[fizzstudio-video-realtime] disconnected: ${reason}`);
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

  const activeJobIds = useMemo(
    () =>
      jobs
        .filter((job) => job.jobId && !isTerminalGenerationStatus(job.status))
        .map((job) => job.jobId),
    [jobs]
  );
  const activeJobKey = useMemo(() => [...activeJobIds].sort().join("|"), [activeJobIds]);

  // Completed outputs flattened in History order → shared result lightbox
  // items (kind drives the media element + the extra duration metadata row).
  const detailItems = useMemo(() => flattenVideoDetailItems(jobs), [jobs]);
  const lightboxItems = useMemo<StudioResultLightboxItem[]>(
    () =>
      detailItems.map((item) => ({
        id: item.id,
        kind: "video" as const,
        url: item.video.url,
        prompt: item.job.prompt,
        createdAt: item.job.completedAt ?? item.job.createdAt,
        modelLabel:
          item.job.modelId && videoModels.length > 0
            ? getModelLabel(videoModels, item.job.modelId)
            : (item.job.modelId ?? t("results.modelFallback")),
        width: item.video.width,
        height: item.video.height,
        durationSeconds: item.video.durationSeconds,
        fallbackRatio: videoFallbackRatio(item.job),
      })),
    [detailItems, t, videoModels]
  );
  const hasSelectedDetail =
    selectedDetailId != null && lightboxItems.some((item) => item.id === selectedDetailId);

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
              videos: resultVideos(job.outputs),
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

  /* ── submit ───────────────────────────────────────────────────────────── */

  const submit = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!submissionReady || !trimmedPrompt || !selectedModel || !canSubmit || recovery.pending)
      return;

    setSubmitting(true);
    setSubmitError(null);
    setActiveTab("history");

    const fieldsInMode = uploadSlots.map((slot) => SLOT_SCHEMA_FIELD[slot]);
    const ready = (field: string) => (fieldsInMode.includes(field) ? readyItems(field) : []);

    // Kind-aware bindings spanning every mentionable reference array.
    const referenceBindings: FizzAiReferenceBinding[] = [];
    if (referenceCardsBundle) {
      for (const item of referenceCardsBundle.mentionable) {
        if (!item.url || item.error || !item.label) continue;
        referenceBindings.push({
          refId: item.id,
          kind: item.kind,
          label: item.label,
          order: referenceBindings.length + 1,
          url: item.url,
          ...(item.assetId ? { assetId: item.assetId } : {}),
        });
      }
    }
    const promptDocument = buildPromptDocument(trimmedPrompt, referenceBindings);

    const frameInput = (field: string): { assetId?: string; url: string } | undefined => {
      const item = ready(field)[0];
      if (!item?.url) return undefined;
      return { url: item.url, ...(item.assetId ? { assetId: item.assetId } : {}) };
    };
    const arrayInput = (
      field: string
    ):
      | Array<{
          assetId?: string;
          refId: string;
          url: string;
          durationSeconds?: number;
          bytes?: number;
        }>
      | undefined => {
      const items = ready(field);
      if (items.length === 0) return undefined;
      return items.map((item) => ({
        url: item.url!,
        refId: item.id,
        ...(item.assetId ? { assetId: item.assetId } : {}),
        ...(typeof item.durationSeconds === "number" && Number.isFinite(item.durationSeconds)
          ? { durationSeconds: item.durationSeconds }
          : {}),
        ...(typeof item.sizeBytes === "number" && Number.isFinite(item.sizeBytes)
          ? { bytes: item.sizeBytes }
          : {}),
      }));
    };

    const input = filterFizzAiInput(
      selectedModel,
      compactFizzAiInput({
        ...settings,
        prompt: trimmedPrompt,
        seed: seedInputValue(settings.seed),
        startFrame: frameInput("startFrame"),
        endFrame: frameInput("endFrame"),
        referenceImages: arrayInput("referenceImages"),
        referenceVideos: arrayInput("referenceVideos"),
        referenceAudios: arrayInput("referenceAudios"),
      })
    );

    const localId = generationIdempotencyKey("local");
    const now = new Date().toISOString();
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
        videos: [],
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
            sourceSurface: "fizzstudio-video-studio",
          },
          idempotencyKey: generationIdempotencyKey(`fizzstudio:video-studio:${workspaceId}`),
          input,
          promptDocument,
          referenceBindings: referenceBindings.length > 0 ? referenceBindings : undefined,
          modelId: selectedModel.id,
          schemaVersion: selectedModel.schemaVersion,
        },
        "video",
        { localId: localId }
      );
      if (!submissionIsCurrent()) return;
      dispatch(touchCredits());
      refreshComputeBilling();
      applySubmitResponse(setJobs, localId, response);
    } catch (error) {
      if (!submissionIsCurrent()) return;
      const message = normalizeFizzAiError(error, t("results.failed"));
      setSubmitError(message);
      if (error instanceof UncertainGenerationSubmissionError) {
        setJobs((previous) =>
          previous.map((row) =>
            row.localId === localId
              ? { ...row, stage: "submission_unconfirmed", error: message }
              : row
          )
        );
      } else markRowFailed(setJobs, localId, message);
    } finally {
      if (submissionIsCurrent()) setSubmitting(false);
    }
  }, [
    submitGeneration,
    submissionIsCurrent,
    submissionReady,
    recovery.pending,
    canSubmit,
    dispatch,
    prompt,
    readyItems,
    refreshComputeBilling,
    referenceCardsBundle,
    selectedModel,
    settings,
    t,
    uploadSlots,
    workspaceId,
  ]);

  /* ── retry ────────────────────────────────────────────────────────────── */

  const retryJob = useCallback(
    (localId: string) => {
      if (submitting || recovery.pending) return;
      const failed = jobs.find((row) => row.localId === localId);
      if (!failed) return;

      let runRetry: (() => Promise<FizzAiSubmitResponse>) | null = null;
      let retryModelId = failed.modelId;
      let retrySchemaVersion = failed.schemaVersion;

      if (failed.jobId) {
        const jobId = failed.jobId;
        runRetry = () => retryFizzAiJob(jobId);
      } else {
        // Local fallback ONLY for rows that never reached the server —
        // rebuilt contract-complete from the stored input.
        const model = failed.modelId ? modelById(videoModels, failed.modelId) : undefined;
        const retryInput = failed.input;
        if (!model || !retryInput || model.schemaVersion !== failed.schemaVersion) {
          setPrompt(failed.prompt);
          setSubmitError(t("results.retryUnavailable"));
          return;
        }
        retryModelId = model.id;
        retrySchemaVersion = model.schemaVersion;
        const referenceBindings = videoBindingsFromInput(retryInput);
        const promptDocument = buildPromptDocument(failed.prompt, referenceBindings);
        runRetry = () =>
          submitGeneration(
            {
              context: {
                workspaceId,
                projectId: "",
                documentId: "",
                documentBlockId: "",
                sourceSurface: "fizzstudio-video-studio",
              },
              idempotencyKey: generationIdempotencyKey(
                `fizzstudio:video-studio-retry:${workspaceId}`
              ),
              input: retryInput,
              promptDocument,
              referenceBindings: referenceBindings.length > 0 ? referenceBindings : undefined,
              modelId: model.id,
              schemaVersion: model.schemaVersion,
            },
            "video",
            { localId: retryLocalId }
          );
      }

      setSubmitting(true);
      setSubmitError(null);
      setActiveTab("history");
      const retryLocalId = generationIdempotencyKey("retry");
      const now = new Date().toISOString();

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
          videos: [],
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
          applySubmitResponse(setJobs, retryLocalId, response);
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
          if (error instanceof UncertainGenerationSubmissionError) {
            setJobs((previous) =>
              previous.map((row) =>
                row.localId === retryLocalId
                  ? { ...row, stage: "submission_unconfirmed", error: message }
                  : row
              )
            );
          } else markRowFailed(setJobs, retryLocalId, message);
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
      jobs,
      refreshComputeBilling,
      submitting,
      t,
      videoModels,
      workspaceId,
    ]
  );

  return (
    <div className="relative min-h-[calc(100svh-64px)] pb-[430px] text-white md:pb-56">
      {/* Sticky tabs — same as the image studio */}
      <div className="sticky top-16 z-30 border-b border-white/[0.06] bg-[#09090a]/88 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6 xl:px-8">
          <div className="shrink-0 text-base font-semibold text-white">{t("title")}</div>
          <div
            role="tablist"
            aria-label={t("modeTabsLabel")}
            className="flex h-8 rounded-[14px] bg-white/[0.04] p-1"
          >
            {VIDEO_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
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

      {/* Feed */}
      <section className="px-4 pb-10 pt-5 sm:px-6 xl:px-8">
        <div className="mx-auto max-w-none">
          {activeTab === "history" ? (
            <VideoResultsSection
              jobs={jobs}
              loading={historyLoading}
              onRetry={retryJob}
              onOpenVideo={setSelectedDetailId}
            />
          ) : (
            <div className="grid min-h-[220px] place-items-center px-6 text-center sm:min-h-[260px]">
              <div>
                <div className="mx-auto mb-3 grid size-10 place-items-center text-white/50">
                  <IconMovie className="size-5" stroke={1.8} />
                </div>
                <p className="text-sm font-semibold text-white/82">{t("communityEmpty")}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <StudioComposer
        submissionRecovery={recovery}
        models={videoModels}
        catalogLoading={catalogQuery.isLoading}
        catalogError={catalogQuery.isError}
        selectedModelId={modelId}
        settings={settings}
        prompt={prompt}
        submitting={submitting}
        submitError={submitError}
        priceEstimate={cost != null ? { sellPoints: cost } : null}
        canSubmit={submissionReady && canSubmit && !recovery.pending}
        onPromptChange={setPrompt}
        onSubmit={() => void submit()}
        onSelectModel={selectModel}
        onSettingsChange={setSettings}
        onRetryCatalog={() => void catalogQuery.refetch()}
        referenceCards={
          referenceCardsBundle
            ? { ...referenceCardsBundle, uploadError: referenceError ?? videoDurationShortfall }
            : undefined
        }
        modes={{
          modes: VIDEO_MODES,
          active: activeMode,
          mode,
          label: modesT(mode.i18nKey),
          onSelect: setActiveMode,
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

/* ── results (history) ────────────────────────────────────────────────────── */

function VideoResultsSection({
  jobs,
  loading,
  onOpenVideo,
  onRetry,
}: {
  jobs: VideoResultJob[];
  loading: boolean;
  onOpenVideo: (detailId: string) => void;
  onRetry: (localId: string) => void;
}) {
  const t = useTranslations("fizzStudio.videoStudio");

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-semibold tracking-[0.01em] text-white/88">
          {t("results.title")}
        </h2>
        <p className="mt-1 text-xs font-medium text-white/42">{t("results.hint")}</p>
      </div>
      {loading && jobs.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center sm:min-h-[260px]">
          <IconLoader2 className="size-6 animate-spin text-white/48" stroke={1.9} />
        </div>
      ) : null}
      {!loading && jobs.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center px-6 text-center sm:min-h-[260px]">
          <div>
            <div className="mx-auto mb-3 grid size-10 place-items-center text-white/50">
              <IconClock className="size-5" stroke={1.8} />
            </div>
            <p className="text-sm font-semibold text-white/82">{t("results.emptyTitle")}</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-white/42">{t("historyEmpty")}</p>
          </div>
        </div>
      ) : null}
      {jobs.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {jobs.map((job) => (
            <VideoJobCard
              key={job.localId}
              job={job}
              onOpenVideo={onOpenVideo}
              onRetry={() => onRetry(job.localId)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Chrome-less video tile: hover = muted autoplay (reset on leave); click
 *  opens the result lightbox; the fullscreen action flips on native controls
 *  + sound for real playback. */
function HoverVideoPreview({
  url,
  alt,
  downloadLabel,
  fullscreenLabel,
  openLabel,
  onOpen,
}: {
  url: string;
  alt: string;
  downloadLabel: string;
  fullscreenLabel: string;
  openLabel: string;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const enterFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    video.controls = true;
    video.muted = false;
    const restore = () => {
      if (!document.fullscreenElement) {
        video.controls = false;
        video.muted = true;
        document.removeEventListener("fullscreenchange", restore);
      }
    };
    document.addEventListener("fullscreenchange", restore);
    void video.requestFullscreen().catch(() => {
      video.controls = false;
      video.muted = true;
      document.removeEventListener("fullscreenchange", restore);
    });
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        void videoRef.current?.play().catch(() => undefined);
      }}
      onMouseLeave={() => {
        const video = videoRef.current;
        if (!video || document.fullscreenElement === video) return;
        video.pause();
        video.currentTime = 0;
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        className="block w-full text-left"
      >
        <video
          ref={videoRef}
          src={url}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={alt}
          className="aspect-video w-full bg-black object-cover"
        />
      </button>
      <div className="absolute right-2 top-2 z-10 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <button
          type="button"
          aria-label={fullscreenLabel}
          title={fullscreenLabel}
          onClick={(event) => {
            event.stopPropagation();
            enterFullscreen();
          }}
          className="grid size-7 place-items-center rounded-full bg-black/52 text-white backdrop-blur-md transition hover:bg-black/72"
        >
          <IconMaximize className="size-4" stroke={1.8} />
        </button>
        <a
          href={url}
          download
          aria-label={downloadLabel}
          title={downloadLabel}
          onClick={(event) => event.stopPropagation()}
          className="grid size-7 place-items-center rounded-full bg-black/52 text-white backdrop-blur-md transition hover:bg-black/72"
        >
          <IconDownload className="size-4" stroke={1.8} />
        </a>
      </div>
    </div>
  );
}

function VideoJobCard({
  job,
  onOpenVideo,
  onRetry,
}: {
  job: VideoResultJob;
  onOpenVideo: (detailId: string) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("fizzStudio.videoStudio");

  if (job.status === "failed" || job.status === "cancelled") {
    return (
      <article className="relative flex aspect-video flex-col justify-between overflow-hidden rounded-[14px] bg-[#1a1011] p-3.5 shadow-[0_12px_32px_rgba(0,0,0,.24)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(229,34,39,0.18),transparent_36%)]" />
        <div className="relative">
          <IconAlertTriangle className="size-4 text-[#ff8a8d]" stroke={1.9} />
          <p className="mt-2 line-clamp-3 text-[12px] font-medium leading-4 text-white/72">
            {job.error ?? t("results.failed")}
          </p>
          <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-white/42">{job.prompt}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="relative mt-4 h-7 self-start rounded-full bg-white/[0.08] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-white/[0.12]"
        >
          {t("results.retry")}
        </button>
      </article>
    );
  }

  if (job.status === "done" && job.videos.length === 0) {
    return (
      <article className="relative flex aspect-video flex-col justify-between overflow-hidden rounded-[14px] bg-[#1a1011] p-3.5 shadow-[0_12px_32px_rgba(0,0,0,.24)]">
        <div className="relative">
          <IconAlertTriangle className="size-4 text-[#ff8a8d]" stroke={1.9} />
          <p className="mt-2 text-[12px] font-medium leading-4 text-white/72">
            {t("results.noOutput")}
          </p>
          <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-white/42">{job.prompt}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="relative mt-4 h-7 self-start rounded-full bg-white/[0.08] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-white/[0.12]"
        >
          {t("results.retry")}
        </button>
      </article>
    );
  }

  if (job.videos.length > 0) {
    // Pure video card (mirrors the image studio's result cards): cover-fit
    // video, hover = muted autoplay + gradient caption + floating actions.
    return (
      <article className="group relative overflow-hidden rounded-[14px] bg-black shadow-[0_12px_32px_rgba(0,0,0,.28)] ring-1 ring-white/[0.06]">
        {job.videos.map((video) => (
          <HoverVideoPreview
            key={video.id}
            url={video.url}
            alt={t("results.alt")}
            downloadLabel={t("results.download")}
            fullscreenLabel={t("results.fullscreen")}
            openLabel={t("results.open")}
            onOpen={() => onOpenVideo(videoDetailId(job, video))}
          />
        ))}
        <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/0 via-black/0 to-black/72 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="pointer-events-none absolute inset-x-3 bottom-3 translate-y-2 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <p className="line-clamp-2 text-[12px] font-medium leading-4 text-white">{job.prompt}</p>
          <p className="mt-0.5 text-[11px] font-medium text-white/55">
            {formatRelativeTime(job.completedAt ?? job.updatedAt, t)}
          </p>
        </div>
      </article>
    );
  }

  // Pending: status chip + progress.
  const percent =
    typeof job.progress === "number" ? Math.round(clamp(job.progress, 0.02, 0.97) * 100) : null;
  return (
    <article className="relative aspect-video overflow-hidden rounded-[14px] bg-[#151517] p-3.5 shadow-[0_12px_32px_rgba(0,0,0,.24)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.055)_48%,rgba(255,255,255,0)_100%)] bg-[length:220%_100%] [animation:gallery-shimmer_2.6s_linear_infinite]" />
      <div className="relative flex size-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-white/82">
            <IconLoader2 className="size-3 animate-spin" stroke={1.9} />
            {pendingStatusLabel(job, t)}
          </span>
          {percent != null ? (
            <span className="shrink-0 rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/58">
              {percent}%
            </span>
          ) : null}
        </div>
        <p className="mt-3 line-clamp-3 text-[11px] leading-4 text-white/42">{job.prompt}</p>
        <div className="mt-auto space-y-2 pt-5">
          <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
            {percent != null ? (
              <div
                className="h-full rounded-full bg-[#E52227] transition-[width] duration-700 ease-out"
                style={{ width: `${percent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[#E52227]/70" />
            )}
          </div>
          {typeof job.queuePosition === "number" ? (
            <p className="text-[11px] text-white/52">
              {t("results.queuePosition", { position: job.queuePosition + 1 })}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function pendingStatusLabel(job: VideoResultJob, t: VideoStudioT): string {
  if (job.stage === "submitting" || job.stage === "created" || job.stage === "validating") {
    return t("results.preparing");
  }
  if (job.stage === "queued" || job.stage === "provider_queued" || job.status === "queued") {
    return t("results.queued");
  }
  if (job.stage === "fetching_output" || job.stage === "uploading_to_oss") {
    return t("results.finalizing");
  }
  return t("results.generating");
}

/* ── job mapping + merge helpers ──────────────────────────────────────────── */

/** One completed video output, addressable inside the result lightbox. */
interface VideoDetailItem {
  id: string;
  job: VideoResultJob;
  video: VideoResultJob["videos"][number];
}

function videoDetailId(job: VideoResultJob, video: VideoResultJob["videos"][number]): string {
  return `${job.localId}:${video.id}`;
}

/** Completed outputs in History order — the lightbox prev/next sequence. */
function flattenVideoDetailItems(jobs: VideoResultJob[]): VideoDetailItem[] {
  return jobs.flatMap((job) =>
    job.videos.map((video) => ({ id: videoDetailId(job, video), job, video }))
  );
}

/** Best-effort CSS ratio ("16 / 9") from the job input when the output has no width/height. */
function videoFallbackRatio(job: VideoResultJob): string | undefined {
  const raw = job.input?.aspectRatio ?? job.input?.aspect_ratio;
  if (typeof raw !== "string") return undefined;
  const match = raw
    .trim()
    .toLowerCase()
    .match(/(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0 && height > 0)) return undefined;
  return `${width} / ${height}`;
}

function resultVideos(
  outputs: Array<{
    durationSeconds?: number | null;
    height?: number | null;
    id: string;
    type: "image" | "video" | "audio";
    url: string;
    width?: number | null;
  }>
): VideoResultJob["videos"] {
  return outputs
    .filter((output) => output.type === "video" && Boolean(output.url))
    .map((output) => ({
      durationSeconds: output.durationSeconds ?? null,
      height: output.height ?? null,
      id: output.id,
      url: output.url,
      width: output.width ?? null,
    }));
}

function jobViewToVideoJob(job: FizzAiJobView, t: VideoStudioT): VideoResultJob {
  const status = generationStatusFromRaw(job.status);
  return {
    localId: job.id,
    jobId: job.id,
    modelId: job.modelId,
    prompt: job.prompt,
    input: job.input,
    status,
    stage: job.stage || status,
    progress: job.progress ?? null,
    queuePosition: job.queuePosition ?? null,
    videos: resultVideos(job.outputs),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
    error:
      status === "failed" || status === "cancelled"
        ? errorMessageFromJob(job, t("results.failed"))
        : undefined,
  };
}

function jobUpdateToVideoJob(job: AiJobUpdatePayload, t: VideoStudioT): VideoResultJob {
  const status = generationStatusFromRaw(job.status);
  return {
    localId: job.id,
    jobId: job.id,
    modelId: job.modelId,
    prompt: job.prompt,
    input: job.input,
    status,
    stage: job.stage || status,
    progress: job.progress ?? null,
    queuePosition: job.queuePosition ?? null,
    videos: resultVideos(job.outputs),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
    error:
      status === "failed" || status === "cancelled"
        ? (job.error?.userMessage ?? t("results.failed"))
        : undefined,
  };
}

function mergeVideoJob(existing: VideoResultJob[], incoming: VideoResultJob): VideoResultJob[] {
  const index = existing.findIndex((job) => sameLogicalVideoJob(job, incoming));
  const next =
    index >= 0
      ? existing.map((job, i) => (i === index ? mergeVideoJobRow(job, incoming) : job))
      : [incoming, ...existing];
  return next.sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
}

function sameLogicalVideoJob(a: VideoResultJob, b: VideoResultJob): boolean {
  if (a.jobId && b.jobId && a.jobId === b.jobId) return true;
  if (a.localId && b.localId && a.localId === b.localId) return true;
  if (a.jobId || !b.jobId || a.prompt !== b.prompt) return false;
  if (isTerminalGenerationStatus(a.status)) return false;
  return Math.abs(timestampMs(a.createdAt) - timestampMs(b.createdAt)) < 5 * 60 * 1000;
}

function mergeVideoJobRow(current: VideoResultJob, incoming: VideoResultJob): VideoResultJob {
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
    videos: incoming.videos.length > 0 ? incoming.videos : current.videos,
    createdAt: incoming.createdAt || current.createdAt,
    updatedAt: primary.updatedAt || fallback.updatedAt,
    completedAt: incoming.completedAt ?? current.completedAt ?? null,
    error: incoming.error ?? current.error,
  };
}

function applySubmitResponse(
  setJobs: (updater: (prev: VideoResultJob[]) => VideoResultJob[]) => void,
  localId: string,
  response: FizzAiSubmitResponse
): void {
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
            updatedAt: new Date().toISOString(),
          }
        : row
    )
  );
}

function markRowFailed(
  setJobs: (updater: (prev: VideoResultJob[]) => VideoResultJob[]) => void,
  localId: string,
  message: string
): void {
  setJobs((prev) =>
    prev.map((row) =>
      row.localId === localId
        ? {
            ...row,
            status: "failed" as const,
            stage: "failed",
            error: message,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : row
    )
  );
}

/**
 * Rebuild kind-aware reference bindings from a failed job's stored input
 * (local re-submit fallback when the original submit never got a jobId).
 */
function videoBindingsFromInput(input: Record<string, unknown>): FizzAiReferenceBinding[] {
  const bindings: FizzAiReferenceBinding[] = [];
  const arrays: Array<{ field: string; kind: FizzAiReferenceKind; prefix: string }> = [
    { field: "referenceImages", kind: "image", prefix: "Image" },
    { field: "referenceVideos", kind: "video", prefix: "Video" },
    { field: "referenceAudios", kind: "audio", prefix: "Audio" },
  ];
  for (const { field, kind, prefix } of arrays) {
    const raw = input[field];
    if (!Array.isArray(raw)) continue;
    let perKindIndex = 0;
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const url = typeof record.url === "string" && record.url ? record.url : undefined;
      if (!url) continue;
      perKindIndex += 1;
      bindings.push({
        refId:
          typeof record.refId === "string" && record.refId
            ? record.refId
            : generationIdempotencyKey("ref"),
        kind,
        label:
          typeof record.label === "string" && record.label
            ? record.label
            : `${prefix}${perKindIndex}`,
        order: bindings.length + 1,
        url,
        ...(typeof record.assetId === "string" && record.assetId
          ? { assetId: record.assetId }
          : {}),
      });
    }
  }
  return bindings;
}

/* ── reference validation helpers ─────────────────────────────────────────── */

function cardTitleForField(field: string, composerT: ReturnType<typeof useTranslations>): string {
  switch (field) {
    case "startFrame":
      return composerT("slots.firstFrame");
    case "endFrame":
      return composerT("slots.lastFrame");
    case "referenceImages":
      return composerT("references.imagesTitle");
    case "referenceVideos":
      return composerT("references.videosTitle");
    case "referenceAudios":
      return composerT("references.audiosTitle");
    default:
      return field;
  }
}

function fileMatchesAccept(file: File, accept: string, acceptFormats: string[]): boolean {
  const rawType = (file.type || "").toLowerCase();
  const normalized = MIME_ALIASES[rawType] ?? rawType;
  const allowed = accept
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (normalized && allowed.includes(normalized)) return true;
  if (normalized) return false;
  // Some platforms report an empty mime — fall back to the extension. The
  // server allowlist remains the final gate.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const format = ext === "jpg" ? "jpeg" : ext;
  return acceptFormats.includes(format);
}

function violatesResolutionBand(width?: number, height?: number): boolean {
  if (!width || !height) return false; // unreadable → let the provider decide
  const pixels = width * height;
  return pixels < RESOLUTION_BAND_MIN_PIXELS || pixels > RESOLUTION_BAND_MAX_PIXELS;
}

function probeMediaMetadata(
  file: File,
  kind: "audio" | "video"
): Promise<{ durationSeconds: number; height?: number; width?: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(kind);
    let settled = false;
    const cleanup = () => {
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
    element.preload = "metadata";
    if (kind === "video") (element as HTMLVideoElement).muted = true;
    element.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      const durationSeconds = Number.isFinite(element.duration) ? element.duration : 0;
      const meta =
        kind === "video"
          ? {
              durationSeconds,
              width: (element as HTMLVideoElement).videoWidth,
              height: (element as HTMLVideoElement).videoHeight,
            }
          : { durationSeconds };
      cleanup();
      resolve(meta);
    };
    element.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("media metadata unavailable"));
    };
    element.src = url;
  });
}

function seedInputValue(value: ModelSettings[string] | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? Math.floor(value) : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function formatRelativeTime(value: string, t: VideoStudioT): string {
  const elapsed = Math.max(0, Date.now() - timestampMs(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t("results.relative.justNow");
  if (minutes < 60) return t("results.relative.minutesAgo", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("results.relative.hoursAgo", { hours });
  return t("results.relative.daysAgo", { days: Math.floor(hours / 24) });
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

"use client";

import {
  IconBolt,
  IconLoader2,
  IconPhotoOff,
  IconRefresh,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  cancelStoryAssetGeneration,
  cancelStoryStoryboardClipGeneration,
  createStoryAssetGeneration,
  createStoryProductionIdempotencyKey,
  createStoryStoryboardClipGeneration,
  getStoryAssetGeneration,
  getStoryStoryboardClipGeneration,
  retryStoryAssetGenerationMaterialization,
  retryStoryAssetGeneration,
  retryStoryStoryboardClipGenerationMaterialization,
  retryStoryStoryboardClipGeneration,
  storyProductionKeys,
  type StoryCreativeMediaVersion,
  type StoryLatestGeneration,
  type StoryProductionGeneration,
  type StoryProductionSpecStatus,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import {
  estimateModelSellPoints,
  schemaFields,
  type FizzAiModel,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import {
  storyGenerationOptions,
  useStoryProductionSettingsStore,
  type ProductionModality,
  type ProductionModelSelection,
} from "../_stores/story-production-settings-store";

interface GenerationScope {
  workspaceId: string;
  projectId: string;
  chapterId: string;
}

type GenerationTarget =
  | {
      kind: "asset_spec";
      id: string;
      sequenceId: null;
      version: number;
      status: StoryProductionSpecStatus;
      latestGeneration: StoryLatestGeneration | null;
    }
  | {
      kind: "storyboard_clip";
      id: string;
      sequenceId: string;
      version: number;
      status: StoryProductionSpecStatus;
      latestGeneration: StoryLatestGeneration | null;
    };

export function StoryProductionGenerationControl({
  scope,
  target,
  label,
  selectedMedia,
  aspect = "square",
  secondaryAction,
  outputKind = "image",
  clipDurationMs,
}: {
  scope: GenerationScope;
  target: GenerationTarget;
  label: string;
  selectedMedia: StoryCreativeMediaVersion | null;
  /** Media-slot shape; character cards use portrait (3:4), location cards landscape (16:9). */
  aspect?: "square" | "portrait" | "landscape";
  /** Extra card-owned action stacked directly under the primary action. */
  secondaryAction?: React.ReactNode;
  /** Which modality this target generates; picks the page-header default. */
  outputKind?: ProductionModality;
  /** Video clips bill by their timeline length: the server rounds this up to
   *  the model's nearest supported source duration, so the estimate must too. */
  clipDurationMs?: number;
}) {
  const t = useTranslations("storyStudio.productionGeneration");
  const queryClient = useQueryClient();
  const [submittedGeneration, setSubmittedGeneration] = useState<StoryProductionGeneration | null>(
    null
  );
  const commandInFlight = useRef(false);
  const trackedGeneration = newerGeneration(submittedGeneration, target.latestGeneration);
  const generationId = trackedGeneration?.id ?? null;
  const queryKey = generationQueryKey(scope, target, generationId);

  const generationQuery = useQuery({
    queryKey,
    enabled: generationId !== null,
    queryFn: ({ signal }) => {
      if (!generationId) throw new Error("A Story generation id is required.");
      return getGeneration(scope, target, generationId, signal);
    },
    refetchInterval: (query) =>
      shouldPollGeneration(query.state.data ?? trackedGeneration) ? 1_500 : false,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const generation =
    queryGeneration(queryKey, queryClient, generationQuery.data) ?? trackedGeneration;
  const running = isGenerationRunning(generation);
  const cancellable = isGenerationCancellable(generation);
  const targetChanged = Boolean(generation && generation.targetVersion !== target.version);
  const retryable = isGenerationRetryable(generation) && !targetChanged;
  const attachmentRetryable =
    generation?.materialization.status === "failed" && generation.materialization.canRetry === true;
  const generatedMedia =
    isFullGeneration(generation) && generation.materialization.status === "completed"
      ? (generation.mediaVersions[0] ?? null)
      : null;
  const previewMedia = generatedMedia ?? selectedMedia;

  const rememberGeneration = (value: StoryProductionGeneration) => {
    setSubmittedGeneration(value);
    queryClient.setQueryData(generationQueryKey(scope, target, value.id), value);
  };

  const generationDefaults = useStoryProductionSettingsStore((state) => state[outputKind]);
  const catalog = useAiCatalog();
  const defaultModel = generationDefaults.selection
    ? catalog.data?.models.find((model) => model.id === generationDefaults.selection?.modelId)
    : undefined;
  const estimatedPoints = estimateStoryGenerationPoints(
    defaultModel,
    generationDefaults.options,
    outputKind === "video" ? (clipDurationMs ?? null) : null
  );
  const createMutation = useMutation({
    retry: false,
    mutationFn: () =>
      createGeneration(scope, target, generationDefaults.selection, generationDefaults.options),
    onSuccess: rememberGeneration,
    onError: (error) => toast.error(storyApiErrorMessage(error, t("requestError"))),
  });

  const cancelMutation = useMutation({
    retry: false,
    mutationFn: () => {
      if (!generation) throw new Error("A Story generation is required before cancelling.");
      return cancelGeneration(scope, target, generation.id);
    },
    onSuccess: rememberGeneration,
    onError: (error) => toast.error(storyApiErrorMessage(error, t("cancelError"))),
  });

  const retryMutation = useMutation({
    retry: false,
    mutationFn: () => {
      if (!generation) throw new Error("A Story generation is required before retrying.");
      return retryGeneration(scope, target, generation.id);
    },
    onSuccess: rememberGeneration,
    onError: (error) => toast.error(storyApiErrorMessage(error, t("requestError"))),
  });

  const attachmentRetryMutation = useMutation({
    retry: false,
    mutationFn: () => {
      if (!generation) throw new Error("A Story generation is required before reattaching.");
      return retryGenerationMaterialization(scope, target, generation);
    },
    onSuccess: rememberGeneration,
    onError: (error) => toast.error(storyApiErrorMessage(error, t("attachmentRetryError"))),
  });

  const invalidatedGenerationIds = useRef(new Set<string>());
  useEffect(() => {
    if (
      !generation ||
      generation.materialization.status !== "completed" ||
      invalidatedGenerationIds.current.has(generation.id)
    ) {
      return;
    }
    invalidatedGenerationIds.current.add(generation.id);
    void invalidateProductionTarget(queryClient, scope, target);
  }, [generation, queryClient, scope, target]);

  const blockedReason = target.status !== "current" ? t("targetNotCurrent") : null;
  const status = attachmentRetryMutation.isPending
    ? { label: t("status.retryingAttachment"), icon: "running" as const }
    : generationStatus(generation, createMutation.isPending, t);
  const errorMessage =
    generationErrorMessage(generation?.materialization.error) ??
    generationErrorMessage(generation?.aiJob.error) ??
    (generationQuery.error
      ? storyApiErrorMessage(generationQuery.error, t("statusRefreshError"))
      : null);
  const progress = generation?.aiJob.progress;
  // targetChanged already covers every version drift, including the
  // "completed at an older target version" regeneration case.
  const showGenerate = !generation || targetChanged;
  const actionPending =
    createMutation.isPending ||
    cancelMutation.isPending ||
    retryMutation.isPending ||
    attachmentRetryMutation.isPending;
  const runCommandOnce = async (command: () => Promise<StoryProductionGeneration>) => {
    if (commandInFlight.current) return;
    commandInFlight.current = true;
    try {
      await command();
    } catch {
      // Each mutation surfaces the upstream message through its own onError.
    } finally {
      commandInFlight.current = false;
    }
  };

  const actionButton = cancellable ? (
    <Button
      variant="secondary"
      size="sm"
      loading={cancelMutation.isPending}
      disabled={actionPending}
      onClick={() => void runCommandOnce(() => cancelMutation.mutateAsync())}
    >
      <IconX />
      {t("cancel")}
    </Button>
  ) : running ? null : attachmentRetryable ? (
    <Button
      size="sm"
      loading={attachmentRetryMutation.isPending}
      disabled={actionPending}
      onClick={() => void runCommandOnce(() => attachmentRetryMutation.mutateAsync())}
    >
      <IconRefresh />
      {t("retryAttachment")}
    </Button>
  ) : retryable ? (
    <Button
      size="sm"
      loading={retryMutation.isPending}
      disabled={Boolean(blockedReason) || actionPending}
      onClick={() => void runCommandOnce(() => retryMutation.mutateAsync())}
    >
      <IconRefresh />
      {t("retry")}
    </Button>
  ) : showGenerate ? (
    <Button
      size="sm"
      loading={createMutation.isPending}
      disabled={Boolean(blockedReason) || actionPending}
      onClick={() => void runCommandOnce(() => createMutation.mutateAsync())}
    >
      <IconSparkles />
      {selectedMedia ? t("generateAgain") : t("generate")}
      {estimatedPoints !== null ? (
        <span className="flex items-center gap-0.5 text-[11px] opacity-85">
          <IconBolt className="size-3" stroke={2} />
          {estimatedPoints}
        </span>
      ) : null}
    </Button>
  ) : null;

  return (
    <div>
      <section
        className={cn(
          "relative overflow-hidden rounded-xl bg-black/24",
          aspect === "portrait"
            ? "aspect-[3/4]"
            : aspect === "landscape"
              ? "aspect-video"
              : "aspect-square"
        )}
        aria-label={t("controlsAria", { name: label })}
      >
        {previewMedia ? (
          <MediaPreview media={previewMedia} label={label} />
        ) : actionButton || secondaryAction ? null : (
          <div className="grid size-full place-items-center">
            <IconPhotoOff className="size-6 text-white/40" aria-hidden="true" />
          </div>
        )}
        {status.icon === "running" ? (
          <div
            className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/88"
            aria-live="polite"
          >
            <IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" />
            <span>{status.label}</span>
          </div>
        ) : null}
        {actionButton || secondaryAction ? (
          <div
            className={cn(
              "absolute",
              previewMedia ? "bottom-2.5 right-2.5" : "inset-0 grid place-items-center"
            )}
          >
            <div className="flex flex-col items-center gap-1.5">
              {actionButton}
              {secondaryAction}
            </div>
          </div>
        ) : null}
        {typeof progress === "number" && running ? (
          <div
            role="progressbar"
            aria-label={t("progressAria")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(1, Math.max(0, progress)) * 100)}
            className="absolute inset-x-0 bottom-0 h-1 bg-white/[0.1]"
          >
            <div
              className="h-full bg-white/78 transition-[width]"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
            />
          </div>
        ) : null}
      </section>
      {blockedReason ? (
        <p className="mt-2 text-[11px] leading-4 text-amber-100/82">{blockedReason}</p>
      ) : null}
      {errorMessage ? (
        <p className="mt-2 text-[11px] leading-4 text-red-100/88" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function MediaPreview({ media, label }: { media: StoryCreativeMediaVersion; label: string }) {
  const video = media.mediaKind === "video" || media.mimeType?.startsWith("video/") === true;
  const source = video
    ? (media.previewUrl ?? media.thumbnailUrl)
    : (media.thumbnailUrl ?? media.previewUrl);
  if (!source) return null;

  return (
    <div className="absolute inset-0 overflow-hidden bg-black/40">
      {video && media.previewUrl ? (
        <video
          src={media.previewUrl}
          poster={media.thumbnailUrl ?? undefined}
          controls
          preload="metadata"
          playsInline
          aria-label={label}
          className="size-full object-cover"
        />
      ) : (
        <Image
          src={source}
          alt={label}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 480px"
          className="object-cover"
        />
      )}
    </div>
  );
}

function generationQueryKey(
  scope: GenerationScope,
  target: GenerationTarget,
  generationId: string | null
) {
  return storyProductionKeys.generation(
    scope.workspaceId,
    scope.projectId,
    scope.chapterId,
    target.kind,
    target.sequenceId,
    target.id,
    generationId
  );
}

function queryGeneration(
  key: ReturnType<typeof generationQueryKey>,
  queryClient: ReturnType<typeof useQueryClient>,
  data: StoryProductionGeneration | undefined
): StoryProductionGeneration | undefined {
  return data ?? queryClient.getQueryData<StoryProductionGeneration>(key);
}

function newerGeneration(
  submitted: StoryProductionGeneration | null,
  latest: StoryLatestGeneration | null
): StoryProductionGeneration | StoryLatestGeneration | null {
  if (!submitted) return latest;
  if (!latest || submitted.id === latest.id) return submitted;
  return Date.parse(submitted.createdAt) >= Date.parse(latest.createdAt) ? submitted : latest;
}

function getGeneration(
  scope: GenerationScope,
  target: GenerationTarget,
  generationId: string,
  signal: AbortSignal
) {
  return target.kind === "asset_spec"
    ? getStoryAssetGeneration(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.id,
        generationId,
        signal
      )
    : getStoryStoryboardClipGeneration(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.sequenceId,
        target.id,
        generationId,
        signal
      );
}

/**
 * The same sell-points estimate the header pill shows, corrected for video
 * clips: duration is server-owned and rounded up from the clip's timeline
 * length to the model's nearest supported source duration.
 */
function estimateStoryGenerationPoints(
  model: FizzAiModel | undefined,
  options: ModelSettings,
  clipDurationMs: number | null
): number | null {
  if (!model) return null;
  const scalar = (name: string) => {
    const value = options[name];
    return Array.isArray(value) ? undefined : value;
  };
  const estimate: {
    numOutputs: number;
    resolution?: string;
    quality?: string;
    duration?: string;
    durationSeconds?: number;
    generateAudio?: boolean;
  } = {
    numOutputs: Number(scalar("numOutputs") ?? scalar("n") ?? 1) || 1,
    resolution: scalar("resolution") != null ? String(scalar("resolution")) : undefined,
    quality: scalar("quality") != null ? String(scalar("quality")) : undefined,
    duration: scalar("duration") != null ? String(scalar("duration")) : undefined,
    durationSeconds:
      typeof scalar("durationSeconds") === "number"
        ? (scalar("durationSeconds") as number)
        : undefined,
    generateAudio:
      typeof scalar("generateAudio") === "boolean"
        ? (scalar("generateAudio") as boolean)
        : undefined,
  };
  if (clipDurationMs !== null) {
    const seconds = clipDurationMs / 1_000;
    const field = schemaFields(model).find(
      (candidate) => candidate.name === "durationSeconds" || candidate.name === "duration"
    );
    const supported = (field?.enum ?? [])
      .map(Number)
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)
      .find((value) => value >= seconds);
    if (supported === undefined) return null;
    estimate.duration = String(supported);
    estimate.durationSeconds = supported;
  }
  return estimateModelSellPoints(model, estimate)?.sellPoints ?? null;
}

function createGeneration(
  scope: GenerationScope,
  target: GenerationTarget,
  selection: ProductionModelSelection | null,
  options: Parameters<typeof storyGenerationOptions>[0]
) {
  const idempotencyKey = createStoryProductionIdempotencyKey("story-generate");
  // The page-header default rides along only when a model is explicitly
  // chosen; option keys are schema-bound to that model.
  const modelInput = selection
    ? {
        modelId: selection.modelId,
        schemaVersion: selection.schemaVersion,
        options: storyGenerationOptions(options),
      }
    : {};
  return target.kind === "asset_spec"
    ? createStoryAssetGeneration(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.id,
        idempotencyKey,
        { expectedVersion: target.version, ...modelInput }
      )
    : createStoryStoryboardClipGeneration(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.sequenceId,
        target.id,
        idempotencyKey,
        { expectedVersion: target.version, ...modelInput }
      );
}

function cancelGeneration(scope: GenerationScope, target: GenerationTarget, generationId: string) {
  return target.kind === "asset_spec"
    ? cancelStoryAssetGeneration(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.id,
        generationId
      )
    : cancelStoryStoryboardClipGeneration(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.sequenceId,
        target.id,
        generationId
      );
}

function retryGeneration(scope: GenerationScope, target: GenerationTarget, generationId: string) {
  const idempotencyKey = createStoryProductionIdempotencyKey("story-generate-retry");
  const input = { expectedVersion: target.version };
  return target.kind === "asset_spec"
    ? retryStoryAssetGeneration(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.id,
        generationId,
        idempotencyKey,
        input
      )
    : retryStoryStoryboardClipGeneration(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.sequenceId,
        target.id,
        generationId,
        idempotencyKey,
        input
      );
}

function retryGenerationMaterialization(
  scope: GenerationScope,
  target: GenerationTarget,
  generation: StoryLatestGeneration | StoryProductionGeneration
) {
  const idempotencyKey = createStoryProductionIdempotencyKey("story-attachment-retry");
  return target.kind === "asset_spec"
    ? retryStoryAssetGenerationMaterialization(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.id,
        generation.id,
        generation.materialization.retryUrl,
        idempotencyKey
      )
    : retryStoryStoryboardClipGenerationMaterialization(
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        target.sequenceId,
        target.id,
        generation.id,
        generation.materialization.retryUrl,
        idempotencyKey
      );
}

async function invalidateProductionTarget(
  queryClient: ReturnType<typeof useQueryClient>,
  scope: GenerationScope,
  target: GenerationTarget
) {
  const invalidations = [
    queryClient.invalidateQueries({
      queryKey: storyProductionKeys.state(scope.workspaceId, scope.projectId, scope.chapterId),
    }),
  ];
  if (target.kind === "asset_spec") {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: storyProductionKeys.assets(scope.workspaceId, scope.projectId, scope.chapterId),
      }),
      queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(
          scope.workspaceId,
          scope.projectId,
          scope.chapterId
        ),
      })
    );
  } else {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(
          scope.workspaceId,
          scope.projectId,
          scope.chapterId
        ),
      })
    );
  }
  await Promise.all(invalidations);
}

function isGenerationRunning(
  generation: StoryLatestGeneration | StoryProductionGeneration | null
): boolean {
  if (!generation) return false;
  if (["created", "in_queue", "in_progress"].includes(generation.aiJob.status)) return true;
  return (
    generation.aiJob.status === "completed" &&
    (generation.materialization.status === "waiting_for_job" ||
      generation.materialization.status === "pending")
  );
}

function isGenerationCancellable(
  generation: StoryLatestGeneration | StoryProductionGeneration | null
): boolean {
  return Boolean(
    generation && ["created", "in_queue", "in_progress"].includes(generation.aiJob.status)
  );
}

function isFullGeneration(
  generation: StoryLatestGeneration | StoryProductionGeneration | null
): generation is StoryProductionGeneration {
  return Boolean(generation && "projectId" in generation && "mediaVersions" in generation);
}

function shouldPollGeneration(
  generation: StoryLatestGeneration | StoryProductionGeneration | undefined | null
): boolean {
  return generation ? isGenerationRunning(generation) : false;
}

function isGenerationRetryable(
  generation: StoryLatestGeneration | StoryProductionGeneration | null
): boolean {
  if (!generation || !["failed", "cancelled", "expired"].includes(generation.aiJob.status)) {
    return false;
  }
  const error = recordValue(generation.aiJob.error);
  return error?.retryable !== false;
}

function generationErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = recordValue(value);
  const message = record?.message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function generationStatus(
  generation: StoryLatestGeneration | StoryProductionGeneration | null,
  submitting: boolean,
  t: ReturnType<typeof useTranslations<"storyStudio.productionGeneration">>
): { label: string; icon: "idle" | "running" | "ready" | "warning" } {
  if (submitting) return { label: t("status.submitting"), icon: "running" };
  if (!generation) return { label: t("status.idle"), icon: "idle" };
  if (generation.aiJob.status === "created") {
    return { label: t("status.created"), icon: "running" };
  }
  if (generation.aiJob.status === "in_queue") {
    return { label: t("status.inQueue"), icon: "running" };
  }
  if (generation.aiJob.status === "in_progress") {
    return { label: t("status.inProgress"), icon: "running" };
  }
  if (
    generation.aiJob.status === "completed" &&
    generation.materialization.status !== "completed" &&
    generation.materialization.status !== "failed"
  ) {
    return { label: t("status.attaching"), icon: "running" };
  }
  if (generation.materialization.status === "completed") {
    return { label: t("status.ready"), icon: "ready" };
  }
  if (generation.materialization.status === "failed") {
    return { label: t("status.materializationFailed"), icon: "warning" };
  }
  if (generation.aiJob.status === "cancelled") {
    return { label: t("status.cancelled"), icon: "warning" };
  }
  if (generation.aiJob.status === "expired") {
    return { label: t("status.expired"), icon: "warning" };
  }
  return { label: t("status.failed"), icon: "warning" };
}

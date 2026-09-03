"use client";

import {
  IconArrowUp,
  IconLoader2,
  IconPhotoOff,
  IconRefresh,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
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
  storyGenerationOptions,
  type ProductionModality,
  type ProductionModelSelection,
} from "../_stores/story-production-settings-store";
import type { ModelSettings } from "@/lib/canvas-authoring/generation-api";
import { useStoryProductionGenerationDefaults } from "./use-story-production-generation-defaults";

interface GenerationScope {
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
  allowGeneration = true,
  mediaLoading = "lazy",
  layout = "stage",
  purpose = "primary",
  modelSelection,
  generationOptions,
  allowConcurrent = false,
  onPendingPreviewCountChange,
}: {
  scope: GenerationScope;
  target: GenerationTarget;
  label: string;
  selectedMedia: StoryCreativeMediaVersion | null;
  /** Media-slot shape; character cards use portrait (3:4), scene cards landscape (16:9). */
  aspect?: "square" | "portrait" | "landscape";
  /** Extra card-owned action stacked directly under the primary action. */
  secondaryAction?: React.ReactNode;
  /** Which modality this target generates; picks the page-header default. */
  outputKind?: ProductionModality;
  /** Keep below-the-fold generation cards lazy while allowing the gallery's first row to be eager. */
  mediaLoading?: "eager" | "lazy";
  /** The compact form places the action beside per-asset model settings. */
  layout?: "stage" | "inline";
  /** Asset generations can create either the canonical image or its three-view sheet. */
  purpose?: "primary" | "turnaround";
  /** Per-asset controls override the page default without mutating other rows. */
  modelSelection?: ProductionModelSelection | null;
  generationOptions?: ModelSettings;
  /** Asset output rows may submit another paid run while earlier runs remain active. */
  allowConcurrent?: boolean;
  onPendingPreviewCountChange?: (count: number) => void;
  /** The owning surface can disable paid actions while it lacks an editable target. */
  allowGeneration?: boolean;
}) {
  const t = useTranslations("storyStudio.productionGeneration");
  const queryClient = useQueryClient();
  const [submittedGenerations, setSubmittedGenerations] = useState<StoryProductionGeneration[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<
    Array<{ idempotencyKey: string; requestedOutputCount: number }>
  >([]);
  const commandInFlight = useRef(false);
  const rememberGenerationState = (value: StoryProductionGeneration) => {
    setSubmittedGenerations((current) => {
      if (!allowConcurrent) return [value];
      return retainConcurrentGenerations(mergeGenerations(current, [value]));
    });
  };
  const trackedGeneration = newerGeneration(
    submittedGenerations.at(-1) ?? null,
    target.latestGeneration
  );
  const generationSeeds = allowConcurrent
    ? mergeGenerations(
        target.latestGeneration ? [target.latestGeneration] : [],
        submittedGenerations
      )
    : trackedGeneration
      ? [trackedGeneration]
      : [];
  const generationQueries = useQueries({
    queries: generationSeeds.map((seed) => ({
      queryKey: generationQueryKey(scope, target, seed.id),
      enabled: allowConcurrent ? isGenerationRunning(seed) : true,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const value = await getGeneration(scope, target, seed.id, signal);
        if (allowConcurrent) rememberGenerationState(value);
        return value;
      },
      refetchInterval: (query: { state: { data?: StoryProductionGeneration } }) =>
        shouldPollGeneration(query.state.data ?? seed) ? 1_500 : false,
      refetchIntervalInBackground: true,
      staleTime: 0,
    })),
  });
  const generations = generationSeeds.map((seed, index) => {
    const key = generationQueryKey(scope, target, seed.id);
    return queryGeneration(key, queryClient, generationQueries[index]?.data) ?? seed;
  });
  const generation = newestGeneration(generations);
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
  // The target's selected media is authoritative. A completed generation is
  // only a temporary preview fallback while the same target version's parent
  // projection catches up. Once the target version moves on, that output is
  // history rather than current footage and must not appear on the Storyboard
  // while the editor, preview, and release pipeline correctly treat the clip
  // as unbound.
  const previewMedia =
    selectedMedia ??
    (submittedGenerations.some((submitted) => submitted.id === generation?.id) &&
    !targetChanged &&
    allowGeneration
      ? generatedMedia
      : null);

  const rememberGeneration = (value: StoryProductionGeneration) => {
    rememberGenerationState(value);
    queryClient.setQueryData(generationQueryKey(scope, target, value.id), value);
  };

  const generationDefaults = useStoryProductionGenerationDefaults(scope.projectId, outputKind);
  const effectiveSelection =
    modelSelection === undefined ? generationDefaults.selection : modelSelection;
  const effectiveOptions = generationOptions ?? generationDefaults.options;
  const createMutation = useMutation({
    retry: false,
    mutationFn: ({ idempotencyKey }: { idempotencyKey: string; requestedOutputCount: number }) =>
      createGeneration(
        scope,
        target,
        effectiveSelection,
        effectiveOptions,
        purpose,
        idempotencyKey
      ),
    onMutate: ({ idempotencyKey, requestedOutputCount }) => {
      setPendingSubmissions((current) => [...current, { idempotencyKey, requestedOutputCount }]);
    },
    onSuccess: rememberGeneration,
    onError: (error) => toast.error(storyApiErrorMessage(error, t("requestError"))),
    onSettled: (_data, _error, { idempotencyKey }) => {
      setPendingSubmissions((current) =>
        current.filter((submission) => submission.idempotencyKey !== idempotencyKey)
      );
    },
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
    for (const currentGeneration of generations) {
      if (
        currentGeneration.materialization.status !== "completed" ||
        invalidatedGenerationIds.current.has(currentGeneration.id)
      ) {
        continue;
      }
      invalidatedGenerationIds.current.add(currentGeneration.id);
      void invalidateProductionTarget(queryClient, scope, target);
    }
  }, [generations, queryClient, scope, target]);

  const status = attachmentRetryMutation.isPending
    ? { label: t("status.retryingAttachment"), icon: "running" as const }
    : generationStatus(generation, createMutation.isPending, t);
  const latestIssue = generations.findLast(hasGenerationIssue) ?? null;
  const errorMessage =
    generationIssueMessage(latestIssue, t) ??
    (generationQueries.find((query) => query.error)?.error
      ? storyApiErrorMessage(
          generationQueries.find((query) => query.error)?.error,
          t("statusRefreshError")
        )
      : null);
  const progress = generation?.aiJob.progress;
  const pendingPreviewCount =
    pendingSubmissions.reduce((total, submission) => total + submission.requestedOutputCount, 0) +
    generations
      .filter(isGenerationRunning)
      .reduce((total, current) => total + current.requestedOutputCount, 0);
  useEffect(() => {
    onPendingPreviewCountChange?.(pendingPreviewCount);
  }, [onPendingPreviewCountChange, pendingPreviewCount]);
  // targetChanged already covers every version drift, including the
  // "completed at an older target version" regeneration case.
  const showGenerate =
    !generation || targetChanged || generation.materialization.status === "completed";
  const actionPending =
    createMutation.isPending ||
    cancelMutation.isPending ||
    retryMutation.isPending ||
    attachmentRetryMutation.isPending;
  const generationEnabled = allowGeneration && target.status !== "archived";
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
  const generateLabel = selectedMedia ? t("generateAgain") : t("generate");
  const generateAction = (
    <Button
      size={layout === "inline" ? "icon" : "sm"}
      className={layout === "inline" ? "rounded-full" : undefined}
      aria-label={layout === "inline" ? generateLabel : undefined}
      title={layout === "inline" ? generateLabel : undefined}
      loading={!allowConcurrent && layout === "stage" && createMutation.isPending}
      disabled={!allowConcurrent && actionPending}
      onClick={() => {
        const request = {
          idempotencyKey: createStoryProductionIdempotencyKey("story-generate"),
          requestedOutputCount: requestedOutputCountFromSettings(effectiveOptions),
        };
        if (allowConcurrent) {
          createMutation.mutate(request);
        } else {
          void runCommandOnce(() => createMutation.mutateAsync(request));
        }
      }}
    >
      {layout === "inline" ? <IconArrowUp stroke={2.2} /> : null}
      {layout === "stage" ? generateLabel : null}
      {layout === "stage" ? <IconSparkles /> : null}
    </Button>
  );

  const actionButton = allowConcurrent ? (
    generationEnabled ? (
      generateAction
    ) : null
  ) : cancellable ? (
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
  ) : running || !generationEnabled ? null : attachmentRetryable ? (
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
      disabled={actionPending}
      onClick={() => void runCommandOnce(() => retryMutation.mutateAsync())}
    >
      <IconRefresh />
      {t("retry")}
    </Button>
  ) : showGenerate ? (
    generateAction
  ) : null;

  if (layout === "inline") {
    return (
      <div className="min-w-0">
        <div className="flex min-h-9 items-center justify-end">{actionButton}</div>
        {errorMessage ? (
          <p className="mt-2 text-[11px] leading-4 text-red-100/88" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  }

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
          <MediaPreview media={previewMedia} label={label} loading={mediaLoading} />
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
      {errorMessage ? (
        <p className="mt-2 text-[11px] leading-4 text-red-100/88" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function requestedOutputCountFromSettings(settings: ModelSettings): number {
  const value = Number(settings.numOutputs ?? 1);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function MediaPreview({
  media,
  label,
  loading,
}: {
  media: StoryCreativeMediaVersion;
  label: string;
  loading: "eager" | "lazy";
}) {
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
          loading={loading}
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

function mergeGenerations<T extends StoryLatestGeneration>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((generation) => [generation.id, generation]));
  for (const generation of incoming) byId.set(generation.id, generation);
  return [...byId.values()].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
  );
}

function newestGeneration(
  generations: Array<StoryLatestGeneration | StoryProductionGeneration>
): StoryLatestGeneration | StoryProductionGeneration | null {
  return generations.at(-1) ?? null;
}

function retainConcurrentGenerations(
  generations: StoryProductionGeneration[]
): StoryProductionGeneration[] {
  const active = generations.filter(isGenerationRunning);
  const latestTerminal = generations.findLast((generation) => !isGenerationRunning(generation));
  const latestIssue = generations.findLast(hasGenerationIssue);
  return mergeGenerations(
    active,
    [latestTerminal, latestIssue].filter((generation): generation is StoryProductionGeneration =>
      Boolean(generation)
    )
  );
}

function getGeneration(
  scope: GenerationScope,
  target: GenerationTarget,
  generationId: string,
  signal: AbortSignal
) {
  return target.kind === "asset_spec"
    ? getStoryAssetGeneration(scope.projectId, scope.chapterId, target.id, generationId, signal)
    : getStoryStoryboardClipGeneration(
        scope.projectId,
        scope.chapterId,
        target.sequenceId,
        target.id,
        generationId,
        signal
      );
}

function createGeneration(
  scope: GenerationScope,
  target: GenerationTarget,
  selection: ProductionModelSelection | null,
  options: Parameters<typeof storyGenerationOptions>[0],
  purpose: "primary" | "turnaround",
  idempotencyKey: string
) {
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
    ? createStoryAssetGeneration(scope.projectId, scope.chapterId, target.id, idempotencyKey, {
        expectedVersion: target.version,
        purpose,
        ...modelInput,
      })
    : createStoryStoryboardClipGeneration(
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
    ? cancelStoryAssetGeneration(scope.projectId, scope.chapterId, target.id, generationId)
    : cancelStoryStoryboardClipGeneration(
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
        scope.projectId,
        scope.chapterId,
        target.id,
        generationId,
        idempotencyKey,
        input
      )
    : retryStoryStoryboardClipGeneration(
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
        scope.projectId,
        scope.chapterId,
        target.id,
        generation.id,
        generation.materialization.retryUrl,
        idempotencyKey
      )
    : retryStoryStoryboardClipGenerationMaterialization(
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
      queryKey: storyProductionKeys.state(scope.projectId, scope.chapterId),
    }),
  ];
  if (target.kind === "asset_spec") {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: storyProductionKeys.assets(scope.projectId, scope.chapterId),
      }),
      queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(scope.projectId, scope.chapterId),
      })
    );
  } else {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(scope.projectId, scope.chapterId),
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

function hasGenerationIssue(
  generation: StoryLatestGeneration | StoryProductionGeneration
): boolean {
  return (
    generation.materialization.status === "failed" ||
    ["failed", "cancelled", "expired"].includes(generation.aiJob.status)
  );
}

function generationIssueMessage(
  generation: StoryLatestGeneration | StoryProductionGeneration | null,
  t: ReturnType<typeof useTranslations<"storyStudio.productionGeneration">>
): string | null {
  if (!generation) return null;
  const upstream =
    generationErrorMessage(generation.materialization.error) ??
    generationErrorMessage(generation.aiJob.error);
  if (upstream) return upstream;
  if (generation.materialization.status === "failed") return t("status.materializationFailed");
  if (generation.aiJob.status === "cancelled") return t("status.cancelled");
  if (generation.aiJob.status === "expired") return t("status.expired");
  return generation.aiJob.status === "failed" ? t("status.failed") : null;
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

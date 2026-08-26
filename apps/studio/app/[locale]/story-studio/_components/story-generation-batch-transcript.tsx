"use client";

import { IconAlertTriangle, IconBan, IconCheck, IconLoader2, IconPhoto } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import type { AgentOsStoryGenerationBatchArtifactReference } from "@/components/agent-os/agent-os-timeline";
import { Button } from "@/components/ui/button";
import {
  cancelStoryGenerationBatch,
  getStoryGenerationBatch,
  listStoryAssetSpecs,
  storyGenerationBatchHasPendingItems,
  storyProductionKeys,
  type StoryAssetSpec,
  type StoryGenerationBatch,
  type StoryGenerationBatchItemStatus,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";

const ACTIVE_BATCH_STATUSES = new Set(["queued", "running", "cancelling"]);
const CANCELLABLE_BATCH_STATUSES = new Set(["queued", "running"]);

export function StoryGenerationBatchTranscript({
  reference,
}: {
  reference: AgentOsStoryGenerationBatchArtifactReference;
}) {
  const t = useTranslations("storyStudio.generationBatchTranscript");
  const queryClient = useQueryClient();
  const { storyProjectId, storyChapterId, generationBatchId } = reference;
  const batchKey = useMemo(
    () => storyProductionKeys.batch(storyProjectId, storyChapterId, generationBatchId),
    [generationBatchId, storyChapterId, storyProjectId]
  );
  const assetsKey = useMemo(
    () => storyProductionKeys.assets(storyProjectId, storyChapterId),
    [storyChapterId, storyProjectId]
  );

  const batchQuery = useQuery({
    queryKey: batchKey,
    queryFn: ({ signal }) =>
      getStoryGenerationBatch(storyProjectId, storyChapterId, generationBatchId, signal),
    refetchInterval: (query) =>
      query.state.data && storyGenerationBatchHasPendingItems(query.state.data) ? 1_500 : false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const settling = batchQuery.data ? storyGenerationBatchHasPendingItems(batchQuery.data) : false;
  const assetsQuery = useQuery({
    queryKey: assetsKey,
    queryFn: ({ signal }) => listStoryAssetSpecs(storyProjectId, storyChapterId, signal),
    enabled: Boolean(batchQuery.data),
    refetchInterval: settling ? 1_500 : false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const completedCount = batchQuery.data?.counts.completed ?? 0;
  const batchStatus = batchQuery.data?.status;
  const hasBatch = Boolean(batchQuery.data);

  useEffect(() => {
    if (!hasBatch) return;
    // Media attachment is authoritative on Asset Specs. Re-read it whenever a
    // batch item settles so the placeholder swaps to the actual media without
    // copying transient URLs into the Agent journal.
    void queryClient.invalidateQueries({ queryKey: assetsKey });
  }, [assetsKey, batchStatus, completedCount, hasBatch, queryClient]);

  const cancelMutation = useMutation({
    retry: false,
    mutationFn: () => cancelStoryGenerationBatch(storyProjectId, storyChapterId, generationBatchId),
    onSuccess: (batch) => {
      queryClient.setQueryData(batchKey, batch);
      void queryClient.invalidateQueries({
        queryKey: storyProductionKeys.batches(storyProjectId, storyChapterId),
      });
      void queryClient.invalidateQueries({ queryKey: assetsKey });
    },
  });

  if (batchQuery.isPending) {
    return (
      <TranscriptSection>
        <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-white/52">
          <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
          {t("loading")}
        </div>
      </TranscriptSection>
    );
  }

  if (batchQuery.isError || !batchQuery.data) {
    return (
      <TranscriptSection>
        <div role="alert" className="space-y-2 py-2">
          <p className="text-xs leading-relaxed text-red-100/88">
            {storyApiErrorMessage(batchQuery.error, t("loadError"))}
          </p>
          <Button type="button" size="xs" variant="quiet" onClick={() => batchQuery.refetch()}>
            {t("retry")}
          </Button>
        </div>
      </TranscriptSection>
    );
  }

  const batch = batchQuery.data;
  const assets = new Map((assetsQuery.data ?? []).map((asset) => [asset.id, asset]));
  const settled = batch.counts.completed + batch.counts.failed + batch.counts.cancelled;

  return (
    <TranscriptSection>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <IconPhoto className="size-4 shrink-0 text-white/48" aria-hidden="true" />
            <p className="truncate text-xs font-medium text-white/82">{t("title")}</p>
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-white/46">
            {t("summary", {
              completed: settled,
              total: batch.itemCount,
              points: batch.totalPoints,
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <BatchStatus batch={batch} settling={settling} />
          {batch.canCancel && CANCELLABLE_BATCH_STATUSES.has(batch.status) ? (
            <Button
              type="button"
              size="xs"
              variant="quiet"
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              <IconBan aria-hidden="true" />
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className="mt-2 h-0.5 overflow-hidden rounded-full bg-white/[0.07]"
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuemin={0}
        aria-valuemax={batch.itemCount}
        aria-valuenow={settled}
      >
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${Math.round((settled / Math.max(1, batch.itemCount)) * 100)}%` }}
        />
      </div>

      <div className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
        {batch.items.map((item) => (
          <GenerationCard
            key={item.id}
            item={item}
            asset={assets.get(item.targetId)}
            label={t(`itemStatus.${item.status}`)}
          />
        ))}
      </div>

      {assetsQuery.isError ? (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-red-100/88">
          {storyApiErrorMessage(assetsQuery.error, t("mediaLoadError"))}
        </p>
      ) : null}
      {cancelMutation.isError ? (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-red-100/88">
          {storyApiErrorMessage(cancelMutation.error, t("cancelError"))}
        </p>
      ) : null}
    </TranscriptSection>
  );
}

function TranscriptSection({ children }: { children: React.ReactNode }) {
  return <section className="mt-1 border-y border-white/[0.09] py-3">{children}</section>;
}

function BatchStatus({ batch, settling }: { batch: StoryGenerationBatch; settling: boolean }) {
  const t = useTranslations("storyStudio.generationBatchTranscript.batchStatus");
  const active = ACTIVE_BATCH_STATUSES.has(batch.status);
  const cancelling = batch.status === "cancelling" || (batch.status === "cancelled" && settling);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] whitespace-nowrap",
        batch.status === "failed" || batch.status === "partial_failed"
          ? "text-red-100/82"
          : "text-white/48"
      )}
    >
      {active || cancelling ? (
        <IconLoader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : null}
      {batch.status === "completed" ? <IconCheck className="size-3" aria-hidden="true" /> : null}
      {(batch.status === "failed" || batch.status === "partial_failed") && (
        <IconAlertTriangle className="size-3" aria-hidden="true" />
      )}
      {t(cancelling ? "cancelling" : batch.status)}
    </span>
  );
}

function GenerationCard({
  item,
  asset,
  label,
}: {
  item: StoryGenerationBatch["items"][number];
  asset?: StoryAssetSpec;
  label: string;
}) {
  const media = item.status === "completed" ? asset?.selectedMediaVersion : null;
  const name = asset?.name ?? item.targetId;
  const progress =
    typeof asset?.latestGeneration?.aiJob.progress === "number"
      ? Math.round(Math.min(1, Math.max(0, asset.latestGeneration.aiJob.progress)) * 100)
      : null;
  const active = isActiveItem(item.status);

  return (
    <article className="w-[104px] shrink-0 snap-start" aria-label={`${name}: ${label}`}>
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-white/[0.055]">
        {media ? <GeneratedMedia asset={asset as StoryAssetSpec} /> : null}
        {!media && active ? (
          <div className="absolute inset-0 animate-pulse bg-white/[0.035]" aria-hidden="true" />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/52 to-transparent px-2 pb-2 pt-8">
          <p className="line-clamp-2 text-[11px] font-medium leading-snug text-white/92">{name}</p>
        </div>
        <div className="absolute left-2 top-2 rounded-md bg-black/62 px-1.5 py-1 text-[10px] leading-none text-white/72 backdrop-blur-sm">
          {item.status === "completed" ? (
            <IconCheck className="size-3" aria-hidden="true" />
          ) : (
            label
          )}
        </div>
        {active ? (
          <div className="absolute inset-x-2 top-9 flex items-center gap-1 text-[10px] text-white/65">
            <IconLoader2 className="size-3 animate-spin" aria-hidden="true" />
            {progress === null ? label : `${progress}%`}
          </div>
        ) : null}
        {(item.status === "failed" || item.status === "cancelled") && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            {item.status === "failed" ? (
              <IconAlertTriangle className="size-5 text-red-100/85" aria-hidden="true" />
            ) : (
              <IconBan className="size-5 text-white/55" aria-hidden="true" />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function GeneratedMedia({ asset }: { asset: StoryAssetSpec }) {
  const media = asset.selectedMediaVersion;
  const source = media?.thumbnailUrl ?? media?.previewUrl;
  const video = media?.mediaKind === "video" || media?.mimeType?.startsWith("video/") === true;
  if (!media || !source) return null;
  return video && media.previewUrl ? (
    <video
      src={media.previewUrl}
      poster={media.thumbnailUrl ?? undefined}
      muted
      playsInline
      preload="metadata"
      aria-label={asset.name}
      className="absolute inset-0 size-full object-cover"
    />
  ) : (
    <Image src={source} alt={asset.name} fill unoptimized sizes="104px" className="object-cover" />
  );
}

function isActiveItem(status: StoryGenerationBatchItemStatus): boolean {
  return status === "ready" || status === "dispatching" || status === "submitted";
}

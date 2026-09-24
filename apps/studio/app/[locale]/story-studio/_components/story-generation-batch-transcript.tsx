"use client";

import {
  IconAlertTriangle,
  IconBan,
  IconBox,
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconMapPin,
  IconMovie,
  IconPhoto,
  IconPlayerPlay,
  IconRefresh,
  IconUser,
  IconWallet,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ComputeRechargeDialog } from "@/app/_components/compute-recharge-dialog";
import type { AgentOsStoryGenerationBatchArtifactReference } from "@/components/agent-os/agent-os-timeline";
import { Button } from "@/components/ui/button";
import {
  cancelStoryGenerationBatch,
  getStoryGenerationBatch,
  getStoryStoryboard,
  listStoryAssetSpecs,
  resumeStoryGenerationBatch,
  storyGenerationBatchFailure,
  storyGenerationBatchHasPendingItems,
  storyProductionKeys,
  type StoryAssetSpec,
  type StoryGenerationBatch,
  type StoryGenerationBatchItemStatus,
  type StoryStoryboardClip,
  type StoryStoryboardSequence,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { useStoryPreviewNavigation } from "../_lib/use-story-preview-navigation";

const ACTIVE_BATCH_STATUSES = new Set(["queued", "running", "cancelling"]);
const CANCELLABLE_BATCH_STATUSES = new Set([
  "blocked",
  "queued",
  "running",
  "failed",
  "partial_failed",
]);

export function StoryGenerationBatchTranscript({
  reference,
  compactMobile = false,
}: {
  reference: AgentOsStoryGenerationBatchArtifactReference;
  compactMobile?: boolean;
}) {
  const t = useTranslations("storyStudio.generationBatchTranscript");
  const tGenerationError = useTranslations("studioModes.error");
  const queryClient = useQueryClient();
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const { storyProjectId, storyChapterId, generationBatchId } = reference;
  // Play through the shared preview navigation so the save barrier runs first;
  // a bare link would walk a story one autosave behind the batch it offers.
  const previewNavigation = useStoryPreviewNavigation(storyProjectId);
  const batchKey = useMemo(
    () => storyProductionKeys.batch(storyProjectId, storyChapterId, generationBatchId),
    [generationBatchId, storyChapterId, storyProjectId]
  );
  const assetsKey = useMemo(
    () => storyProductionKeys.assets(storyProjectId, storyChapterId),
    [storyChapterId, storyProjectId]
  );
  const storyboardKey = useMemo(
    () => storyProductionKeys.storyboard(storyProjectId, storyChapterId),
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
  const targetKind = batchQuery.data?.items[0]?.targetKind;
  const assetsQuery = useQuery({
    queryKey: assetsKey,
    queryFn: ({ signal }) => listStoryAssetSpecs(storyProjectId, storyChapterId, signal),
    enabled: targetKind === "asset_spec",
    refetchInterval: settling ? 1_500 : false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const storyboardQuery = useQuery({
    queryKey: storyboardKey,
    queryFn: ({ signal }) => getStoryStoryboard(storyProjectId, storyChapterId, signal),
    enabled: targetKind === "storyboard_clip",
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
    void queryClient.invalidateQueries({ queryKey: storyboardKey });
  }, [assetsKey, batchStatus, completedCount, hasBatch, queryClient, storyboardKey]);

  const cancelMutation = useMutation({
    retry: false,
    mutationFn: () => cancelStoryGenerationBatch(storyProjectId, storyChapterId, generationBatchId),
    onSuccess: (batch) => {
      queryClient.setQueryData(batchKey, batch);
      void queryClient.invalidateQueries({
        queryKey: storyProductionKeys.batches(storyProjectId, storyChapterId),
      });
      void queryClient.invalidateQueries({ queryKey: assetsKey });
      void queryClient.invalidateQueries({ queryKey: storyboardKey });
    },
  });
  const resumeMutation = useMutation({
    retry: false,
    mutationFn: () => resumeStoryGenerationBatch(storyProjectId, storyChapterId, generationBatchId),
    onSuccess: (batch) => {
      queryClient.setQueryData(batchKey, batch);
      void queryClient.invalidateQueries({
        queryKey: storyProductionKeys.batches(storyProjectId, storyChapterId),
      });
      void queryClient.invalidateQueries({ queryKey: assetsKey });
      void queryClient.invalidateQueries({ queryKey: storyboardKey });
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
  const storyboard = storyboardQuery.data ?? [];
  const orderedItems = [...batch.items].sort((left, right) => left.ordinal - right.ordinal);
  const transcriptItems = compactMobile ? sequentiallyRevealedItems(orderedItems) : orderedItems;
  const settled = batch.counts.completed + batch.counts.failed + batch.counts.cancelled;
  const failure = storyGenerationBatchFailure(batch);
  const failureMessage =
    failure?.code === "INSUFFICIENT_COMPUTE_POINTS" ||
    failure?.code === "INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS"
      ? tGenerationError("insufficientCredits")
      : failure?.message;
  const recoverable =
    compactMobile &&
    (batch.status === "blocked" || batch.status === "failed" || batch.status === "partial_failed");
  const insufficientBalance =
    failure?.code === "INSUFFICIENT_COMPUTE_POINTS" ||
    failure?.code === "INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS";
  const firstUnfinished = orderedItems.find((item) => item.status !== "completed");
  const requiredPoints =
    numericPoints(failure?.requiredAmount) ?? firstUnfinished?.quotedPoints ?? null;
  const availablePoints =
    bigintPoints(batch.availablePoints) ?? bigintPoints(failure?.availableBalance) ?? null;

  return (
    <TranscriptSection compactMobile={compactMobile}>
      {!compactMobile ? (
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <IconPhoto className="size-4 shrink-0 text-white/48" aria-hidden="true" />
              <p className="truncate text-xs font-medium text-white/82">{t("title")}</p>
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-white/46">
              {t("summary", {
                processed: settled,
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
      ) : null}

      {!compactMobile ? (
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
      ) : null}

      {compactMobile ? (
        <div data-testid="sequential-generation-stream" className="space-y-3" aria-live="polite">
          {targetKind === "storyboard_clip" ? (
            <MobileStoryboardGenerationStream
              items={transcriptItems}
              sequences={storyboard}
              canCancel={batch.canCancel && CANCELLABLE_BATCH_STATUSES.has(batch.status)}
              blocked={batch.status === "blocked"}
              cancelling={cancelMutation.isPending}
              onCancel={() => cancelMutation.mutate()}
            />
          ) : (
            transcriptItems.map((item) => (
              <MobileGenerationCard
                key={item.id}
                item={item}
                asset={assets.get(item.targetId)}
                label={
                  batch.status === "blocked" && item.id === firstUnfinished?.id
                    ? t("itemStatus.blocked")
                    : isActiveItem(item.status)
                      ? t("itemStatus.generating")
                      : t(`itemStatus.${item.status}`)
                }
                failureDetail={item.status === "failed" ? mobileFailureDetail(item.error) : null}
                blocked={batch.status === "blocked" && item.id === firstUnfinished?.id}
                failureStopped={
                  item.status === "failed" &&
                  orderedItems
                    .filter((candidate) => candidate.ordinal > item.ordinal)
                    .every((candidate) => candidate.status === "cancelled")
                }
                canCancel={
                  isActiveItem(item.status) &&
                  batch.canCancel &&
                  CANCELLABLE_BATCH_STATUSES.has(batch.status)
                }
                cancelling={cancelMutation.isPending}
                onCancel={() => cancelMutation.mutate()}
              />
            ))
          )}
        </div>
      ) : (
        <div className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
          {transcriptItems.map((item) => (
            <GenerationCard
              key={item.id}
              item={item}
              asset={assets.get(item.targetId)}
              label={t(`itemStatus.${item.status}`)}
            />
          ))}
        </div>
      )}

      {recoverable ? (
        <div
          role="alert"
          className="mt-3 rounded-2xl border border-white/[0.1] bg-white/[0.025] p-3.5"
        >
          <p className="text-sm font-medium text-white/88">
            {insufficientBalance ? t("recovery.balanceTitle") : t("recovery.failedTitle")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-white/56">
            {insufficientBalance ? t("recovery.balanceBody") : t("recovery.failedBody")}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {insufficientBalance ? (
              <Button type="button" onClick={() => setRechargeOpen(true)}>
                <IconWallet aria-hidden="true" />
                {t("recovery.recharge")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={insufficientBalance ? "quiet" : "default"}
              loading={resumeMutation.isPending}
              onClick={() => resumeMutation.mutate()}
            >
              <IconRefresh aria-hidden="true" />
              {t("recovery.continue")}
            </Button>
            <Button
              type="button"
              variant="quiet"
              className={insufficientBalance ? "col-span-2" : ""}
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              <IconBan aria-hidden="true" />
              {t("recovery.stop")}
            </Button>
          </div>
          {resumeMutation.isError ? (
            <p className="mt-2 text-xs leading-relaxed text-red-100/88">
              {storyApiErrorMessage(resumeMutation.error, t("recovery.resumeError"))}
            </p>
          ) : null}
        </div>
      ) : null}

      {!compactMobile && failureMessage ? (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-red-100/88">
          {failureMessage}
        </p>
      ) : null}

      {assetsQuery.isError ? (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-red-100/88">
          {storyApiErrorMessage(assetsQuery.error, t("mediaLoadError"))}
        </p>
      ) : null}
      {storyboardQuery.isError ? (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-red-100/88">
          {storyApiErrorMessage(storyboardQuery.error, t("mediaLoadError"))}
        </p>
      ) : null}
      {compactMobile && targetKind === "storyboard_clip" && batch.status === "completed" ? (
        <Button
          type="button"
          className="mt-3 w-full"
          loading={previewNavigation.pending}
          onClick={() => void previewNavigation.openPreview({ chapterId: storyChapterId })}
        >
          <IconPlayerPlay aria-hidden="true" />
          {t("mobileStoryboard.play")}
        </Button>
      ) : null}
      {cancelMutation.isError ? (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-red-100/88">
          {storyApiErrorMessage(cancelMutation.error, t("cancelError"))}
        </p>
      ) : null}
      {rechargeOpen ? (
        <ComputeRechargeDialog
          available={availablePoints}
          onOpenChange={setRechargeOpen}
          open
          required={requiredPoints}
        />
      ) : null}
    </TranscriptSection>
  );
}

function TranscriptSection({
  children,
  compactMobile = false,
}: {
  children: React.ReactNode;
  compactMobile?: boolean;
}) {
  return (
    <section className={cn("mt-1", compactMobile ? "" : "border-y border-white/[0.09] py-3")}>
      {children}
    </section>
  );
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

function MobileGenerationCard({
  item,
  asset,
  label,
  failureDetail,
  failureStopped,
  blocked,
  canCancel,
  cancelling,
  onCancel,
}: {
  item: StoryGenerationBatch["items"][number];
  asset?: StoryAssetSpec;
  label: string;
  failureDetail: string | null;
  failureStopped: boolean;
  blocked: boolean;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const t = useTranslations("storyStudio.generationBatchTranscript");
  const media = item.status === "completed" ? asset?.selectedMediaVersion : null;
  const name = asset?.name ?? item.targetId;
  const active = isActiveItem(item.status);
  const kind = asset?.kind ?? "prop";
  const kindLabel = t(`assetKinds.${kind}`);
  const title = t("mobileCard.title", { kind: kindLabel, name });
  const Icon = kind === "character" ? IconUser : kind === "location" ? IconMapPin : IconBox;

  return (
    <details
      open
      data-generation-item={item.targetId}
      className="group overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.018]"
      aria-label={`${name}: ${label}`}
    >
      <summary className="flex min-h-12 list-none items-center gap-2.5 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <Icon className="size-5 shrink-0 text-white/58" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/88">{title}</span>
        <IconChevronDown className="size-4 shrink-0 text-white/45" aria-hidden="true" />
      </summary>

      <div
        className="relative mx-2.5 mb-2.5 overflow-hidden rounded-xl bg-white/[0.045]"
        style={{ aspectRatio: mediaAspectRatio(asset) }}
      >
        {media ? <GeneratedMedia asset={asset as StoryAssetSpec} large /> : null}
        {!media && active ? (
          <div className="absolute inset-0 grid place-items-center overflow-hidden">
            <div className="absolute inset-0 animate-pulse bg-white/[0.025]" aria-hidden="true" />
            <div className="relative flex flex-col items-center gap-3 text-white/62">
              <IconLoader2 className="size-6 animate-spin" aria-hidden="true" />
              <span className="text-sm">{t("mobileCard.generating")}</span>
              {canCancel ? (
                <Button
                  type="button"
                  size="xs"
                  variant="quiet"
                  loading={cancelling}
                  onClick={(event) => {
                    event.preventDefault();
                    onCancel();
                  }}
                >
                  <IconBan aria-hidden="true" />
                  {t("cancel")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {!media && blocked && item.status === "awaiting_confirmation" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
            <IconWallet className="size-6 text-white/68" aria-hidden="true" />
            <p className="text-sm font-medium text-white/86">{t("mobileCard.paused")}</p>
            <p className="text-xs leading-relaxed text-white/52">{t("mobileCard.pausedHint")}</p>
          </div>
        ) : null}
        {!media && item.status === "failed" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
            <IconAlertTriangle className="size-6 text-red-100/82" aria-hidden="true" />
            <p className="text-sm font-medium text-red-100/88">{t("mobileCard.failed")}</p>
            <p className="text-xs leading-relaxed text-white/52">
              {t(failureStopped ? "mobileCard.failedStoppedHint" : "mobileCard.failedRetainedHint")}
            </p>
            {failureDetail ? (
              <details className="max-w-full text-left">
                <summary className="text-xs text-white/58 underline decoration-white/24 underline-offset-4">
                  {t("mobileCard.viewError")}
                </summary>
                <p className="mt-2 max-h-24 overflow-y-auto break-words text-[11px] leading-relaxed text-red-100/76">
                  {failureDetail}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}
        {!media && item.status === "cancelled" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/55">
            <IconBan className="size-6" aria-hidden="true" />
            <span className="text-sm">{t("mobileCard.cancelled")}</span>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function MobileStoryboardGenerationStream({
  items,
  sequences,
  canCancel,
  blocked,
  cancelling,
  onCancel,
}: {
  items: StoryGenerationBatch["items"];
  sequences: StoryStoryboardSequence[];
  canCancel: boolean;
  blocked: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const t = useTranslations("storyStudio.generationBatchTranscript");
  const clipIndex = new Map<
    string,
    { sequence: StoryStoryboardSequence; clip: StoryStoryboardClip }
  >();
  for (const sequence of sequences) {
    for (const clip of sequence.clips) clipIndex.set(clip.id, { sequence, clip });
  }
  const grouped = new Map<
    string,
    { sequence: StoryStoryboardSequence | null; items: StoryGenerationBatch["items"] }
  >();
  for (const item of items) {
    const indexed = clipIndex.get(item.targetId);
    const sequenceId = item.sequenceId ?? indexed?.sequence.id ?? item.targetId;
    const group = grouped.get(sequenceId) ?? {
      sequence: indexed?.sequence ?? null,
      items: [],
    };
    group.items.push(item);
    grouped.set(sequenceId, group);
  }

  return [...grouped.entries()].map(([sequenceId, group], sequenceIndex) => (
    <article
      key={sequenceId}
      data-storyboard-sequence={sequenceId}
      className="overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.018]"
    >
      <div className="flex min-h-12 items-center gap-2.5 px-3.5 py-2.5">
        <IconMovie className="size-5 shrink-0 text-white/58" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/88">
          {t("mobileStoryboard.title", {
            index: sequenceIndex + 1,
            name: group.sequence?.title ?? t("mobileStoryboard.untitled"),
          })}
        </span>
      </div>
      <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-2.5 pb-2.5">
        {group.items.map((item, clipIndexInSequence) => {
          const clip = clipIndex.get(item.targetId)?.clip;
          const media = item.status === "completed" ? clip?.selectedMediaVersion : null;
          const active = isActiveItem(item.status);
          const title =
            clip?.title ?? t("mobileStoryboard.clip", { index: clipIndexInSequence + 1 });
          return (
            <div
              key={item.id}
              data-generation-item={item.targetId}
              className="w-[88%] shrink-0 snap-start"
            >
              <p className="mb-2 truncate px-0.5 text-xs text-white/68">{title}</p>
              <div className="relative aspect-video overflow-hidden rounded-xl bg-white/[0.045]">
                {media ? <GeneratedStoryboardMedia clip={clip as StoryStoryboardClip} /> : null}
                {!media && active ? (
                  <div className="absolute inset-0 grid place-items-center">
                    <div
                      className="absolute inset-0 animate-pulse bg-white/[0.025]"
                      aria-hidden="true"
                    />
                    <div className="relative flex flex-col items-center gap-3 text-white/62">
                      <IconLoader2 className="size-6 animate-spin" aria-hidden="true" />
                      <span className="text-sm">{t("mobileStoryboard.generating")}</span>
                      {canCancel ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="quiet"
                          loading={cancelling}
                          onClick={onCancel}
                        >
                          <IconBan aria-hidden="true" />
                          {t("cancel")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {!media && blocked && item.status === "awaiting_confirmation" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
                    <IconWallet className="size-6 text-white/68" aria-hidden="true" />
                    <p className="text-sm font-medium text-white/86">
                      {t("mobileStoryboard.paused")}
                    </p>
                  </div>
                ) : null}
                {!media && item.status === "failed" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
                    <IconAlertTriangle className="size-6 text-red-100/82" aria-hidden="true" />
                    <p className="text-sm font-medium text-red-100/88">
                      {t("mobileStoryboard.failed")}
                    </p>
                    {mobileFailureDetail(item.error) ? (
                      <p className="line-clamp-3 text-xs leading-relaxed text-white/52">
                        {mobileFailureDetail(item.error)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {!media && item.status === "cancelled" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/55">
                    <IconBan className="size-6" aria-hidden="true" />
                    <span className="text-sm">{t("mobileCard.cancelled")}</span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  ));
}

function GeneratedStoryboardMedia({ clip }: { clip: StoryStoryboardClip }) {
  const media = clip.selectedMediaVersion;
  const source = media?.previewUrl ?? media?.thumbnailUrl;
  if (!media || !source) return null;
  const video = media.mediaKind === "video" || media.mimeType?.startsWith("video/") === true;
  return video && media.previewUrl ? (
    <video
      src={media.previewUrl}
      poster={media.thumbnailUrl ?? undefined}
      muted
      playsInline
      controls
      preload="metadata"
      aria-label={clip.title}
      className="absolute inset-0 size-full object-cover"
    />
  ) : (
    <Image
      src={source}
      alt={clip.title}
      fill
      unoptimized
      sizes="(max-width: 767px) 82vw"
      className="object-cover"
    />
  );
}

function GeneratedMedia({ asset, large = false }: { asset: StoryAssetSpec; large?: boolean }) {
  const media = asset.selectedMediaVersion;
  const source = large
    ? (media?.previewUrl ?? media?.thumbnailUrl)
    : (media?.thumbnailUrl ?? media?.previewUrl);
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
    <Image
      src={source}
      alt={asset.name}
      fill
      unoptimized
      sizes={large ? "(max-width: 767px) calc(100vw - 40px)" : "104px"}
      className="object-cover"
    />
  );
}

function mediaAspectRatio(asset?: StoryAssetSpec): string {
  const width = asset?.selectedMediaVersion?.width;
  const height = asset?.selectedMediaVersion?.height;
  return width && height && width > 0 && height > 0 ? `${width} / ${height}` : "1 / 1";
}

function mobileFailureDetail(error: unknown): string | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const value = error as Record<string, unknown>;
  for (const key of ["userMessage", "message", "detail"] as const) {
    const message = value[key];
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return null;
}

function bigintPoints(value: string | null | undefined): bigint | null {
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

function numericPoints(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isActiveItem(status: StoryGenerationBatchItemStatus): boolean {
  return status === "ready" || status === "dispatching" || status === "submitted";
}

function sequentiallyRevealedItems(
  items: readonly StoryGenerationBatch["items"][number][]
): StoryGenerationBatch["items"] {
  const visible: StoryGenerationBatch["items"] = [];
  for (const item of items) {
    visible.push(item);
    if (!isSettledItem(item.status)) break;
    // A sequential stream stops visually at the first failure immediately,
    // even during the sub-second window before the backend marks every later
    // ready item cancelled. Never render a later card as "generating" beside
    // an already-visible failure.
    if (item.status === "failed" || item.status === "cancelled") break;
  }
  return visible;
}

function isSettledItem(status: StoryGenerationBatchItemStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

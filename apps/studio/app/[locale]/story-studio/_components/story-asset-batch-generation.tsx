"use client";

import { IconAlertTriangle, IconBan, IconBolt, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  cancelStoryGenerationBatch,
  resumeStoryGenerationBatch,
  confirmStoryGenerationBatch,
  createStoryProductionIdempotencyKey,
  listStoryGenerationBatches,
  quoteStoryAssetGenerationBatch,
  storyGenerationBatchFailure,
  storyGenerationBatchHasPendingItems,
  storyProductionKeys,
  type StoryAssetSpec,
  type StoryGenerationBatch,
} from "@/lib/story-production-api";
import { storyApiErrorMessage, storyBillingBalanceQueryKey } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { storyGenerationOptions } from "../_stores/story-production-settings-store";
import { useStoryProductionGenerationDefaults } from "./use-story-production-generation-defaults";

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling"]);
const CANCELLABLE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_STATUSES = new Set([
  "completed",
  "partial_failed",
  "cancelled",
  "failed",
  "expired",
]);

export function StoryAssetBatchGeneration({
  projectId,
  chapterId,
  assets,
}: {
  projectId: string;
  chapterId: string;
  assets: StoryAssetSpec[];
}) {
  const t = useTranslations("storyStudio.assetsPage.batch");
  const tGenerationError = useTranslations("studioModes.error");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const defaults = useStoryProductionGenerationDefaults(projectId, "image");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [quote, setQuote] = useState<StoryGenerationBatch | null>(null);
  const reconciledBatchIds = useRef(new Set<string>());
  const observedActiveBatchIds = useRef(new Set<string>());
  const observedCompletedCounts = useRef(new Map<string, number>());

  const batchesQuery = useQuery({
    queryKey: storyProductionKeys.batches(projectId, chapterId),
    queryFn: ({ signal }) => listStoryGenerationBatches(projectId, chapterId, signal),
    refetchInterval: (query) =>
      query.state.data?.some((batch) => storyGenerationBatchHasPendingItems(batch)) ? 1_500 : false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const activeBatch = batchesQuery.data?.find((batch) => ACTIVE_STATUSES.has(batch.status)) ?? null;

  useEffect(() => {
    for (const batch of batchesQuery.data ?? []) {
      const previousCompleted = observedCompletedCounts.current.get(batch.id);
      observedCompletedCounts.current.set(batch.id, batch.counts.completed);
      if (previousCompleted !== undefined && previousCompleted !== batch.counts.completed) {
        void queryClient.invalidateQueries({
          queryKey: storyProductionKeys.assets(projectId, chapterId),
        });
        void queryClient.invalidateQueries({
          queryKey: storyBillingBalanceQueryKey(projectId),
        });
      }
      if (ACTIVE_STATUSES.has(batch.status)) {
        observedActiveBatchIds.current.add(batch.id);
      }
      if (!batch.confirmedAt || !TERMINAL_STATUSES.has(batch.status)) continue;
      if (reconciledBatchIds.current.has(batch.id)) continue;
      reconciledBatchIds.current.add(batch.id);
      void queryClient.invalidateQueries({
        queryKey: storyProductionKeys.assets(projectId, chapterId),
      });
      void queryClient.invalidateQueries({
        queryKey: storyBillingBalanceQueryKey(projectId),
      });
      if (!observedActiveBatchIds.current.has(batch.id)) continue;
      if (batch.status === "completed") toast.success(t("completed"));
      else if (batch.status === "partial_failed") {
        toast.error(
          batchFailureMessage(batch, t("partialFailed"), tGenerationError("insufficientCredits"))
        );
      } else if (batch.status === "failed") {
        toast.error(
          batchFailureMessage(batch, t("failed"), tGenerationError("insufficientCredits"))
        );
      }
    }
  }, [batchesQuery.data, chapterId, projectId, queryClient, t, tGenerationError]);

  const quoteMutation = useMutation({
    retry: false,
    mutationFn: () =>
      quoteStoryAssetGenerationBatch(
        projectId,
        chapterId,
        createStoryProductionIdempotencyKey("asset-batch-quote"),
        {
          targets: assets.map((asset) => ({
            id: asset.id,
            expectedVersion: asset.version,
          })),
          outputKind: "image",
          modelId: defaults.selection?.modelId,
          schemaVersion: defaults.selection?.schemaVersion,
          options: storyGenerationOptions(defaults.options),
        }
      ),
    onSuccess: (value) => {
      setQuote(value);
      void queryClient.invalidateQueries({
        queryKey: storyProductionKeys.batches(projectId, chapterId),
      });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("quoteError"))),
  });

  const confirmMutation = useMutation({
    retry: false,
    mutationFn: () => {
      if (!quote) throw new Error("A batch quote is required before confirmation.");
      return confirmStoryGenerationBatch(projectId, chapterId, quote.id, quote.version);
    },
    onSuccess: (value) => {
      setQuote(value);
      setDialogOpen(false);
      void queryClient.invalidateQueries({
        queryKey: storyBillingBalanceQueryKey(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: storyProductionKeys.batches(projectId, chapterId),
      });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("confirmError"))),
  });

  const cancelMutation = useMutation({
    retry: false,
    mutationFn: () => {
      if (!activeBatch) throw new Error("An active batch is required before cancellation.");
      return cancelStoryGenerationBatch(projectId, chapterId, activeBatch.id);
    },
    onSuccess: () => {
      toast.success(t("cancelled"));
      void queryClient.invalidateQueries({
        queryKey: storyProductionKeys.batches(projectId, chapterId),
      });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("cancelError"))),
  });

  const openQuote = () => {
    setQuote(null);
    setDialogOpen(true);
    quoteMutation.mutate();
  };
  const insufficientPoints = quote ? quoteCannotBeAfforded(quote) : false;
  const tooltip =
    assets.length === 0
      ? t("allGeneratedTooltip")
      : t("tooltip", {
          model: defaults.model?.name ?? "…",
          count: assets.length,
        });

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {activeBatch ? <BatchProgress batch={activeBatch} /> : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex shrink-0"
              tabIndex={assets.length === 0 ? 0 : undefined}
              aria-label={assets.length === 0 ? tooltip : undefined}
            >
              <Button
                type="button"
                onClick={openQuote}
                disabled={assets.length === 0 || Boolean(activeBatch) || defaults.loading}
              >
                <IconBolt />
                {assets.length === 0 ? t("allGenerated") : t("generate")}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8} className="max-w-72 leading-5">
            {tooltip}
          </TooltipContent>
        </Tooltip>
        {activeBatch?.canCancel && CANCELLABLE_STATUSES.has(activeBatch.status) ? (
          <Button
            type="button"
            size="sm"
            variant="quiet"
            loading={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            <IconBan />
            {t("cancel")}
          </Button>
        ) : null}
      </div>

      {(batchesQuery.data ?? [])
        .filter((batch) => batch.status === "blocked")
        .map((batch) => (
          <BlockedAssetBatch
            key={batch.id}
            batch={batch}
            projectId={projectId}
            chapterId={chapterId}
          />
        ))}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>

          {quoteMutation.isPending ? (
            <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-white/64">
              <IconLoader2 className="size-4 animate-spin" />
              {t("quoting")}
            </div>
          ) : quote ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <QuoteMetric label={t("dialog.items")} value={String(quote.itemCount)} />
                <QuoteMetric label={t("dialog.points")} value={String(quote.totalPoints)} />
                <QuoteMetric
                  label={t("dialog.available")}
                  value={quote.availablePoints ?? t("dialog.unavailable")}
                />
              </div>
              <div className="rounded-xl bg-white/[0.045] px-3 py-2.5 text-xs leading-5 text-white/62">
                <p>
                  {t("dialog.model", { model: defaults.model?.name ?? quote.items[0]?.modelId })}
                </p>
                <p>
                  {t("dialog.expires", {
                    time: format.dateTime(new Date(quote.quoteExpiresAt), {
                      hour: "numeric",
                      minute: "2-digit",
                    }),
                  })}
                </p>
              </div>
              {insufficientPoints ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-xs leading-5 text-red-100/90"
                >
                  <IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t("dialog.insufficientPoints", {
                    available: quote.availablePoints ?? "0",
                    required: quote.totalPoints,
                  })}
                </div>
              ) : null}
              <p className="text-xs leading-5 text-white/55">{t("dialog.billingNotice")}</p>
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-white/55">{t("quoteError")}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="quiet" onClick={() => setDialogOpen(false)}>
              {t("dialog.back")}
            </Button>
            <Button
              type="button"
              loading={confirmMutation.isPending}
              disabled={!quote || quote.status !== "awaiting_confirmation" || insufficientPoints}
              onClick={() => confirmMutation.mutate()}
            >
              <IconCheck />
              {insufficientPoints
                ? t("dialog.insufficientConfirm")
                : quote
                  ? t("dialog.confirm", { points: quote.totalPoints })
                  : t("dialog.confirmEmpty")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function QuoteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.055] px-3 py-3">
      <p className="text-[11px] text-white/48">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-white/92">{value}</p>
    </div>
  );
}

function quoteCannotBeAfforded(quote: StoryGenerationBatch): boolean {
  if (quote.availablePoints === null || !/^\d+$/.test(quote.availablePoints)) return false;
  return BigInt(quote.availablePoints) < BigInt(quote.totalPoints);
}

function BatchProgress({ batch }: { batch: StoryGenerationBatch }) {
  const t = useTranslations("storyStudio.assetsPage.batch");
  const settled = batch.counts.completed + batch.counts.failed + batch.counts.cancelled;
  const progress = Math.round((settled / batch.itemCount) * 100);
  return (
    <div className="flex min-w-44 items-center gap-2 rounded-xl bg-white/[0.045] px-3 py-2">
      <IconLoader2 className="size-3.5 shrink-0 animate-spin text-white/62" />
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-3 text-[11px] text-white/62">
          <span>
            {batch.status === "cancelling"
              ? t("cancelling")
              : batch.canCancel
                ? t("running")
                : t("runningOther")}
          </span>
          <span className="tabular-nums">
            {settled}/{batch.itemCount}
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.09]">
          <div
            className={cn(
              "h-full rounded-full bg-white/70 transition-[width]",
              progress === 0 && "w-0"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function batchFailureMessage(
  batch: StoryGenerationBatch,
  fallback: string,
  insufficientCredits: string
): string {
  const failure = storyGenerationBatchFailure(batch);
  if (
    failure?.code === "INSUFFICIENT_COMPUTE_POINTS" ||
    failure?.code === "INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS"
  ) {
    return insufficientCredits;
  }
  return failure?.message ?? fallback;
}

export function BlockedAssetBatch({
  batch,
  projectId,
  chapterId,
}: {
  batch: StoryGenerationBatch;
  projectId: string;
  chapterId: string;
}) {
  const t = useTranslations("storyStudio.assetsPage.batch");
  const client = useQueryClient();
  const action = useMutation({
    retry: false,
    mutationFn: (operation: "resume" | "cancel") => {
      if (!batch.canCancel) throw new Error(t("recoveryOwner"));
      return operation === "resume"
        ? resumeStoryGenerationBatch(projectId, chapterId, batch.id)
        : cancelStoryGenerationBatch(projectId, chapterId, batch.id);
    },
    onSuccess: (updated) => {
      client.setQueryData<StoryGenerationBatch[]>(
        storyProductionKeys.batches(projectId, chapterId),
        (current) => current?.map((item) => (item.id === updated.id ? updated : item))
      );
      void client.invalidateQueries({
        queryKey: storyProductionKeys.batches(projectId, chapterId),
      });
      void client.invalidateQueries({ queryKey: storyBillingBalanceQueryKey(projectId) });
      void client.invalidateQueries({ queryKey: storyProductionKeys.assets(projectId, chapterId) });
    },
  });
  return (
    <div className="space-y-2 rounded-xl bg-white/[0.045] p-3 text-xs text-white/70">
      <p role="status">
        {t("recoveryPaused", { completed: batch.counts.completed, total: batch.itemCount })}
      </p>
      {batch.canCancel ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="quiet"
            disabled={action.isPending}
            onClick={() => action.mutate("resume")}
          >
            {t("recoveryResume")}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={action.isPending}
            onClick={() => action.mutate("cancel")}
          >
            {t("cancel")}
          </Button>
        </div>
      ) : (
        <p>{t("recoveryOwner")}</p>
      )}
      {action.error ? (
        <p role="alert">{storyApiErrorMessage(action.error, t("recoveryError"))}</p>
      ) : null}
    </div>
  );
}

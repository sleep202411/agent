"use client";

import { IconAlertTriangle, IconArrowBackUp, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  createStoryProductionIdempotencyKey,
  resolveStoryAssetSpecConflict,
  resolveStoryStoryboardSequenceConflict,
  storyProductionKeys,
  type StoryAssetSpec,
  type StoryAssetSpecConflictResolutionResult,
  type StoryProductionConflictResolution,
  type StoryProductionState,
  type StoryStoryboardSequence,
  type StoryStoryboardSequenceConflictResolutionResult,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";

interface ConflictScope {
  projectId: string;
  chapterId: string;
}

type ConflictTarget =
  | { kind: "asset_spec"; item: StoryAssetSpec }
  | { kind: "storyboard_sequence"; item: StoryStoryboardSequence };

type ConflictResult =
  | StoryAssetSpecConflictResolutionResult
  | StoryStoryboardSequenceConflictResolutionResult;

export function StoryProductionConflictPanel({
  scope,
  target,
}: {
  scope: ConflictScope;
  target: ConflictTarget;
}) {
  const t = useTranslations("storyStudio.productionConflict");
  const queryClient = useQueryClient();
  const [pendingResolution, setPendingResolution] =
    useState<StoryProductionConflictResolution | null>(null);
  const commandInFlight = useRef(false);
  const item = target.item;

  const mutation = useMutation({
    retry: false,
    mutationFn: (resolution: StoryProductionConflictResolution) =>
      resolveConflict(scope, target, resolution),
    onSuccess: (result) => {
      applyConflictResult(queryClient, scope, result);
      toast.success(t("resolved"));
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("resolveError"))),
  });

  if (item.status !== "stale") return null;

  const conflict = item.conflict ?? null;
  const fingerprint = item.pendingSourceFingerprint ?? null;
  const metadataReady =
    conflict !== null && fingerprint !== null && fingerprint === conflict.pendingSourceFingerprint;
  const keepCurrentSupported = !(target.kind === "storyboard_sequence" && conflict?.removed);

  const confirmResolution = async () => {
    if (!pendingResolution || !metadataReady || commandInFlight.current) return;
    commandInFlight.current = true;
    try {
      await mutation.mutateAsync(pendingResolution);
    } catch {
      // The mutation renders the exact upstream message through its own onError.
    } finally {
      commandInFlight.current = false;
    }
  };

  return (
    <section
      className="mt-5 rounded-xl border border-amber-200/20 bg-amber-200/[0.07] p-4"
      role="alert"
      aria-label={t("ariaLabel")}
    >
      <div className="flex items-start gap-3">
        <IconAlertTriangle
          className="mt-0.5 size-5 shrink-0 text-amber-100/90"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-amber-50/95">{t("title")}</h2>
          <p className="mt-1 text-xs leading-5 text-amber-50/82">{t("description")}</p>

          {metadataReady && conflict ? (
            <ConflictSummary target={target} />
          ) : (
            <p className="mt-3 rounded-lg bg-black/20 px-3 py-2.5 text-xs leading-5 text-amber-50/88">
              {t("metadataUnavailable")}
            </p>
          )}

          {metadataReady ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!keepCurrentSupported || mutation.isPending}
                loading={mutation.isPending && pendingResolution === "keep_current"}
                onClick={() => setPendingResolution("keep_current")}
              >
                <IconArrowBackUp />
                {t("keepCurrent")}
              </Button>
              <Button
                size="sm"
                disabled={mutation.isPending}
                loading={mutation.isPending && pendingResolution === "use_latest_plan"}
                onClick={() => setPendingResolution("use_latest_plan")}
              >
                <IconRefresh />
                {t("useLatestPlan")}
              </Button>
            </div>
          ) : null}

          {!keepCurrentSupported ? (
            <p className="mt-2 text-[11px] leading-5 text-amber-50/78">
              {t("removedSequenceCannotKeep")}
            </p>
          ) : null}
        </div>
      </div>

      <AlertDialog
        open={pendingResolution !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setPendingResolution(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <IconAlertTriangle aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {pendingResolution === "keep_current"
                ? t("confirmKeepTitle")
                : t("confirmLatestTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmationDescription(t, target, pendingResolution)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => void confirmResolution()}
            >
              {pendingResolution === "keep_current" ? t("confirmKeep") : t("confirmLatest")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ConflictSummary({ target }: { target: ConflictTarget }) {
  const t = useTranslations("storyStudio.productionConflict");
  const conflict = target.item.conflict;
  if (!conflict) return null;

  if (conflict.removed) {
    return (
      <div className="mt-3 rounded-lg bg-black/22 px-3 py-2.5">
        <p className="text-xs font-semibold text-white/90">{t("latestRemovesItem")}</p>
        <p className="mt-1 text-[11px] leading-5 text-white/70">
          {target.kind === "asset_spec"
            ? t("assetRemovalSummary", { name: target.item.name })
            : t("sequenceRemovalSummary", {
                name: target.item.title?.trim() || target.item.plotNodeId,
              })}
        </p>
      </div>
    );
  }

  if (target.kind === "asset_spec") {
    const pendingItem = target.item.conflict?.pendingItem;
    if (!pendingItem) return null;
    return (
      <div className="mt-3 rounded-lg bg-black/22 px-3 py-2.5">
        <p className="text-xs font-semibold text-white/90">
          {t("latestAsset", {
            name: pendingItem.name,
            kind: pendingItem.kind,
          })}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-white/72">
          {pendingItem.description}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-white/68">
          {t("latestPrompt", { prompt: pendingItem.imagePrompt })}
        </p>
      </div>
    );
  }
  const pendingItem = target.item.conflict?.pendingItem;
  if (!pendingItem) return null;
  return (
    <div className="mt-3 rounded-lg bg-black/22 px-3 py-2.5">
      <p className="text-xs font-semibold text-white/90">
        {t("latestSequence", { name: pendingItem.title })}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-white/72">
        {t("latestSequenceSummary", {
          duration: pendingItem.durationMs,
          clips: pendingItem.clips.length,
          cues: pendingItem.cues.length,
        })}
      </p>
    </div>
  );
}

function resolveConflict(
  scope: ConflictScope,
  target: ConflictTarget,
  resolution: StoryProductionConflictResolution
): Promise<ConflictResult> {
  const conflict = target.item.conflict;
  if (!conflict || target.item.pendingSourceFingerprint !== conflict.pendingSourceFingerprint) {
    throw new Error("The latest Story production conflict details are unavailable.");
  }
  const input = {
    expectedVersion: target.item.version,
    expectedPendingSourceFingerprint: conflict.pendingSourceFingerprint,
    resolution,
  };
  const key = createStoryProductionIdempotencyKey("story-conflict-resolution");
  return target.kind === "asset_spec"
    ? resolveStoryAssetSpecConflict(scope.projectId, scope.chapterId, target.item.id, key, input)
    : resolveStoryStoryboardSequenceConflict(
        scope.projectId,
        scope.chapterId,
        target.item.id,
        key,
        input
      );
}

function applyConflictResult(
  queryClient: ReturnType<typeof useQueryClient>,
  scope: ConflictScope,
  result: ConflictResult
): void {
  queryClient.setQueryData<StoryProductionState>(
    storyProductionKeys.state(scope.projectId, scope.chapterId),
    result.productionState
  );
  if (result.targetKind === "asset_spec") {
    queryClient.setQueryData<StoryAssetSpec[]>(
      storyProductionKeys.assets(scope.projectId, scope.chapterId),
      (current) => replaceOrRemove(current, result.item)
    );
    void queryClient.invalidateQueries({
      queryKey: storyProductionKeys.storyboard(scope.projectId, scope.chapterId),
    });
    return;
  }
  queryClient.setQueryData<StoryStoryboardSequence[]>(
    storyProductionKeys.storyboard(scope.projectId, scope.chapterId),
    (current) => replaceOrRemove(current, result.item)
  );
}

function replaceOrRemove<T extends { id: string; status: string }>(
  current: T[] | undefined,
  item: T
): T[] | undefined {
  if (!current) return current;
  if (item.status === "archived") return current.filter((candidate) => candidate.id !== item.id);
  return current.map((candidate) => (candidate.id === item.id ? item : candidate));
}

function confirmationDescription(
  t: ReturnType<typeof useTranslations<"storyStudio.productionConflict">>,
  target: ConflictTarget,
  resolution: StoryProductionConflictResolution | null
): string {
  if (resolution === "keep_current") return t("confirmKeepDescription");
  if (target.item.conflict?.removed) {
    return target.kind === "asset_spec"
      ? t("confirmRemoveAssetDescription")
      : t("confirmRemoveSequenceDescription");
  }
  return t("confirmLatestDescription");
}

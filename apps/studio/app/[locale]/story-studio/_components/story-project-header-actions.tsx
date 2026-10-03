"use client";

import { useAuth } from "@/app/_components/auth-provider";

import {
  IconAlertTriangle,
  IconCheck,
  IconCloudOff,
  IconCloudUpload,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getInteractiveFilmPublication,
  interactiveFilmPublicationQueryKey,
  offlineInteractiveFilm,
  type InteractiveFilmPublication,
  type InteractiveFilmPublicationStatus,
} from "@/lib/interactive-film-api";
import { getStoryWorkbench, storyApiErrorMessage } from "@/lib/story-projects-api";
import { storyChapterWorkbenchQueryKey } from "../_lib/use-story-chapter-workbench";
import { StoryPublicationDialog } from "./project-canvas/story-publication-dialog";
import {
  useStoryPublication,
  type SavedDraftSnapshotRunner,
} from "./project-canvas/use-story-publication";
import { StoryProjectCreditsBadge } from "./story-project-credits-badge";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

const LABEL_CLASS = "@max-[1000px]:sr-only";

/** Project publication status is read directly from Java by projectId. */
export function StoryProjectHeaderActions({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  if (user?.id == null) return null;
  return <AccountStoryProjectHeaderActions key={`${user.id}:${projectId}`} projectId={projectId} />;
}
function AccountStoryProjectHeaderActions({ projectId }: { projectId: string }) {
  const { user, isCurrentAccount } = useAuth();
  const router = useRouter();
  const t = useTranslations("storyStudio.canvas");
  const commonT = useTranslations("storyStudio");
  const queryClient = useQueryClient();
  const [offlineIntent, setOfflineIntent] = useState(false);
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const liveDraft = useStoryProjectUiStore((state) => state.liveDraft);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);

  const workbenchQuery = useQuery({
    queryKey: activeChapterId
      ? storyChapterWorkbenchQueryKey(projectId, activeChapterId, user?.id ?? null)
      : ["story-studio", "script-workbench", projectId, user?.id ?? null],
    queryFn: ({ signal }) => getStoryWorkbench(projectId, activeChapterId ?? undefined, signal),
    enabled: Boolean(projectId && user),
    retry: false,
  });
  const workbench = workbenchQuery.data ?? null;
  const canRelease = Boolean(workbench?.project.capabilities.includes("story.release"));
  const publicationKey = interactiveFilmPublicationQueryKey(projectId, user?.id ?? null);
  const publicationQuery = useQuery({
    queryKey: publicationKey,
    queryFn: ({ signal }) => getInteractiveFilmPublication(projectId, signal),
    enabled: canRelease,
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const publication = publicationQuery.data ?? null;
  const status = publication?.status ?? null;

  const draftRevision = liveDraft?.revision ?? workbench?.draft.revision ?? null;
  const conflicted = liveDraft?.conflicted ?? false;
  const videoSnapshotHash = liveDraft
    ? liveDraft.videoSnapshotHash
    : (workbench?.video.snapshotHash ?? null);
  const ready = liveDraft !== null || workbench !== null;
  const storedRevision = workbench?.draft.revision;
  const fallbackRunner = useCallback<SavedDraftSnapshotRunner>(
    (submit) => {
      if (storedRevision == null) return Promise.reject(new Error(commonT("errors.generic")));
      return submit(storedRevision);
    },
    [storedRevision, commonT]
  );

  const submission = useStoryPublication({
    projectId,
    capabilities: workbench?.project.capabilities ?? [],
    expectedVideoSnapshotHash: videoSnapshotHash,
    withSavedDraftSnapshot: draftBarrier ?? fallbackRunner,
  });
  const canMutate = submission.canSubmit && ready && !conflicted;
  const statusReady = !publicationQuery.isLoading && !publicationQuery.isError;
  const canSubmitStatus = status === null || status === "draft" || status === "offline";
  const canSubmit = canMutate && statusReady && canSubmitStatus;
  const submitDisabledReason = !ready
    ? t("publish.projectLoading")
    : !submission.canSubmit
      ? t("publish.errors.permissionDenied")
      : publicationQuery.isLoading
        ? t("publish.statusChecking")
        : publicationQuery.isError
          ? t("publish.statusUnavailable")
          : status === "reviewing"
            ? t("publish.reviewingLocked")
            : status === "published"
              ? t("publish.publishedUpdateLocked")
              : conflicted
                ? t("publish.draftConflict")
                : null;
  const projectTitle = workbench?.project.title.trim() ?? "";
  const submitTooltip = submission.isPending
    ? t("publish.actionPending")
    : (submitDisabledReason ??
      enabledSubmitTooltip(t, submitActionKind(status, publication), projectTitle));
  const submitDisabled = !canSubmit || submission.isPending;
  const canOffline = canRelease && (status === "reviewing" || status === "published");
  const canEdit = !workbench || workbench.project.capabilities.includes("story.edit");

  const offlineOwner = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    offlineOwner.current = controller;
    return () => {
      controller.abort();
      if (offlineOwner.current === controller) offlineOwner.current = null;
    };
  }, [canRelease]);
  const offlineMutation = useMutation({
    onMutate: () => offlineOwner.current,
    mutationFn: async () => {
      const controller = offlineOwner.current;
      if (
        !canOffline ||
        !controller ||
        controller.signal.aborted ||
        user?.id == null ||
        !isCurrentAccount(user.id)
      )
        throw new DOMException("Publication action abandoned", "AbortError");
      const next = await offlineInteractiveFilm(projectId, controller.signal);
      return { next, controller };
    },
    onSuccess: ({ next, controller }) => {
      if (
        controller !== offlineOwner.current ||
        controller.signal.aborted ||
        user?.id == null ||
        !isCurrentAccount(user.id)
      )
        return;
      queryClient.setQueryData<InteractiveFilmPublication>(publicationKey, next);
      setOfflineIntent(false);
      toast.success(t("publish.offline.success"));
      void queryClient.invalidateQueries({ queryKey: publicationKey });
    },
    onError: (error, _variables, controller) => {
      if (
        controller === offlineOwner.current &&
        offlineOwner.current &&
        !offlineOwner.current.signal.aborted &&
        user?.id != null &&
        isCurrentAccount(user.id) &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        toast.error(storyApiErrorMessage(error, t("publish.errors.offlineFailed")));
    },
  });

  const submitButton = (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      onClick={submission.open}
      disabled={submitDisabled}
      className="h-9 gap-2 rounded-[14px] bg-transparent px-3 font-semibold text-white/68 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed"
    >
      {submission.isPending ? (
        <IconLoader2 className="size-4 animate-spin" />
      ) : status === "reviewing" ? (
        <IconLoader2 className="size-4" />
      ) : status === "published" ? (
        <IconCheck className="size-4" />
      ) : (
        <IconCloudUpload className="size-4" />
      )}
      <span className={LABEL_CLASS}>
        {submission.isPending
          ? t("publish.actionPending")
          : status === "reviewing"
            ? t("publish.actionReviewing")
            : status === "published"
              ? t("publish.actionPublished")
              : publication?.rejectReason
                ? t("publish.actionResubmit")
                : status === "offline"
                  ? t("publish.actionUpdate")
                  : t("publish.action")}
      </span>
    </Button>
  );

  return (
    <>
      {canRelease ? (
        <PublicationStatusBadge
          status={status}
          loading={publicationQuery.isLoading}
          failed={publicationQuery.isError}
          errorMessage={
            publicationQuery.isError
              ? storyApiErrorMessage(publicationQuery.error, t("publish.statusUnavailable"))
              : null
          }
          retrying={publicationQuery.isFetching}
          onRetry={() => void publicationQuery.refetch()}
          rejectReason={publication?.rejectReason ?? null}
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          {submitDisabled ? (
            <span
              tabIndex={0}
              className="inline-flex rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-white/55 [&>button]:pointer-events-none"
              aria-label={submitTooltip}
            >
              {submitButton}
            </span>
          ) : (
            submitButton
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8} className="max-w-80">
          {submitTooltip}
        </TooltipContent>
      </Tooltip>
      {canRelease ? (
        <>
          {canOffline ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => setOfflineIntent(true)}
              disabled={submission.isPending || offlineMutation.isPending}
              className="h-9 gap-2 rounded-[14px] px-3 font-semibold text-white/52 hover:bg-destructive/10 hover:text-destructive"
            >
              {offlineMutation.isPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconCloudOff className="size-4" />
              )}
              <span className={LABEL_CLASS}>{t("publish.offline.action")}</span>
            </Button>
          ) : null}
        </>
      ) : null}
      <StoryProjectCreditsBadge projectId={projectId} />
      {!canEdit ? (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-[14px] bg-white px-3 text-[11px] font-semibold text-black">
          {t("readOnly")}
        </span>
      ) : null}
      {canRelease ? (
        <>
          <StoryPublicationDialog
            state={submission.state}
            draftRevision={draftRevision ?? 0}
            canMutate={canSubmit}
            disabledReason={submitDisabledReason}
            onClose={submission.close}
            onConfirm={() => {
              if (canSubmit) void submission.confirm();
            }}
            onRetry={() => {
              if (canSubmit) void submission.retry();
            }}
            onLocateNode={(nodeId) => {
              if (!activeChapterId) return;
              submission.close();
              router.push(
                `/story-studio/projects/${projectId}/canvas?chapter=${encodeURIComponent(activeChapterId)}&focus=${encodeURIComponent(nodeId)}`
              );
            }}
          />
          <Dialog
            open={offlineIntent}
            onOpenChange={(open) => {
              if (!open && !offlineMutation.isPending) setOfflineIntent(false);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("publish.offline.title")}</DialogTitle>
                <DialogDescription>{t("publish.offline.description")}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={offlineMutation.isPending}
                  onClick={() => setOfflineIntent(false)}
                >
                  {t("publish.actions.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={offlineMutation.isPending}
                  onClick={() => offlineMutation.mutate()}
                >
                  {offlineMutation.isPending ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : (
                    <IconCloudOff className="size-4" />
                  )}
                  {t("publish.offline.confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}

function PublicationStatusBadge({
  status,
  loading,
  failed,
  errorMessage,
  retrying,
  onRetry,
  rejectReason,
}: {
  status: InteractiveFilmPublicationStatus | null;
  loading: boolean;
  failed: boolean;
  errorMessage: string | null;
  retrying: boolean;
  onRetry: () => void;
  rejectReason: string | null;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
  if (failed)
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-white/[0.055] px-2 text-[10px] font-semibold text-white/70 hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/55"
          >
            <IconAlertTriangle className="size-3.5" />
            {t("status.unavailable")}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <p role="alert" className="break-words text-sm text-white/80">
            {errorMessage}
          </p>
          <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>
            {retrying ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconRefresh className="size-4" />
            )}
            {t("retryStatus")}
          </Button>
        </PopoverContent>
      </Popover>
    );
  const label = loading
    ? t("status.checking")
    : failed
      ? t("status.unavailable")
      : publicationStatusLabel(status, t);
  const badge = (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-white/[0.055] px-2 text-[10px] font-semibold text-white/48">
      {rejectReason ? <IconAlertTriangle className="size-3.5 text-destructive" /> : null}
      {label}
    </span>
  );
  if (!rejectReason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="max-w-80">
        {t("rejectionReason", { reason: rejectReason })}
      </TooltipContent>
    </Tooltip>
  );
}

type PublishCanvasT = ReturnType<typeof useTranslations<"storyStudio.canvas">>;

function submitActionKind(
  status: InteractiveFilmPublicationStatus | null,
  publication: InteractiveFilmPublication | null
): "submit" | "update" | "resubmit" {
  if (publication?.rejectReason) return "resubmit";
  if (status === "offline") return "update";
  return "submit";
}

function enabledSubmitTooltip(
  t: PublishCanvasT,
  kind: "submit" | "update" | "resubmit",
  title: string
): string {
  if (!title) {
    if (kind === "resubmit") return t("publish.actionResubmit");
    if (kind === "update") return t("publish.actionUpdate");
    return t("publish.action");
  }
  if (kind === "resubmit") return t("publish.resubmitTooltip", { title });
  if (kind === "update") return t("publish.updateTooltip", { title });
  return t("publish.submitTooltip", { title });
}

type PublishT = ReturnType<typeof useTranslations<"storyStudio.canvas.publish">>;

function publicationStatusLabel(
  status: InteractiveFilmPublicationStatus | null,
  t: PublishT
): string {
  switch (status) {
    case "reviewing":
      return t("status.reviewing");
    case "published":
      return t("status.published");
    case "offline":
      return t("status.offline");
    case null:
    case "draft":
      return t("status.draft");
  }
}

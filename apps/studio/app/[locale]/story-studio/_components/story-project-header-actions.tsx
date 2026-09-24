"use client";

import { useAuth } from "@/app/_components/auth-provider";

import {
  IconAlertTriangle,
  IconCheck,
  IconCloudOff,
  IconCloudUpload,
  IconListCheck,
  IconLoader2,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
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
  getInteractiveFilmPublication,
  interactiveFilmPublicationQueryKey,
  offlineInteractiveFilm,
  type InteractiveFilmPublication,
  type InteractiveFilmPublicationStatus,
} from "@/lib/interactive-film-api";
import { getStoryWorkbench, storyApiErrorMessage } from "@/lib/story-projects-api";
import { storyChapterWorkbenchQueryKey } from "../_lib/use-story-chapter-workbench";
import { runStoryDraftCheck } from "../_lib/use-story-draft-check";
import { firstNodeIssue } from "./project-canvas/story-canvas-validation";
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
  const publicationKey = interactiveFilmPublicationQueryKey(projectId);
  const publicationQuery = useQuery({
    queryKey: publicationKey,
    queryFn: () => getInteractiveFilmPublication(projectId),
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
  const submitDisabledReason = publicationQuery.isLoading
    ? t("publish.statusChecking")
    : publicationQuery.isError
      ? t("publish.statusUnavailable")
      : status === "reviewing"
        ? t("publish.reviewingLocked")
        : status === "published"
          ? t("publish.publishedUpdateLocked")
          : submission.disabledReason;
  const canOffline = canRelease && (status === "reviewing" || status === "published");
  const canEdit = !workbench || workbench.project.capabilities.includes("story.edit");

  const offlineMutation = useMutation({
    mutationFn: () => offlineInteractiveFilm(projectId),
    onSuccess: (next) => {
      queryClient.setQueryData<InteractiveFilmPublication>(publicationKey, next);
      setOfflineIntent(false);
      toast.success(t("publish.offline.success"));
      void queryClient.invalidateQueries({ queryKey: publicationKey });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("publish.errors.offlineFailed"))),
  });

  const submitButton = (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      onClick={submission.open}
      disabled={!canSubmit || submission.isPending}
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
      <DraftCheckButton
        projectId={projectId}
        chapterId={activeChapterId}
        draftBarrier={draftBarrier}
      />
      {canRelease ? (
        <>
          <PublicationStatusBadge
            status={status}
            loading={publicationQuery.isLoading}
            failed={publicationQuery.isError}
            rejectReason={publication?.rejectReason ?? null}
          />
          {submitDisabledReason && (!canSubmit || submission.isPending) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-white/55 [&>button]:pointer-events-none"
                  aria-label={`${t("publish.action")}: ${submitDisabledReason}`}
                >
                  {submitButton}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {submitDisabledReason}
              </TooltipContent>
            </Tooltip>
          ) : (
            submitButton
          )}
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

/**
 * Compile the saved draft through the working-preview pipeline and surface
 * what blocks publishing: a toast summary, badges on the offending canvas
 * scenes, and a jump straight to the first one.
 */
function DraftCheckButton({
  projectId,
  chapterId,
  draftBarrier,
}: {
  projectId: string;
  chapterId: string | null;
  draftBarrier: SavedDraftSnapshotRunner | null;
}) {
  const t = useTranslations("storyStudio.canvas.validation");
  const queryClient = useQueryClient();
  const requestCanvasFocus = useStoryProjectUiStore((state) => state.requestCanvasFocus);
  const [checking, setChecking] = useState(false);

  const run = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      // The check compiles the saved head, so flush canvas edits first; on the
      // other steps edits are already server-side and the barrier is null.
      if (draftBarrier) await draftBarrier(async () => null);
      const result = await runStoryDraftCheck(queryClient, projectId, chapterId);
      const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
      if (errors.length === 0 && warnings.length === 0) {
        toast.success(t("checkClean"));
        return;
      }
      toast.error(
        warnings.length > 0
          ? t("checkIssuesWithWarnings", { errors: errors.length, warnings: warnings.length })
          : t("checkIssues", { errors: errors.length })
      );
      const first = firstNodeIssue(result.diagnostics);
      if (first?.entityId) requestCanvasFocus(first.entityId);
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("checkFailed")));
    } finally {
      setChecking(false);
    }
  }, [chapterId, checking, draftBarrier, projectId, queryClient, requestCanvasFocus, t]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      onClick={() => void run()}
      disabled={checking}
      className="h-9 gap-2 rounded-[14px] px-3 font-semibold text-white/68 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed"
    >
      {checking ? (
        <IconLoader2 className="size-4 animate-spin" />
      ) : (
        <IconListCheck className="size-4" />
      )}
      <span className={LABEL_CLASS}>{checking ? t("checkPending") : t("checkAction")}</span>
    </Button>
  );
}

function PublicationStatusBadge({
  status,
  loading,
  failed,
  rejectReason,
}: {
  status: InteractiveFilmPublicationStatus | null;
  loading: boolean;
  failed: boolean;
  rejectReason: string | null;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
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

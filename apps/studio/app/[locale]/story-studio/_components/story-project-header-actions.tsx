"use client";

import { IconCheck, IconCloudUpload, IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getStoryExperienceCurrentRelease, getStoryWorkbench } from "@/lib/story-projects-api";
import { storyChapterWorkbenchQueryKey } from "../_lib/use-story-chapter-workbench";
import { isExactCurrentStoryRelease } from "./project-canvas/story-current-release";
import { StoryPublicationDialog } from "./project-canvas/story-publication-dialog";
import { StoryProjectCreditsBadge } from "./story-project-credits-badge";
import {
  useStoryPublication,
  type SavedDraftSnapshotRunner,
} from "./project-canvas/use-story-publication";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

const LABEL_CLASS = "@max-[1000px]:sr-only";

/**
 * Project-level Preview/Publish, mounted in the layout header on every step.
 * While the canvas is mounted it supplies live signals through the store
 * (draft head, save barrier, leave guard) so the buttons keep exact canvas
 * semantics; on the other steps the server projection is the truth and the
 * barrier is a plain pass-through of the stored revision.
 */
export function StoryProjectHeaderActions({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas");
  const commonT = useTranslations("storyStudio");
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const liveDraft = useStoryProjectUiStore((state) => state.liveDraft);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);

  const workbenchQuery = useQuery({
    // With a chapter in scope this shares the dock tenants' cache entry; the
    // header also renders before one resolves, hence the project-level key.
    queryKey: activeChapterId
      ? storyChapterWorkbenchQueryKey(projectId, activeChapterId)
      : ["story-studio", "script-workbench", projectId],
    queryFn: () => getStoryWorkbench(projectId, activeChapterId ?? undefined),
    retry: false,
  });
  const workbench = workbenchQuery.data ?? null;

  const currentReleaseQuery = useQuery({
    queryKey: ["story-studio", "current-release", projectId],
    queryFn: () => getStoryExperienceCurrentRelease(projectId),
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Canvas live head wins while it is mounted; other steps have nothing
  // unsaved, so the stored draft is the head and the barrier is trivial.
  const draftRevision = liveDraft?.revision ?? workbench?.draft.revision ?? null;
  const settled = liveDraft ? liveDraft.settled : true;
  const conflicted = liveDraft?.conflicted ?? false;
  const videoSnapshotHash = liveDraft
    ? liveDraft.videoSnapshotHash
    : (workbench?.video.snapshotHash ?? null);
  const ready = liveDraft !== null || workbench !== null;

  const storedRevision = workbench?.draft.revision;
  const fallbackRunner = useCallback<SavedDraftSnapshotRunner>(
    (submit) => {
      if (storedRevision == null) {
        return Promise.reject(new Error(commonT("errors.generic")));
      }
      return submit(storedRevision);
    },
    [storedRevision, commonT]
  );

  const publication = useStoryPublication({
    projectId,
    capabilities: workbench?.project.capabilities ?? [],
    withSavedDraftSnapshot: draftBarrier ?? fallbackRunner,
  });

  // Both hashes of the local check were produced in THIS session; the
  // authority check compares against the stored release. Semantics preserved
  // verbatim from the canvas implementation.
  const locallyConfirmed = Boolean(
    settled &&
    draftRevision != null &&
    publication.lastSucceeded?.sourceDraftRevision === draftRevision &&
    publication.lastSucceeded.build.videoSnapshotHash === videoSnapshotHash
  );
  const authorityConfirmed =
    settled &&
    draftRevision != null &&
    isExactCurrentStoryRelease(currentReleaseQuery.data, {
      draftRevision,
      videoSnapshotHash: videoSnapshotHash ?? "",
    });
  const published = authorityConfirmed || (!currentReleaseQuery.data && locallyConfirmed);

  const canMutate = publication.canPublish && ready && !conflicted;
  const canPublish = canMutate && !currentReleaseQuery.isLoading;
  const publishDisabledReason = currentReleaseQuery.isLoading
    ? t("publish.statusChecking")
    : publication.disabledReason;
  const canEdit = !workbench || workbench.project.capabilities.includes("story.edit");

  const publishButton = (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      onClick={publication.open}
      disabled={!canPublish || publication.isPending || published}
      className="h-9 gap-2 rounded-[14px] bg-transparent px-3 font-semibold text-white/68 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed"
    >
      {publication.isPending ? (
        <IconLoader2 className="size-4 animate-spin" />
      ) : published ? (
        <IconCheck className="size-4" />
      ) : (
        <IconCloudUpload className="size-4" />
      )}
      <span className={LABEL_CLASS}>
        {publication.isPending
          ? t("publish.actionPending")
          : published
            ? t("publish.actionPublished")
            : t("publish.action")}
      </span>
    </Button>
  );

  return (
    <>
      {!canPublish && publishDisabledReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-flex rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-white/55 [&>button]:pointer-events-none"
              aria-label={`${t("publish.action")}: ${publishDisabledReason}`}
            >
              {publishButton}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {publishDisabledReason}
          </TooltipContent>
        </Tooltip>
      ) : (
        publishButton
      )}
      <StoryProjectCreditsBadge projectId={projectId} />
      {!canEdit ? (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-[14px] bg-white px-3 text-[11px] font-semibold text-black">
          {t("readOnly")}
        </span>
      ) : null}
      <StoryPublicationDialog
        state={publication.state}
        draftRevision={draftRevision ?? 0}
        canMutate={canMutate}
        disabledReason={publication.disabledReason}
        onClose={publication.close}
        onConfirm={() => {
          if (canMutate) void publication.confirm();
        }}
        onRetry={() => {
          if (canMutate) void publication.retry();
        }}
      />
    </>
  );
}

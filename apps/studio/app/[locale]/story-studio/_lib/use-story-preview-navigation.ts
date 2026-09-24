"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

export interface StoryPreviewTarget {
  /** Scene to start the walk at; omit for the chapter/story entry. */
  nodeId?: string;
  /**
   * Chapter to walk. Defaults to the chapter the canvas is editing — callers
   * that know better (a batch scoped to one chapter) pass their own.
   */
  chapterId?: string;
}

/**
 * Entering the preview, from wherever it is offered (header button, stepper).
 *
 * A preview compiles the latest SAVED draft, so this is never a plain link:
 * while the canvas is mounted it publishes a save barrier that must run first
 * — otherwise the creator walks a story that is one autosave behind what they
 * just edited. On the other steps it degrades to normal navigation.
 *
 * The barrier hands back the revision it persisted, which travels in the URL
 * (`?rev=`) beside the video snapshot hash: the playtest query is keyed by
 * both, so walking back and forth without edits is served from cache while
 * draft edits or media re-picks compile afresh.
 */
export function useStoryPreviewNavigation(projectId: string): {
  openPreview: (target?: StoryPreviewTarget) => Promise<void>;
  openPreviewFromNode: (
    nodeId: string,
    target?: Omit<StoryPreviewTarget, "nodeId">
  ) => Promise<void>;
  pending: boolean;
} {
  const t = useTranslations("storyStudio.canvas");
  const router = useRouter();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
  const liveDraft = useStoryProjectUiStore((state) => state.liveDraft);
  const [pending, setPending] = useState(false);

  const open = useCallback(
    async (target?: StoryPreviewTarget) => {
      if (pending) return;
      setPending(true);
      try {
        const chapterId = target?.chapterId ?? activeChapterId;
        const navigate = (draftRevision?: number) => {
          const params = new URLSearchParams();
          if (chapterId) params.set("chapter", chapterId);
          if (target?.nodeId) params.set("node", target.nodeId);
          if (typeof draftRevision === "number" && draftRevision > 0) {
            params.set("rev", String(draftRevision));
          }
          // Media re-picks do not bump the draft revision, so the video
          // snapshot hash completes the freshness token.
          if (liveDraft?.videoSnapshotHash) {
            params.set("vsh", liveDraft.videoSnapshotHash);
          }
          const query = params.size > 0 ? `?${params.toString()}` : "";
          router.push(`/story-studio/projects/${encodeURIComponent(projectId)}/playtest${query}`);
        };
        if (draftBarrier) {
          await draftBarrier(async (draftRevision) => {
            navigate(draftRevision);
            return null;
          });
        } else {
          navigate();
        }
      } catch (error) {
        toast.error(storyApiErrorMessage(error, t("workingPreview.errorFallback")));
      } finally {
        setPending(false);
      }
    },
    [activeChapterId, draftBarrier, liveDraft, pending, projectId, router, t]
  );

  const openPreview = useCallback((target?: StoryPreviewTarget) => open(target), [open]);
  const openPreviewFromNode = useCallback(
    (nodeId: string, target?: Omit<StoryPreviewTarget, "nodeId">) => open({ ...target, nodeId }),
    [open]
  );

  return { openPreview, openPreviewFromNode, pending };
}

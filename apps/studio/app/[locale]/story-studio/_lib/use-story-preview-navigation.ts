"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * Entering the preview, from wherever it is offered (header button, stepper).
 *
 * A preview compiles the latest SAVED draft, so this is never a plain link:
 * while the canvas is mounted it publishes a save barrier and a leave guard,
 * and both must run first — otherwise the creator walks a story that is one
 * autosave behind what they just edited. On the other steps both are absent
 * and this degrades to a normal navigation.
 */
export function useStoryPreviewNavigation(projectId: string): {
  openPreview: () => Promise<void>;
  pending: boolean;
} {
  const t = useTranslations("storyStudio.canvas");
  const router = useRouter();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
  const guardedNavigate = useStoryProjectUiStore((state) => state.guardedNavigate);
  const [pending, setPending] = useState(false);

  const openPreview = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      const navigate = () => {
        const chapterQuery = activeChapterId
          ? `?chapter=${encodeURIComponent(activeChapterId)}`
          : "";
        router.push(
          `/story-studio/projects/${encodeURIComponent(projectId)}/playtest${chapterQuery}`
        );
      };
      const go = () => (guardedNavigate ?? ((proceed: () => void) => proceed()))(navigate);
      if (draftBarrier) {
        await draftBarrier(async () => {
          go();
          return null;
        });
      } else {
        go();
      }
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("workingPreview.errorFallback")));
    } finally {
      setPending(false);
    }
  }, [activeChapterId, draftBarrier, guardedNavigate, pending, projectId, router, t]);

  return { openPreview, pending };
}

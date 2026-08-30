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
 * while the canvas is mounted it publishes a save barrier that must run first
 * — otherwise the creator walks a story that is one autosave behind what they
 * just edited. On the other steps it degrades to normal navigation.
 */
export function useStoryPreviewNavigation(projectId: string): {
  openPreview: () => Promise<void>;
  pending: boolean;
} {
  const t = useTranslations("storyStudio.canvas");
  const router = useRouter();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
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
      if (draftBarrier) {
        await draftBarrier(async () => {
          navigate();
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
  }, [activeChapterId, draftBarrier, pending, projectId, router, t]);

  return { openPreview, pending };
}

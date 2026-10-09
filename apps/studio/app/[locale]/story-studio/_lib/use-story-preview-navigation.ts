"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getPathname } from "@/i18n/navigation";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * Entering the preview, from wherever it is offered (header button, stepper,
 * a scene card's play button).
 *
 * A preview compiles the latest SAVED draft, so this is never a plain link:
 * while the canvas is mounted it publishes a save barrier that must run first
 * — otherwise the creator walks a story that is one autosave behind what they
 * just edited. Each entry opens a new tab, leaving the editor in place.
 */
export function useStoryPreviewNavigation(projectId: string): {
  openPreview: () => Promise<void>;
  /** Walk the chapter entering at one chosen scene (`?scene=`). */
  openPreviewFromScene: (sceneId: string) => Promise<void>;
  pending: boolean;
} {
  const t = useTranslations("storyStudio.canvas");
  const locale = useLocale();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
  const [pending, setPending] = useState(false);

  const open = useCallback(
    async (sceneId?: string) => {
      if (pending) return;
      // Reserve the tab during the click, before an async save can lose user activation.
      const previewWindow = window.open("about:blank", "_blank");
      if (!previewWindow) {
        toast.error(t("workingPreview.popupBlocked"));
        return;
      }
      previewWindow.opener = null;
      setPending(true);
      try {
        const navigate = () => {
          const params = new URLSearchParams();
          if (activeChapterId) params.set("chapter", activeChapterId);
          if (sceneId) params.set("scene", sceneId);
          const chapterQuery = params.size > 0 ? `?${params.toString()}` : "";
          if (!previewWindow.closed) {
            previewWindow.location.replace(
              getPathname({
                locale,
                href: `/story-studio/projects/${encodeURIComponent(projectId)}/playtest${chapterQuery}`,
              })
            );
          }
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
        previewWindow.close();
        toast.error(storyApiErrorMessage(error, t("workingPreview.errorFallback")));
      } finally {
        setPending(false);
      }
    },
    [activeChapterId, draftBarrier, locale, pending, projectId, t]
  );

  const openPreview = useCallback(() => open(), [open]);
  const openPreviewFromScene = useCallback((sceneId: string) => open(sceneId), [open]);

  return { openPreview, openPreviewFromScene, pending };
}

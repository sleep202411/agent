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
 *
 * `openPreviewFromNode` walks the same path but starts at one chosen scene,
 * so a late branch can be tested without replaying everything before it.
 */
export function useStoryPreviewNavigation(projectId: string): {
  openPreview: () => Promise<void>;
  openPreviewFromNode: (nodeId: string) => Promise<void>;
  pending: boolean;
} {
  const t = useTranslations("storyStudio.canvas");
  const router = useRouter();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
  const [pending, setPending] = useState(false);

  const open = useCallback(
    async (nodeId?: string) => {
      if (pending) return;
      setPending(true);
      try {
        const navigate = () => {
          const params = new URLSearchParams();
          if (activeChapterId) params.set("chapter", activeChapterId);
          if (nodeId) params.set("node", nodeId);
          const chapterQuery = params.size > 0 ? `?${params.toString()}` : "";
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
    },
    [activeChapterId, draftBarrier, pending, projectId, router, t]
  );

  const openPreview = useCallback(() => open(), [open]);
  const openPreviewFromNode = useCallback((nodeId: string) => open(nodeId), [open]);

  return { openPreview, openPreviewFromNode, pending };
}

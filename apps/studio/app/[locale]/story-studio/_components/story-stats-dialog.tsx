"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isProductionStepSegment } from "../_lib/production-steps";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryEndingsPanel, StoryStateVariablesPanel } from "./project-canvas/story-stats-editors";
import { useStoryBiblePatch } from "./use-story-bible-patch";

/**
 * Stats registry as a rail dialog — list cards for variables and named
 * endings. Same bible-writer path as Overview so the mounted canvas stays
 * the draft's only writer.
 */
export function StoryStatsDialog({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas.stats");
  const locale = useLocale();
  const segment = useSelectedLayoutSegment();
  const statsOpen = useStoryProjectUiStore((state) => state.statsOpen);
  const setStatsOpen = useStoryProjectUiStore((state) => state.setStatsOpen);
  const { content, canEdit, patchBible } = useStoryBiblePatch(projectId);
  if (!isProductionStepSegment(segment)) return null;

  return (
    <Dialog open={statsOpen} onOpenChange={setStatsOpen}>
      <DialogContent className="flex max-h-[min(80vh,720px)] w-full flex-col gap-0 overflow-hidden rounded-[22px] bg-[oklch(0.205_0_0/0.98)] p-0 text-white shadow-[0_32px_100px_rgba(0,0,0,0.72)] sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b border-white/[0.08] px-5 py-4 pr-12">
          <DialogTitle className="text-base font-semibold tracking-[-0.01em] text-white">
            {t("dockTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-white/48">
            {t("dockDescription")}
          </DialogDescription>
        </DialogHeader>
        {content ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <StoryStateVariablesPanel
              variables={content.storyBible.stateVariables ?? []}
              characters={content.storyBible.characters}
              locale={locale}
              canEdit={canEdit}
              onChange={(stateVariables) => patchBible({ stateVariables })}
            />
            <StoryEndingsPanel
              endings={content.storyBible.endings ?? []}
              locale={locale}
              canEdit={canEdit}
              onChange={(endings) => patchBible({ endings })}
            />
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-xs text-white/42">{t("loading")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

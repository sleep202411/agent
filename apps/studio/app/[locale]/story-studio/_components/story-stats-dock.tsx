"use client";

import { IconX } from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryStateVariablesPanel } from "./project-canvas/story-stats-editors";
import { useStoryBiblePatch } from "./use-story-bible-patch";

/**
 * State-variable registry in the shared project side-panel slot. The plot tree
 * owns ending authoring; bible edits share Overview's single-writer path.
 */
export function StoryStatsDock({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas.stats");
  const locale = useLocale();
  const setSidePanel = useStoryProjectUiStore((state) => state.setSidePanel);
  const { workbench, content, canEdit, patchBible } = useStoryBiblePatch(projectId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.08] px-5 py-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-white">
            {t("dockTitle")}
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-white/48">{t("dockDescription")}</p>
        </div>
        <button
          type="button"
          onClick={() => setSidePanel(null)}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/68 transition hover:bg-white/[0.1] hover:text-white"
          aria-label={t("dockClose")}
        >
          <IconX className="size-4" />
        </button>
      </header>
      {content && workbench ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <StoryStateVariablesPanel
            variables={content.storyBible.stateVariables ?? []}
            locale={locale}
            defaultLocale={workbench.project.defaultLocale}
            canEdit={canEdit}
            onChange={(stateVariables) => patchBible({ stateVariables })}
          />
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-xs text-white/42">{t("loading")}</p>
      )}
    </div>
  );
}

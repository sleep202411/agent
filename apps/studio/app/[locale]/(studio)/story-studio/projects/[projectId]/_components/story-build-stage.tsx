"use client";

import { IconEdit, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { StoryWorkingPreviewContent } from "@/app/[locale]/story-studio/_components/project-canvas/story-working-preview-dialog";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Link } from "@/i18n/navigation";
import {
  getStoryWorkingPreview,
  storyApiErrorMessage,
  type StoryWorkbench,
} from "@/lib/story-projects-api";

/**
 * Creator playtest for the latest saved draft.
 *
 * A formal FilmBuild is a release concern. Authoring preview deliberately
 * compiles on demand and never asks the creator to freeze or lock the story.
 */
export function StoryBuildStage({
  projectId,
  workspaceId,
  workbench,
}: {
  projectId: string;
  workspaceId: string;
  workbench: StoryWorkbench;
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview");
  const locale = useLocale();
  const previewQuery = useQuery({
    queryKey: ["story-studio", "working-preview", workspaceId, projectId, workbench.draft.revision],
    queryFn: () => getStoryWorkingPreview(workspaceId, projectId, workbench.draft.revision),
    retry: false,
  });
  const error = previewQuery.isError
    ? storyApiErrorMessage(previewQuery.error, t("errorFallback"))
    : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white">{t("title")}</h2>
            <span className="rounded-full bg-white/[0.055] px-2.5 py-1 text-[10px] font-semibold text-white/42">
              {t("draftRevision", { revision: workbench.draft.revision })}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/42">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" asChild>
            <Link href={`/story-studio/projects/${projectId}/canvas`}>
              <IconEdit className="size-4" />
              {t("editStory")}
            </Link>
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={previewQuery.isFetching}
            onClick={() => void previewQuery.refetch()}
          >
            <IconRefresh className={previewQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
            {t("refresh")}
          </Button>
        </div>
      </header>

      <FrostedPanel className="p-4 sm:p-5">
        <StoryWorkingPreviewContent
          preview={previewQuery.data ?? null}
          pending={previewQuery.isLoading}
          error={error}
          locale={locale}
          frameProfile={workbench.project.frameProfile}
          onRetry={() => void previewQuery.refetch()}
        />
      </FrostedPanel>
    </div>
  );
}

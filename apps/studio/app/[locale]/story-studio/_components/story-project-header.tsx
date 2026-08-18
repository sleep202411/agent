"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { useWorkspace } from "@/app/_components/workspace-context";
import { getStoryWorkbench } from "@/lib/story-projects-api";
import { StoryProductionSteps } from "./story-production-steps";

const STEP_BY_SEGMENT = {
  script: "script",
  assets: "assets",
  storyboard: "storyboard",
} as const;

/**
 * Project-level header: title + the numbered production stepper. Rendered by
 * the [projectId] layout for the step pages; the canvas ships its own richer
 * header (chapter, preview, publish) and the playtest stays chrome-free, so
 * this hides itself on those segments.
 */
export function StoryProjectHeader({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const t = useTranslations("storyStudio");
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const active = STEP_BY_SEGMENT[segment as keyof typeof STEP_BY_SEGMENT];

  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "script-workbench", workspaceId, projectId],
    queryFn: () => getStoryWorkbench(workspaceId as string, projectId),
    enabled: Boolean(workspaceId) && Boolean(active),
    retry: false,
  });

  if (!active) return null;

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[oklch(0.185_0_0)] px-4">
      <h1 className="max-w-[320px] truncate text-[15px] font-semibold tracking-[-0.01em]">
        {workbenchQuery.data?.project.title ?? t(`canvas.steps.${active}`)}
      </h1>
      <StoryProductionSteps
        projectId={projectId}
        active={active}
        className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex"
      />
      <span aria-hidden="true" />
    </header>
  );
}

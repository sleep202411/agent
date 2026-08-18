"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { useWorkspace } from "@/app/_components/workspace-context";
import { getStoryWorkbench } from "@/lib/story-projects-api";
import { StoryProductionSteps } from "./story-production-steps";
import { StoryProjectHeaderActions } from "./story-project-header-actions";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

const STEP_BY_SEGMENT = {
  canvas: "tree",
  script: "script",
  assets: "assets",
  storyboard: "storyboard",
} as const;

/**
 * The project's single top bar: title, the numbered production stepper, and
 * portal slots for segment-owned extras. Rendered by the [projectId] layout
 * for every step page including the canvas; the playtest stays chrome-free,
 * so this hides itself there.
 */
export function StoryProjectHeader({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const t = useTranslations("storyStudio");
  // Ref-registered so the canvas can portal its chapter switcher in here.
  const setHeaderContextSlot = useStoryProjectUiStore((state) => state.setHeaderContextSlot);
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
    // Occupying top bar, monochrome solid background + hairline divider per
    // DESIGN.md. `@container`: portaled toolbar labels collapse to icon-only
    // when space is tight.
    <header className="@container relative z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[oklch(0.185_0_0)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="max-w-[320px] truncate text-[15px] font-semibold tracking-[-0.01em]">
          {workbenchQuery.data?.project.title ?? t(`canvas.steps.${active}`)}
        </h1>
        <div ref={setHeaderContextSlot} className="flex min-w-0 items-center gap-3 empty:hidden" />
      </div>
      <StoryProductionSteps
        projectId={projectId}
        active={active}
        className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex"
      />
      <div className="flex shrink-0 items-center gap-0.5">
        <StoryProjectHeaderActions projectId={projectId} />
      </div>
    </header>
  );
}

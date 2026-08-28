"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getStoryWorkbench } from "@/lib/story-projects-api";
import { StoryProductionSteps } from "./story-production-steps";
import { StoryProjectHeaderActions } from "./story-project-header-actions";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

const STEP_BY_SEGMENT = {
  canvas: "tree",
  script: "script",
  assets: "assets",
  storyboard: "storyboard",
  // The node-level timeline editor belongs to the Storyboard stage rather
  // than introducing a second project-level production stage.
  edit: "storyboard",
} as const;

/**
 * The project's single top bar: back navigation, title, numbered production
 * stepper, and project actions. Rendered by the [projectId] layout for every
 * step page including the canvas; the playtest stays chrome-free.
 */
export function StoryProjectHeader({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const t = useTranslations("storyStudio");
  // Phones give the chat view the whole screen — the bar only shows with work.
  const mobileView = useStoryProjectUiStore((state) => state.mobileView);
  const backGuard = useStoryProjectUiStore((state) => state.backGuard);
  const active = STEP_BY_SEGMENT[segment as keyof typeof STEP_BY_SEGMENT];

  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "script-workbench", projectId],
    queryFn: () => getStoryWorkbench(projectId),
    enabled: Boolean(active),
    retry: false,
  });

  if (!active) return null;

  return (
    // Occupying top bar, monochrome solid background + hairline divider per
    // DESIGN.md. The back action belongs here with the project identity;
    // project destinations live exclusively in the rail below.
    <header
      className={cn(
        "@container relative z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[oklch(0.185_0_0)] px-4",
        mobileView === "chat" && "max-md:hidden"
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href="/story-studio"
          onNavigate={backGuard ?? undefined}
          aria-label={t("canvas.back")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/66 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          <IconArrowLeft className="size-4" stroke={1.8} />
        </Link>
        <h1 className="hidden max-w-[320px] truncate text-[15px] font-semibold tracking-[-0.01em] max-md:block xl:block">
          {workbenchQuery.data?.project.title ?? t(`canvas.steps.${active}`)}
        </h1>
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

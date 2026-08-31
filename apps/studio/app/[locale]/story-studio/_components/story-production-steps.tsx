"use client";

import { IconAlertTriangle, IconCheck, IconCircleDashed, IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  getStoryProductionState,
  storyProductionKeys,
  type StoryProductionStatus,
} from "@/lib/story-production-api";
import { cn } from "@/lib/utils";
import { useStoryPreviewNavigation } from "../_lib/use-story-preview-navigation";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

type LiveStep = "script" | "tree" | "assets" | "storyboard" | "preview";

/**
 * `preview` carries no href: it compiles the latest SAVED draft, so it goes
 * through the shared preview navigation (save barrier + leave guard) instead
 * of a link that could walk a story one autosave stale.
 */
const STEPS: Array<{
  key: LiveStep;
  href?: (projectId: string, chapterId: string | null) => string;
}> = [
  { key: "script", href: chapterHref("script") },
  { key: "tree", href: chapterHref("canvas") },
  { key: "assets", href: chapterHref("assets") },
  { key: "storyboard", href: chapterHref("storyboard") },
  { key: "preview" },
];

function chapterHref(segment: string) {
  return (projectId: string, chapterId: string | null) =>
    `/story-studio/projects/${projectId}/${segment}${
      chapterId ? `?chapter=${encodeURIComponent(chapterId)}` : ""
    }`;
}

/**
 * Chapter-scoped production navigation. Every real surface remains reachable;
 * the icon reports server readiness instead of implying a fixed linear gate.
 */
export function StoryProductionSteps({
  projectId,
  active,
  className,
}: {
  projectId: string;
  active: LiveStep;
  className?: string;
}) {
  const t = useTranslations("storyStudio.canvas.steps");
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const productionQuery = useQuery({
    queryKey: storyProductionKeys.state(projectId, activeChapterId),
    queryFn: ({ signal }) => getStoryProductionState(projectId, activeChapterId as string, signal),
    enabled: Boolean(activeChapterId),
    retry: false,
  });
  const { openPreview, pending: previewPending } = useStoryPreviewNavigation(projectId);
  const productionReady = productionQuery.data?.ready ?? null;
  const statuses: Record<LiveStep, StoryProductionStatus | null> = {
    script: productionQuery.data?.script.status ?? null,
    tree: productionQuery.data?.plotTree.status ?? null,
    assets: productionQuery.data?.assets.status ?? null,
    storyboard: productionQuery.data?.storyboard.status ?? null,
    // A preview has no plan of its own to be current or stale: it is walkable
    // whenever the earlier stages are, and worth flagging when they are not.
    preview: productionReady === null ? null : productionReady ? "current" : "stale",
  };
  return (
    <nav aria-label={t("navigationLabel")} className={cn("items-center", className)}>
      {STEPS.map((step, index) => {
        const isActive = step.key === active;
        const status = statuses[step.key];
        const statusLabel = status ? t(`status.${status}`) : t("status.unknown");
        const icon = productionQuery.isPending ? (
          <IconLoader2 className="size-3 animate-spin" aria-hidden="true" />
        ) : status === "current" ? (
          <IconCheck className="size-3" aria-hidden="true" />
        ) : status === "stale" ? (
          <IconAlertTriangle className="size-3" aria-hidden="true" />
        ) : (
          <IconCircleDashed className="size-3" aria-hidden="true" />
        );
        return (
          <span key={step.key} className="inline-flex items-center">
            {index > 0 ? (
              <span aria-hidden="true" className="mx-2 h-px w-4 bg-white/12 2xl:mx-3 2xl:w-8" />
            ) : null}
            {isActive ? (
              <span
                aria-current="page"
                aria-label={t("stepAria", { step: t(step.key), status: statusLabel })}
                className="inline-flex items-center gap-2"
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full",
                    status === "stale"
                      ? "bg-amber-100 text-amber-950"
                      : status === "missing"
                        ? "bg-white/18 text-white"
                        : "bg-white text-black"
                  )}
                >
                  {icon}
                </span>
                <span className="text-xs font-semibold text-white">{t(step.key)}</span>
              </span>
            ) : step.href ? (
              <Link
                href={step.href(projectId, activeChapterId)}
                aria-label={t("stepAria", { step: t(step.key), status: statusLabel })}
                className="group inline-flex items-center gap-2"
              >
                <StepFace icon={icon} label={t(step.key)} status={status} />
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void openPreview()}
                disabled={previewPending}
                aria-label={t("stepAria", { step: t(step.key), status: statusLabel })}
                className="group inline-flex items-center gap-2 disabled:opacity-60"
              >
                <StepFace
                  icon={previewPending ? <IconLoader2 className="size-3 animate-spin" /> : icon}
                  label={t(step.key)}
                  status={status}
                />
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** The shared inactive-step face: status dot plus label. */
function StepFace({
  icon,
  label,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  status: StoryProductionStatus | null;
}) {
  return (
    <>
      <span
        className={cn(
          "grid size-5 place-items-center rounded-full transition group-hover:bg-white/18 group-hover:text-white",
          status === "stale" ? "bg-amber-300/14 text-amber-100/80" : "bg-white/10 text-white/62"
        )}
      >
        {icon}
      </span>
      <span className="text-xs font-medium text-white/62 transition group-hover:text-white/90">
        {label}
      </span>
    </>
  );
}

"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StoryBuildDiagnostic } from "@/lib/story-projects-api";

/**
 * The exclamation mark a blocking issue paints on a scene card. Hover spells
 * out why the scene blocks publishing; the server message is surfaced
 * verbatim because it names the exact missing production input.
 */
export function StoryNodeErrorBadge({ issues }: { issues: readonly StoryBuildDiagnostic[] }) {
  const t = useTranslations("storyStudio.canvas.validation");
  if (issues.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("nodeIssues", { count: issues.length })}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="nodrag nopan inline-flex h-7 cursor-default items-center gap-1 rounded-full bg-destructive/15 px-2 text-[10px] font-semibold text-destructive shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:bg-destructive/25"
        >
          <IconAlertTriangle className="size-3.5" stroke={2} />
          {issues.length > 1 ? <span className="tabular-nums">{issues.length}</span> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="max-w-80">
        <div className="space-y-2">
          {issues.map((issue, index) => (
            <div key={`${issue.code}:${issue.entityId ?? "project"}:${index}`}>
              <p className="text-[10px] font-semibold tracking-[0.09em] text-white/42 uppercase">
                {issue.code}
              </p>
              <p className="mt-0.5 text-xs leading-5">{issue.message}</p>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

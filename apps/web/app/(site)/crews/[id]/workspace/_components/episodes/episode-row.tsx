"use client";

import { useMemo } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { useEpisodeAssignments, type Episode } from "@/app/(site)/crews/_hooks/use-episodes";
import { EpisodeStatusBadge } from "./episode-status-badge";
import { EpisodeDetail } from "./episode-detail";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";

interface EpisodeRowProps {
  crewId: string;
  episode: Episode;
  /** Whether this is the "current" episode in the crew. Highlights
   *  the row border. Caller derives this (first non-approved row). */
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
  viewer: UserCrewRole;
}

export function EpisodeRow({
  crewId,
  episode,
  isCurrent,
  expanded,
  onToggle,
  viewer,
}: EpisodeRowProps) {
  const t = useTranslations("workspace");
  const { data: assignments = [] } = useEpisodeAssignments(crewId, episode.id);

  const summary = useMemo(() => {
    const total = assignments.length;
    if (total === 0) return t("rowNoAssignments");
    const pending = assignments.filter(
      (a) => a.status === "in_progress" || a.status === "submitted" || a.status === "rejected"
    ).length;
    return t("rowSummary", { total, pending });
  }, [assignments, t]);

  const numberBadgeColors =
    episode.status === "approved"
      ? "border-green-400/30 bg-green-400/10 text-green-400"
      : episode.status === "in_production"
        ? "border-blue-400/30 bg-blue-400/10 text-blue-400"
        : "border-border bg-secondary text-muted-foreground";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card transition-colors",
        isCurrent ? "border-primary/40" : "border-border"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-secondary/30"
      >
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg border text-xs font-black",
              numberBadgeColors
            )}
          >
            {episode.number}
          </div>
          <div className="min-w-0">
            <div className="mb-0.5 flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-foreground">
                {t("episodeLabel", { number: episode.number })}
                {episode.title ? ` · ${episode.title}` : ""}
              </span>
              {isCurrent ? (
                <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                  {t("currentEpisode")}
                </span>
              ) : null}
              <EpisodeStatusBadge status={episode.status} />
            </div>
            <span className="block truncate text-xs text-muted-foreground">{summary}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
          <span className="hidden text-xs sm:inline">{expanded ? t("collapse") : t("expand")}</span>
          <IconChevronDown
            className={cn("size-4 transition-transform", expanded && "rotate-180")}
          />
        </div>
      </button>

      {expanded ? (
        <div className="px-5 pb-5">
          <EpisodeDetail crewId={crewId} episode={episode} viewer={viewer} />
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Episodes tab content — card grid + filter chips + detail sheet.
 *
 * Filter chips at top with counts per status. Cards in a responsive
 * 1/2/3 column grid. Clicking a card opens EpisodeDetailSheet on the
 * right with full info (brief, assignments table, activity log).
 */

import { useMemo, useState } from "react";
import { IconMovie, IconPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type Episode, type EpisodeStatus } from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodeCard } from "./episode-card";
import { EpisodeDetailSheet } from "./episode-detail-sheet";

type FilterKey = "all" | EpisodeStatus;

interface EpisodesGridProps {
  crewId: string;
  episodes: Episode[];
  /** First non-approved episode id — gets the "current" highlight. */
  currentId: string | null;
  isAdmin: boolean;
  viewer: UserCrewRole;
  onAddEpisode: () => void;
}

export function EpisodesGrid({
  crewId,
  episodes,
  currentId,
  isAdmin,
  viewer,
  onAddEpisode,
}: EpisodesGridProps) {
  const t = useTranslations("workspace");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { all: episodes.length, not_started: 0, in_production: 0, approved: 0 };
    for (const e of episodes) c[e.status] += 1;
    return c;
  }, [episodes]);

  const filtered = useMemo(() => {
    if (filter === "all") return episodes;
    return episodes.filter((e) => e.status === filter);
  }, [episodes, filter]);

  const selected = episodes.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      {/* Header: filter chips + add CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs filter={filter} onChange={setFilter} counts={counts} t={t} />
        {isAdmin ? (
          <Button variant="soft" color="primary" size="sm" onClick={onAddEpisode}>
            <IconPlus className="size-3.5" /> {t("addEpisode")}
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState filter={filter} onAddEpisode={onAddEpisode} isAdmin={isAdmin} t={t} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((ep) => (
            <EpisodeCard
              key={ep.id}
              crewId={crewId}
              episode={ep}
              isCurrent={ep.id === currentId}
              onClick={() => setSelectedId(ep.id)}
            />
          ))}
        </div>
      )}

      <EpisodeDetailSheet
        crewId={crewId}
        episode={selected}
        viewer={viewer}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </div>
  );
}

function FilterTabs({
  filter,
  onChange,
  counts,
  t,
}: {
  filter: FilterKey;
  onChange: (f: FilterKey) => void;
  counts: { all: number; not_started: number; in_production: number; approved: number };
  t: ReturnType<typeof useTranslations>;
}) {
  const tabs: { key: FilterKey; labelKey: string }[] = [
    { key: "all", labelKey: "filterAll" },
    { key: "not_started", labelKey: "epStatusNotStarted" },
    { key: "in_production", labelKey: "epStatusInProduction" },
    { key: "approved", labelKey: "epStatusApproved" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg bg-secondary/40 p-0.5">
      {tabs.map((tab) => {
        const count = counts[tab.key];
        const active = filter === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(tab.labelKey)}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-semibold",
                active
                  ? "bg-primary/15 text-primary"
                  : "bg-muted-foreground/15 text-muted-foreground"
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({
  filter,
  onAddEpisode,
  isAdmin,
  t,
}: {
  filter: FilterKey;
  onAddEpisode: () => void;
  isAdmin: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <IconMovie className="size-5" />
      </div>
      <p className="text-sm text-muted-foreground">
        {filter === "all" ? t("noEpisodesYet") : t("noEpisodesInFilter")}
      </p>
      {isAdmin && filter === "all" ? (
        <Button variant="soft" color="primary" size="sm" onClick={onAddEpisode}>
          <IconPlus className="size-3.5" /> {t("addEpisode")}
        </Button>
      ) : null}
    </div>
  );
}

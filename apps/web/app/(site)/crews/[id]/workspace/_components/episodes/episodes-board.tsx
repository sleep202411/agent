"use client";

/**
 * Episodes tab content — accordion-style production board.
 *
 * Episodes are inherently sequential (EP01 → EP02 → …), so an
 * accordion preserves that linear flow better than a card grid.
 * Filter chips at the top let admins narrow to a single status when
 * the board grows beyond what fits in one screen.
 *
 * Multiple items can be expanded simultaneously (admins frequently
 * coordinate across two adjacent episodes). The "current" episode —
 * first non-approved — is expanded by default the first time the
 * board renders.
 */

import { useEffect, useMemo, useState } from "react";
import { IconMovie, IconPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type Episode, type EpisodeStatus } from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodeAccordionItem } from "./episode-accordion-item";
import { EpisodesDashboard } from "./episodes-dashboard";

type FilterKey = "all" | EpisodeStatus;

interface EpisodesBoardProps {
  crewId: string;
  episodes: Episode[];
  /** First non-approved episode id — gets the "current" highlight and
   *  starts expanded the first time the board renders. */
  currentId: string | null;
  viewer: UserCrewRole;
  onAddEpisode: () => void;
}

export function EpisodesBoard({
  crewId,
  episodes,
  currentId,
  viewer,
  onAddEpisode,
}: EpisodesBoardProps) {
  const t = useTranslations("workspace");
  const [filter, setFilter] = useState<FilterKey>("all");

  // Set of expanded episode ids. Auto-expand the current episode on
  // first render, but never auto-expand on subsequent renders so the
  // user's manual expand/collapse choices stick across data refetches.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [didInit, setDidInit] = useState(false);
  useEffect(() => {
    if (didInit || episodes.length === 0) return;
    if (currentId) setExpandedIds(new Set([currentId]));
    setDidInit(true);
  }, [currentId, didInit, episodes.length]);

  const counts = useMemo(() => {
    const c = { all: episodes.length, not_started: 0, in_production: 0, approved: 0 };
    for (const e of episodes) c[e.status] += 1;
    return c;
  }, [episodes]);

  const filtered = useMemo(() => {
    if (filter === "all") return episodes;
    return episodes.filter((e) => e.status === filter);
  }, [episodes, filter]);

  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAndScrollTo = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (typeof window !== "undefined") {
      // Wait one frame so the just-expanded body is in layout before
      // scrolling; smooth-scroll into view, aligned to the top so
      // the assignment table is visible immediately.
      requestAnimationFrame(() => {
        const el = document.getElementById(`episode-row-${id}`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  // Dashboard is admin/finance only — members and outsiders don't
  // need the production-wide overview.
  const showDashboard = (viewer.isAdmin || viewer.isFinance) && episodes.length > 0;

  return (
    <div className="space-y-4">
      {showDashboard ? (
        <EpisodesDashboard
          crewId={crewId}
          episodes={episodes}
          onJumpToEpisode={expandAndScrollTo}
        />
      ) : null}

      {/* Header: filter chips + add CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs filter={filter} onChange={setFilter} counts={counts} t={t} />
        <div className="flex items-center gap-2">
          {episodes.length > 1 ? (
            <Button
              variant="ghost"
              color="muted"
              size="sm"
              onClick={() =>
                setExpandedIds(
                  expandedIds.size === filtered.length
                    ? new Set()
                    : new Set(filtered.map((e) => e.id))
                )
              }
            >
              {expandedIds.size === filtered.length ? t("collapseAll") : t("expandAll")}
            </Button>
          ) : null}
          {viewer.isAdmin ? (
            <Button variant="soft" color="primary" size="sm" onClick={onAddEpisode}>
              <IconPlus className="size-3.5" /> {t("addEpisode")}
            </Button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState filter={filter} onAddEpisode={onAddEpisode} isAdmin={viewer.isAdmin} t={t} />
      ) : (
        <div className="space-y-3">
          {filtered.map((ep) => (
            <div key={ep.id} id={`episode-row-${ep.id}`}>
              <EpisodeAccordionItem
                crewId={crewId}
                episode={ep}
                isCurrent={ep.id === currentId}
                expanded={expandedIds.has(ep.id)}
                onToggle={() => toggleExpanded(ep.id)}
                viewer={viewer}
              />
            </div>
          ))}
        </div>
      )}
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

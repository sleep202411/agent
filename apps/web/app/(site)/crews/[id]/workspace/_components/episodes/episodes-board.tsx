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
 * board renders, unless a notification deeplink names another one.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { IconAlertTriangle, IconLoader2, IconMovie, IconPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  type Episode,
  type EpisodeStatus,
  useMyCrewAssignments,
} from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { episodeRowAnchorId } from "@/app/(site)/crews/[id]/workspace/_lib/deeplink-anchors";
import { EpisodeAccordionItem } from "./episode-accordion-item";
import { EpisodesDashboard } from "./episodes-dashboard";

type FilterKey = "all" | "mine" | EpisodeStatus;

interface EpisodesBoardProps {
  crewId: string;
  episodes: Episode[];
  /** First non-approved episode id — gets the "current" highlight and
   *  starts expanded the first time the board renders. */
  currentId: string | null;
  /** `?episode=` from a crew notification. When it names an episode the
   *  board is showing, that one starts expanded instead of `currentId`. */
  deeplinkEpisodeId?: string | null;
  viewer: UserCrewRole;
  onAddEpisode: () => void;
}

export function EpisodesBoard({
  crewId,
  episodes,
  currentId,
  deeplinkEpisodeId = null,
  viewer,
  onAddEpisode,
}: EpisodesBoardProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const [filter, setFilter] = useState<FilterKey>("all");
  const myAssignmentsQuery = useMyCrewAssignments(crewId);
  const myEpisodeIds = useMemo(
    () => new Set((myAssignmentsQuery.data ?? []).map((assignment) => assignment.episodeId)),
    [myAssignmentsQuery.data]
  );

  // Set of expanded episode ids. Auto-expansion is seeded once and then
  // left alone, so the reader's own expand / collapse choices survive
  // every refetch.
  //
  // A notification deeplink outranks the standing "current episode"
  // default: someone who followed "member submitted EP03" while EP05 is
  // current came for EP03's body — deliverable, approve / reject — and
  // expanding EP05 instead leaves them staring at a collapsed row.
  // Tracked per deeplinked id rather than as a boolean so a second
  // notification, opened from the live toast while the workspace is
  // still mounted, expands its episode too.
  //
  // The deeplink seed waits for its episode to actually be on the
  // board. The list is unpaginated (`GET /crews/:id/episodes` returns
  // the crew's whole run), so an id that is missing is a deleted
  // episode or one the viewer cannot see — fall back to the current
  // episode rather than expanding a row that will never render.
  // `currentId` needs no such check: it is derived from this same list.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const seeded = useRef<{ initial: boolean; deeplinkEpisodeId: string | null }>({
    initial: false,
    deeplinkEpisodeId: null,
  });
  useEffect(() => {
    if (episodes.length === 0) return;
    const expand = (id: string) =>
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

    if (
      deeplinkEpisodeId &&
      seeded.current.deeplinkEpisodeId !== deeplinkEpisodeId &&
      episodes.some((e) => e.id === deeplinkEpisodeId)
    ) {
      seeded.current.deeplinkEpisodeId = deeplinkEpisodeId;
      seeded.current.initial = true;
      // A live notification can change only the URL while this board
      // stays mounted. If the reader previously selected a status that
      // excludes the target, expanding an invisible row is useless.
      setFilter("all");
      expand(deeplinkEpisodeId);
      return;
    }

    if (seeded.current.initial) return;
    seeded.current.initial = true;
    if (currentId) expand(currentId);
  }, [currentId, deeplinkEpisodeId, episodes]);

  const counts = useMemo(() => {
    const c = {
      all: episodes.length,
      mine: myAssignmentsQuery.data === undefined ? null : myEpisodeIds.size,
      not_started: 0,
      in_production: 0,
      approved: 0,
    };
    for (const e of episodes) c[e.status] += 1;
    return c;
  }, [episodes, myAssignmentsQuery.data, myEpisodeIds]);

  const filtered = useMemo(() => {
    if (filter === "all") return episodes;
    if (filter === "mine") return episodes.filter((episode) => myEpisodeIds.has(episode.id));
    return episodes.filter((e) => e.status === filter);
  }, [episodes, filter, myEpisodeIds]);

  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAndScrollTo = (id: string) => {
    setFilter("all");
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
        const el = document.getElementById(episodeRowAnchorId(id));
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

      {myAssignmentsQuery.isError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl bg-destructive/10 px-4 py-4 text-sm text-destructive"
        >
          <IconAlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("myTasksUnavailableTitle")}</p>
            <p className="mt-0.5 break-words text-xs">
              {myAssignmentsQuery.error instanceof Error
                ? myAssignmentsQuery.error.message
                : t("myTasksUnavailableFallback")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void myAssignmentsQuery.refetch()}
            className="shrink-0 text-xs font-semibold underline underline-offset-2"
          >
            {tc("retry")}
          </button>
        </div>
      ) : null}

      {filter === "mine" && myAssignmentsQuery.isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
        </div>
      ) : filter === "mine" && myAssignmentsQuery.isError ? null : filtered.length === 0 ? (
        <EmptyState filter={filter} onAddEpisode={onAddEpisode} isAdmin={viewer.isAdmin} t={t} />
      ) : (
        <div className="space-y-3">
          {filtered.map((ep) => (
            <div key={ep.id} id={episodeRowAnchorId(ep.id)}>
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
  counts: {
    all: number;
    mine: number | null;
    not_started: number;
    in_production: number;
    approved: number;
  };
  t: ReturnType<typeof useTranslations>;
}) {
  const tabs: { key: FilterKey; labelKey: string }[] = [
    { key: "all", labelKey: "filterAll" },
    { key: "mine", labelKey: "filterMyTasks" },
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
            aria-pressed={active}
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
              {count ?? "—"}
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
        {filter === "all"
          ? t("noEpisodesYet")
          : filter === "mine"
            ? t("noMyTasks")
            : t("noEpisodesInFilter")}
      </p>
      {isAdmin && filter === "all" ? (
        <Button variant="soft" color="primary" size="sm" onClick={onAddEpisode}>
          <IconPlus className="size-3.5" /> {t("addEpisode")}
        </Button>
      ) : null}
    </div>
  );
}

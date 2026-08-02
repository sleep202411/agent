"use client";

/**
 * Roles tab content — card grid + filter tabs + detail sheet.
 *
 * Filter tabs sit at the top with counts per status. Cards lay out in
 * a responsive 1/2/3 column grid. Clicking a card opens
 * PositionDetailSheet on the right with full info + applicants
 * triage + management actions.
 */

import { useMemo, useState } from "react";
import { IconBriefcase, IconPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CrewPositionDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { PositionCard } from "./position-card";
import { PositionDetailSheet } from "./position-detail-sheet";

type FilterKey = "all" | "open" | "full" | "frozen";

interface PositionsGridProps {
  crewId: string;
  positions: CrewPositionDTO[];
  isOwner: boolean;
  onPublish: () => void;
}

export function PositionsGrid({ crewId, positions, isOwner, onPublish }: PositionsGridProps) {
  const t = useTranslations("workspace");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { all: positions.length, open: 0, full: 0, frozen: 0 };
    for (const p of positions) {
      if (p.status === "frozen") c.frozen += 1;
      else if (p.status === "full" || p.recruitedCount >= p.targetCount) c.full += 1;
      else c.open += 1;
    }
    return c;
  }, [positions]);

  const filtered = useMemo(() => {
    if (filter === "all") return positions;
    if (filter === "open")
      return positions.filter(
        (p) => p.status !== "frozen" && p.status !== "full" && p.recruitedCount < p.targetCount
      );
    if (filter === "full")
      return positions.filter((p) => p.status === "full" || p.recruitedCount >= p.targetCount);
    return positions.filter((p) => p.status === "frozen");
  }, [positions, filter]);

  const selected = positions.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      {/* Header: filter tabs + publish CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs filter={filter} onChange={setFilter} counts={counts} t={t} />
        {isOwner ? (
          <Button variant="soft" color="primary" size="sm" onClick={onPublish}>
            <IconPlus className="size-3.5" /> {t("publishJob")}
          </Button>
        ) : null}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState filter={filter} onPublish={onPublish} isOwner={isOwner} t={t} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <PositionCard
              key={p.id}
              position={p}
              applicantCount={p.applicationStats?.total ?? 0}
              pendingApplicantCount={p.applicationStats?.pending ?? 0}
              onClick={() => setSelectedId(p.id)}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <PositionDetailSheet
        crewId={crewId}
        position={selected}
        canManage={isOwner}
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
  counts: { all: number; open: number; full: number; frozen: number };
  t: ReturnType<typeof useTranslations>;
}) {
  const tabs: { key: FilterKey; labelKey: string }[] = [
    { key: "all", labelKey: "filterAll" },
    { key: "open", labelKey: "statusRecruiting" },
    { key: "full", labelKey: "statusFull" },
    { key: "frozen", labelKey: "statusFrozen" },
  ];
  // Pill-style segmented control — borderless container; the
  // background lift IS the affordance.
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
  onPublish,
  isOwner,
  t,
}: {
  filter: FilterKey;
  onPublish: () => void;
  isOwner: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <IconBriefcase className="size-5" />
      </div>
      <p className="text-sm text-muted-foreground">
        {filter === "all" ? t("noJobsYet") : t("noJobsInFilter")}
      </p>
      {isOwner && filter === "all" ? (
        <Button variant="soft" color="primary" size="sm" onClick={onPublish}>
          <IconPlus className="size-3.5" /> {t("publishJob")}
        </Button>
      ) : null}
    </div>
  );
}

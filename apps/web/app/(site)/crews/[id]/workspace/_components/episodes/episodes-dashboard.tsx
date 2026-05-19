"use client";

/**
 * Production-snapshot dashboard above the episode accordion.
 *
 * Renders three at-a-glance panels for admins and finance:
 *
 *   1. **Episode heatmap** — each episode as a colored cell (status-
 *      tinted, with approval-progress overlay). Lets the admin spot
 *      bottlenecks across the whole production at a glance.
 *   2. **Pending approvals** — count + jump-to badge for episodes
 *      with submissions awaiting review.
 *   3. **Revenue tally** — cumulative revenue grouped by currency
 *      (finance gets the most utility, but admins see it too so they
 *      know the production's running totals).
 *
 * Implementation note: aggregation is pure client-side. We call
 * `useQueries` over the existing per-episode assignments endpoint —
 * React Query keys dedupe with the per-row queries inside each
 * accordion item, so the cumulative cost is the same as the accordion
 * alone (no additional Java pressure / no new server endpoint).
 *
 * Members see nothing — gate at the consumer level (EpisodesBoard).
 */

import { useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { IconChartBar, IconCoin, IconHourglass, IconLayoutGrid } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewKeys } from "@/app/(site)/crews/_hooks/shared";
import { type Episode, type EpisodeAssignment } from "@/app/(site)/crews/_hooks/use-episodes";
import { CURRENCY_SYMBOLS, ZERO_DECIMAL_CURRENCIES, type CurrencyCode } from "@repo/shared/crew";

interface EpisodesDashboardProps {
  crewId: string;
  episodes: Episode[];
  onJumpToEpisode: (episodeId: string) => void;
}

export function EpisodesDashboard({ crewId, episodes, onJumpToEpisode }: EpisodesDashboardProps) {
  const t = useTranslations("workspace");

  // useQueries is the only Rules-of-Hooks-safe way to fan out N
  // parallel reads. Each child uses the SAME key the accordion item
  // would use → React Query dedupes both reads to one network call.
  const queries = useQueries({
    queries: episodes.map((ep) => ({
      queryKey: crewKeys.episodeAssignments(crewId, ep.id),
      queryFn: () =>
        crewApi.get<EpisodeAssignment[]>(
          `/crews/${encodeURIComponent(crewId)}/episodes/${encodeURIComponent(ep.id)}/assignments`
        ),
      enabled: !!ep.id,
      staleTime: 30_000,
    })),
  });

  const aggregate = useMemo(() => {
    let totalAssignments = 0;
    let totalApproved = 0;
    let totalPending = 0;
    let totalInProgress = 0;
    const pendingByEpisode: { episodeId: string; episodeNumber: number; count: number }[] = [];
    const revenueByCurrency = new Map<CurrencyCode, number>();

    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const assignments = queries[i]?.data ?? [];
      let epPending = 0;
      for (const a of assignments) {
        totalAssignments += 1;
        if (a.status === "approved") totalApproved += 1;
        if (a.status === "submitted") {
          totalPending += 1;
          epPending += 1;
        }
        if (a.status === "in_progress" || a.status === "rejected") {
          totalInProgress += 1;
        }
        if (a.revenue) {
          const cur = a.revenue.currency;
          revenueByCurrency.set(cur, (revenueByCurrency.get(cur) ?? 0) + a.revenue.amount);
        }
      }
      if (epPending > 0) {
        pendingByEpisode.push({ episodeId: ep.id, episodeNumber: ep.number, count: epPending });
      }
    }

    return {
      totalAssignments,
      totalApproved,
      totalPending,
      totalInProgress,
      pendingByEpisode,
      revenueByCurrency: Array.from(revenueByCurrency.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [episodes, queries]);

  if (episodes.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {/* Episode heatmap (spans 2 cols on wide screens) */}
      <div className="rounded-xl bg-card p-4 lg:col-span-2">
        <DashboardHeader
          icon={IconLayoutGrid}
          title={t("dashboardHeatmapTitle")}
          subtitle={t("dashboardHeatmapSubtitle", {
            done: aggregate.totalApproved,
            total: aggregate.totalAssignments,
          })}
        />
        <Heatmap
          episodes={episodes}
          queries={queries as AssignmentQuery[]}
          onJumpToEpisode={onJumpToEpisode}
          t={t}
        />
      </div>

      {/* Pending approvals */}
      <div className="rounded-xl bg-card p-4">
        <DashboardHeader
          icon={IconHourglass}
          title={t("dashboardPendingTitle")}
          subtitle={t("dashboardPendingSubtitle", { count: aggregate.totalPending })}
        />
        {aggregate.pendingByEpisode.length === 0 ? (
          <div className="rounded-lg bg-secondary/40 px-3 py-4 text-center text-xs text-muted-foreground">
            {t("dashboardPendingEmpty")}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {aggregate.pendingByEpisode.slice(0, 5).map((p) => (
              <li key={p.episodeId}>
                <button
                  type="button"
                  onClick={() => onJumpToEpisode(p.episodeId)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary/70"
                >
                  <span className="font-medium text-foreground">
                    {t("episodeLabel", { number: p.episodeNumber })}
                  </span>
                  <span className="rounded-full bg-blue-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
                    {p.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Revenue tally — full width on its own row */}
      <div className="rounded-xl bg-card p-4 lg:col-span-3">
        <DashboardHeader
          icon={IconCoin}
          title={t("dashboardRevenueTitle")}
          subtitle={
            aggregate.revenueByCurrency.length === 0
              ? t("dashboardRevenueEmpty")
              : t("dashboardRevenueSubtitle", {
                  currencies: aggregate.revenueByCurrency.length,
                })
          }
        />
        {aggregate.revenueByCurrency.length === 0 ? (
          <div className="rounded-lg bg-secondary/40 px-3 py-4 text-center text-xs text-muted-foreground">
            {t("dashboardRevenueNoneYet")}
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {aggregate.revenueByCurrency.map(([currency, amount]) => (
              <RevenueChip key={currency} currency={currency} amount={amount} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Heatmap ───────────────────────────────────────────

type AssignmentQuery = UseQueryResult<EpisodeAssignment[], Error>;

function Heatmap({
  episodes,
  queries,
  onJumpToEpisode,
  t,
}: {
  episodes: Episode[];
  queries: AssignmentQuery[];
  onJumpToEpisode: (episodeId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {episodes.map((ep, i) => {
        const assignments = queries[i]?.data ?? [];
        const total = assignments.length;
        const approved = assignments.filter((a) => a.status === "approved").length;
        const pct = total > 0 ? approved / total : 0;
        const tint = cellTint(ep.status, pct);
        const tooltip = `${t("episodeLabel", { number: ep.number })} · ${total > 0 ? `${approved}/${total}` : t("rowNoAssignments")}`;
        return (
          <button
            key={ep.id}
            type="button"
            onClick={() => onJumpToEpisode(ep.id)}
            title={tooltip}
            className={cn(
              "group relative flex size-8 items-center justify-center rounded-md text-[10px] font-bold tabular-nums transition-all hover:scale-110",
              tint
            )}
          >
            {ep.number.toString().padStart(2, "0")}
          </button>
        );
      })}
    </div>
  );
}

function cellTint(status: Episode["status"], pct: number): string {
  if (status === "approved") return "bg-green-400/30 text-green-300";
  if (status === "in_production") {
    if (pct >= 1) return "bg-blue-400/30 text-blue-300";
    if (pct >= 0.5) return "bg-amber-400/30 text-amber-300";
    return "bg-amber-400/15 text-amber-400";
  }
  return "bg-secondary text-muted-foreground";
}

// ─── Revenue chip ──────────────────────────────────────

function RevenueChip({
  currency,
  amount,
  t,
}: {
  currency: CurrencyCode;
  amount: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  const display = isZeroDecimal ? amount : amount / 100;
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  const formatted =
    typeof Intl !== "undefined" && Intl.NumberFormat
      ? new Intl.NumberFormat(undefined, {
          minimumFractionDigits: isZeroDecimal ? 0 : 2,
          maximumFractionDigits: isZeroDecimal ? 0 : 2,
        }).format(display)
      : display.toFixed(isZeroDecimal ? 0 : 2);
  return (
    <div className="flex items-baseline gap-2 rounded-lg bg-amber-400/10 px-3 py-2">
      <span className="text-xs font-semibold text-amber-400">{currency}</span>
      <span className="text-lg font-black tabular-nums text-foreground">
        {symbol}
        {formatted}
      </span>
      <span className="text-[10px] text-muted-foreground">{t("dashboardRevenueAccrued")}</span>
    </div>
  );
}

// ─── Small atoms ───────────────────────────────────────

function DashboardHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof IconChartBar;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}

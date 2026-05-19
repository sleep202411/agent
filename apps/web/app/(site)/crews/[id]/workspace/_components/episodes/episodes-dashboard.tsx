"use client";

/**
 * Production-snapshot dashboard above the episode accordion.
 *
 * Renders three at-a-glance panels for admins and finance:
 *
 *   1. **Member × Episode heatmap** — the production board.
 *      Each row is a crew member, each column is an episode, each
 *      cell is the member's assignment status on that episode.
 *      Approved/Submitted/In Progress/Rejected/Unassigned all
 *      have distinct tints so admins can spot "X is blocking EP05"
 *      in one glance. Clicking any cell expands the corresponding
 *      episode in the accordion below.
 *   2. **Pending approvals** — count + jump-to badge for episodes
 *      with submissions awaiting review.
 *   3. **Revenue tally** — cumulative revenue grouped by currency.
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
import { IconCoin, IconCrown, IconHourglass, IconLayoutGrid } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewKeys } from "@/app/(site)/crews/_hooks/shared";
import { useCrewMembers, type CrewMemberDTO } from "@/app/(site)/crews/_hooks/use-crew";
import {
  type AssignmentStatus,
  type Episode,
  type EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import { CURRENCY_SYMBOLS, ZERO_DECIMAL_CURRENCIES, type CurrencyCode } from "@repo/shared/crew";

interface EpisodesDashboardProps {
  crewId: string;
  episodes: Episode[];
  onJumpToEpisode: (episodeId: string) => void;
}

type AssignmentQuery = UseQueryResult<EpisodeAssignment[], Error>;

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
  }) as AssignmentQuery[];

  const aggregate = useMemo(() => {
    let totalAssignments = 0;
    let totalApproved = 0;
    let totalPending = 0;
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
      pendingByEpisode,
      revenueByCurrency: Array.from(revenueByCurrency.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [episodes, queries]);

  if (episodes.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {/* Member × Episode heatmap (spans 2 cols on wide screens) */}
      <div className="rounded-xl bg-card p-4 lg:col-span-2">
        <DashboardHeader
          icon={IconLayoutGrid}
          title={t("dashboardHeatmapTitle")}
          subtitle={t("dashboardHeatmapSubtitle", {
            done: aggregate.totalApproved,
            total: aggregate.totalAssignments,
          })}
        />
        <HeatmapMatrix
          crewId={crewId}
          episodes={episodes}
          queries={queries}
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

// ─── Heatmap matrix ───────────────────────────────────

/**
 * Real production heatmap — rows are crew members (founder first,
 * then by joinedAt asc), cols are episodes by number, cells encode
 * assignment status. Empty cells = "unassigned" so the grid is
 * fully populated and the eye can sweep horizontally to find a
 * blocked row, or vertically to find a blocked episode.
 */
function HeatmapMatrix({
  crewId,
  episodes,
  queries,
  onJumpToEpisode,
  t,
}: {
  crewId: string;
  episodes: Episode[];
  queries: AssignmentQuery[];
  onJumpToEpisode: (episodeId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { data: members = [] } = useCrewMembers(crewId);
  const memberIds = useMemo(() => members.map((m) => m.userId), [members]);
  const displays = useUserDisplays(memberIds);
  const translatePosition = useTranslatePositionValue();

  // Sort members: founder first, then by joinedAt ascending.
  const orderedMembers = useMemo(() => {
    const founder = members.find((m) => m.via === "founder") ?? null;
    const rest = members
      .filter((m) => m.via !== "founder")
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    return founder ? [founder, ...rest] : rest;
  }, [members]);

  // (userId, episodeId) → assignment lookup.
  const assignmentMap = useMemo(() => {
    const m = new Map<string, AssignmentStatus>();
    for (let i = 0; i < episodes.length; i++) {
      const epId = episodes[i].id;
      const assignments = queries[i]?.data ?? [];
      for (const a of assignments) m.set(`${a.userId}:${epId}`, a.status);
    }
    return m;
  }, [episodes, queries]);

  if (orderedMembers.length === 0) {
    return (
      <div className="rounded-lg bg-secondary/40 px-3 py-4 text-center text-xs text-muted-foreground">
        {t("heatmapNoMembers")}
      </div>
    );
  }

  // CSS grid — sticky leading column for member names so wide
  // productions (20+ episodes) scroll horizontally without losing
  // the row label.
  const cols = `minmax(140px, 180px) repeat(${episodes.length}, minmax(36px, 1fr))`;

  return (
    <div className="space-y-3">
      {/* Legend */}
      <Legend t={t} />

      {/* Matrix */}
      <div className="overflow-x-auto">
        <div
          role="table"
          aria-label={t("dashboardHeatmapTitle")}
          className="grid w-full gap-1 text-xs"
          style={{ gridTemplateColumns: cols }}
        >
          {/* Header row: empty corner + episode numbers */}
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("memberAssignmentsLabel")}
          </div>
          {episodes.map((ep) => (
            <button
              key={ep.id}
              type="button"
              onClick={() => onJumpToEpisode(ep.id)}
              className="flex h-7 items-center justify-center rounded-md bg-secondary/50 px-1 text-[10px] font-semibold tabular-nums text-foreground transition-colors hover:bg-secondary"
              title={ep.title || t("episodeLabel", { number: ep.number })}
            >
              {ep.number.toString().padStart(2, "0")}
            </button>
          ))}

          {/* Data rows — one per member */}
          {orderedMembers.map((member) => (
            <MatrixRow
              key={member.id}
              member={member}
              episodes={episodes}
              assignmentMap={assignmentMap}
              displayName={displayNameOf(member.userId, displays)}
              rolePretty={
                member.via === "founder" ? t("memberRoleOwner") : translatePosition(member.roleType)
              }
              onJumpToEpisode={onJumpToEpisode}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MatrixRow({
  member,
  episodes,
  assignmentMap,
  displayName,
  rolePretty,
  onJumpToEpisode,
  t,
}: {
  member: CrewMemberDTO;
  episodes: Episode[];
  assignmentMap: Map<string, AssignmentStatus>;
  displayName: string;
  rolePretty: string;
  onJumpToEpisode: (episodeId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const isFounder = member.via === "founder";
  return (
    <>
      {/* Row label cell — member name + role */}
      <div className="flex min-w-0 items-center gap-2 pr-2">
        {isFounder ? <IconCrown className="size-3 shrink-0 text-primary" /> : null}
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{displayName}</div>
          <div className="truncate text-[10px] text-muted-foreground">{rolePretty}</div>
        </div>
      </div>
      {/* Cells for each episode */}
      {episodes.map((ep) => {
        const status = assignmentMap.get(`${member.userId}:${ep.id}`) ?? null;
        return (
          <HeatCell
            key={ep.id}
            status={status}
            label={t("episodeLabel", { number: ep.number })}
            displayName={displayName}
            t={t}
            onClick={() => onJumpToEpisode(ep.id)}
          />
        );
      })}
    </>
  );
}

function HeatCell({
  status,
  label,
  displayName,
  t,
  onClick,
}: {
  status: AssignmentStatus | null;
  label: string;
  displayName: string;
  t: ReturnType<typeof useTranslations>;
  onClick: () => void;
}) {
  const visual = CELL_VISUAL[status ?? "unassigned"];
  const statusLabel =
    status == null
      ? t("heatmapStatusUnassigned")
      : t(`assignmentStatus${capitalize(status)}` as Parameters<typeof t>[0]);
  const tooltip = `${displayName} · ${label} · ${statusLabel}`;
  return (
    <button
      type="button"
      title={tooltip}
      aria-label={tooltip}
      onClick={onClick}
      className={cn(
        "h-7 rounded-md text-[10px] font-bold transition-all hover:scale-110 hover:shadow-sm",
        visual
      )}
    >
      {status === "rejected" ? "✗" : status === "submitted" ? "▲" : null}
    </button>
  );
}

// `assignmentStatus*` keys are PascalCase suffixes on the existing
// status translations; this tiny helper avoids hand-mapping each
// status string twice.
function capitalize(s: string): string {
  return s
    .split("_")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

const CELL_VISUAL: Record<AssignmentStatus | "unassigned", string> = {
  approved: "bg-green-400/60 text-green-950 hover:bg-green-400/80",
  submitted: "bg-blue-400/55 text-blue-950 hover:bg-blue-400/75",
  in_progress: "bg-amber-400/45 text-amber-950 hover:bg-amber-400/65",
  rejected: "bg-rose-400/60 text-rose-950 hover:bg-rose-400/80",
  unassigned: "bg-secondary/40 text-muted-foreground hover:bg-secondary/70",
};

function Legend({ t }: { t: ReturnType<typeof useTranslations> }) {
  const items: { key: AssignmentStatus | "unassigned"; labelKey: string }[] = [
    { key: "approved", labelKey: "assignmentStatusApproved" },
    { key: "submitted", labelKey: "assignmentStatusSubmitted" },
    { key: "in_progress", labelKey: "assignmentStatusInProgress" },
    { key: "rejected", labelKey: "assignmentStatusRejected" },
    { key: "unassigned", labelKey: "heatmapStatusUnassigned" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", CELL_VISUAL[it.key])} />
          {t(it.labelKey)}
        </span>
      ))}
    </div>
  );
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
  const display = isZeroDecimal ? amount : Math.round(amount / 100);
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  const formatted =
    typeof Intl !== "undefined" && Intl.NumberFormat
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(display)
      : String(display);
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
  icon: typeof IconLayoutGrid;
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

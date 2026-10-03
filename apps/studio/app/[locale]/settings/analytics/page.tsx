"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  IconBolt,
  IconChartBar,
  IconChevronRight,
  IconClock,
  IconListDetails,
  IconPhoto,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { listProjects, type ProjectRef } from "@/lib/collab/projects-api";
import { listWorkspaceMembers, type SharingMember } from "@/lib/collab/sharing-api";
import {
  generationStatusFromRaw,
  listFizzAiJobs,
  type FizzAiJobType,
  type FizzAiJobView,
} from "@/lib/canvas-authoring/generation-api";
import { EmptyState, PageHeader, Panel, StatCard } from "../_components/settings-ui";

interface WalletLedgerData {
  entries?: WalletLedgerEntry[];
}

interface WalletLedgerEntry {
  id: string;
  entryType: string;
  amount: string;
  availableDelta: string;
  heldDelta: string;
  reason: string;
  sourceType: string;
  sourceId: string | null;
  description: string | null;
  createdAt: string;
}

interface DailyUsagePoint {
  date: string;
  credits: string;
}

interface DailyUsageData {
  days: DailyUsagePoint[];
}

interface MemberUsageProjectRow {
  projectId: string | null;
  projectName: string | null;
  credits: string;
  jobs: number;
}

interface MemberUsageRow {
  userId: string;
  totalCredits: string;
  totalJobs: number;
  projects: MemberUsageProjectRow[];
}

interface MemberUsageData {
  rangeDays: number;
  projectId: string | null;
  members: MemberUsageRow[];
}

const MEMBER_USAGE_RANGES = [7, 30, 90] as const;
const EMPTY_MEMBERS: SharingMember[] = [];

const JOB_HISTORY_LIMIT = 100;
const LEDGER_LIMIT = 100;
const DAILY_USAGE_DAYS = 30;
const EMPTY_LEDGER_ENTRIES: WalletLedgerEntry[] = [];
const EMPTY_JOB_ROWS: FizzAiJobView[] = [];
const EMPTY_PROJECTS: ProjectRef[] = [];

function bigintFromString(value: string | null | undefined): bigint {
  if (!value || !/^-?\d+$/.test(value)) return BigInt(0);
  return BigInt(value);
}

function formatBigint(value: bigint): string {
  return value.toLocaleString();
}

function formatSignedBigint(value: bigint): string {
  if (value === BigInt(0)) return "0";
  const sign = value > BigInt(0) ? "+" : "-";
  return `${sign}${formatBigint(value < BigInt(0) ? -value : value)}`;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** A local YYYY-MM-DD key for `date`, matching the server's day buckets. */
function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A short axis label (month/day) for a YYYY-MM-DD key. */
function formatDayLabel(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

/** Build the fixed window [today - (days - 1) … today], mapping credits per day (0 if absent). */
function buildDailyAxis(
  points: DailyUsagePoint[],
  days: number
): { key: string; credits: bigint }[] {
  const byDay = new Map<string, bigint>();
  for (const point of points) {
    byDay.set(point.date, bigintFromString(point.credits));
  }
  const axis: { key: string; credits: bigint }[] = [];
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = dayKey(date);
    axis.push({ key, credits: byDay.get(key) ?? BigInt(0) });
  }
  return axis;
}

function jobFeature(job: FizzAiJobView): FizzAiJobType | "unknown" {
  if (job.type === "image" || job.type === "video") return job.type;
  return "unknown";
}

function ledgerDisplayDelta(entry: WalletLedgerEntry): bigint {
  const amount = bigintFromString(entry.amount);
  if (["settle", "debit", "expire", "transfer_out"].includes(entry.entryType)) return -amount;
  if (["credit", "refund", "release", "transfer_in"].includes(entry.entryType)) return amount;
  if (entry.entryType === "hold") return -amount;
  return bigintFromString(entry.availableDelta) + bigintFromString(entry.heldDelta);
}

function pointsIn(entries: WalletLedgerEntry[]): bigint {
  return entries.reduce((sum, entry) => {
    if (["credit", "refund", "transfer_in"].includes(entry.entryType)) {
      return sum + bigintFromString(entry.amount);
    }
    if (entry.entryType === "hold" || entry.entryType === "release") return sum;
    const delta = bigintFromString(entry.availableDelta);
    return delta > BigInt(0) ? sum + delta : sum;
  }, BigInt(0));
}

function pointsOut(entries: WalletLedgerEntry[]): bigint {
  return entries.reduce((sum, entry) => {
    if (["settle", "debit", "expire", "transfer_out"].includes(entry.entryType)) {
      return sum + bigintFromString(entry.amount);
    }
    return sum;
  }, BigInt(0));
}

function settledByJob(entries: WalletLedgerEntry[]): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const entry of entries) {
    if (entry.sourceType !== "ai_job" || !entry.sourceId || entry.entryType !== "settle") continue;
    map.set(
      entry.sourceId,
      (map.get(entry.sourceId) ?? BigInt(0)) + bigintFromString(entry.amount)
    );
  }
  return map;
}

function useAnalyticsData(workspaceId: string | undefined, viewerId: string | null) {
  const ledger = useQuery({
    queryKey: ["settings", "analytics", "wallet-ledger", viewerId, workspaceId],
    enabled: Boolean(viewerId && workspaceId),
    queryFn: ({ signal }) =>
      api.get<WalletLedgerData>("/aurora/billing/wallet-ledger", {
        signal,
        headers: { "x-fizz-workspace-id": workspaceId! },
        params: { currency: "compute_point", balanceKind: "consumable", limit: LEDGER_LIMIT },
      }),
    staleTime: 20_000,
  });

  const jobs = useQuery({
    queryKey: ["settings", "analytics", "jobs", viewerId, workspaceId],
    enabled: Boolean(viewerId && workspaceId),
    queryFn: ({ signal }) =>
      listFizzAiJobs(
        { limit: JOB_HISTORY_LIMIT },
        { signal, headers: { "x-fizz-workspace-id": workspaceId! } }
      ),
    staleTime: 20_000,
  });

  return { ledger, jobs };
}

/** Workspace usage analytics backed by real wallet ledger + AI job history. */
export default function AnalyticsSettingsPage() {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const viewerId = user?.id == null ? null : String(user.id);
  return (
    <AnalyticsView key={JSON.stringify([viewerId, activeWorkspace?.id])} viewerId={viewerId} />
  );
}

function AnalyticsView({ viewerId }: { viewerId: string | null }) {
  const t = useTranslations("settings");
  const { activeWorkspace: ws, loading } = useWorkspace();
  const { ledger, jobs } = useAnalyticsData(ws?.id, viewerId);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["settings", "analytics", "projects", viewerId, ws?.id],
    enabled: Boolean(viewerId && ws?.id),
    queryFn: ({ signal }) => listProjects(ws!.id, signal),
    staleTime: 20_000,
  });

  const dailyUsage = useQuery({
    queryKey: ["settings", "analytics", "daily-usage", viewerId, ws?.id, selectedProjectId],
    enabled: Boolean(viewerId && ws?.id),
    queryFn: ({ signal }) =>
      api.get<DailyUsageData>("/aurora/billing/wallet-ledger/daily-usage", {
        signal,
        headers: { "x-fizz-workspace-id": ws!.id },
        params: { days: DAILY_USAGE_DAYS, projectId: selectedProjectId || undefined },
      }),
    staleTime: 20_000,
  });

  // Team members power the member-usage panel: display names (the usage endpoint
  // is keyed by userId) and the caller's own role, which gates the panel — per-
  // member consumption is admin-only (the server enforces it too).
  const membersQuery = useQuery({
    queryKey: ["settings", "analytics", "members", viewerId, ws?.id],
    enabled: Boolean(viewerId && ws?.id),
    queryFn: ({ signal }) => listWorkspaceMembers(ws!.id, signal),
    staleTime: 20_000,
  });
  const members = membersQuery.data ?? EMPTY_MEMBERS;
  const selfRole = members.find((member) => member.isSelf)?.role;
  const canViewMemberUsage = selfRole === "owner" || selfRole === "admin";

  const projects = projectsQuery.data ?? EMPTY_PROJECTS;
  const dailyAxis = useMemo(
    () => buildDailyAxis(dailyUsage.data?.days ?? [], DAILY_USAGE_DAYS),
    [dailyUsage.data?.days]
  );

  const entries = ledger.data?.entries ?? EMPTY_LEDGER_ENTRIES;
  const jobRows = jobs.data?.jobs ?? EMPTY_JOB_ROWS;
  const settled = useMemo(() => settledByJob(entries), [entries]);

  const summary = useMemo(
    () => ({
      totalJobs: jobRows.length,
      creditsIn: pointsIn(entries),
      creditsOut: pointsOut(entries),
    }),
    [entries, jobRows.length]
  );

  const modelRows = useMemo(() => {
    const map = new Map<string, { modelId: string; count: number; credits: bigint }>();
    for (const job of jobRows) {
      const current = map.get(job.modelId) ?? {
        modelId: job.modelId,
        count: 0,
        credits: BigInt(0),
      };
      current.count += 1;
      current.credits += settled.get(job.id) ?? BigInt(0);
      map.set(job.modelId, current);
    }
    return [...map.values()].sort(
      (a, b) => b.count - a.count || a.modelId.localeCompare(b.modelId)
    );
  }, [jobRows, settled]);

  const maxModelCount = Math.max(1, ...modelRows.map((row) => row.count));
  const initialLoading = loading || !ws || ledger.isLoading || jobs.isLoading;
  const failedQueries = [ledger, jobs, projectsQuery, membersQuery].filter(
    (query) => query.isError
  );

  if (initialLoading) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </main>
    );
  }

  if (failedQueries.length > 0) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
        <PageHeader title={t("usageAnalytics")} subtitle={t("usageAnalyticsSubtitle")} />
        <Panel>
          <AnalyticsRecovery
            error={failedQueries[0]?.error}
            busy={failedQueries.some((query) => query.isFetching)}
            retry={() => {
              for (const query of failedQueries) void query.refetch();
            }}
          />
        </Panel>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
      <PageHeader title={t("usageAnalytics")} subtitle={t("usageAnalyticsSubtitle")} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={t("totalJobs")}
          value={formatBigint(BigInt(summary.totalJobs))}
          hint={t("recentJobsWindow", { count: JOB_HISTORY_LIMIT })}
        />
        <StatCard
          label={t("creditsIn")}
          value={formatBigint(summary.creditsIn)}
          hint={t("recentLedgerWindow", { count: LEDGER_LIMIT })}
        />
        <StatCard
          label={t("creditsOut")}
          value={formatBigint(summary.creditsOut)}
          hint={t("recentLedgerWindow", { count: LEDGER_LIMIT })}
        />
      </div>

      <Panel
        title={t("creditsUsage")}
        icon={<IconChartBar className="size-4 text-muted-foreground" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CreditDeltaCard label={t("creditsIn")} value={summary.creditsIn} tone="in" />
          <CreditDeltaCard label={t("creditsOut")} value={summary.creditsOut} tone="out" />
        </div>
      </Panel>

      <Panel
        title={t("dailyUsage")}
        icon={<IconChartBar className="size-4 text-muted-foreground" />}
        action={
          <select
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            className="h-9 max-w-[200px] rounded-md bg-input/30 px-2 text-sm text-foreground outline-none"
            aria-label={t("projectFilter")}
          >
            <option value="">{t("allProjects")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {t("dailyUsageWindow", { count: DAILY_USAGE_DAYS })}
        </p>
        {dailyUsage.isLoading ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : dailyUsage.isError ? (
          <AnalyticsRecovery
            error={dailyUsage.error}
            busy={dailyUsage.isFetching}
            retry={() => void dailyUsage.refetch()}
          />
        ) : (
          <DailyUsageChart axis={dailyAxis} />
        )}
      </Panel>

      {canViewMemberUsage && (
        <MemberUsagePanel
          viewerId={viewerId!}
          workspaceId={ws.id}
          projects={projects}
          members={members}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title={t("modelsUsage")}>
          {modelRows.length > 0 ? (
            <div className="space-y-3">
              {modelRows.slice(0, 8).map((row) => (
                <UsageBar
                  key={row.modelId}
                  label={row.modelId}
                  value={row.count}
                  max={maxModelCount}
                  trailing={
                    row.credits > BigInt(0)
                      ? t("modelCreditsUsed", { credits: formatBigint(row.credits) })
                      : t("modelJobs", { count: row.count })
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<IconChartBar className="size-5" />}
              title={t("noUsageDataYet")}
              body={t("noGenerationHistoryYet")}
            />
          )}
        </Panel>

        <Panel
          title={t("creditsSummary")}
          icon={<IconBolt className="size-4 text-muted-foreground" />}
        >
          {entries.length > 0 ? (
            <div className="space-y-3">
              {entries.slice(0, 8).map((entry) => (
                <LedgerRow key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<IconBolt className="size-5" />}
              title={t("noUsageDataYet")}
              body={t("noCreditLedgerYet")}
            />
          )}
        </Panel>
      </div>

      <Panel
        title={t("generations")}
        icon={<IconListDetails className="size-4 text-muted-foreground" />}
      >
        {jobRows.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr_0.7fr] gap-2 px-1 pb-2 text-xs font-medium text-muted-foreground uppercase">
                <span>{t("colCompleted")}</span>
                <span>{t("colModel")}</span>
                <span>{t("colFeature")}</span>
                <span>{t("colStatus")}</span>
                <span className="text-right">{t("colCredits")}</span>
              </div>
              <div className="h-px bg-white/[0.06]" />
              <div className="divide-y divide-white/[0.06]">
                {jobRows.slice(0, 18).map((job) => (
                  <GenerationRow key={job.id} job={job} credits={settled.get(job.id)} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<IconClock className="size-5" />}
            title={t("noUsageDataYet")}
            body={t("noGenerationHistoryYet")}
          />
        )}
      </Panel>
    </main>
  );
}

/** Per-member compute usage for a team (admin-only), broken down by project. */
function MemberUsagePanel({
  viewerId,
  workspaceId,
  projects,
  members,
}: {
  viewerId: string;
  workspaceId: string;
  projects: ProjectRef[];
  members: SharingMember[];
}) {
  const t = useTranslations("settings");
  const [range, setRange] = useState<number>(30);
  const [projectId, setProjectId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const usage = useQuery({
    queryKey: ["settings", "analytics", "member-usage", viewerId, workspaceId, range, projectId],
    enabled: Boolean(viewerId && workspaceId),
    queryFn: ({ signal }) =>
      api.get<MemberUsageData>("/aurora/billing/wallet-ledger/member-usage", {
        signal,
        headers: { "x-fizz-workspace-id": workspaceId },
        params: { days: range, projectId: projectId || undefined },
      }),
    staleTime: 20_000,
  });

  const identity = useMemo(() => {
    const map = new Map<string, SharingMember>();
    for (const member of members) map.set(member.userId, member);
    return map;
  }, [members]);

  const rows = usage.data?.members ?? [];
  const maxCredits = rows.reduce((max, row) => {
    const credits = bigintFromString(row.totalCredits);
    return credits > max ? credits : max;
  }, BigInt(0));

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  return (
    <Panel
      title={t("memberUsage")}
      icon={<IconUsers className="size-4 text-muted-foreground" />}
      action={
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="h-9 max-w-[200px] rounded-md bg-input/30 px-2 text-sm text-foreground outline-none"
          aria-label={t("projectFilter")}
        >
          <option value="">{t("allProjects")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("memberUsageWindow", { count: range })}</p>
        <div className="flex gap-1">
          {MEMBER_USAGE_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors",
                option === range
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("lastNDays", { count: option })}
            </button>
          ))}
        </div>
      </div>

      {usage.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ) : usage.isError ? (
        <AnalyticsRecovery
          error={usage.error}
          busy={usage.isFetching}
          retry={() => void usage.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconUsers className="size-5" />}
          title={t("noUsageDataYet")}
          body={t("noMemberUsageYet")}
        />
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => {
            const member = identity.get(row.userId);
            const credits = bigintFromString(row.totalCredits);
            const width = `${
              maxCredits > BigInt(0)
                ? Math.max(4, Number((credits * BigInt(1000)) / maxCredits) / 10)
                : 0
            }%`;
            const name = member?.nickname?.trim()
              ? member.nickname
              : row.userId === "unknown"
                ? t("memberUnknown")
                : row.userId;
            const isOpen = expanded.has(row.userId);
            return (
              <div key={row.userId}>
                <button
                  type="button"
                  onClick={() => toggle(row.userId)}
                  className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
                  aria-expanded={isOpen}
                >
                  <div className="flex items-center gap-3">
                    <IconChevronRight
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-90"
                      )}
                    />
                    <MemberAvatar member={member} name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">
                          {name}
                          {member?.isSelf ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {t("memberSelfSuffix")}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums">
                          <IconBolt className="size-3.5" stroke={1.8} />
                          {formatBigint(credits)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full bg-white/70" style={{ width }} />
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {t("memberGenerations", { count: row.totalJobs })}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-0.5 mb-1 ml-11 space-y-1 border-l border-white/[0.06] pl-3">
                    {row.projects.map((project) => (
                      <div
                        key={project.projectId ?? "none"}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="truncate text-muted-foreground">
                          {project.projectId
                            ? (project.projectName ?? project.projectId)
                            : t("workspaceLevelUsage")}
                        </span>
                        <span className="flex shrink-0 items-center gap-3 tabular-nums">
                          <span className="text-muted-foreground">
                            {t("memberGenerations", { count: project.jobs })}
                          </span>
                          <span className="font-medium text-foreground">
                            {formatBigint(bigintFromString(project.credits))}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function MemberAvatar({ member, name }: { member: SharingMember | undefined; name: string }) {
  if (member?.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={member.avatar} alt={name} className="size-7 shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-foreground">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function CreditDeltaCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: bigint;
  tone: "in" | "out";
}) {
  return (
    <FrostedPanel className="px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 flex items-center gap-1.5 text-lg font-semibold tabular-nums",
          tone === "in" ? "text-white" : "text-white/82"
        )}
      >
        <IconBolt className="size-4" stroke={1.8} />
        {formatBigint(value)}
      </div>
    </FrostedPanel>
  );
}

function UsageBar({
  label,
  value,
  max,
  trailing,
}: {
  label: string;
  value: number;
  max: number;
  trailing: string;
}) {
  const width = `${Math.max(8, Math.round((value / max) * 100))}%`;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{trailing}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-white/70" style={{ width }} />
      </div>
    </div>
  );
}

/** Vertical daily-usage bars: credits (Y) per day (X), fixed window, hand-rolled. */
function DailyUsageChart({ axis }: { axis: { key: string; credits: bigint }[] }) {
  const t = useTranslations("settings");
  const max = axis.reduce((m, d) => (d.credits > m ? d.credits : m), BigInt(0));

  if (max === BigInt(0)) {
    return (
      <EmptyState
        icon={<IconChartBar className="size-5" />}
        title={t("noUsageDataYet")}
        body={t("noDailyUsageYet")}
      />
    );
  }

  return (
    <div>
      <div className="flex h-44 items-end gap-1">
        {axis.map((day) => {
          // Percent of the tallest bar; bigint-safe ratio scaled by 1000.
          const heightPct =
            day.credits > BigInt(0)
              ? Math.max(2, Number((day.credits * BigInt(1000)) / max) / 10)
              : 0;
          return (
            <div key={day.key} className="flex h-full flex-1 items-end">
              <div
                className="w-full rounded-t-sm bg-white/70"
                style={{ height: `${heightPct}%` }}
                title={t("dailyUsageBarTitle", {
                  date: formatDayLabel(day.key),
                  credits: formatBigint(day.credits),
                })}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{formatDayLabel(axis[0]?.key ?? "")}</span>
        <span>{formatDayLabel(axis[axis.length - 1]?.key ?? "")}</span>
      </div>
    </div>
  );
}

function LedgerRow({ entry }: { entry: WalletLedgerEntry }) {
  const t = useTranslations("settings");
  const delta = ledgerDisplayDelta(entry);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {ledgerReasonLabel(entry.reason, entry.entryType, t)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</p>
      </div>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          delta > BigInt(0) ? "text-white" : "text-muted-foreground"
        )}
      >
        {formatSignedBigint(delta)}
      </span>
    </div>
  );
}

function GenerationRow({ job, credits }: { job: FizzAiJobView; credits: bigint | undefined }) {
  const t = useTranslations("settings");
  const feature = jobFeature(job);
  const status = generationStatusFromRaw(job.status);
  const Icon = feature === "video" ? IconVideo : IconPhoto;
  return (
    <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr_0.7fr] items-center gap-2 px-1 py-3 text-sm">
      <span className="text-muted-foreground tabular-nums">
        {formatDateTime(job.completedAt ?? job.updatedAt ?? job.createdAt)}
      </span>
      <span className="truncate font-medium">{job.modelId}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Icon className="size-4 shrink-0" stroke={1.8} />
        <span className="truncate">{t(`feature.${feature}`)}</span>
      </span>
      <span>{t(`jobStatus.${status}`)}</span>
      <span className="text-right font-semibold tabular-nums">
        {credits != null ? formatBigint(credits) : "—"}
      </span>
    </div>
  );
}

function ledgerReasonLabel(
  reason: string,
  entryType: string,
  t: ReturnType<typeof useTranslations<"settings">>
): string {
  const key = `ledgerReason.${reason}`;
  const fallbackKey = `ledgerEntry.${entryType}`;
  try {
    return t(key);
  } catch {
    try {
      return t(fallbackKey);
    } catch {
      return reason || entryType;
    }
  }
}

function AnalyticsRecovery({
  error,
  busy,
  retry,
}: {
  error: unknown;
  busy: boolean;
  retry: () => void;
}) {
  const t = useTranslations("settings");
  const common = useTranslations("common");
  return (
    <div className="space-y-3" role="alert">
      <p className="break-words text-sm text-muted-foreground">
        {error instanceof Error && error.message ? error.message : t("usageAnalyticsLoadFailed")}
      </p>
      <Button size="sm" variant="secondary" disabled={busy} onClick={retry}>
        {common("retry")}
      </Button>
    </div>
  );
}

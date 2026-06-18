"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  IconBolt,
  IconChartBar,
  IconClock,
  IconListDetails,
  IconPhoto,
  IconVideo,
} from "@tabler/icons-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/app/_components/workspace-context";
import {
  generationStatusFromRaw,
  listFizzAiJobs,
  type FizzAiJobType,
  type FizzAiJobView,
} from "@/app/[locale]/canvas/_lib/generation-api";
import { EmptyState, PageHeader, Panel, StatCard, TeamBadge } from "../_components/settings-ui";

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

const JOB_HISTORY_LIMIT = 100;
const LEDGER_LIMIT = 100;
const EMPTY_LEDGER_ENTRIES: WalletLedgerEntry[] = [];
const EMPTY_JOB_ROWS: FizzAiJobView[] = [];

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

function useAnalyticsData(workspaceId: string | undefined) {
  const ledger = useQuery({
    queryKey: ["settings", "analytics", "wallet-ledger", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () =>
      api.get<WalletLedgerData>("/aurora/billing/wallet-ledger", {
        params: { currency: "compute_point", balanceKind: "consumable", limit: LEDGER_LIMIT },
      }),
    staleTime: 20_000,
  });

  const jobs = useQuery({
    queryKey: ["settings", "analytics", "jobs", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => listFizzAiJobs({ limit: JOB_HISTORY_LIMIT }),
    staleTime: 20_000,
  });

  return { ledger, jobs };
}

/** Workspace usage analytics backed by real wallet ledger + AI job history. */
export default function AnalyticsSettingsPage() {
  const t = useTranslations("settings");
  const { activeWorkspace: ws, loading } = useWorkspace();
  const { ledger, jobs } = useAnalyticsData(ws?.id);

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
  const hasLoadError = ledger.isError || jobs.isError;

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

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
      <PageHeader
        title={t("usageAnalytics")}
        badge={<TeamBadge label={ws.type === "personal" ? t("personal") : t("team")} />}
        subtitle={t("usageAnalyticsSubtitle")}
      />

      {hasLoadError && (
        <Panel>
          <p className="text-sm text-muted-foreground">{t("usageAnalyticsLoadFailed")}</p>
        </Panel>
      )}

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
              <div className="h-px bg-border" />
              <div className="divide-y divide-border/70">
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
    <div className="rounded-xl bg-white/[0.05] px-4 py-3">
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
    </div>
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

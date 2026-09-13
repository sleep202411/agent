"use client";

import { useMemo, useState } from "react";
import { IconLoader2, IconReceipt, IconRefresh, IconWallet } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useProjectComputeLedger } from "../../_hooks/use-billing";
import type { ComputeWalletLedgerData } from "../../_lib/billing-api";
import { FizzStudioShell, useFizzStudioWorkspace } from "../_components/fizzstudio-shell";

import { useCurrentUser } from "@/src/hooks/use-user";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { FizzProject } from "../../_lib/api";

type LedgerEntry = ComputeWalletLedgerData["entries"][number];

export default function FizzStudioBillingPage() {
  const workspaceState = useFizzStudioWorkspace();
  const { user } = useCurrentUser();

  return (
    <FizzStudioShell
      className="overflow-x-hidden bg-[#0d0d0e] pb-16"
      headerVariant="enterprise"
      mainClassName="max-w-none px-4 pt-8 sm:px-6 lg:px-12 xl:px-[60px] 2xl:px-[136px]"
      sidebarVariant="enterprise"
      workspaceState={workspaceState}
    >
      <BillingUsageSurface
        key={`${user?.id}:${workspaceState.workspaceId}`}
        workspaceId={workspaceState.workspaceId}
      />
    </FizzStudioShell>
  );
}

export function BillingUsageSurface({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("fizzStudio.billingUsage");
  const locale = useLocale();
  const { user } = useCurrentUser();
  const [projectId, setProjectId] = useState("");
  const ledger = useProjectComputeLedger(workspaceId, projectId || undefined);
  const projects = useQuery({
    queryKey: ["billing-projects", user?.id, workspaceId],
    enabled: !!user && !!workspaceId,
    retry: false,
    queryFn: ({ signal }) =>
      api.get<{ projects: FizzProject[] }>(`/aurora/workspaces/${workspaceId}/projects`, {
        signal,
        headers: { "X-Fizz-Workspace-Id": workspaceId },
      }),
  });
  const summary = useMemo(() => summarizeAccounts(ledger.data?.pages[0]), [ledger.data]);
  const entries = [
    ...new Map(
      (ledger.data?.pages.flatMap((page) => page.entries) ?? []).map((entry) => [entry.id, entry])
    ).values(),
  ];

  return (
    <section className="mx-auto max-w-[1360px] text-white">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-3 inline-flex size-11 items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.04] text-white/76">
            <IconReceipt className="size-5" stroke={1.9} />
          </div>
          <h1 className="text-3xl font-semibold tracking-normal text-white">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/54">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          disabled={ledger.isFetching}
          onClick={() => void ledger.refetch()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-white/12 px-4 text-sm font-semibold text-white/84 transition-colors hover:bg-white/8 hover:text-white"
        >
          {ledger.isFetching ? (
            <IconLoader2 className="size-4 animate-spin" stroke={1.9} />
          ) : (
            <IconRefresh className="size-4" stroke={1.9} />
          )}
          {t("refresh")}
        </button>
      </div>

      <div className="mt-6 space-y-2">
        <NativeSelect aria-label={t("projectFilter")} value={projectId} onChange={setProjectId}>
          <NativeSelectOption value="">{t("allProjects")}</NativeSelectOption>
          {(projects.data?.projects ?? []).map((project) => (
            <NativeSelectOption key={project.id} value={project.id}>
              {project.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-sm text-white/54">{t("walletScope")}</p>
        {projects.error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-300">
            {projects.error.message}
            <button disabled={projects.isFetching} onClick={() => void projects.refetch()}>
              {t("refresh")}
            </button>
          </div>
        ) : null}
        {ledger.error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-300">
            {ledger.error.message}
            <button
              disabled={ledger.isFetching}
              onClick={() =>
                void (ledger.isFetchNextPageError
                  ? ledger.fetchNextPage({ cancelRefetch: false })
                  : ledger.refetch())
              }
            >
              {t("refresh")}
            </button>
          </div>
        ) : null}
      </div>
      {ledger.data ? (
        <div className="mt-7 grid gap-3 md:grid-cols-3">
          <SummaryTile label={t("summary.available")} value={summary.available} tone="strong" />
          <SummaryTile label={t("summary.held")} value={summary.held} tone="reserved" />
          <SummaryTile label={t("summary.total")} value={summary.total} tone="neutral" />
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-[8px] border border-white/10 bg-[#141416]">
        <div className="grid min-w-[1120px] grid-cols-[minmax(136px,.9fr)_minmax(190px,1.35fr)_minmax(136px,.9fr)_minmax(112px,.75fr)_minmax(120px,.7fr)_minmax(120px,.8fr)_minmax(150px,1fr)] border-b border-white/8 px-5 py-3 text-[11px] font-semibold uppercase text-white/42">
          <span>{t("table.time")}</span>
          <span>{t("table.activity")}</span>
          <span>{t("table.source")}</span>
          <span>{t("table.status")}</span>
          <span className="text-right">{t("table.points")}</span>
          <span className="text-right">{t("table.balance")}</span>
          <span className="text-right">{t("table.reference")}</span>
        </div>

        {ledger.isLoading ? (
          <div className="grid min-h-[280px] place-items-center text-sm font-medium text-white/52">
            <span className="inline-flex items-center gap-2">
              <IconLoader2 className="size-4 animate-spin" stroke={1.9} />
              {t("loading")}
            </span>
          </div>
        ) : entries.length === 0 && !ledger.isError ? (
          <div className="grid min-h-[280px] place-items-center px-6 text-center">
            <div>
              <div className="mx-auto grid size-12 place-items-center rounded-[8px] bg-white/[0.05] text-white/58">
                <IconWallet className="size-5" stroke={1.9} />
              </div>
              <p className="mt-4 text-sm font-semibold text-white/86">{t("emptyTitle")}</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/46">
                {t("emptyDescription")}
              </p>
            </div>
          </div>
        ) : (
          <div className="min-w-[1120px] divide-y divide-white/[0.06]">
            {entries.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} locale={locale} />
            ))}
          </div>
        )}
      </div>
      {ledger.hasNextPage ? (
        <button
          className="mt-4 rounded px-4 py-2 text-sm"
          disabled={ledger.isFetching}
          onClick={() => void ledger.fetchNextPage({ cancelRefetch: false })}
        >
          {t("loadMore")}
        </button>
      ) : null}
    </section>
  );
}

function SummaryTile({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "neutral" | "reserved" | "strong";
  value: bigint;
}) {
  return (
    <div
      className={cn(
        "rounded-[8px] border px-4 py-4",
        tone === "strong" && "border-[#e92d32]/35 bg-[#241416]",
        tone === "reserved" && "border-white/10 bg-white/[0.035]",
        tone === "neutral" && "border-white/10 bg-white/[0.025]"
      )}
    >
      <p className="text-[12px] font-semibold text-white/48">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-normal text-white">
        {formatPoints(value)}
      </p>
    </div>
  );
}

function LedgerRow({ entry, locale }: { entry: LedgerEntry; locale: string }) {
  const t = useTranslations("fizzStudio.billingUsage");
  const activityKey = activityKeyFor(entry);
  const reference = referenceFor(entry, t("noReference"));
  const modelId = stringFromMetadata(entry.metadata, "modelId");
  const sourceLabel = grantSourceLabel(entry, t);

  return (
    <div className="grid grid-cols-[minmax(136px,.9fr)_minmax(190px,1.35fr)_minmax(136px,.9fr)_minmax(112px,.75fr)_minmax(120px,.7fr)_minmax(120px,.8fr)_minmax(150px,1fr)] items-center gap-4 px-5 py-4 text-sm">
      <time className="text-white/52" dateTime={entry.createdAt}>
        {formatDateTime(entry.createdAt, locale)}
      </time>
      <div className="min-w-0">
        <p className="truncate font-semibold text-white/88">{t(`activities.${activityKey}`)}</p>
        <p className="mt-1 truncate text-[12px] text-white/42">{modelId ?? entry.reason}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-white/72" title={sourceLabel}>
          {sourceLabel}
        </p>
        {entry.creditAllocations[0]?.expiresAt ? (
          <p className="mt-1 truncate text-[12px] text-white/38">
            {t("expiresAt", {
              value: formatDateTime(entry.creditAllocations[0].expiresAt, locale),
            })}
          </p>
        ) : null}
      </div>
      <div>
        <span
          className={cn(
            "inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold",
            statusTone(entry)
          )}
        >
          {t(`statuses.${entry.entryType}`)}
        </span>
      </div>
      <div className="text-right font-semibold tabular-nums text-white/74">
        {formatPoints(BigInt(entry.amount))}
      </div>
      <div className="text-right font-semibold tabular-nums text-white/74">
        {formatPoints(BigInt(entry.availableBalanceAfter))}
      </div>
      <div className="truncate text-right text-[12px] font-medium text-white/42" title={reference}>
        {reference}
        {entry.projectId ? (
          <p title={entry.projectId}>
            {t("projectReference", { value: compactReference(entry.projectId) })}
          </p>
        ) : null}
        {entry.transactionStatus ? (
          <p>{t(`transactionStatuses.${entry.transactionStatus}`)}</p>
        ) : null}
      </div>
    </div>
  );
}

function summarizeAccounts(data: ComputeWalletLedgerData | undefined) {
  const totals = { available: 0n, held: 0n, total: 0n };
  for (const account of data?.accounts ?? []) {
    if (account.status !== "active") continue;
    const available = BigInt(account.availableBalance);
    const held = BigInt(account.heldBalance);
    totals.available += available;
    totals.held += held;
    totals.total += available + held;
  }
  return totals;
}

function activityKeyFor(entry: LedgerEntry) {
  if (entry.sourceType === "ai_job") {
    if (entry.entryType === "hold") return "aiJobHold";
    if (entry.entryType === "settle") return "aiJobSettle";
    if (entry.entryType === "release") return "aiJobRelease";
  }
  if (entry.entryType === "expire") return "expired";
  if (entry.sourceType === "billing_order" && entry.entryType === "credit") return "topupCredit";
  if (entry.entryType === "refund") return "refund";
  if (entry.entryType === "adjustment") return "adjustment";
  if (entry.entryType === "transfer_in" || entry.entryType === "transfer_out") return "transfer";
  return "default";
}

function statusTone(entry: LedgerEntry) {
  if (entry.entryType === "hold") return "bg-[#7c5cff]/16 text-[#cdbdff]";
  if (entry.entryType === "release" || entry.entryType === "refund") {
    return "bg-emerald-400/12 text-emerald-200";
  }
  if (entry.entryType === "expire") return "bg-amber-400/12 text-amber-200";
  if (entry.entryType === "credit" || entry.entryType === "transfer_in") {
    return "bg-sky-400/12 text-sky-200";
  }
  if (entry.entryType === "debit" || entry.entryType === "settle") {
    return "bg-white/[0.07] text-white/68";
  }
  return "bg-white/[0.06] text-white/58";
}

function referenceFor(entry: LedgerEntry, fallback: string) {
  if (entry.orderNo) return entry.orderNo;
  if (entry.sourceId) return compactReference(entry.sourceId);
  return fallback;
}

function compactReference(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function stringFromMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function grantSourceLabel(entry: LedgerEntry, t: ReturnType<typeof useTranslations>) {
  const types = distinctGrantTypes(entry);
  if (types.length === 0) return t("grantTypes.unspecified");
  const primary = t(`grantTypes.${types[0]}`);
  if (types.length === 1) return primary;
  return t("grantTypes.mixed", { primary, count: types.length - 1 });
}

function distinctGrantTypes(entry: LedgerEntry) {
  const values = new Set<string>();
  for (const allocation of entry.creditAllocations) values.add(allocation.grantType);
  const metadataGrantType = stringFromMetadata(entry.metadata, "grantType");
  if (metadataGrantType) values.add(metadataGrantType);
  const fallbackGrantType = fallbackGrantTypeFor(entry);
  if (fallbackGrantType) values.add(fallbackGrantType);
  return [...values].filter(isKnownGrantType);
}

function fallbackGrantTypeFor(
  entry: LedgerEntry
): LedgerEntry["creditAllocations"][number]["grantType"] | null {
  if (entry.sourceType === "billing_order") return "purchase_topup";
  if (entry.sourceType === "wallet_balance_backfill") return "migration";
  if (
    entry.sourceType.includes("admin") ||
    entry.sourceType.includes("adjustment") ||
    entry.sourceType === "local_dev_adjustment" ||
    entry.entryType === "adjustment"
  ) {
    return "admin_adjustment";
  }
  if (entry.sourceType.includes("check_in")) return "check_in_reward";
  if (entry.sourceType.includes("campaign") || entry.sourceType.includes("activity")) {
    return "campaign_reward";
  }
  return null;
}

function isKnownGrantType(
  value: string
): value is LedgerEntry["creditAllocations"][number]["grantType"] {
  return (
    value === "purchase_topup" ||
    value === "membership_included" ||
    value === "check_in_reward" ||
    value === "campaign_reward" ||
    value === "admin_adjustment" ||
    value === "refund_return" ||
    value === "migration" ||
    value === "system_grant" ||
    value === "other"
  );
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPoints(value: bigint) {
  return new Intl.NumberFormat().format(value);
}

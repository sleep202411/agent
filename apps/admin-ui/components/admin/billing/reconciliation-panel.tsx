"use client";

// 对账任务 page — extracted AS-IS from ReconciliationRunsTable
// (admin-billing-panel.tsx:3800). Run rows + open-item differences, with the
// page header layered on top (mirrors the IP module per-page panels).

import { useMemo } from "react";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ColumnHeader,
  ErrorBanner,
  formatDate,
  formatInteger,
  formatNullableMoneyMinor,
  PageHeader,
  providerLabel,
  reconciliationItemStatusLabel,
  reconciliationStatusLabel,
  StatusPill,
} from "./shared";
import type { AdminBillingReconciliationRunsData, BillingReconciliationRunRow } from "./types";

export function BillingReconciliationPanel({
  siteLabel,
  databaseLabel,
  initialReconciliationRuns,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialReconciliationRuns: AdminBillingReconciliationRunsData | null;
  initialError?: string | null;
}) {
  const runs = initialReconciliationRuns?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="对账任务"
        description="内部账与渠道账的自动对账运行，列出不一致与缺失明细。"
      />
      {initialError ? <ErrorBanner message={initialError} /> : null}
      <ReconciliationRunsTable runs={runs} />
    </div>
  );
}

function ReconciliationRunsTable({ runs }: { runs: BillingReconciliationRunRow[] }) {
  const columns = useMemo<ColumnDef<BillingReconciliationRunRow, unknown>[]>(
    () => [
      {
        id: "run",
        header: "运行",
        enableSorting: false,
        cell: ({ row }) => {
          const run = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">
                {run.id.slice(0, 8)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {providerLabel(run.provider)} {run.currency ?? ""}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: () => (
          <ColumnHeader help="本次对账任务是否仍在运行、完成或失败。">状态</ColumnHeader>
        ),
        cell: ({ row }) => {
          const run = row.original;
          const issueCount =
            run.mismatchCount + run.missingInternalCount + run.missingProviderCount;
          return (
            <>
              <StatusPill
                tone={
                  run.status === "failed"
                    ? "risk"
                    : run.status === "completed" && issueCount === 0
                      ? "success"
                      : "muted"
                }
              >
                {reconciliationStatusLabel(run.status)}
              </StatusPill>
              {run.error ? (
                <p className="mt-1 max-w-[180px] truncate text-[11px] text-red-600">{run.error}</p>
              ) : null}
            </>
          );
        },
      },
      {
        id: "period",
        header: "周期",
        enableSorting: false,
        cell: ({ row }) => {
          const run = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{formatDate(run.periodStart)}</p>
              <p className="text-[11px] text-slate-500">{formatDate(run.periodEnd)}</p>
            </>
          );
        },
      },
      {
        accessorKey: "matchedCount",
        header: "匹配",
        cell: ({ row }) => formatInteger(String(row.original.matchedCount)),
      },
      {
        id: "diff",
        header: () => (
          <ColumnHeader help="金额不一致、内部缺失、渠道缺失三类异常合计。">差异</ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const run = row.original;
          const issueCount =
            run.mismatchCount + run.missingInternalCount + run.missingProviderCount;
          return (
            <>
              <p
                className={cn(
                  "text-sm font-semibold",
                  issueCount ? "text-red-700" : "text-slate-950"
                )}
              >
                {formatInteger(String(issueCount))}
              </p>
              <p className="text-[11px] text-slate-500">总项 {run.itemCount}</p>
            </>
          );
        },
      },
      {
        id: "samples",
        header: () => (
          <ColumnHeader help="最多展示近期未匹配样本，便于定位漏单、重复回调或渠道金额不一致。">
            异常样本
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const run = row.original;
          return (
            <div className="space-y-1.5">
              {run.openItems.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[92px_minmax(120px,1fr)_110px] gap-2 text-[12px]"
                >
                  <span className="truncate text-red-700">
                    {reconciliationItemStatusLabel(item.status)}
                  </span>
                  <span
                    className="truncate text-slate-600"
                    title={item.providerReference ?? item.orderId ?? undefined}
                  >
                    {item.providerReference ?? item.orderId ?? "-"}
                  </span>
                  <span className="text-right font-mono text-slate-950">
                    {formatNullableMoneyMinor(
                      item.differenceMinor ?? item.providerAmountMinor ?? item.internalAmountMinor,
                      item.currency
                    )}
                  </span>
                </div>
              ))}
              {!run.openItems.length ? (
                <span className="text-[12px] text-slate-500">无未处理异常</span>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => formatDate(row.original.updatedAt),
      },
    ],
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">支付对账</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          对账运行、差异数量和未匹配项集中展示，后续处理退款、拒付和渠道漏单。
        </p>
      </div>
      <DataTable
        columns={columns}
        data={runs}
        minWidth={1050}
        pageSize={20}
        emptyLabel="暂无对账运行"
        className="rounded-none border-0"
      />
    </section>
  );
}

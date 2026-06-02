"use client";

import { useMemo } from "react";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { AdminDialog } from "@/components/admin/billing/shared";
import {
  ErrorBanner,
  formatAmount,
  formatDate,
  formatShareBps,
  Metric,
  revenueLedgerEntryTypeLabel,
  revenueLedgerStatusLabel,
  StatusPill,
} from "./shared";
import type {
  AdminOrderRevenueBeneficiary,
  AdminOrderRevenueBreakdownData,
  RevenueLedgerEntryStatus,
} from "./types";

function statusTone(status: RevenueLedgerEntryStatus): "success" | "warn" | "muted" {
  if (status === "posted") return "success";
  if (status === "pending") return "warn";
  return "muted";
}

export function OrderRevenueBreakdownDialog({
  breakdown,
  loading,
  error,
  onClose,
}: {
  breakdown: AdminOrderRevenueBreakdownData | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const columns = useMemo<ColumnDef<AdminOrderRevenueBeneficiary, unknown>[]>(
    () => [
      {
        accessorKey: "userId",
        header: "受益用户",
        cell: ({ row }) => (
          <p className="max-w-[180px] truncate font-mono text-[12px] text-slate-700">
            {row.original.userId}
          </p>
        ),
      },
      {
        accessorKey: "entryType",
        header: "类型",
        cell: ({ row }) => (
          <p className="text-sm text-slate-700">
            {revenueLedgerEntryTypeLabel(row.original.entryType)}
          </p>
        ),
      },
      {
        accessorKey: "poolShareBps",
        header: "池内分成",
        cell: ({ row }) => (
          <p className="text-sm text-slate-700">{formatShareBps(row.original.poolShareBps)}</p>
        ),
      },
      {
        accessorKey: "amount",
        header: "金额",
        cell: ({ row }) => (
          <p className="font-medium text-slate-950">{formatAmount(row.original.amount)}</p>
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => (
          <StatusPill tone={statusTone(row.original.status)}>
            {revenueLedgerStatusLabel(row.original.status)}
          </StatusPill>
        ),
      },
      {
        id: "walletTransactionId",
        header: "钱包流水",
        enableSorting: false,
        cell: ({ row }) => (
          <p
            className="max-w-[180px] truncate font-mono text-[11px] text-slate-500"
            title={row.original.walletTransactionId ?? undefined}
          >
            {row.original.walletTransactionId ?? "-"}
          </p>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => (
          <p className="text-[12px] text-slate-700">{formatDate(row.original.createdAt)}</p>
        ),
      },
    ],
    []
  );

  const open = Boolean(breakdown || loading || error);

  return (
    <AdminDialog
      open={open}
      title="订单收益明细"
      description={
        breakdown ? `${breakdown.orderNo ?? breakdown.orderId}` : "查看单笔订单的分账去向"
      }
      onClose={onClose}
    >
      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          正在加载订单收益明细…
        </div>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      {breakdown ? (
        <div className="space-y-4">
          <section className="grid gap-2 sm:grid-cols-3">
            <Metric label="订单总额" value={formatAmount(breakdown.totalAmount)} />
            <Metric label="创作者分账" value={formatAmount(breakdown.creditedAmount)} />
            <Metric label="平台留存" value={formatAmount(breakdown.platformCut)} />
          </section>
          <section className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 px-3 py-2">
              <h4 className="text-sm font-semibold text-slate-950">分账受益人</h4>
              <p className="mt-0.5 text-[11px] text-slate-500">
                每一条都对应一笔创作者钱包入账（社区积分，暂不开放提现）。
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <DataTable
                columns={columns}
                data={breakdown.beneficiaries}
                minWidth={820}
                emptyLabel="该订单暂无分账受益人"
                className="rounded-none border-0"
              />
            </div>
          </section>
        </div>
      ) : null}
    </AdminDialog>
  );
}

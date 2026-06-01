"use client";

// 结算批次 page. The settlements table body is MOVED AS-IS from
// SettlementsTable (admin-billing-panel.tsx:3690) during the P2 per-page split:
// every gross/fee/net money cell, status pill, and Chinese string is preserved
// verbatim. Shared primitives come from "./shared"; the page server component
// fetches /billing/ledger/settlements and passes the rows in.

import { useMemo } from "react";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  ColumnHeader,
  ErrorBanner,
  PageHeader,
  StatusPill,
  formatDate,
  formatMoneyMinor,
  providerLabel,
  settlementStatusLabel,
} from "./shared";
import type { AdminBillingSettlementsData, BillingSettlementRow } from "./types";

export function BillingSettlementsPanel({
  siteLabel,
  databaseLabel,
  initialSettlements,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialSettlements: AdminBillingSettlementsData | null;
  initialError?: string | null;
}) {
  const settlements = initialSettlements?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="结算批次"
        description="支付渠道打款结算，用于核对 provider payout 与手续费。"
      />
      {initialError ? <ErrorBanner message={initialError} /> : null}
      <SettlementsTable settlements={settlements} />
    </div>
  );
}

function SettlementsTable({ settlements }: { settlements: BillingSettlementRow[] }) {
  const columns = useMemo<ColumnDef<BillingSettlementRow, unknown>[]>(
    () => [
      {
        accessorKey: "providerSettlementId",
        header: () => (
          <ColumnHeader help="支付供应商侧 settlement/payout 批次 ID，用于和渠道后台对账。">
            结算批次
          </ColumnHeader>
        ),
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">
                {settlement.providerSettlementId}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {providerLabel(settlement.provider)}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: () => <ColumnHeader help="结算批次与内部账本的对账状态。">状态</ColumnHeader>,
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <StatusPill tone={settlement.status === "failed" ? "risk" : "muted"}>
              {settlementStatusLabel(settlement.status)}
            </StatusPill>
          );
        },
      },
      {
        id: "gross",
        header: () => <ColumnHeader help="渠道结算总金额，未扣手续费。">总额</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => formatMoneyMinor(row.original.grossAmountMinor, row.original.currency),
      },
      {
        id: "fee",
        header: () => (
          <ColumnHeader help="渠道从结算中扣除的手续费。后续会生成 provider_fee journal。">
            手续费
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => formatMoneyMinor(row.original.feeAmountMinor, row.original.currency),
      },
      {
        id: "net",
        header: () => <ColumnHeader help="渠道实际打款金额，等于总额减手续费。">净额</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <p className="font-semibold text-slate-950">
              {formatMoneyMinor(settlement.netAmountMinor, settlement.currency)}
            </p>
          );
        },
      },
      {
        id: "links",
        header: "关联",
        enableSorting: false,
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">Journal {settlement.journalCount}</p>
              <p className="text-[11px] text-slate-500">
                对账项 {settlement.reconciliationItemCount}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "settledAt",
        header: "时间",
        cell: ({ row }) => (row.original.settledAt ? formatDate(row.original.settledAt) : "-"),
      },
    ],
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">渠道结算</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          用于核对支付渠道打款、手续费和内部 journal 是否一致。
        </p>
      </div>
      <DataTable
        columns={columns}
        data={settlements}
        minWidth={900}
        pageSize={20}
        emptyLabel="暂无渠道结算记录"
        className="rounded-none border-0"
      />
    </section>
  );
}

"use client";

// 用户钱包 page for the /billing sub-app. View bodies moved AS-IS from
// WalletView/WalletAccountDetailDialog (admin-billing-panel.tsx:3089/3282).
// Wallet 流水 stays INSIDE the wallet detail dialog (not a nav item).
// 人工调整 is DEFERRED to P3 — do NOT add it here.

import { useMemo, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  AdminDialog,
  ColumnHeader,
  ErrorBanner,
  Metric,
  OrderStatusPill,
  PageHeader,
  StatusPill,
  balanceKindLabel,
  currencyLabel,
  formatDate,
  formatInteger,
  formatMoneyMinor,
  formatSignedInteger,
  requestEnvelope,
  toErrorMessage,
  walletEntryTypeLabel,
} from "./shared";
import type {
  AdminBillingOverviewData,
  BillingOrderRow,
  WalletAccountRow,
  WalletLedgerEntryRow,
} from "./types";

export function BillingWalletsPanel({
  siteLabel,
  databaseLabel,
  initialOverview,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialOverview: AdminBillingOverviewData | null;
  initialError?: string | null;
}) {
  const [overview, setOverview] = useState<AdminBillingOverviewData | null>(initialOverview);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const nextOverview = await requestEnvelope<AdminBillingOverviewData>(
        "/api/admin/billing/overview"
      );
      setOverview(nextOverview);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="用户钱包"
        description="算力积分与社区积分钱包余额，明细在钱包详情内查看。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      {overview ? (
        <WalletView
          accounts={overview.walletAccounts}
          entries={overview.walletLedgerEntries}
          metrics={overview.metrics}
          recentOrders={overview.recentOrders}
          loading={loading}
        />
      ) : null}
    </div>
  );
}

function WalletView({
  accounts,
  entries,
  metrics,
  recentOrders,
  loading,
}: {
  accounts: WalletAccountRow[];
  entries: WalletLedgerEntryRow[];
  metrics: AdminBillingOverviewData["metrics"];
  recentOrders: BillingOrderRow[];
  loading: boolean;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;
  const selectedAccountEntries = selectedAccount
    ? entries.filter((entry) => entry.accountId === selectedAccount.id)
    : [];

  const columns = useMemo<ColumnDef<WalletAccountRow, unknown>[]>(
    () => [
      {
        id: "account",
        header: "账户",
        enableSorting: false,
        cell: ({ row }) => {
          const account = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{account.ownerType}</p>
              <p className="max-w-[220px] truncate text-[11px] text-slate-500">{account.ownerId}</p>
            </>
          );
        },
      },
      {
        accessorKey: "currency",
        header: () => (
          <ColumnHeader help="平台钱包币种，不是法币。算力积分和社区积分相互隔离。">
            币种
          </ColumnHeader>
        ),
        cell: ({ row }) => currencyLabel(row.original.currency),
      },
      {
        accessorKey: "balanceKind",
        header: () => (
          <ColumnHeader help="可消费余额用于购买内容/服务；可提现余额只来自创作者收入，暂不开放提现流程。">
            余额类型
          </ColumnHeader>
        ),
        cell: ({ row }) => balanceKindLabel(row.original.balanceKind),
      },
      {
        accessorKey: "availableBalance",
        header: "可用余额",
        cell: ({ row }) => formatInteger(row.original.availableBalance),
      },
      {
        accessorKey: "heldBalance",
        header: "冻结",
        cell: ({ row }) => formatInteger(row.original.heldBalance),
      },
      {
        accessorKey: "ledgerEntryCount",
        header: "流水",
        cell: ({ row }) => formatInteger(String(row.original.ledgerEntryCount)),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const account = row.original;
          return (
            <StatusPill tone={account.status === "active" ? "success" : "muted"}>
              {account.status}
            </StatusPill>
          );
        },
      },
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => formatDate(row.original.updatedAt),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelectedAccountId(row.original.id)}
          >
            查看
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">钱包账户余额</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            每行是一个用户或工作区的钱包账户；点击查看可打开余额详情和真实流水。
          </p>
        </div>
        <DataTable
          columns={columns}
          data={accounts}
          loading={loading}
          minWidth={940}
          pageSize={20}
          emptyLabel="暂无钱包账户"
          className="rounded-none border-0"
        />
      </section>

      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h3 className="text-sm font-semibold text-slate-950">最近钱包流水</h3>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            最近已记账的 wallet ledger entry，不包含仅初始化的空账户。
          </p>
          <div className="mt-3 space-y-2">
            {entries.slice(0, 6).map((entry) => (
              <div key={entry.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-slate-950">
                      {walletEntryTypeLabel(entry.entryType)} · {currencyLabel(entry.currency)}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {entry.ownerType}:{entry.ownerId}
                    </p>
                  </div>
                  <span className="text-[12px] font-semibold text-slate-950">
                    {formatSignedInteger(entry.availableDelta)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{formatDate(entry.createdAt)}</p>
              </div>
            ))}
            {!entries.length ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[12px] text-slate-500">
                暂无钱包流水
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h3 className="text-sm font-semibold text-slate-950">7 日账单状态</h3>
          <div className="mt-4 grid gap-2">
            <Metric label="已履约订单" value={metrics.fulfilledOrders7d} />
            <Metric label="失败订单" value={metrics.failedOrders7d} tone="risk" />
            <Metric label="支付失败事件" value={metrics.paymentFailures7d} tone="risk" />
          </div>
          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="text-[12px] font-semibold text-slate-500">最近订单</p>
            <div className="mt-3 space-y-2">
              {recentOrders.slice(0, 5).map((order) => (
                <div key={order.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-slate-950">
                      {order.item.name}
                    </p>
                    <OrderStatusPill status={order.status} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {formatMoneyMinor(order.amountMinor, order.currency)} ·{" "}
                    {formatDate(order.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <WalletAccountDetailDialog
        account={selectedAccount}
        entries={selectedAccountEntries}
        onClose={() => setSelectedAccountId(null)}
      />
    </div>
  );
}

function WalletAccountDetailDialog({
  account,
  entries,
  onClose,
}: {
  account: WalletAccountRow | null;
  entries: WalletLedgerEntryRow[];
  onClose: () => void;
}) {
  const columns = useMemo<ColumnDef<WalletLedgerEntryRow, unknown>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
      {
        id: "action",
        header: "动作",
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">
                {walletEntryTypeLabel(entry.entryType)}
              </p>
              <p className="text-[11px] text-slate-500">{entry.reason}</p>
            </>
          );
        },
      },
      {
        accessorKey: "availableDelta",
        header: "可用变动",
        cell: ({ row }) => formatSignedInteger(row.original.availableDelta),
      },
      {
        accessorKey: "heldDelta",
        header: "冻结变动",
        cell: ({ row }) => formatSignedInteger(row.original.heldDelta),
      },
      {
        id: "balanceAfter",
        header: "余额后",
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{formatInteger(entry.availableBalanceAfter)}</p>
              <p className="text-[11px] text-slate-500">
                冻结 {formatInteger(entry.heldBalanceAfter)}
              </p>
            </>
          );
        },
      },
      {
        id: "source",
        header: "来源",
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{entry.sourceType}</p>
              <p
                className="max-w-[180px] truncate font-mono text-[11px] text-slate-500"
                title={entry.sourceId ?? entry.idempotencyKey}
              >
                {entry.sourceId ?? entry.idempotencyKey}
              </p>
            </>
          );
        },
      },
    ],
    []
  );

  return (
    <AdminDialog
      open={Boolean(account)}
      title="钱包账户详情"
      description={
        account
          ? `${account.ownerType}:${account.ownerId} · ${currencyLabel(account.currency)} · ${balanceKindLabel(account.balanceKind)}`
          : undefined
      }
      onClose={onClose}
    >
      {account ? (
        <div className="space-y-4">
          <section className="grid gap-2 sm:grid-cols-3">
            <Metric label="可用余额" value={formatInteger(account.availableBalance)} />
            <Metric label="冻结余额" value={formatInteger(account.heldBalance)} />
            <Metric label="流水条数" value={account.ledgerEntryCount} />
          </section>
          <section className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 px-3 py-2">
              <h4 className="text-sm font-semibold text-slate-950">账户流水</h4>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <DataTable
                columns={columns}
                data={entries}
                minWidth={780}
                emptyLabel="暂无该账户流水"
                className="rounded-none border-0"
              />
            </div>
          </section>
        </div>
      ) : null}
    </AdminDialog>
  );
}

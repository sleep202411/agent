"use client";

// 用户钱包 page for the /billing sub-app. Wallet 流水 stays INSIDE the
// wallet detail dialog (not a nav item); admin adjustments use the same
// wallet ledger + credit grant engine as billing and AI generation.

import { useCallback, useMemo, useState } from "react";
import { IconAdjustments, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  AdminDialog,
  ColumnHeader,
  ErrorBanner,
  FormLabel,
  Metric,
  OrderStatusPill,
  PageHeader,
  Select,
  StatusPill,
  TextInput,
  balanceKindLabel,
  currencyLabel,
  formatDate,
  formatInteger,
  formatMoneyMinor,
  formatSignedInteger,
  mutateEnvelope,
  requestEnvelope,
  toErrorMessage,
  walletEntryTypeLabel,
  walletGrantStatusLabel,
  walletGrantTypeLabel,
} from "./shared";
import type {
  AdminBillingOverviewData,
  AdminWalletAccountDetailData,
  BillingOrderRow,
  WalletAccountRow,
  WalletCreditGrantRow,
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
          onAccountUpdated={(detail) =>
            setOverview((current) =>
              current
                ? {
                    ...current,
                    walletAccounts: current.walletAccounts.map((account) =>
                      account.id === detail.account.id ? detail.account : account
                    ),
                    walletLedgerEntries: [
                      ...detail.entries.slice(0, 12),
                      ...current.walletLedgerEntries.filter(
                        (entry) => entry.accountId !== detail.account.id
                      ),
                    ].slice(0, 12),
                  }
                : current
            )
          }
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
  onAccountUpdated,
}: {
  accounts: WalletAccountRow[];
  entries: WalletLedgerEntryRow[];
  metrics: AdminBillingOverviewData["metrics"];
  recentOrders: BillingOrderRow[];
  loading: boolean;
  onAccountUpdated: (detail: AdminWalletAccountDetailData) => void;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminWalletAccountDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const selectedAccount =
    detail?.account ?? accounts.find((account) => account.id === selectedAccountId) ?? null;
  const selectedAccountEntries =
    detail?.entries ??
    (selectedAccount ? entries.filter((entry) => entry.accountId === selectedAccount.id) : []);
  const selectedAccountGrants = detail?.grants ?? [];

  const openAccount = useCallback(
    async (accountId: string) => {
      setSelectedAccountId(accountId);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const nextDetail = await requestEnvelope<AdminWalletAccountDetailData>(
          `/api/admin/billing/wallets/${accountId}`
        );
        setDetail(nextDetail);
        onAccountUpdated(nextDetail);
      } catch (err) {
        setDetailError(toErrorMessage(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [onAccountUpdated]
  );

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
            onClick={() => void openAccount(row.original.id)}
          >
            查看
          </Button>
        ),
      },
    ],
    [openAccount]
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
        grants={selectedAccountGrants}
        loading={detailLoading}
        error={detailError}
        onAdjusted={(nextDetail) => {
          setDetail(nextDetail);
          onAccountUpdated(nextDetail);
        }}
        onClose={() => {
          // Clear the loaded detail too — `account` derives from
          // `detail?.account ?? selectedAccountId`, so leaving the detail in
          // place keeps `open` true and the dialog can never close.
          setSelectedAccountId(null);
          setDetail(null);
          setDetailError(null);
        }}
      />
    </div>
  );
}

function WalletAccountDetailDialog({
  account,
  entries,
  grants,
  loading,
  error,
  onAdjusted,
  onClose,
}: {
  account: WalletAccountRow | null;
  entries: WalletLedgerEntryRow[];
  grants: WalletCreditGrantRow[];
  loading: boolean;
  error: string | null;
  onAdjusted: (detail: AdminWalletAccountDetailData) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [grantType, setGrantType] = useState("admin_adjustment");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const parsedAmount = parseAdjustmentAmount(amount);
  const isPositiveAdjustment = parsedAmount !== null && parsedAmount > BigInt(0);
  const canAdjust =
    Boolean(account) &&
    account?.currency === "compute_point" &&
    account?.balanceKind === "consumable" &&
    account?.status === "active";

  const grantColumns = useMemo<ColumnDef<WalletCreditGrantRow, unknown>[]>(
    () => [
      {
        id: "grant",
        header: "来源批次",
        enableSorting: false,
        cell: ({ row }) => {
          const grant = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">
                {walletGrantTypeLabel(grant.grantType)}
              </p>
              <p className="max-w-[180px] truncate font-mono text-[11px] text-slate-500">
                {grant.id}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const status = row.original.status;
          return (
            <StatusPill
              tone={status === "active" ? "success" : status === "expired" ? "risk" : "muted"}
            >
              {walletGrantStatusLabel(status)}
            </StatusPill>
          );
        },
      },
      {
        id: "amounts",
        header: "金额",
        enableSorting: false,
        cell: ({ row }) => {
          const grant = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">
                可用 {formatInteger(grant.availableAmount)} / 总额{" "}
                {formatInteger(grant.totalAmount)}
              </p>
              <p className="text-[11px] text-slate-500">
                冻结 {formatInteger(grant.heldAmount)} · 已用 {formatInteger(grant.consumedAmount)}
              </p>
            </>
          );
        },
      },
      {
        id: "expiry",
        header: "有效期",
        enableSorting: false,
        cell: ({ row }) => (
          <>
            <p className="text-[12px] text-slate-700">
              {row.original.expiresAt ? formatDate(row.original.expiresAt) : "长期有效"}
            </p>
            <p className="text-[11px] text-slate-500">创建 {formatDate(row.original.createdAt)}</p>
          </>
        ),
      },
      {
        id: "source",
        header: "业务来源",
        enableSorting: false,
        cell: ({ row }) => (
          <>
            <p className="text-[12px] text-slate-700">{row.original.sourceType}</p>
            <p className="max-w-[160px] truncate font-mono text-[11px] text-slate-500">
              {row.original.sourceId ?? "-"}
            </p>
          </>
        ),
      },
    ],
    []
  );

  const ledgerColumns = useMemo<ColumnDef<WalletLedgerEntryRow, unknown>[]>(
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
        header: "业务来源",
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original;
          const firstAllocation = entry.creditAllocations[0];
          return (
            <>
              <p className="text-sm text-slate-700">
                {firstAllocation
                  ? walletGrantTypeLabel(firstAllocation.grantType)
                  : entry.sourceType}
              </p>
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

  async function submitAdjustment() {
    if (!account || !canAdjust || parsedAmount === null) return;
    setAdjusting(true);
    setAdjustError(null);
    try {
      const nextDetail = await mutateEnvelope<AdminWalletAccountDetailData>(
        `/api/admin/billing/wallets/${account.id}/adjustments`,
        {
          amount: parsedAmount.toString(),
          grantType: parsedAmount > BigInt(0) ? grantType : "admin_adjustment",
          expiresAt:
            parsedAmount > BigInt(0) && expiresAt ? new Date(expiresAt).toISOString() : null,
          reason,
          idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${account.id}`,
        }
      );
      setAmount("");
      setGrantType("admin_adjustment");
      setExpiresAt("");
      setReason("");
      onAdjusted(nextDetail);
    } catch (err) {
      setAdjustError(toErrorMessage(err));
    } finally {
      setAdjusting(false);
    }
  }

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
          {error ? <ErrorBanner message={error} /> : null}
          <section className="grid gap-2 sm:grid-cols-3">
            <Metric label="可用余额" value={formatInteger(account.availableBalance)} />
            <Metric label="冻结余额" value={formatInteger(account.heldBalance)} />
            <Metric label="流水条数" value={account.ledgerEntryCount} />
          </section>
          <section className="rounded-lg border border-slate-200">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-950">积分批次</h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  用于追踪积分来源、有效期、冻结、消耗和过期。
                </p>
              </div>
              {loading ? <StatusPill tone="muted">加载中</StatusPill> : null}
            </div>
            <div className="max-h-[320px] overflow-auto">
              <DataTable
                columns={grantColumns}
                data={grants}
                minWidth={860}
                emptyLabel="暂无积分批次"
                className="rounded-none border-0"
              />
            </div>
          </section>
          <section className="rounded-lg border border-slate-200">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-3 py-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-950">人工调整</h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  正数发放新批次，负数按可用批次冲回；必须填写审计原因。
                </p>
              </div>
              <IconAdjustments className="mt-0.5 size-4 text-slate-400" />
            </div>
            <div className="grid gap-3 p-3">
              {canAdjust ? (
                <>
                  <div className="grid gap-3 md:grid-cols-[120px_180px_180px_minmax(0,1fr)]">
                    <FormLabel label="积分变动">
                      <TextInput
                        value={amount}
                        inputMode="numeric"
                        placeholder="例如 100 或 -20"
                        onChange={(event) => setAmount(event.target.value)}
                      />
                    </FormLabel>
                    <FormLabel label="来源类型">
                      <Select
                        value={
                          parsedAmount !== null && parsedAmount < BigInt(0)
                            ? "admin_adjustment"
                            : grantType
                        }
                        onChange={setGrantType}
                        title="来源类型"
                      >
                        <option value="admin_adjustment">管理员调整</option>
                        <option value="campaign_reward">活动奖励</option>
                        <option value="check_in_reward">签到奖励</option>
                        <option value="system_grant">系统赠送</option>
                        <option value="other">其他</option>
                      </Select>
                    </FormLabel>
                    <FormLabel label="过期时间">
                      <TextInput
                        type="datetime-local"
                        value={expiresAt}
                        disabled={!isPositiveAdjustment}
                        onChange={(event) => setExpiresAt(event.target.value)}
                      />
                    </FormLabel>
                    <FormLabel label="审计原因">
                      <TextInput
                        value={reason}
                        placeholder="例如 用户补偿、活动发放、纠错扣回"
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </FormLabel>
                  </div>
                  {adjustError ? <ErrorBanner message={adjustError} /> : null}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      disabled={adjusting || parsedAmount === null || !reason.trim()}
                      onClick={() => void submitAdjustment()}
                    >
                      {adjusting ? "提交中" : "提交调整"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-500">
                  仅 active 的算力积分可消费账户支持人工调整。
                </div>
              )}
            </div>
          </section>
          <section className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 px-3 py-2">
              <h4 className="text-sm font-semibold text-slate-950">账户流水</h4>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <DataTable
                columns={ledgerColumns}
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

function parseAdjustmentAmount(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const amount = BigInt(trimmed);
  return amount === BigInt(0) ? null : amount;
}

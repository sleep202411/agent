"use client";

import { useMemo, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ColumnHeader,
  ErrorBanner,
  formatDate,
  formatMoneyMinor,
  InfoTip,
  ledgerJournalTypeHelp,
  ledgerJournalTypeLabel,
  Metric,
  PageHeader,
  providerHelp,
  providerLabel,
  requestEnvelope,
  Select,
  StatusPill,
  TextInput,
  toErrorMessage,
} from "./shared";
import type {
  AdminBillingLedgerJournalsData,
  AdminBillingLedgerOverviewData,
  BillingLedgerJournalRow,
} from "./types";
import { emptyLedgerJournals, emptyLedgerOverview } from "./types";

export function BillingLedgerPanel({
  siteLabel,
  databaseLabel,
  initialLedgerOverview,
  initialLedgerJournals,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialLedgerOverview: AdminBillingLedgerOverviewData | null;
  initialLedgerJournals: AdminBillingLedgerJournalsData | null;
  initialError?: string | null;
}) {
  const [overview, setOverview] = useState(initialLedgerOverview ?? emptyLedgerOverview);
  const [journals, setJournals] = useState(initialLedgerJournals ?? emptyLedgerJournals);
  const [journalType, setJournalType] = useState("");
  const [provider, setProvider] = useState("");
  const [currency, setCurrency] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  function ledgerQueryString() {
    const params = new URLSearchParams();
    if (journalType) params.set("journalType", journalType);
    if (provider) params.set("provider", provider);
    if (currency.trim()) params.set("currency", currency.trim().toUpperCase());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  async function refreshLedger() {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextJournals] = await Promise.all([
        requestEnvelope<AdminBillingLedgerOverviewData>("/api/admin/billing/ledger/overview"),
        requestEnvelope<AdminBillingLedgerJournalsData>(
          `/api/admin/billing/ledger/journals${ledgerQueryString()}`
        ),
      ]);
      setOverview(nextOverview);
      setJournals(nextJournals);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const journalColumns = useMemo<ColumnDef<BillingLedgerJournalRow, unknown>[]>(
    () => [
      {
        accessorKey: "journalNo",
        header: "Journal",
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">
                {journal.journalNo}
              </p>
              <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                {journal.description ?? journal.id}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "journalType",
        header: () => (
          <ColumnHeader help="journal 类型描述资金事件的业务来源，例如支付入账、履约分配、结算或退款。">
            类型
          </ColumnHeader>
        ),
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <>
              <StatusPill tone={journal.status === "posted" ? "success" : "muted"}>
                {ledgerJournalTypeLabel(journal.journalType)}
              </StatusPill>
              <p className="mt-1 text-[11px] text-slate-500">
                {journal.provider ? providerLabel(journal.provider) : "platform"}
              </p>
            </>
          );
        },
      },
      {
        id: "debit",
        header: () => <ColumnHeader help="双分录借方合计，必须等于贷方合计。">借方</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <p className="text-sm font-semibold text-slate-950">
              {formatMoneyMinor(journal.totalDebitMinor, journal.currency)}
            </p>
          );
        },
      },
      {
        id: "credit",
        header: () => <ColumnHeader help="双分录贷方合计，必须等于借方合计。">贷方</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <p className="text-sm font-semibold text-slate-950">
              {formatMoneyMinor(journal.totalCreditMinor, journal.currency)}
            </p>
          );
        },
      },
      {
        id: "source",
        header: "来源",
        enableSorting: false,
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{journal.sourceType}</p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                {journal.sourceId ?? journal.orderId ?? "-"}
              </p>
            </>
          );
        },
      },
      {
        id: "entries",
        header: () => (
          <ColumnHeader help="具体账户分录和账户余额。余额按账户正常方向计算，不是用户积分余额。">
            分录
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <div className="space-y-1.5">
              {journal.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[52px_minmax(170px,1fr)_120px] gap-2 text-[12px]"
                >
                  <span
                    className={cn(
                      "w-fit rounded-full border px-2 py-0.5",
                      entry.direction === "debit"
                        ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-violet-200 bg-violet-50 text-violet-700"
                    )}
                  >
                    {entry.direction === "debit" ? "借" : "贷"}
                  </span>
                  <span className="truncate text-slate-600" title={entry.account.code}>
                    {entry.account.name}
                  </span>
                  <span className="text-right font-mono text-slate-950">
                    {formatMoneyMinor(entry.amountMinor, journal.currency)}
                  </span>
                </div>
              ))}
            </div>
          );
        },
      },
      {
        accessorKey: "postedAt",
        header: "时间",
        cell: ({ row }) => formatDate(row.original.postedAt),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="会计分录"
        description="复式记账分录，每笔资金流动都可追溯到原订单与渠道事件。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="border-b border-slate-200 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">资金双分录账本</h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    支付、履约、退款、结算和收入确认都会沉淀为 append-only journal。
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-[190px_150px_110px_auto]">
                  <Select
                    value={journalType}
                    onChange={setJournalType}
                    title="资金账本 journal 类型。所有资金状态变化都必须以双分录方式入账。"
                  >
                    <option value="">全部分录类型</option>
                    <option
                      value="payment_capture"
                      title={ledgerJournalTypeHelp("payment_capture")}
                    >
                      支付入账
                    </option>
                    <option
                      value="fulfillment_allocation"
                      title={ledgerJournalTypeHelp("fulfillment_allocation")}
                    >
                      履约分配
                    </option>
                    <option value="settlement" title={ledgerJournalTypeHelp("settlement")}>
                      结算
                    </option>
                    <option value="refund" title={ledgerJournalTypeHelp("refund")}>
                      退款
                    </option>
                    <option value="chargeback" title={ledgerJournalTypeHelp("chargeback")}>
                      拒付
                    </option>
                    <option
                      value="revenue_recognition"
                      title={ledgerJournalTypeHelp("revenue_recognition")}
                    >
                      收入确认
                    </option>
                  </Select>
                  <Select
                    value={provider}
                    onChange={setProvider}
                    title="按账务来源渠道过滤。内部发放表示平台承担成本的零元履约或迁移补偿。"
                  >
                    <option value="">全部渠道</option>
                    <option value="airwallex" title={providerHelp("airwallex")}>
                      Airwallex
                    </option>
                    <option value="wechat_pay" title={providerHelp("wechat_pay")}>
                      微信支付
                    </option>
                    <option value="alipay" title={providerHelp("alipay")}>
                      支付宝
                    </option>
                    <option value="manual" title={providerHelp("manual")}>
                      线下确认
                    </option>
                    <option value="internal" title={providerHelp("internal")}>
                      内部发放
                    </option>
                  </Select>
                  <TextInput
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                    className="uppercase"
                    maxLength={3}
                    placeholder="USD"
                  />
                  <Button variant="outline" size="sm" onClick={refreshLedger} disabled={loading}>
                    <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                    应用
                  </Button>
                </div>
              </div>
            </div>
            <DataTable
              columns={journalColumns}
              data={journals.items}
              loading={loading}
              minWidth={1180}
              pageSize={20}
              emptyLabel="暂无资金账本分录"
              className="rounded-none border-0"
            />
          </section>
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-slate-950">账务控制面</h3>
            <InfoTip text="显示总账账户、journal、结算和对账运行的控制指标；这里不直接改余额。" />
          </div>
          <div className="mt-4 grid gap-2">
            <Metric label="活跃账户" value={overview.metrics.activeAccounts} />
            <Metric label="Journal" value={overview.metrics.journalCount} />
            <Metric label="Settlement" value={overview.metrics.settlementCount} />
            <Metric
              label="对账运行中"
              value={overview.metrics.openReconciliationCount}
              tone={overview.metrics.openReconciliationCount ? "risk" : "default"}
            />
          </div>
          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="text-[12px] font-semibold text-slate-500">账户余额</p>
            <div className="mt-3 max-h-[420px] space-y-2 overflow-auto pr-1">
              {overview.accounts.map((account) => (
                <div key={account.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-slate-950">
                      {account.name}
                    </p>
                    <span className="shrink-0 text-[11px] text-slate-500">{account.currency}</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                    {account.code}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">
                    {formatMoneyMinor(account.balanceMinor, account.currency)}
                  </p>
                </div>
              ))}
              {!overview.accounts.length ? (
                <p className="rounded-lg border border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
                  暂无账务账户
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { IconCoin, IconPercentage, IconRefresh, IconReportMoney } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  fetchAdminRevenueEntries,
  fetchAdminOrderRevenueBreakdown,
  updateIpCommerceRevenueShare,
} from "@/lib/admin-ip-commerce-client";
import {
  ErrorBanner,
  formatAmount,
  formatDate,
  formatShareBps,
  PageHeader,
  revenueLedgerEntryTypeLabel,
  revenueLedgerStatusLabel,
  StatusPill,
  toErrorMessage,
} from "./shared";
import type {
  AdminOrderRevenueBreakdownData,
  AdminRevenueEntriesData,
  AdminRevenueEntryRow,
  IpCommerceSettingsData,
  RevenueLedgerEntryStatus,
} from "./types";
import { emptyRevenueEntries } from "./types";
import { OrderRevenueBreakdownDialog } from "./order-revenue-breakdown";

const STATUS_ALL = "__all__";

function statusTone(status: RevenueLedgerEntryStatus): "success" | "warn" | "muted" {
  if (status === "posted") return "success";
  if (status === "pending") return "warn";
  return "muted";
}

export function IpRevenuePanel({
  siteLabel,
  databaseLabel,
  initialSettings,
  initialEntries,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialSettings: IpCommerceSettingsData | null;
  initialEntries: AdminRevenueEntriesData | null;
  initialError: string | null;
}) {
  // Global default creator share editor.
  const initialPercent =
    initialSettings != null ? String(initialSettings.creatorRevenueShareBps / 100) : "";
  const [savedBps, setSavedBps] = useState<number | null>(
    initialSettings?.creatorRevenueShareBps ?? null
  );
  const [sharePercent, setSharePercent] = useState(initialPercent);
  const [savingShare, setSavingShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSaved, setShareSaved] = useState(false);

  // Cross-IP revenue entries observability.
  const [entries, setEntries] = useState(initialEntries ?? emptyRevenueEntries);
  const [ipId, setIpId] = useState("");
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  // Per-order breakdown drilldown.
  const [breakdown, setBreakdown] = useState<AdminOrderRevenueBreakdownData | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);

  function entryQuery(extra?: Record<string, string>) {
    return {
      ...(ipId.trim() ? { ipId: ipId.trim() } : {}),
      ...(userId.trim() ? { userId: userId.trim() } : {}),
      ...(status ? { status } : {}),
      ...extra,
    };
  }

  async function saveShare() {
    const trimmed = sharePercent.trim();
    const percent = Number(trimmed);
    if (trimmed === "" || Number.isNaN(percent) || percent < 0 || percent > 100) {
      setShareError("默认分成比例必须在 0% 到 100% 之间。");
      return;
    }
    setSavingShare(true);
    setShareError(null);
    setShareSaved(false);
    try {
      const result = await updateIpCommerceRevenueShare(Math.round(percent * 100));
      setSavedBps(result.valueInt);
      if (result.valueInt != null) setSharePercent(String(result.valueInt / 100));
      setShareSaved(true);
    } catch (err) {
      setShareError(toErrorMessage(err));
    } finally {
      setSavingShare(false);
    }
  }

  async function refreshEntries() {
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchAdminRevenueEntries(entryQuery()));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreEntries() {
    if (!entries.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await fetchAdminRevenueEntries(entryQuery({ cursor: entries.nextCursor }));
      setEntries((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
      }));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function openBreakdown(orderId: string) {
    setBreakdownLoading(true);
    setBreakdownError(null);
    setBreakdown(null);
    try {
      setBreakdown(await fetchAdminOrderRevenueBreakdown(orderId));
    } catch (err) {
      setBreakdownError(toErrorMessage(err));
    } finally {
      setBreakdownLoading(false);
    }
  }

  const columns = useMemo<ColumnDef<AdminRevenueEntryRow, unknown>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => (
          <p className="text-[12px] text-slate-700">{formatDate(row.original.createdAt)}</p>
        ),
      },
      {
        id: "content",
        header: "IP / 订单",
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <>
              <p className="max-w-[240px] truncate text-sm font-medium text-slate-950">
                {entry.ip?.title ?? "-"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">{entry.orderNo ?? entry.orderId}</p>
            </>
          );
        },
      },
      {
        accessorKey: "userId",
        header: "受益用户",
        cell: ({ row }) => (
          <p className="max-w-[160px] truncate text-sm text-slate-700">{row.original.userId}</p>
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
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <>
              <p className="font-medium text-slate-950">{formatAmount(entry.amount)}</p>
              {entry.sourceAmount ? (
                <p className="mt-0.5 text-[11px] text-slate-500">
                  原始 {formatAmount(entry.sourceAmount)}
                </p>
              ) : null}
            </>
          );
        },
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
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openBreakdown(row.original.orderId)}
            disabled={breakdownLoading}
          >
            订单明细
          </Button>
        ),
      },
    ],
    // openBreakdown is a render-stable closure used only in an onClick; rebuild
    // only when the disabled state flips (matches the other action tables).
    [breakdownLoading]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="创作者收益"
        description="管理平台默认创作者分成比例，并查看全部 IP 的收益分账流水。收益以社区积分计入创作者钱包，暂不开放提现。"
      />
      {error ? <ErrorBanner message={error} /> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2">
          <IconPercentage className="size-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-950">平台默认分成</h3>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-slate-500">
          单部 IP 未单独配置时，创作者按此比例从每笔 IP 售卖中分成。可被单 IP 覆盖。
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="default-share" className="text-[12px] text-slate-600">
              默认创作者分成（%）
            </Label>
            <Input
              id="default-share"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={sharePercent}
              onChange={(event) => {
                setSharePercent(event.target.value);
                setShareSaved(false);
              }}
              placeholder="例如 70"
              className="h-9 w-40"
            />
          </div>
          <Button type="button" size="sm" onClick={() => void saveShare()} disabled={savingShare}>
            <IconCoin className="size-3.5" />
            {savingShare ? "保存中…" : "保存默认比例"}
          </Button>
          <p className="text-[12px] text-slate-500">
            当前生效：{savedBps != null ? formatShareBps(savedBps) : "-"}
          </p>
          {shareSaved ? <p className="text-[12px] text-emerald-600">已保存</p> : null}
        </div>
        {shareError ? <p className="mt-2 text-sm text-red-600">{shareError}</p> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <IconReportMoney className="size-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-950">收益分账流水</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-[160px_160px_130px_auto] lg:min-w-[620px]">
            <Input
              value={ipId}
              onChange={(event) => setIpId(event.target.value)}
              placeholder="IP ID"
              aria-label="按 IP 过滤"
              className="h-9"
            />
            <Input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="受益用户 ID"
              aria-label="按用户过滤"
              className="h-9"
            />
            <Select
              value={status || STATUS_ALL}
              onValueChange={(value) => setStatus(value === STATUS_ALL ? "" : value)}
            >
              <SelectTrigger className="h-9 w-full" aria-label="状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STATUS_ALL}>全部状态</SelectItem>
                <SelectItem value="pending">待结算</SelectItem>
                <SelectItem value="posted">已结算</SelectItem>
                <SelectItem value="voided">已作废</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshEntries()}
              disabled={loading}
            >
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              刷新
            </Button>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={entries.items}
          loading={loading}
          minWidth={1000}
          pageSize={20}
          emptyLabel="暂无收益分账流水"
          className="rounded-none border-0"
        />
        {entries.nextCursor ? (
          <div className="flex justify-center border-t border-slate-200 px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadMoreEntries()}
              disabled={loadingMore}
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </Button>
          </div>
        ) : null}
      </section>

      <OrderRevenueBreakdownDialog
        breakdown={breakdown}
        loading={breakdownLoading}
        error={breakdownError}
        onClose={() => {
          setBreakdown(null);
          setBreakdownError(null);
        }}
      />
    </div>
  );
}

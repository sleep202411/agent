"use client";

import { useMemo, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { useOrderRevenueBreakdown } from "./use-order-revenue-breakdown";
import { IconKey, IconRefresh, IconShoppingBag, IconUserPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  currencyLabel,
  entitlementStatusLabel,
  ErrorBanner,
  formatAmount,
  formatDate,
  orderStatusLabel,
  PageHeader,
  requestEnvelope,
  sourceTypeLabel,
  StatusPill,
  targetTypeLabel,
  toErrorMessage,
} from "./shared";
import type {
  AdminIpEntitlementsData,
  AdminIpOrdersData,
  AdminIpsData,
  IpEntitlementRow,
  IpPurchaseOrderRow,
} from "./types";
import { emptyIpEntitlements, emptyIpOrders, emptyIps } from "./types";
import { OrderRevenueBreakdownDialog } from "./order-revenue-breakdown";

const LOCALE_ALL = "__all__";

export function IpOrdersPanel({
  siteLabel,
  databaseLabel,
  initialOrders,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialOrders: AdminIpOrdersData | null;
  initialError: string | null;
}) {
  const [orders, setOrders] = useState(initialOrders ?? emptyIpOrders);
  const [query, setQuery] = useState("");
  const [locale, setLocale] = useState("");
  const { busy: loading, begin } = useAdminOperation();
  const loadingMore = loading;
  const [error, setError] = useState<string | null>(initialError);
  const {
    data: breakdown,
    loading: breakdownLoading,
    error: breakdownError,
    open: openBreakdown,
    close: closeBreakdown,
  } = useOrderRevenueBreakdown();

  const [loadedParams, setLoadedParams] = useState("limit=30");
  function orderParams(extra?: Record<string, string>) {
    const params = new URLSearchParams({ limit: "30" });
    if (query.trim()) params.set("q", query.trim());
    if (locale) params.set("locale", locale);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) params.set(key, value);
    }
    return params;
  }

  async function refreshOrders() {
    const operation = begin("read");
    if (!operation) return;
    const params = orderParams().toString();
    setError(null);
    try {
      const result = await requestEnvelope<AdminIpOrdersData>(
        `/api/admin/ip-commerce/orders?${params}`,
        { signal: operation.signal }
      );
      if (operation.current()) {
        setOrders(result);
        setLoadedParams(params);
      }
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }
  async function loadMoreOrders() {
    if (!orders.nextCursor) return;
    if (orderParams().toString() !== loadedParams) {
      await refreshOrders();
      return;
    }
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    const params = new URLSearchParams(loadedParams);
    params.set("cursor", orders.nextCursor);
    try {
      const next = await requestEnvelope<AdminIpOrdersData>(
        `/api/admin/ip-commerce/orders?${params}`,
        { signal: operation.signal }
      );
      if (operation.current())
        setOrders((current) => ({
          items: [...current.items, ...next.items],
          nextCursor: next.nextCursor,
        }));
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  const columns = useMemo<ColumnDef<IpPurchaseOrderRow, unknown>[]>(
    () => [
      {
        accessorKey: "orderNo",
        header: "订单",
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="font-medium text-slate-950">{order.orderNo}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{order.id}</p>
            </>
          );
        },
      },
      {
        accessorKey: "userId",
        header: "用户",
        cell: ({ row }) => (
          <p className="max-w-[160px] truncate text-sm text-slate-700">{row.original.userId}</p>
        ),
      },
      {
        id: "content",
        header: "内容",
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="max-w-[260px] truncate text-sm font-medium text-slate-950">
                {order.episode?.title ?? order.ip?.title ?? order.ipId}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {targetTypeLabel(order.targetType)} · {order.entitlementCount ?? 0} 权益
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const order = row.original;
          return (
            <StatusPill tone={order.status === "fulfilled" ? "success" : "muted"}>
              {orderStatusLabel(order.status)}
            </StatusPill>
          );
        },
      },
      {
        accessorKey: "totalAmount",
        header: "金额",
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="font-medium text-slate-950">{formatAmount(order.totalAmount)}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{currencyLabel(order.currency)}</p>
            </>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{formatDate(order.createdAt)}</p>
              <p className="text-[11px] text-slate-500">
                {order.fulfilledAt ? `履约 ${formatDate(order.fulfilledAt)}` : "未履约"}
              </p>
            </>
          );
        },
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
            onClick={() => void openBreakdown(row.original.id)}
            disabled={breakdownLoading}
          >
            查看分账
          </Button>
        ),
      },
    ],
    [breakdownLoading, openBreakdown]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 订单流水"
        description="只展示 IP 内容售卖订单，不混入平台积分购买、退款和钱包总账。财务账本仍归订单积分模块。"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <IconShoppingBag className="size-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-950">订单列表</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_130px_auto] lg:min-w-[520px]">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="订单号、用户、IP"
              aria-label="搜索订单"
              className="h-9"
            />
            <Select
              value={locale || LOCALE_ALL}
              onValueChange={(value) => setLocale(value === LOCALE_ALL ? "" : value)}
            >
              <SelectTrigger className="h-9 w-full" aria-label="语言">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LOCALE_ALL}>默认语言</SelectItem>
                <SelectItem value="zh-CN">简体中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
                <SelectItem value="zh-HK">繁體中文</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshOrders()}
              disabled={loading}
            >
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              刷新
            </Button>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={orders.items}
          loading={loading}
          minWidth={1020}
          pageSize={20}
          emptyLabel="暂无订单流水"
          className="rounded-none border-0"
        />
        {orders.nextCursor ? (
          <div className="flex justify-center border-t border-slate-200 px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadMoreOrders()}
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
        onClose={closeBreakdown}
      />
    </div>
  );
}

export function IpEntitlementsPanel({
  siteLabel,
  databaseLabel,
  initialEntitlements,
  ips,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialEntitlements: AdminIpEntitlementsData | null;
  ips: AdminIpsData | null;
  initialError: string | null;
}) {
  const [entitlements, setEntitlements] = useState(initialEntitlements ?? emptyIpEntitlements);
  const [ipList] = useState(ips ?? emptyIps);
  const [query, setQuery] = useState("");
  const [locale, setLocale] = useState("");
  const { busy: loading, begin } = useAdminOperation();
  const loadingMore = loading;
  const [loadedParams, setLoadedParams] = useState("limit=30");
  const [error, setError] = useState<string | null>(initialError);
  const [userId, setUserId] = useState("");
  const [ipId, setIpId] = useState("");
  const [targetType, setTargetType] = useState<"ip" | "episode">("ip");
  const [episodeId, setEpisodeId] = useState("");
  const [reason, setReason] = useState("运营补发权益。");
  const canGrant = Boolean(
    userId.trim() &&
    ipId.trim() &&
    reason.trim() &&
    (targetType === "ip" || episodeId.trim()) &&
    !loading
  );

  function entitlementParams(extra?: Record<string, string>) {
    const params = new URLSearchParams({ limit: "30" });
    if (query.trim()) params.set("q", query.trim());
    if (locale) params.set("locale", locale);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) params.set(key, value);
    }
    return params;
  }

  const readEntitlements = (params: string, signal: AbortSignal) =>
    requestEnvelope<AdminIpEntitlementsData>(`/api/admin/ip-commerce/entitlements?${params}`, {
      signal,
    });
  async function refreshEntitlements() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    const params = entitlementParams().toString();
    try {
      const next = await readEntitlements(params, operation.signal);
      if (operation.current()) {
        setEntitlements(next);
        setLoadedParams(params);
      }
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }
  async function loadMoreEntitlements() {
    if (!entitlements.nextCursor) return;
    if (entitlementParams().toString() !== loadedParams) {
      await refreshEntitlements();
      return;
    }
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    const params = new URLSearchParams(loadedParams);
    params.set("cursor", entitlements.nextCursor);
    try {
      const next = await readEntitlements(params.toString(), operation.signal);
      if (operation.current())
        setEntitlements((current) => ({
          items: [...current.items, ...next.items],
          nextCursor: next.nextCursor,
        }));
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function grantEntitlement() {
    if (!canGrant) return;
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      await requestEnvelope<unknown>("/api/admin/ip-commerce/entitlements/grants", {
        method: "POST",
        signal: operation.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: userId.trim(),
          ipId: ipId.trim(),
          targetType,
          episodeId: targetType === "episode" ? episodeId.trim() : undefined,
          reason: reason.trim(),
        }),
      });
      if (!operation.current()) return;
      const params = entitlementParams().toString();
      const next = await readEntitlements(params, operation.signal);
      if (operation.current()) {
        setEntitlements(next);
        setLoadedParams(params);
      }
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function revokeEntitlement(entitlementId: string) {
    const operation = begin();
    if (!operation) return;
    setError(null);
    let accepted = false;
    try {
      await requestEnvelope<unknown>(
        `/api/admin/ip-commerce/entitlements/${encodeURIComponent(entitlementId)}/revoke`,
        {
          method: "PATCH",
          signal: operation.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "运营手动撤销 IP 权益。" }),
        }
      );
      accepted = true;
      if (!operation.current()) return;
      const params = entitlementParams().toString();
      const next = await readEntitlements(params, operation.signal);
      if (operation.current()) {
        setEntitlements(next);
        setLoadedParams(params);
      }
    } catch (err) {
      if (operation.current()) {
        setError(toErrorMessage(err));
        // An accepted revoke must not remain retryable because its read failed.
        if (!accepted) throw err;
      }
    } finally {
      operation.finish();
    }
  }

  const columns: ColumnDef<IpEntitlementRow, unknown>[] = [
    {
      id: "content",
      header: "内容",
      enableSorting: false,
      cell: ({ row }) => {
        const entitlement = row.original;
        return (
          <>
            <p className="max-w-[260px] truncate text-sm font-medium text-slate-950">
              {entitlement.episode?.title ?? entitlement.ip?.title ?? entitlement.ipId}
            </p>
            <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-slate-500">
              {entitlement.userId} · {targetTypeLabel(entitlement.targetType)} ·{" "}
              {entitlement.sourceOrderNo ?? sourceTypeLabel(entitlement.sourceType)}
            </p>
          </>
        );
      },
    },
    {
      accessorKey: "startsAt",
      header: "有效期",
      cell: ({ row }) => {
        const entitlement = row.original;
        return (
          <p className="text-[12px] text-slate-700">
            {formatDate(entitlement.startsAt)}
            {entitlement.endsAt ? ` - ${formatDate(entitlement.endsAt)}` : " - 长期"}
          </p>
        );
      },
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => {
        const entitlement = row.original;
        return (
          <StatusPill tone={entitlement.status === "active" ? "success" : "muted"}>
            {entitlementStatusLabel(entitlement.status)}
          </StatusPill>
        );
      },
    },
    {
      id: "actions",
      header: "操作",
      enableSorting: false,
      meta: { pin: "right" },
      cell: ({ row }) => {
        const entitlement = row.original;
        if (entitlement.status !== "active") return null;
        return (
          <ConfirmDialog
            destructive
            title="确认吊销该权益？"
            description="吊销后该用户将失去对应内容的访问权限。"
            confirmLabel="确认吊销"
            onConfirm={() => revokeEntitlement(entitlement.id)}
            trigger={
              <Button variant="destructive" size="sm" disabled={loading}>
                吊销
              </Button>
            }
          />
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 权益"
        description="管理用户对 IP 或单集的访问权益，支持客服补发和运营撤销。所有动作由后端写入审计。"
      />
      {error ? <ErrorBanner message={error} /> : null}

      <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <IconKey className="size-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-950">权益列表</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_130px_auto] lg:min-w-[520px]">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="用户、IP、订单"
                aria-label="搜索权益"
                className="h-9"
              />
              <Select
                value={locale || LOCALE_ALL}
                onValueChange={(value) => setLocale(value === LOCALE_ALL ? "" : value)}
              >
                <SelectTrigger className="h-9 w-full" aria-label="语言">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={LOCALE_ALL}>默认语言</SelectItem>
                  <SelectItem value="zh-CN">简体中文</SelectItem>
                  <SelectItem value="en-US">English</SelectItem>
                  <SelectItem value="zh-HK">繁體中文</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refreshEntitlements()}
                disabled={loading}
              >
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                刷新
              </Button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={entitlements.items}
            loading={loading}
            minWidth={640}
            pageSize={20}
            emptyLabel="暂无权益记录"
            className="rounded-none border-0"
          />
          {entitlements.nextCursor ? (
            <div className="flex justify-center border-t border-slate-200 px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMoreEntitlements()}
                disabled={loadingMore}
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <IconUserPlus className="size-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-950">补发权益</h3>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            用于客服补偿、人工恢复和运营白名单。补发原因必须可审计。
          </p>
          <div inert={loading} className="mt-3 grid gap-2">
            <div className="grid gap-1">
              <Label htmlFor="grant-user-id" className="text-[12px] text-slate-600">
                用户 ID
              </Label>
              <Input
                id="grant-user-id"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="用户 ID"
                className="h-9"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="grant-ip-id" className="text-[12px] text-slate-600">
                IP ID
              </Label>
              <Input
                id="grant-ip-id"
                value={ipId}
                onChange={(event) => setIpId(event.target.value)}
                placeholder="IP ID"
                list="admin-ip-id-list"
                className="h-9"
              />
              <datalist id="admin-ip-id-list">
                {ipList.items.map((ip) => (
                  <option key={ip.id} value={ip.id}>
                    {ip.roomNumber} · {ip.title}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="grant-target-type" className="text-[12px] text-slate-600">
                授权范围
              </Label>
              <Select
                value={targetType}
                onValueChange={(value) => setTargetType(value as "ip" | "episode")}
              >
                <SelectTrigger id="grant-target-type" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ip">整部 IP</SelectItem>
                  <SelectItem value="episode">单集</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="grant-episode-id" className="text-[12px] text-slate-600">
                Episode ID
              </Label>
              <Input
                id="grant-episode-id"
                value={episodeId}
                onChange={(event) => setEpisodeId(event.target.value)}
                placeholder="Episode ID（单集必填）"
                disabled={targetType === "ip"}
                className="h-9"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="grant-reason" className="text-[12px] text-slate-600">
                补发原因
              </Label>
              <Input
                id="grant-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="补发原因"
                className="h-9"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => void grantEntitlement()}
              disabled={!canGrant}
            >
              <IconKey className="size-3.5" />
              补发权益
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

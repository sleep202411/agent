"use client";

import { useState } from "react";
import { IconKey, IconRefresh, IconShoppingBag, IconUserPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  currencyLabel,
  EmptyRow,
  entitlementStatusLabel,
  ErrorBanner,
  formatAmount,
  formatDate,
  InputLike,
  orderStatusLabel,
  PageHeader,
  requestEnvelope,
  Select,
  sourceTypeLabel,
  StatusPill,
  targetTypeLabel,
  Td,
  Th,
  toErrorMessage,
} from "./shared";
import type { AdminIpEntitlementsData, AdminIpOrdersData, AdminIpsData } from "./types";
import { emptyIpEntitlements, emptyIpOrders, emptyIps } from "./types";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function refreshOrders() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (query.trim()) params.set("q", query.trim());
      if (locale) params.set("locale", locale);
      setOrders(
        await requestEnvelope<AdminIpOrdersData>(
          `/api/admin/ip-commerce/orders?${params.toString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

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
            <InputLike value={query} onChange={setQuery} placeholder="订单号、用户、IP" />
            <Select value={locale} onChange={setLocale} aria-label="语言">
              <option value="">默认语言</option>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
              <option value="zh-HK">繁體中文</option>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <Th>订单</Th>
                <Th>用户</Th>
                <Th>内容</Th>
                <Th>状态</Th>
                <Th>金额</Th>
                <Th>时间</Th>
              </tr>
            </thead>
            <tbody>
              {orders.items.map((order) => (
                <tr key={order.id}>
                  <Td>
                    <p className="font-medium text-slate-950">{order.orderNo}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{order.id}</p>
                  </Td>
                  <Td>
                    <p className="max-w-[160px] truncate text-sm text-slate-700">{order.userId}</p>
                  </Td>
                  <Td>
                    <p className="max-w-[260px] truncate text-sm font-medium text-slate-950">
                      {order.episode?.title ?? order.ip?.title ?? order.ipId}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {targetTypeLabel(order.targetType)} · {order.entitlementCount ?? 0} 权益
                    </p>
                  </Td>
                  <Td>
                    <StatusPill tone={order.status === "fulfilled" ? "success" : "muted"}>
                      {orderStatusLabel(order.status)}
                    </StatusPill>
                  </Td>
                  <Td>
                    <p className="font-medium text-slate-950">{formatAmount(order.totalAmount)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {currencyLabel(order.currency)}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-[12px] text-slate-700">{formatDate(order.createdAt)}</p>
                    <p className="text-[11px] text-slate-500">
                      {order.fulfilledAt ? `履约 ${formatDate(order.fulfilledAt)}` : "未履约"}
                    </p>
                  </Td>
                </tr>
              ))}
              {!orders.items.length ? <EmptyRow colSpan={6} label="暂无订单流水" /> : null}
            </tbody>
          </table>
        </div>
      </section>
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
  const [loading, setLoading] = useState(false);
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

  async function refreshEntitlements() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (query.trim()) params.set("q", query.trim());
      if (locale) params.set("locale", locale);
      setEntitlements(
        await requestEnvelope<AdminIpEntitlementsData>(
          `/api/admin/ip-commerce/entitlements?${params.toString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function grantEntitlement() {
    if (!canGrant) return;
    setLoading(true);
    setError(null);
    try {
      await requestEnvelope<unknown>("/api/admin/ip-commerce/entitlements/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: userId.trim(),
          ipId: ipId.trim(),
          targetType,
          episodeId: targetType === "episode" ? episodeId.trim() : undefined,
          reason: reason.trim(),
        }),
      });
      await refreshEntitlements();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function revokeEntitlement(entitlementId: string) {
    setLoading(true);
    setError(null);
    try {
      await requestEnvelope<unknown>(
        `/api/admin/ip-commerce/entitlements/${encodeURIComponent(entitlementId)}/revoke`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "运营手动撤销 IP 权益。" }),
        }
      );
      await refreshEntitlements();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

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
              <InputLike value={query} onChange={setQuery} placeholder="用户、IP、订单" />
              <Select value={locale} onChange={setLocale} aria-label="语言">
                <option value="">默认语言</option>
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
                <option value="zh-HK">繁體中文</option>
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
          <div className="divide-y divide-slate-100">
            {entitlements.items.map((entitlement) => (
              <div
                key={entitlement.id}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-950">
                    {entitlement.episode?.title ?? entitlement.ip?.title ?? entitlement.ipId}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-slate-500">
                    {entitlement.userId} · {targetTypeLabel(entitlement.targetType)} ·{" "}
                    {entitlement.sourceOrderNo ?? sourceTypeLabel(entitlement.sourceType)}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {formatDate(entitlement.startsAt)}
                    {entitlement.endsAt ? ` - ${formatDate(entitlement.endsAt)}` : " - 长期"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusPill tone={entitlement.status === "active" ? "success" : "muted"}>
                    {entitlementStatusLabel(entitlement.status)}
                  </StatusPill>
                  {entitlement.status === "active" ? (
                    <button
                      type="button"
                      onClick={() => void revokeEntitlement(entitlement.id)}
                      disabled={loading}
                      className="mt-2 block rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      撤销
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {!entitlements.items.length ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">暂无权益记录</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <IconUserPlus className="size-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-950">补发权益</h3>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            用于客服补偿、人工恢复和运营白名单。补发原因必须可审计。
          </p>
          <div className="mt-3 grid gap-2">
            <InputLike value={userId} onChange={setUserId} placeholder="用户 ID" />
            <InputLike
              value={ipId}
              onChange={setIpId}
              placeholder="IP ID"
              list="admin-ip-id-list"
            />
            <datalist id="admin-ip-id-list">
              {ipList.items.map((ip) => (
                <option key={ip.id} value={ip.id}>
                  {ip.title}
                </option>
              ))}
            </datalist>
            <Select
              value={targetType}
              onChange={(value) => setTargetType(value as "ip" | "episode")}
            >
              <option value="ip">整部 IP</option>
              <option value="episode">单集</option>
            </Select>
            <InputLike
              value={episodeId}
              onChange={setEpisodeId}
              placeholder="Episode ID（单集必填）"
              disabled={targetType === "ip"}
            />
            <InputLike value={reason} onChange={setReason} placeholder="补发原因" />
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

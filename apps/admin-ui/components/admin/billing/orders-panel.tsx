"use client";

import { useMemo, useState } from "react";
import { IconRefresh, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ColumnHeader,
  ErrorBanner,
  formatDate,
  formatMoneyMinor,
  OrderStatusPill,
  PageHeader,
  providerHelp,
  providerLabel,
  requestEnvelope,
  Select,
  TextInput,
  toErrorMessage,
} from "./shared";
import type { AdminBillingOrdersData, BillingOrderRow } from "./types";

const emptyOrders: AdminBillingOrdersData = { items: [], nextCursor: null };

export function BillingOrdersPanel({
  siteLabel,
  databaseLabel,
  initialOrders,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialOrders: AdminBillingOrdersData | null;
  initialError?: string | null;
}) {
  const [orders, setOrders] = useState(initialOrders ?? emptyOrders);
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  function orderQueryString() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (provider) params.set("provider", provider);
    if (query.trim()) params.set("q", query.trim());
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  async function refreshOrders() {
    setLoading(true);
    setError(null);
    try {
      setOrders(
        await requestEnvelope<AdminBillingOrdersData>(
          `/api/admin/billing/orders${orderQueryString()}`
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
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="订单"
        description="所有商品订单、支付状态与履约结果。"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <OrdersView
        orders={orders.items}
        status={status}
        provider={provider}
        query={query}
        loading={loading}
        onStatusChange={setStatus}
        onProviderChange={setProvider}
        onQueryChange={setQuery}
        onRefresh={() => void refreshOrders()}
      />
    </div>
  );
}

function OrdersView({
  orders,
  status,
  provider,
  query,
  loading,
  onStatusChange,
  onProviderChange,
  onQueryChange,
  onRefresh,
}: {
  orders: BillingOrderRow[];
  status: string;
  provider: string;
  query: string;
  loading: boolean;
  onStatusChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const columns = useMemo<ColumnDef<BillingOrderRow, unknown>[]>(
    () => [
      {
        accessorKey: "orderNo",
        header: "订单",
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">{order.orderNo}</p>
              <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                {order.idempotencyKey}
              </p>
            </>
          );
        },
      },
      {
        id: "item",
        header: "商品",
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{order.item.name}</p>
              <p className="text-[12px] text-slate-500">
                {order.item.code} · {order.orderType}
              </p>
            </>
          );
        },
      },
      {
        id: "amount",
        header: "金额",
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {formatMoneyMinor(order.amountMinor, order.currency)}
              </p>
              <p className="text-[12px] text-slate-500">
                {order.refundedAmountMinor !== "0"
                  ? `已退 ${formatMoneyMinor(order.refundedAmountMinor, order.currency)}`
                  : order.discountAmountMinor !== "0"
                    ? `原价 ${formatMoneyMinor(order.subtotalAmountMinor, order.currency)}`
                    : `x ${order.quantity}`}
              </p>
            </>
          );
        },
      },
      {
        id: "provider",
        header: () => (
          <ColumnHeader help="实际支付或履约来源；优惠码/兑换码会体现在折扣和订单履约，不作为渠道。">
            支付渠道
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{providerLabel(order.provider)}</p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                {order.paymentIntent?.providerStatus ?? "-"}
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
            <>
              <OrderStatusPill status={order.status} />
              <p className="mt-1 text-[11px] text-slate-500">
                {order.paymentIntent?.status ?? "no_intent"}
              </p>
            </>
          );
        },
      },
      {
        id: "user",
        header: "用户/主体",
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="max-w-[180px] truncate text-[12px] text-slate-700">{order.userId}</p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                {order.subjectType}:{order.subjectId}
              </p>
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
    ],
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_160px_150px_auto]">
          <label className="relative block">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="pl-9 pr-3"
              placeholder="搜索订单号、用户、主体"
            />
          </label>
          <Select value={status} onChange={onStatusChange}>
            <option value="">全部状态</option>
            <option value="pending_payment">待支付</option>
            <option value="paid">已支付</option>
            <option value="fulfilled">已履约</option>
            <option value="failed">失败</option>
            <option value="refunded">已退款</option>
            <option value="partially_refunded">部分退款</option>
          </Select>
          <Select
            value={provider}
            onChange={onProviderChange}
            title="订单支付渠道。线下确认表示后台确认的线下收款；兑换码会显示为促销抵扣，不是渠道。"
          >
            <option value="">全部渠道</option>
            <option value="airwallex" title={providerHelp("airwallex")}>
              Airwallex
            </option>
            <option value="wechat_pay" title={providerHelp("wechat_pay")}>
              微信支付
            </option>
            <option value="manual" title={providerHelp("manual")}>
              线下确认
            </option>
          </Select>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            应用
          </Button>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={orders}
        loading={loading}
        minWidth={1140}
        pageSize={20}
        emptyLabel="暂无订单"
        className="rounded-none border-0"
      />
    </section>
  );
}

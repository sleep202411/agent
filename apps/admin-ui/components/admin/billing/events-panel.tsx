"use client";

import { useAdminOperation } from "../use-admin-operation";

// 支付事件 page for the /billing sub-app. Moved AS-IS from
// ProviderEventsView/PayloadLine (admin-billing-panel.tsx:2760/3077) during the
// P2 per-page split. The view's controlled props became local state + handlers
// so this page owns its own filters, refresh, reprocess and ignore actions.

import { useCallback, useMemo, useState } from "react";
import { IconCircleCheck, IconRefresh, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ColumnHeader,
  ErrorBanner,
  formatDate,
  ledgerJournalTypeLabel,
  mutateEnvelope,
  orderStatusLabel,
  PageHeader,
  PayloadLine,
  ProviderEventStatusPill,
  providerHelp,
  providerLabel,
  refundStatusLabel,
  requestEnvelope,
  Select,
  StatusPill,
  TextInput,
  toErrorMessage,
} from "./shared";
import type { AdminBillingProviderEventsData, BillingProviderEventRow } from "./types";

const emptyProviderEvents: AdminBillingProviderEventsData = {
  items: [],
  nextCursor: null,
};

export function BillingEventsPanel({
  siteLabel,
  databaseLabel,
  initialProviderEvents,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialProviderEvents: AdminBillingProviderEventsData | null;
  initialError?: string | null;
}) {
  const [providerEvents, setProviderEvents] = useState(
    initialProviderEvents ?? emptyProviderEvents
  );
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [eventType, setEventType] = useState("");
  const [query, setQuery] = useState("");
  const [ignoreReasons, setIgnoreReasons] = useState<Record<string, string>>({});
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError ?? null);

  const providerEventQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (provider) params.set("provider", provider);
    if (eventType.trim()) params.set("eventType", eventType.trim());
    if (query.trim()) params.set("q", query.trim());
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [status, provider, eventType, query]);

  const loadEvents = useCallback(
    (signal: AbortSignal) =>
      requestEnvelope<AdminBillingProviderEventsData>(
        `/api/admin/billing/provider-events${providerEventQueryString}`,
        signal
      ),
    [providerEventQueryString]
  );
  async function refreshProviderEvents() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const data = await loadEvents(operation.signal);
      if (operation.current()) setProviderEvents(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }
  const handleReprocessProviderEvent = useCallback(
    async (eventId: string) => {
      const operation = begin();
      if (!operation) return;
      setError(null);
      try {
        await mutateEnvelope(
          `/api/admin/billing/provider-events/${eventId}/reprocess`,
          {},
          "POST",
          operation.signal
        );
        if (!operation.current()) return;
        const data = await loadEvents(operation.signal);
        if (operation.current()) setProviderEvents(data);
      } catch (err) {
        if (operation.current()) setError(toErrorMessage(err));
      } finally {
        operation.finish();
      }
    },
    [begin, loadEvents]
  );
  const handleIgnoreProviderEvent = useCallback(
    async (eventId: string) => {
      const operation = begin();
      if (!operation) return;
      try {
        const reason = ignoreReasons[eventId]?.trim();
        if (!reason) {
          setError("请输入忽略原因。");
          return;
        }
        setError(null);
        await mutateEnvelope(
          `/api/admin/billing/provider-events/${eventId}/ignore`,
          { reason },
          "POST",
          operation.signal
        );
        if (!operation.current()) return;
        setIgnoreReasons((current) => {
          const next = { ...current };
          if (current[eventId]?.trim() === reason) delete next[eventId];
          return next;
        });
        const data = await loadEvents(operation.signal);
        if (operation.current()) setProviderEvents(data);
      } catch (err) {
        if (operation.current()) setError(toErrorMessage(err));
      } finally {
        operation.finish();
      }
    },
    [begin, ignoreReasons, loadEvents]
  );

  const columns = useMemo<ColumnDef<BillingProviderEventRow, unknown>[]>(
    () => [
      {
        id: "event",
        header: () => (
          <ColumnHeader help="供应商事件 ID 是 webhook 幂等键，同一个事件只能处理一次。">
            事件
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{providerLabel(event.provider)}</p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-700">{event.eventType}</p>
              <p
                className="mt-0.5 max-w-[260px] truncate font-mono text-[11px] text-slate-500"
                title={event.providerEventId}
              >
                {event.providerEventId}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: () => (
          <ColumnHeader help="received 表示已入库待处理，failed 表示处理异常已保留，ignored 表示人工关闭。">
            状态
          </ColumnHeader>
        ),
        cell: ({ row }) => {
          const event = row.original;
          return (
            <>
              <ProviderEventStatusPill status={event.status} />
              <p className="mt-1 text-[11px] text-slate-500">
                {event.processedAt ? `处理 ${formatDate(event.processedAt)}` : "待处理"}
              </p>
            </>
          );
        },
      },
      {
        id: "business",
        header: () => (
          <ColumnHeader help="事件匹配到的内部订单、payment intent 或退款记录。">
            关联业务
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <>
              {event.order ? (
                <>
                  <p className="font-mono text-[12px] font-medium text-slate-950">
                    {event.order.orderNo}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {orderStatusLabel(event.order.status)} · {event.order.userId}
                  </p>
                </>
              ) : (
                <p className="text-[12px] text-slate-500">未匹配订单</p>
              )}
              {event.refund ? (
                <p className="mt-1 text-[12px] text-slate-700">
                  退款 {event.refund.refundNo} · {refundStatusLabel(event.refund.status)}
                </p>
              ) : null}
              {event.paymentIntent ? (
                <p
                  className="mt-1 max-w-[220px] truncate font-mono text-[11px] text-slate-500"
                  title={event.paymentIntent.providerPaymentIntentId ?? event.paymentIntent.id}
                >
                  PI {event.paymentIntent.providerStatus ?? event.paymentIntent.status}
                </p>
              ) : null}
            </>
          );
        },
      },
      {
        id: "payload",
        header: () => (
          <ColumnHeader help="供应商 payload 中关键定位字段，便于和 Airwallex 后台交叉检索。">
            Payload 摘要
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <div className="space-y-1 text-[12px] text-slate-700">
              <PayloadLine label="data" value={event.payloadSummary?.dataId} />
              <PayloadLine label="status" value={event.payloadSummary?.dataStatus} />
              <PayloadLine label="checkout" value={event.payloadSummary?.billingCheckoutId} />
              <PayloadLine label="request" value={event.payloadSummary?.requestId} />
              <PayloadLine
                label="refund"
                value={event.payloadSummary?.refundId ?? event.refund?.providerRefundId}
              />
            </div>
          );
        },
      },
      {
        id: "error",
        header: () => <ColumnHeader help="处理失败原因或人工忽略原因。">异常/原因</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <p
              className={cn(
                "max-w-[260px] text-[12px] leading-5",
                event.status === "failed" ? "text-red-700" : "text-slate-600"
              )}
              title={event.error ?? undefined}
            >
              {event.error ?? "-"}
            </p>
          );
        },
      },
      {
        id: "ledger",
        header: () => (
          <ColumnHeader help="事件触发的账务 journal；支付、履约、退款都必须可追溯。">
            账务
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <div className="space-y-1">
              {event.ledgerJournals.map((journal) => (
                <p key={journal.id} className="text-[12px] text-slate-700">
                  {ledgerJournalTypeLabel(journal.journalType)} · {journal.journalNo}
                </p>
              ))}
              {!event.ledgerJournals.length ? (
                <p className="text-[12px] text-slate-500">无 journal</p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "receivedAt",
        header: "时间",
        cell: ({ row }) => {
          const event = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{formatDate(event.receivedAt)}</p>
              <p className="text-[11px] text-slate-500">接收</p>
            </>
          );
        },
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => {
          const event = row.original;
          const canOperate = event.status !== "processed";
          return canOperate ? (
            <div className="grid min-w-[230px] gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void handleReprocessProviderEvent(event.id)}
              >
                <IconRefresh className="size-3.5" />
                重放
              </Button>
              <TextInput
                disabled={loading}
                value={ignoreReasons[event.id] ?? ""}
                onChange={(inputEvent) =>
                  setIgnoreReasons((current) => ({
                    ...current,
                    [event.id]: inputEvent.target.value,
                  }))
                }
                placeholder="忽略原因"
                title="忽略会写入审计。只用于确认无需再处理的重复、测试或无法匹配事件。"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void handleIgnoreProviderEvent(event.id)}
              >
                <IconCircleCheck className="size-3.5" />
                忽略
              </Button>
            </div>
          ) : (
            <StatusPill tone="success">已完成</StatusPill>
          );
        },
      },
    ],
    [loading, ignoreReasons, handleReprocessProviderEvent, handleIgnoreProviderEvent]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="支付事件"
        description="Airwallex / 微信支付回调事件，可重处理或忽略。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">支付供应商事件</h3>
              <p className="mt-1 text-[12px] text-slate-500">
                Webhook 接收、处理、失败和人工补偿入口集中在这里。
              </p>
            </div>
            <div className="grid gap-2 xl:grid-cols-[minmax(220px,1fr)_145px_150px_210px_auto]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <TextInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9 pr-3"
                  placeholder="搜索 event id、订单号、退款号、错误"
                />
              </label>
              <Select
                value={status}
                onChange={setStatus}
                title="provider event 当前处理状态。failed/ignored 需要运营确认是否重放或关闭。"
              >
                <option value="">全部状态</option>
                <option value="received">已接收</option>
                <option value="processed">已处理</option>
                <option value="ignored">已忽略</option>
                <option value="failed">失败</option>
              </Select>
              <Select
                value={provider}
                onChange={setProvider}
                title="支付供应商。国际站当前为 Airwallex，中国站使用微信支付或支付宝。"
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
              </Select>
              <TextInput
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
                placeholder="event type"
                title="按供应商事件类型过滤，例如 billing_checkout.completed、payment_intent.succeeded、refund.settled。"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshProviderEvents()}
                disabled={loading}
              >
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                应用
              </Button>
            </div>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={providerEvents.items}
          loading={loading}
          minWidth={1360}
          pageSize={20}
          emptyLabel="暂无支付供应商事件"
          className="rounded-none border-0"
        />
      </section>
    </div>
  );
}

"use client";

// 退款 page for the /billing sub-app. Extracted AS-IS from RefundsView /
// RefundQuotePanel (admin-billing-panel.tsx:2364/2665) during the P2 per-page
// split. The quote -> create flow, money cells, status pills, and benefit-impact
// display are preserved verbatim; only the surrounding state/handlers (formerly
// owned by AdminBillingPanel) are inlined here so the page is self-contained.

import { useMemo, useState } from "react";
import { IconReceiptRefund, IconRefresh, IconScale, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  buildRefundCreatePayload,
  buildRefundQuotePayload,
  ColumnHeader,
  ErrorBanner,
  FormLabel,
  formatDate,
  formatMoneyMinor,
  mutateEnvelope,
  PageHeader,
  RefundQuotePanel,
  RefundStatusPill,
  requestEnvelope,
  Select,
  stringField,
  TextInput,
  toErrorMessage,
  walletCurrencyLabel,
} from "./shared";
import type { AdminBillingRefundsData, BillingRefundQuoteData, BillingRefundRow } from "./types";

const emptyRefunds: AdminBillingRefundsData = { items: [], nextCursor: null };

export function BillingRefundsPanel({
  siteLabel,
  databaseLabel,
  initialRefunds,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialRefunds: AdminBillingRefundsData | null;
  initialError?: string | null;
}) {
  const [refunds, setRefunds] = useState(initialRefunds ?? emptyRefunds);
  const [refundQuote, setRefundQuote] = useState<BillingRefundQuoteData | null>(null);
  const [refundStatus, setRefundStatus] = useState("");
  const [refundProvider, setRefundProvider] = useState("");
  const [refundQuery, setRefundQuery] = useState("");
  const [refundMode, setRefundMode] = useState("suggested");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const canSubmitRefund = Boolean(refundQuote && refundQuote.blockers.length === 0);

  function refundQueryString() {
    const params = new URLSearchParams();
    if (refundStatus) params.set("status", refundStatus);
    if (refundProvider) params.set("provider", refundProvider);
    if (refundQuery.trim()) params.set("q", refundQuery.trim());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  async function refreshRefunds() {
    setLoading(true);
    setError(null);
    try {
      setRefunds(
        await requestEnvelope<AdminBillingRefundsData>(
          `/api/admin/billing/refunds${refundQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleQuoteRefund(formElement: HTMLFormElement) {
    setLoading(true);
    setError(null);
    try {
      const quote = await mutateEnvelope<BillingRefundQuoteData>(
        "/api/admin/billing/refunds/quote",
        buildRefundQuotePayload(new FormData(formElement))
      );
      setRefundQuote(quote);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRefund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const payload = buildRefundCreatePayload(form, refundQuote);
      await mutateEnvelope("/api/admin/billing/refunds", {
        ...payload,
        idempotencyKey:
          stringField(form, "idempotencyKey") ||
          (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `refund-${Date.now()}`),
      });
      event.currentTarget.reset();
      setRefundQuote(null);
      await refreshRefunds();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const columns = useMemo<ColumnDef<BillingRefundRow, unknown>[]>(
    () => [
      {
        accessorKey: "refundNo",
        header: "退款",
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">{refund.refundNo}</p>
              <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                {refund.providerRefundId ?? refund.requestId}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "orderNo",
        header: "订单",
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">{refund.orderNo}</p>
              <p className="text-[12px] text-slate-500">
                {refund.order.item.name} · {refund.order.userId}
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
          const refund = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {formatMoneyMinor(refund.amountMinor, refund.currency)}
              </p>
              <p className="text-[12px] text-slate-500">{refund.reasonCode}</p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: () => (
          <ColumnHeader help="内部状态决定是否已记账；provider 状态保留 Airwallex/微信原始状态。">
            状态
          </ColumnHeader>
        ),
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <RefundStatusPill status={refund.status} />
              <p className="mt-1 text-[11px] text-slate-500">
                {refund.providerStatus ?? "provider_pending"}
              </p>
            </>
          );
        },
      },
      {
        id: "reversal",
        header: () => (
          <ColumnHeader help="已履约订单退款前会先冲回可用积分或撤销会员权益，避免退款后权益仍可消费。">
            权益冲回
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">
                {refund.walletReversalAmount
                  ? `${walletCurrencyLabel(refund.walletReversalCurrency)} -${refund.walletReversalAmount}`
                  : refund.entitlementGrantId
                    ? "会员权益已撤销"
                    : "无虚拟权益"}
              </p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                {refund.walletTransactionId ?? refund.entitlementGrantId ?? "-"}
              </p>
            </>
          );
        },
      },
      {
        id: "failure",
        header: "失败原因",
        enableSorting: false,
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="max-w-[240px] truncate text-[12px] text-slate-700">
                {refund.failureMessage ?? refund.operatorNote ?? "-"}
              </p>
              <p className="text-[11px] text-slate-500">{refund.failureCode ?? "-"}</p>
            </>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{formatDate(refund.createdAt)}</p>
              <p className="text-[11px] text-slate-500">
                {refund.succeededAt
                  ? `成功 ${formatDate(refund.succeededAt)}`
                  : refund.failedAt
                    ? `失败 ${formatDate(refund.failedAt)}`
                    : "未完成"}
              </p>
            </>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="退款"
        description="后台发起的退款评估与提交，含可退金额与权益冲回计算。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-200 p-4">
            <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_170px_150px_auto]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <TextInput
                  value={refundQuery}
                  onChange={(event) => setRefundQuery(event.target.value)}
                  className="pl-9 pr-3"
                  placeholder="搜索退款号、订单号、用户"
                />
              </label>
              <Select value={refundStatus} onChange={setRefundStatus}>
                <option value="">全部状态</option>
                <option value="requested">已请求</option>
                <option value="provider_pending">渠道处理中</option>
                <option value="succeeded">成功</option>
                <option value="failed">失败</option>
                <option value="canceled">已取消</option>
              </Select>
              <Select value={refundProvider} onChange={setRefundProvider}>
                <option value="">全部渠道</option>
                <option value="airwallex">Airwallex</option>
                <option value="wechat_pay">微信支付</option>
                <option value="alipay">支付宝</option>
                <option value="manual">线下确认</option>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshRefunds()}
                disabled={loading}
              >
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                应用
              </Button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={refunds.items}
            loading={loading}
            minWidth={1180}
            pageSize={20}
            emptyLabel="暂无退款"
            className="rounded-none border-0"
          />
        </section>

        <section className="h-fit rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-950">创建退款</h3>
            <p className="mt-1 text-[12px] leading-5 text-slate-500">
              退款不开放给前台用户；先评估政策，再提交到支付供应商。
            </p>
          </div>
          <form className="space-y-3" onSubmit={handleCreateRefund}>
            <FormLabel
              label="订单 ID"
              help="必须是已支付或已履约订单；退款不会跨国际站/中国站数据库。"
            >
              <TextInput name="orderId" placeholder="UUID" required />
            </FormLabel>

            <FormLabel
              label="计算方式"
              help="建议金额由后台按订单剩余可退金额、积分可冲回余额、会员未使用周期统一计算。"
            >
              <Select name="refundMode" value={refundMode} onChange={setRefundMode}>
                <option value="suggested">按建议金额</option>
                <option value="amount">指定金额</option>
                <option value="percent">按剩余可退比例</option>
              </Select>
            </FormLabel>

            {refundMode === "amount" ? (
              <FormLabel label="退款金额 minor" help="使用法币最小单位，例如 USD 9.99 填 999。">
                <TextInput name="amountMinor" inputMode="numeric" placeholder="999" required />
              </FormLabel>
            ) : null}

            {refundMode === "percent" ? (
              <FormLabel
                label="退款比例"
                help="按订单当前剩余可退金额计算，例如 50 表示退还剩余可退金额的 50%。"
              >
                <TextInput
                  name="refundPercent"
                  inputMode="decimal"
                  min="0.01"
                  max="100"
                  step="0.01"
                  placeholder="50"
                  required
                />
              </FormLabel>
            ) : null}

            <FormLabel label="原因" help="原因会进入审计和 provider refund reason。">
              <Select name="reasonCode" defaultValue="customer_requested">
                <option value="customer_requested">客户申请</option>
                <option value="duplicate_payment">重复支付</option>
                <option value="fraud_review">风控退款</option>
                <option value="service_issue">服务问题</option>
                <option value="operator_correction">运营纠错</option>
              </Select>
            </FormLabel>
            <FormLabel
              label="幂等键"
              help="重复提交同一个退款动作必须使用同一个幂等键，避免重复退款。"
            >
              <TextInput name="idempotencyKey" placeholder="可留空自动生成" />
            </FormLabel>
            <FormLabel label="内部备注" help="备注只给后台审计，不展示给用户。">
              <TextInput name="operatorNote" placeholder="可选" />
            </FormLabel>

            <RefundQuotePanel quote={refundQuote} />

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (form) void handleQuoteRefund(form);
                }}
              >
                <IconScale className="size-4" />
                评估退款
              </Button>
              <Button type="submit" disabled={loading || !canSubmitRefund}>
                <IconReceiptRefund className="size-4" />
                提交退款
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

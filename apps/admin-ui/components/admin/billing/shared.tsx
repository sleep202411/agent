"use client";

// Shared billing primitives for the /billing sub-app. Moved AS-IS (verbatim
// bodies) from components/admin/admin-billing-panel.tsx during the P2 per-page
// split. The monolith keeps its own copies until Stage 2 deletes it; this file
// is the canonical home that the new per-page panels import from.
//
// NOTE: the old in-panel tab nav (TabButton / BillingNavGroup) is intentionally
// NOT moved here — the dual-sidebar second rail replaces it.

import { Children, isValidElement, useState } from "react";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCloudUpload,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminUiApiPath } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import { PageHeader } from "../page-header";
import type {
  BillingOrderStatus,
  BillingPriceRow,
  BillingProviderBinding,
  BillingPromotionProviderBinding,
  BillingPromotionRow,
  BillingPromotionStatus,
  BillingRefundQuoteData,
  BillingRefundStatus,
  PaymentProviderEventStatus,
} from "./types";

// Canonical admin page header re-exported so billing panels can import it from
// "./shared" alongside the rest of the primitives (mirrors the IP module).
export { PageHeader };

// ---------------------------------------------------------------------------
// Layout / metric primitives
// ---------------------------------------------------------------------------

export function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "risk";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "risk" ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"
      )}
    >
      <p
        className={cn(
          "text-[11px] font-medium",
          tone === "risk" ? "text-red-600" : "text-slate-500"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tracking-tight",
          tone === "risk" ? "text-red-700" : "text-slate-950"
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function AdminDialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned footer rendered OUTSIDE the scroll area (stays visible). */
  footer?: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl ring-0 sm:max-w-2xl">
        <DialogHeader className="flex flex-row items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <DialogTitle className="text-base font-semibold text-slate-950">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="mt-1 max-w-xl text-sm leading-5 text-slate-600">
                {description}
              </DialogDescription>
            ) : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Form primitives
// ---------------------------------------------------------------------------

// Sentinel mapped to "" — shadcn/radix SelectItem cannot use an empty string
// value, so the 全部/不发放/稍后配置 "all/none" options round-trip through this.
const SELECT_ALL_SENTINEL = "__all__";

type SelectOption = {
  value: string;
  label: React.ReactNode;
  title?: string;
};

// Parse the existing <option> children into shadcn SelectItem props so call
// sites keep their verbatim labels + per-option title tooltips while rendering
// through the composable Select primitives.
function optionsFromChildren(children: React.ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== "option") return;
    const props = child.props as {
      value?: string;
      title?: string;
      children?: React.ReactNode;
    };
    options.push({
      value: props.value ?? "",
      label: props.children,
      title: props.title,
    });
  });
  return options;
}

export function Select({
  name,
  value,
  defaultValue,
  onChange,
  title,
  children,
  disabled,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const options = optionsFromChildren(children);
  const toSentinel = (raw: string) => (raw === "" ? SELECT_ALL_SENTINEL : raw);
  const fromSentinel = (raw: string) => (raw === SELECT_ALL_SENTINEL ? "" : raw);

  // Track the current value internally so the FormData-backed hidden input
  // submits the real (de-sentineled) string. radix's own `name` is not used so
  // an empty "all/none" option submits "" rather than the sentinel.
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = value !== undefined ? value : internalValue;

  const rootProps =
    value !== undefined
      ? {
          value: toSentinel(value),
          onValueChange: onChange ? (next: string) => onChange(fromSentinel(next)) : undefined,
        }
      : {
          defaultValue: defaultValue !== undefined ? toSentinel(defaultValue) : undefined,
          onValueChange: (next: string) => setInternalValue(fromSentinel(next)),
        };

  return (
    <ShadSelect {...rootProps} disabled={disabled}>
      {name ? <input type="hidden" name={name} value={currentValue} /> : null}
      <SelectTrigger
        title={title}
        aria-label={title}
        className="h-9 w-full rounded-lg border-slate-200 bg-white px-2.5 text-sm text-slate-700 focus-visible:border-slate-950 focus-visible:ring-2 focus-visible:ring-slate-950/10"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        {options.map((option) => (
          <SelectItem
            key={option.value || SELECT_ALL_SENTINEL}
            value={toSentinel(option.value)}
            title={option.title}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

export function TextInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <Input
      {...props}
      className={cn(
        "h-9 rounded-lg border-slate-200 bg-white px-2.5 text-sm placeholder:text-slate-400 focus-visible:border-slate-950 focus-visible:ring-2 focus-visible:ring-slate-950/10",
        className
      )}
    />
  );
}

export function FormLabel({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
        {label}
        {help ? <InfoTip text={help} /> : null}
      </span>
      {children}
    </label>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    // Self-contained provider: admin-shell's TooltipProvider only wraps the
    // sidebar, not page content, so InfoTip must bring its own. Radix Tooltip
    // portals its content to <body> (not clipped by dialog overflow) and carries
    // no native `title` (no duplicate browser tooltip).
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          // Not in the tab/focus order: an info hint shouldn't steal a dialog's
          // initial autofocus (which pops the tooltip open on open). Mouse hover
          // still works.
          tabIndex={-1}
          aria-label={text}
          className="inline-flex size-4 items-center justify-center rounded-full text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus-visible:bg-slate-100 focus-visible:text-slate-700"
        >
          <IconInfoCircle className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-left leading-4">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Column header with an inline help tooltip, mirroring the old <Th help> markup
// so DataTable header cells keep their InfoTip affordance.
export function ColumnHeader({ children, help }: { children: React.ReactNode; help?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      {help ? <InfoTip text={help} /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Provider badges
// ---------------------------------------------------------------------------

export function ProviderBadge({
  binding,
  onSync,
}: {
  binding: BillingProviderBinding;
  onSync?: (bindingId: string) => void;
}) {
  const risky =
    binding.status === "sync_failed" ||
    (binding.provider === "airwallex" && binding.status === "active" && !binding.providerPriceId);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
          risky
            ? "border-red-200 bg-red-50 text-red-700"
            : binding.status === "active"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
        )}
        title={
          binding.syncError ??
          binding.providerPriceId ??
          binding.providerProductId ??
          providerHelp(binding.provider)
        }
      >
        {risky ? <IconAlertTriangle className="size-3" /> : <IconCircleCheck className="size-3" />}
        {providerLabel(binding.provider)}
      </span>
      {onSync &&
      binding.provider !== "manual" &&
      binding.provider !== "internal" &&
      binding.provider !== "wechat_pay" ? (
        <button
          type="button"
          onClick={() => onSync(binding.id)}
          className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          title="同步供应商价格"
          aria-label="同步供应商价格"
        >
          <IconCloudUpload className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

export function PromotionProviderBadge({
  binding,
  onSync,
}: {
  binding: BillingPromotionProviderBinding;
  onSync: (bindingId: string) => void;
}) {
  const risky =
    binding.status === "sync_failed" || (binding.status === "active" && !binding.providerCouponId);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
          risky
            ? "border-red-200 bg-red-50 text-red-700"
            : binding.status === "active"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
        )}
        title={binding.syncError ?? binding.providerCouponId ?? providerHelp(binding.provider)}
      >
        {risky ? <IconAlertTriangle className="size-3" /> : <IconCircleCheck className="size-3" />}
        {providerLabel(binding.provider)}
      </span>
      {binding.provider !== "manual" && binding.provider !== "internal" ? (
        <button
          type="button"
          onClick={() => onSync(binding.id)}
          className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          title="同步供应商优惠券"
          aria-label="同步供应商优惠券"
        >
          <IconCloudUpload className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status pills
// ---------------------------------------------------------------------------

export function RiskText({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-medium text-red-600">{children}</span>;
}

export function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "risk" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "risk" && "border-red-200 bg-red-50 text-red-700",
        tone === "muted" && "border-slate-200 bg-slate-50 text-slate-600"
      )}
    >
      {children}
    </span>
  );
}

export function OrderStatusPill({ status }: { status: BillingOrderStatus }) {
  const tone =
    status === "fulfilled" || status === "paid"
      ? "success"
      : status === "failed" || status === "expired"
        ? "risk"
        : "muted";
  return <StatusPill tone={tone}>{orderStatusLabel(status)}</StatusPill>;
}

export function RefundStatusPill({ status }: { status: BillingRefundStatus }) {
  const tone =
    status === "succeeded"
      ? "success"
      : status === "failed" || status === "canceled"
        ? "risk"
        : "muted";
  return <StatusPill tone={tone}>{refundStatusLabel(status)}</StatusPill>;
}

export function ProviderEventStatusPill({ status }: { status: PaymentProviderEventStatus }) {
  const tone = status === "processed" ? "success" : status === "failed" ? "risk" : "muted";
  return <StatusPill tone={tone}>{providerEventStatusLabel(status)}</StatusPill>;
}

export function PromotionStatusPill({ status }: { status: BillingPromotionStatus }) {
  const tone = status === "active" ? "success" : status === "archived" ? "risk" : "muted";
  return <StatusPill tone={tone}>{promotionStatusLabel(status)}</StatusPill>;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto code preview + payload line
// ---------------------------------------------------------------------------

export function AutoCodePreview({ code }: { code: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-slate-500">商品编码</span>
        <StatusPill tone="muted">自动生成</StatusPill>
      </div>
      <p className="mt-1 break-all font-mono text-[12px] font-semibold text-slate-900">{code}</p>
    </div>
  );
}

export function PayloadLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Refund quote panel
// ---------------------------------------------------------------------------

export function RefundQuotePanel({ quote }: { quote: BillingRefundQuoteData | null }) {
  if (!quote) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-500">
        先评估退款，后台会计算可退金额、权益冲回和阻断原因。
      </div>
    );
  }

  const hasBlockers = quote.blockers.length > 0;
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border px-3 py-3",
        hasBlockers ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[12px] font-semibold text-slate-950">
            {quote.order.orderNo}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {quote.order.item.name} · {quote.policy.calculationMode}
          </p>
        </div>
        <StatusPill tone={hasBlockers ? "risk" : "success"}>
          {hasBlockers ? "不可自动退款" : "可提交"}
        </StatusPill>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p className="text-slate-500">剩余可退</p>
          <p className="mt-0.5 font-semibold text-slate-950">
            {formatMoneyMinor(quote.refundableAmountMinor, quote.order.currency)}
          </p>
        </div>
        <div>
          <p className="text-slate-500">策略上限</p>
          <p className="mt-0.5 font-semibold text-slate-950">
            {formatMoneyMinor(quote.maxPolicyRefundMinor, quote.order.currency)}
          </p>
        </div>
        <div>
          <p className="text-slate-500">本次金额</p>
          <p className="mt-0.5 font-semibold text-slate-950">
            {formatMoneyMinor(quote.requestedAmountMinor, quote.order.currency)}
          </p>
        </div>
      </div>

      <div className="rounded-md border border-white/70 bg-white/70 px-2.5 py-2 text-[12px] leading-5 text-slate-700">
        <p className="font-semibold text-slate-950">权益影响</p>
        {quote.benefitImpact.type === "wallet" ? (
          <p className="mt-1">
            {currencyLabel(quote.benefitImpact.walletCurrency)}：可用{" "}
            {formatInteger(quote.benefitImpact.availableBalance)}，本次冲回{" "}
            {formatInteger(quote.benefitImpact.requestedReversalAmount)}，累计已冲回{" "}
            {formatInteger(quote.benefitImpact.alreadyReversedAmount)}。
          </p>
        ) : quote.benefitImpact.type === "membership" ? (
          <p className="mt-1">
            {quote.benefitImpact.planKey} 未使用 {formatBpsPercent(quote.benefitImpact.unusedBps)}
            ，提交后撤销剩余会员权益。
          </p>
        ) : (
          <p className="mt-1">{quote.benefitImpact.description}</p>
        )}
      </div>

      {quote.blockers.length ? (
        <div className="space-y-1">
          {quote.blockers.map((issue) => (
            <p key={`${issue.code}:${issue.msg}`} className="flex gap-1.5 text-[12px] text-red-700">
              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{issue.msg}</span>
            </p>
          ))}
        </div>
      ) : null}

      {quote.warnings.length ? (
        <div className="space-y-1">
          {quote.warnings.map((issue) => (
            <p key={`${issue.code}:${issue.msg}`} className="text-[11px] leading-4 text-slate-600">
              {issue.msg}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API envelope helpers
// ---------------------------------------------------------------------------

export async function requestEnvelope<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(adminUiApiPath(url), { cache: "no-store", signal });
  const payload = (await response.json().catch(() => null)) as AdminApiPayload<T> | null;
  signal?.throwIfAborted();
  if (!response.ok || payload?.code !== 200) {
    throw new Error(adminApiErrorMessage(payload, response.status));
  }
  return payload.data as T;
}

export async function mutateEnvelope<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  method = "POST",
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(adminUiApiPath(url), {
    method,
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as AdminApiPayload<T> | null;
  signal?.throwIfAborted();
  if (!response.ok || payload?.code !== 200) {
    throw new Error(adminApiErrorMessage(payload, response.status));
  }
  return payload.data as T;
}

type AdminApiPayload<T> = {
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
  issues?: Array<{ path?: string; message?: string; code?: string }>;
};

function adminApiErrorMessage(payload: AdminApiPayload<unknown> | null, status: number) {
  const base = payload?.msg ?? payload?.message ?? `请求失败：${status}`;
  if (!payload?.issues?.length) return base;
  const details = payload.issues
    .map((issue) => {
      const path = issue.path ? `${issue.path}: ` : "";
      return `${path}${issue.message ?? issue.code ?? "invalid"}`;
    })
    .join("；");
  return `${base}：${details}`;
}

// ---------------------------------------------------------------------------
// Refund payload builders
// ---------------------------------------------------------------------------

export function buildRefundQuotePayload(form: FormData): Record<string, unknown> {
  return {
    orderId: stringField(form, "orderId"),
    reasonCode: stringField(form, "reasonCode") || undefined,
    ...refundAmountChoice(form),
  };
}

export function buildRefundCreatePayload(
  form: FormData,
  quote: BillingRefundQuoteData | null
): Record<string, unknown> {
  const orderId = stringField(form, "orderId");
  const amountChoice = refundAmountChoice(form);
  const mode = stringField(form, "refundMode") || "suggested";
  if (!quote || quote.order.id !== orderId) {
    throw new Error("请先评估当前订单的退款。");
  }
  if (quote.blockers.length > 0) {
    throw new Error("当前评估存在阻断项，不能提交自动退款。");
  }
  if (mode === "suggested") {
    if (quote.policy.calculationMode !== "suggested") {
      throw new Error("退款方式已变化，请重新评估。");
    }
    amountChoice.amountMinor = quote.requestedAmountMinor;
  } else if (
    mode === "amount" &&
    (quote.policy.calculationMode !== "amount" ||
      amountChoice.amountMinor !== quote.requestedAmountMinor)
  ) {
    throw new Error("退款金额已变化，请重新评估。");
  } else if (
    mode === "percent" &&
    (quote.policy.calculationMode !== "percent" ||
      amountChoice.percentBps !== quote.requestedPercentBps)
  ) {
    throw new Error("退款比例已变化，请重新评估。");
  }

  return {
    orderId,
    ...amountChoice,
    reasonCode: stringField(form, "reasonCode"),
    operatorNote: stringField(form, "operatorNote") || undefined,
  };
}

export function refundAmountChoice(form: FormData): {
  amountMinor?: string;
  percentBps?: number;
} {
  const mode = stringField(form, "refundMode") || "suggested";
  if (mode === "amount") {
    const amountMinor = stringField(form, "amountMinor");
    if (!amountMinor) throw new Error("请输入退款金额。");
    return { amountMinor };
  }
  if (mode === "percent") {
    const percent = Number(stringField(form, "refundPercent"));
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new Error("退款比例必须大于 0 且不超过 100。");
    }
    return { percentBps: Math.round(percent * 100) };
  }
  return {};
}

export function stringField(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    airwallex: "Airwallex",
    wechat_pay: "微信支付",
    alipay: "支付宝",
    manual: "线下确认",
    internal: "内部发放",
  };
  return labels[provider] ?? provider;
}

export function providerHelp(provider: string) {
  const labels: Record<string, string> = {
    airwallex: "国际站支付供应商。用于银行卡、本地支付、订阅、优惠券同步和结算对账。",
    wechat_pay: "中国站支付供应商。直接按内部 CNY 价格下单，没有供应商商品目录，不需要价格同步。",
    alipay: "中国站支付供应商。只在中国站部署中使用，不和国际站数据库共享。",
    manual: "后台确认的线下收款或企业转账。不是兑换码，仍然必须走订单、履约、ledger 和审计。",
    internal: "平台内部承担成本的发放，例如迁移补偿、运营赠送或 100% 免费兑换码的零元订单。",
  };
  return labels[provider] ?? provider;
}

export function buildBillingItemCode({
  productType,
  walletAmount,
  planKey,
  currency,
  amountMinor,
}: {
  productType: string;
  walletAmount: string;
  planKey: string;
  currency: string;
  amountMinor: string;
}) {
  const prefixes: Record<string, string> = {
    community_point_pack: "COMMUNITY_POINT",
    compute_point_pack: "COMPUTE_POINT",
    membership_plan: "MEMBERSHIP",
    team_membership_plan: "TEAM_MEMBERSHIP",
    community_membership_plan: "COMMUNITY_MEMBERSHIP",
  };
  const prefix = prefixes[productType] ?? "BILLING";
  const benefit = sanitizeCodeToken(walletAmount || planKey || "PACKAGE");
  const fiatCurrency = sanitizeCodeToken(currency || "CUR");
  const fiatAmount = sanitizeCodeToken(amountMinor || "AMOUNT");
  return [prefix, benefit, fiatCurrency, fiatAmount]
    .join("_")
    .replace(/_+/g, "_")
    .slice(0, 96)
    .replace(/_+$/g, "");
}

function sanitizeCodeToken(value: string) {
  const token = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || "AUTO";
}

export function productTypeLabel(value: string) {
  const labels: Record<string, string> = {
    community_point_pack: "社区积分",
    compute_point_pack: "算力积分",
    membership_plan: "个人会员",
    team_membership_plan: "团队会员",
    community_membership_plan: "社区会员",
  };
  return labels[value] ?? value;
}

// ── Product family ────────────────────────────────────────────────────────
// The billing catalog spans two distinct products. Individual + team are both
// the **Studio** product at different scales (user vs workspace); the community
// side is its own product. Grouping by family — not by raw productType — is the
// organizing principle for the catalog + membership admin pages.
export type ProductFamily = "studio" | "community";

const PRODUCT_FAMILY: Record<string, ProductFamily> = {
  compute_point_pack: "studio",
  membership_plan: "studio",
  team_membership_plan: "studio",
  community_point_pack: "community",
  community_membership_plan: "community",
};

export function productFamily(productType: string): ProductFamily | null {
  return PRODUCT_FAMILY[productType] ?? null;
}

/** Tab definitions in display order; `label` is overridable per page. */
export const PRODUCT_FAMILY_TABS: {
  key: ProductFamily;
  label: string;
  productTypes: string[];
}[] = [
  {
    key: "studio",
    label: "Studio",
    productTypes: ["compute_point_pack", "membership_plan", "team_membership_plan"],
  },
  {
    key: "community",
    label: "社区",
    productTypes: ["community_point_pack", "community_membership_plan"],
  },
];

/** Segmented tab bar that switches a page between the two product families. */
export function ProductFamilyTabs({
  value,
  onChange,
  labels,
}: {
  value: ProductFamily;
  onChange: (family: ProductFamily) => void;
  /** Per-page label overrides, e.g. { studio: "Studio 会员" }. */
  labels?: Partial<Record<ProductFamily, string>>;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
      {PRODUCT_FAMILY_TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            {labels?.[tab.key] ?? tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function productTypeHelp(value: string) {
  const labels: Record<string, string> = {
    community_point_pack: "购买后发放可消费社区积分；可提现社区积分只能来自创作者收入。",
    compute_point_pack: "购买后向工作区发放算力积分，用于该工作区的 AI 生成等消耗。",
    membership_plan: "购买后开通个人会员权益，可按月/年订阅或一次性购买。",
    team_membership_plan: "购买后开通工作区或团队会员权益。",
    community_membership_plan: "购买后开通社区会员权益(会员免费观看 + 购买折扣)。",
  };
  return labels[value] ?? value;
}

export function intervalLabel(value: string) {
  const labels: Record<string, string> = { one_time: "一次性", month: "月付", year: "年付" };
  return labels[value] ?? value;
}

export function orderStatusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    pending_payment: "待支付",
    paid: "已支付",
    fulfilled: "已履约",
    canceled: "已取消",
    expired: "已过期",
    failed: "失败",
    refunded: "已退款",
    partially_refunded: "部分退款",
  };
  return labels[value] ?? value;
}

export function refundStatusLabel(value: string) {
  const labels: Record<string, string> = {
    requested: "已请求",
    provider_pending: "渠道处理中",
    succeeded: "成功",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[value] ?? value;
}

export function providerEventStatusLabel(value: string) {
  const labels: Record<string, string> = {
    received: "已接收",
    processed: "已处理",
    ignored: "已忽略",
    failed: "失败",
  };
  return labels[value] ?? value;
}

export function promotionStatusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    active: "启用",
    paused: "暂停",
    archived: "归档",
  };
  return labels[value] ?? value;
}

export function walletCurrencyLabel(value: string | null) {
  const labels: Record<string, string> = {
    compute_point: "算力积分",
    community_point: "社区积分",
  };
  return value ? (labels[value] ?? value) : "钱包";
}

export function ledgerJournalTypeLabel(value: string) {
  const labels: Record<string, string> = {
    payment_capture: "支付入账",
    fulfillment_allocation: "履约分配",
    settlement: "结算",
    refund: "退款",
    chargeback: "拒付",
    revenue_recognition: "收入确认",
    provider_fee: "渠道费用",
    manual_adjustment: "人工调整",
    reversal: "反向冲销",
  };
  return labels[value] ?? value;
}

export function ledgerJournalTypeHelp(value: string) {
  const labels: Record<string, string> = {
    payment_capture: "支付供应商确认收款后入账：借记渠道应收，贷记客户资金清算。",
    fulfillment_allocation: "订单履约后把客户资金清算到钱包负债、递延会员收入或即时收入。",
    settlement: "渠道结算/打款到账时的 journal，用于核对 provider payout。",
    refund: "退款发生时冲减原支付和履约影响，必须可追溯到原订单。",
    chargeback: "渠道拒付或争议扣款，和普通退款区分处理。",
    revenue_recognition: "递延会员收入按服务期确认收入。",
    provider_fee: "支付渠道手续费，从结算批次或 provider fee 明细生成。",
    manual_adjustment: "财务纠错分录。不能作为常规发积分入口，必须带审计原因。",
    reversal: "反向冲销已 posted journal，保留原分录不可删除。",
  };
  return labels[value] ?? value;
}

export function settlementStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: "待对账",
    reconciled: "已对账",
    partially_reconciled: "部分对账",
    failed: "失败",
  };
  return labels[value] ?? value;
}

export function reconciliationStatusLabel(value: string) {
  const labels: Record<string, string> = {
    running: "运行中",
    completed: "已完成",
    failed: "失败",
  };
  return labels[value] ?? value;
}

export function reconciliationItemStatusLabel(value: string) {
  const labels: Record<string, string> = {
    matched: "已匹配",
    mismatch: "金额不一致",
    missing_internal: "内部缺失",
    missing_provider: "渠道缺失",
    ignored: "已忽略",
  };
  return labels[value] ?? value;
}

export function promotionDiscountLabel(promotion: BillingPromotionRow) {
  if (promotion.amountOffMinor != null) {
    return `-${formatMoneyMinor(
      String(promotion.amountOffMinor),
      promotion.amountOffCurrency ?? "USD"
    )}`;
  }
  return `${(promotion.percentOffBps ?? 0) / 100}%`;
}

export function promotionScopeLabel(promotion: BillingPromotionRow) {
  if (promotion.appliesPrice) {
    return `${promotion.appliesPrice.name} · ${formatMoneyMinor(
      promotion.appliesPrice.amountMinor,
      promotion.appliesPrice.currency
    )}`;
  }
  if (promotion.appliesItem) {
    return `${promotion.appliesItem.name} · ${productTypeLabel(promotion.appliesItem.productType)}`;
  }
  if (promotion.appliesProductType) {
    return productTypeLabel(promotion.appliesProductType);
  }
  return "全部商品";
}

export function isInternalFreePromotion(promotion: BillingPromotionRow) {
  return promotion.percentOffBps != null && promotion.percentOffBps >= 10000;
}

export function grantLabel(price: BillingPriceRow) {
  if (price.grantsWalletCurrency && price.grantsWalletAmount) {
    const kind = price.grantsWalletBalanceKind
      ? ` · ${balanceKindLabel(price.grantsWalletBalanceKind)}`
      : "";
    return `${formatInteger(price.grantsWalletAmount)} ${currencyLabel(price.grantsWalletCurrency)}${kind}`;
  }
  if (price.grantsPlanKey) return `会员权益 ${price.grantsPlanKey}`;
  return "无自动权益";
}

export function currencyLabel(value: string) {
  const labels: Record<string, string> = {
    community_point: "社区积分",
    compute_point: "算力积分",
  };
  return labels[value] ?? value;
}

export function balanceKindLabel(value: string) {
  const labels: Record<string, string> = {
    consumable: "可消费",
    withdrawable: "可提现",
  };
  return labels[value] ?? value;
}

export function walletEntryTypeLabel(value: string) {
  const labels: Record<string, string> = {
    credit: "入账",
    debit: "扣款",
    expire: "过期",
    hold: "冻结",
    release: "释放",
    settle: "结算",
    refund: "退款",
    adjustment: "调整",
  };
  return labels[value] ?? value;
}

export function walletGrantTypeLabel(value: string) {
  const labels: Record<string, string> = {
    purchase_topup: "购买充值",
    membership_included: "会员赠送",
    check_in_reward: "签到奖励",
    campaign_reward: "活动奖励",
    admin_adjustment: "管理员调整",
    refund_return: "退款返还",
    migration: "历史迁移",
    system_grant: "系统赠送",
    other: "其他",
  };
  return labels[value] ?? value;
}

export function walletGrantStatusLabel(value: string) {
  const labels: Record<string, string> = {
    active: "可用",
    exhausted: "已用尽",
    expired: "已过期",
    reversed: "已冲回",
    voided: "已作废",
  };
  return labels[value] ?? value;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatMoneyMinor(amountMinor: string, currency: string) {
  const value = BigInt(amountMinor);
  const zero = BigInt(0);
  const centsPerUnit = BigInt(100);
  const sign = value < zero ? "-" : "";
  const abs = value < zero ? -value : value;
  const major = abs / centsPerUnit;
  const minor = abs % centsPerUnit;
  return `${currency} ${sign}${major.toString()}.${minor.toString().padStart(2, "0")}`;
}

export function formatNullableMoneyMinor(amountMinor: string | null, currency: string) {
  return amountMinor ? formatMoneyMinor(amountMinor, currency) : "-";
}

export function formatInteger(value: string) {
  return new Intl.NumberFormat("zh-CN").format(Number(value));
}

export function formatSignedInteger(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "0";
  const formatted = new Intl.NumberFormat("zh-CN").format(Math.abs(numeric));
  return numeric > 0 ? `+${formatted}` : `-${formatted}`;
}

export function formatBpsPercent(value: number) {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

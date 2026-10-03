/**
 * Nest `/billing` checkout used by the web WeChat scan dialog.
 * Paths omit `/aurora`; `api` resolves the aurora base URL.
 */

import { appEnv } from "@/config";
import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

export type BillingPrice = {
  id: string;
  name: string;
  currency: string;
  amountMinor: string;
  grantsWalletAmount: string | null;
  isActive?: boolean;
  interval?: string | null;
  activeDiscount?: { effectiveAmountMinor: string } | null;
};

export type BillingCheckoutResult = {
  order: { id: string; orderNo: string; status: string };
  paymentIntent: { checkoutUrl: string | null } | null;
};

export type BillingOrderView = {
  id: string;
  orderNo: string;
  status: string;
};

const DEAD_ORDER_STATUSES = new Set(["failed", "expired", "canceled", "refunded"]);

export function isOrderFulfilled(status: string): boolean {
  return status === "fulfilled";
}

export function isOrderDead(status: string): boolean {
  return DEAD_ORDER_STATUSES.has(status);
}

/** A WeChat Native code_url. Render it as a QR; do not navigate to it. */
export function isWechatScanUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("weixin://");
}

export function chargedAmountMinor(price: BillingPrice): string {
  return price.activeDiscount?.effectiveAmountMinor ?? price.amountMinor;
}

export function formatCny(amountMinor: string): string {
  const minor = Number(amountMinor);
  if (!Number.isFinite(minor)) return amountMinor;
  return `¥${(minor / 100).toFixed(2)}`;
}

export function formatBillingMoney(currency: string, amountMinor: string): string {
  if (currency === "CNY") return formatCny(amountMinor);
  const minor = Number(amountMinor);
  if (!Number.isFinite(minor)) return amountMinor;
  return `$${(minor / 100).toFixed(2)}`;
}

/** Nest list currency for the active mobile region. */
export function paywallBillingCurrency(): "CNY" | "USD" {
  return appEnv.appRegion === "cn" ? "CNY" : "USD";
}

export async function listCommunityPointPackages(
  currency: string,
  signal?: AbortSignal
): Promise<BillingPrice[]> {
  const res = await api.get<{ prices?: BillingPrice[] }>("/billing/prices", {
    ...AURORA,
    params: { productType: "community_point_pack", currency },
    signal,
    cache: "no-store",
  });
  if (!Array.isArray(res?.prices))
    throw Error("Recharge catalog is unavailable: invalid price data.");
  return res.prices.filter((price) => price.isActive !== false);
}

export async function listMembershipPrices(
  input: {
    productType: "membership_plan" | "community_membership_plan";
    currency: string;
  },
  signal?: AbortSignal
): Promise<BillingPrice[]> {
  const res = await api.get<{ plans?: { prices?: BillingPrice[] }[] }>(
    "/billing/membership-plans",
    {
      ...AURORA,
      params: { productType: input.productType, currency: input.currency },
      signal,
      cache: "no-store",
    }
  );
  if (!Array.isArray(res?.plans) || res.plans.some((plan) => !plan || !Array.isArray(plan.prices)))
    throw Error("Membership catalog is unavailable: invalid plan data.");
  return res.plans.flatMap((plan) => plan.prices!);
}

export async function createBillingCheckout(input: {
  priceId: string;
  idempotencyKey: string;
  successUrl: string;
  backUrl: string;
  quantity?: number;
}): Promise<BillingCheckoutResult> {
  return api.post<BillingCheckoutResult>("/billing/checkout", {
    ...AURORA,
    data: {
      priceId: input.priceId,
      quantity: input.quantity ?? 1,
      idempotencyKey: input.idempotencyKey,
      successUrl: input.successUrl,
      backUrl: input.backUrl,
    },
  });
}

/** Arbitrary compute-point amount. CN WeChat returns a `weixin://` code_url. */
export async function createComputeCustomRecharge(input: {
  amountDollars: number;
  idempotencyKey: string;
  successUrl: string;
  backUrl: string;
}): Promise<BillingCheckoutResult> {
  return api.post<BillingCheckoutResult>("/billing/recharge-custom", {
    ...AURORA,
    data: {
      amountDollars: input.amountDollars,
      currency: "compute_point",
      idempotencyKey: input.idempotencyKey,
      successUrl: input.successUrl,
      backUrl: input.backUrl,
    },
  });
}

export async function getBillingOrder(orderId: string): Promise<BillingOrderView> {
  const res = await api.get<{ order: BillingOrderView }>(
    `/billing/orders/${encodeURIComponent(orderId)}`,
    AURORA
  );
  return res.order;
}

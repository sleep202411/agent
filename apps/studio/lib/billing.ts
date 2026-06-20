import { api } from "@/lib/api";

export interface MembershipPrice {
  id: string;
  code: string;
  name: string;
  description: string | null;
  productType: string;
  currency: string;
  amountMinor: string;
  interval: "one_time" | "month" | "year" | string;
  subjectType: "user" | "workspace" | string;
  grantsPlanKey: string | null;
  grantDurationDays: number | null;
  metadata: Record<string, unknown>;
  provider: string;
}

export interface MembershipPlan {
  id: string;
  planKey: string;
  productType: "membership_plan" | "team_membership_plan";
  subjectType: "user" | "workspace";
  status: string;
  rank: number;
  name: string;
  description: string | null;
  includedComputeCredits: string;
  includedSeats: number;
  maxSeats: number | null;
  seatOverageAllowed: boolean;
  topupDiscountBps: number;
  billingIntervalDefault: "one_time" | "month" | "year" | null;
  featureFlags: Record<string, unknown>;
  limits: Record<string, unknown>;
  marketing: Record<string, unknown>;
  metadata: Record<string, unknown>;
  prices: MembershipPrice[];
  updatedAt: string;
}

export function listMembershipPlans(input: {
  productType: "membership_plan" | "team_membership_plan";
  currency: "USD" | "SGD";
}) {
  return api.get<{ provider: string; plans: MembershipPlan[] }>(
    "/aurora/billing/membership-plans",
    {
      params: input,
    }
  );
}

export interface CreateBillingCheckoutInput {
  priceId: string;
  quantity?: number;
  idempotencyKey: string;
  successUrl: string;
  backUrl: string;
  workspaceId?: string;
}

export interface BillingCheckoutResult {
  order: { id: string; orderNo: string; status: string };
  paymentIntent: { checkoutUrl: string | null } | null;
}

export function createBillingCheckout(input: CreateBillingCheckoutInput) {
  return api.post<BillingCheckoutResult>("/aurora/billing/checkout", { data: input });
}

export interface RedeemVoucherResult {
  granted: {
    grantType: "compute_credits";
    currency: string;
    amount: string;
    workspaceId: string;
  };
  alreadyRedeemed: boolean;
}

/**
 * Redeem a 兑换券 / gift code for compute credits. The server credits the active
 * user's personal-workspace pot and is idempotent (a retry never double-credits).
 */
export function redeemVoucher(code: string) {
  return api.post<RedeemVoucherResult>("/aurora/billing/vouchers/redeem", {
    data: { code },
  });
}

export interface CheckInStatus {
  enabled: boolean;
  rewards: number[];
  checkedInToday: boolean;
  streak: number;
  nextStreakDay: number;
  nextReward: number;
  todayReward: number;
}

/** Today's daily check-in status + the streak reward cycle. */
export function getCheckInStatus() {
  return api.get<CheckInStatus>("/aurora/billing/check-in/status");
}

export interface CheckInResult {
  granted: RedeemVoucherResult["granted"];
  streakDay: number;
  alreadyCheckedIn: boolean;
}

/** Claim today's check-in (once per day; idempotent server-side). */
export function dailyCheckIn() {
  return api.post<CheckInResult>("/aurora/billing/check-in", { data: {} });
}

export interface ActiveCampaign {
  id: string;
  name: string;
  description: string | null;
  computeCreditAmount: number;
  endsAt: string | null;
  claimed: boolean;
}

/** Active, in-window free-credits campaigns + whether the caller already claimed. */
export function listActiveCampaigns() {
  return api.get<{ items: ActiveCampaign[] }>("/aurora/billing/campaigns/active");
}

export interface CampaignClaimResult {
  granted: RedeemVoucherResult["granted"];
  alreadyClaimed: boolean;
}

/** Claim a campaign's free credits (once per user; idempotent server-side). */
export function claimCampaign(campaignId: string) {
  return api.post<CampaignClaimResult>(`/aurora/billing/campaigns/${campaignId}/claim`, {
    data: {},
  });
}

// ───────────────────────── Compute-point recharge ──────────────────────────
// Funds a compute_point (AI-generation) wallet — the caller's own, or a team's
// shared pool when `workspaceId` is supplied (the server requires the billing
// role and directs the credit to the workspace wallet). Two ways to fund:
// fixed catalog packs (hosted checkout) and an arbitrary USD amount (payment
// intent). Both complete via {@link redirectToComputePayment}.

export type ComputeTopupProvider = "airwallex" | "wechat_pay" | "alipay";

export interface ComputeTopupPrice {
  id: string;
  code: string;
  name: string;
  description: string | null;
  provider: ComputeTopupProvider;
  currency: string;
  amountMinor: string;
  grantsWalletAmount: string;
  metadata: Record<string, unknown>;
}

export interface ComputeTopupCatalog {
  provider: ComputeTopupProvider;
  providers: ComputeTopupProvider[];
  currency: string;
  cell: "global" | "cn";
  exchangeRate: {
    computePointsPerUsdCent: number;
    usdCentsPerComputePoint: number;
  } | null;
  rateMode: "usd_cent_anchor" | "explicit_admin_pricing";
  prices: ComputeTopupPrice[];
}

export interface ComputePaymentResult {
  order: {
    id: string;
    orderNo: string;
    status: string;
    provider: string;
    currency: string;
    amountMinor: string;
    grantsWalletAmount: string | null;
  };
  paymentIntent: {
    id: string;
    provider: string;
    checkoutUrl: string | null;
    clientSecret: string | null;
    providerPaymentIntentId: string | null;
  } | null;
  shopperCountry: string;
  env: "demo" | "prod";
}

export function listComputeTopupPackages() {
  return api.get<ComputeTopupCatalog>("/aurora/billing/compute-topup-packages");
}

export interface CreateComputeTopupInput {
  priceId: string;
  workspaceId?: string;
  idempotencyKey: string;
  successUrl: string;
  backUrl: string;
}

export function createComputeTopup(input: CreateComputeTopupInput) {
  return api.post<ComputePaymentResult>("/aurora/billing/compute-topup", { data: input });
}

export interface CreateComputeCustomRechargeInput {
  amountDollars: number;
  workspaceId?: string;
  idempotencyKey: string;
  successUrl: string;
  backUrl: string;
}

export function createComputeCustomRecharge(input: CreateComputeCustomRechargeInput) {
  return api.post<ComputePaymentResult>("/aurora/billing/recharge-custom", {
    data: { ...input, currency: "compute_point" },
  });
}

/**
 * Drive an order to payment completion. Returns "fulfilled" when the order was
 * already settled (e.g. a 100%-off promo, no payment needed); otherwise
 * redirects the browser to the provider — a hosted-checkout URL, or the
 * Airwallex hosted page via the components SDK for payment-intent orders — and
 * returns "redirecting" (navigation has begun). Throws if no payment method is
 * available on the order.
 */
export async function redirectToComputePayment(
  result: ComputePaymentResult,
  urls: { successUrl: string; backUrl: string }
): Promise<"fulfilled" | "redirecting"> {
  if (result.order.status === "fulfilled" && !result.paymentIntent) return "fulfilled";

  const pi = result.paymentIntent;
  if (pi?.checkoutUrl) {
    window.location.assign(pi.checkoutUrl);
    return "redirecting";
  }
  if (result.order.provider === "airwallex" && pi?.providerPaymentIntentId && pi.clientSecret) {
    const { init } = await import("@airwallex/components-sdk");
    const aw = await init({ env: result.env, enabledElements: ["payments"] });
    if (!aw.payments) throw new Error("Payment is unavailable right now.");
    await aw.payments.redirectToCheckout({
      env: result.env,
      mode: "payment",
      intent_id: pi.providerPaymentIntentId,
      client_secret: pi.clientSecret,
      currency: result.order.currency,
      country_code: result.shopperCountry,
      successUrl: urls.successUrl,
      failUrl: urls.backUrl,
    });
    return "redirecting";
  }
  throw new Error("No payment method is available for this order.");
}

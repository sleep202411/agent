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
  billingIntervalDefault: "one_time" | "month" | "year" | null;
  benefits: MembershipBenefits;
  generationEstimates?: MembershipGenerationEstimate[];
  marketing: Record<string, unknown>;
  metadata: Record<string, unknown>;
  prices: MembershipPrice[];
  updatedAt: string;
}

export interface MembershipGenerationEstimate {
  kind: "image" | "video";
  modelId: string;
  modelName: string;
  estimatedOutputs: string;
  unitPoints: number;
  pricingVersion: string;
  resolution: string | null;
  quality: string | null;
  durationSeconds: number | null;
  audioIncluded: boolean | null;
}

export interface MembershipBenefits {
  queuePriority: number;
  imageDaily: number | "Infinity";
  videoDaily: number | "Infinity";
  chatDaily: number | "Infinity";
  workflowDaily: number | "Infinity";
  uploadMB: number;
  chatPerMinute: number;
  concurrentJobs: number | null;
  queuedJobs: number | null;
}

export function listMembershipPlans(input: {
  productType: "membership_plan" | "team_membership_plan";
  /**
   * Membership pricing is one currency per cell: USD on .com, CNY on .cn.
   * Never ask for a currency the catalog has no rows for — the API answers
   * with price-less plans and the dialog degrades to "Contact Sales".
   */
  currency: "USD" | "CNY";
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

export interface BillingOrderView {
  id: string;
  orderNo: string;
  status: string; // pending_payment | paid | fulfilled | failed | expired | cancelled
  provider: string;
}

/**
 * Poll an order's status. Server-side, reading a still-pending WeChat order
 * triggers a 查单 reconcile + fulfil, so this flips to paid/fulfilled once the
 * user finishes scanning — no dependency on the async callback landing first.
 */
export function getBillingOrder(orderId: string) {
  return api.get<{
    order: BillingOrderView;
    paymentIntent: { checkoutUrl: string | null } | null;
  }>(`/aurora/billing/orders/${encodeURIComponent(orderId)}`);
}

/**
 * A WeChat 扫码 (Native) checkout returns a `weixin://` code_url — it is rendered
 * as a QR the user scans, NOT a URL the browser navigates to.
 */
export function isWechatScanUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("weixin://");
}

const SETTLED_ORDER_STATUSES = new Set(["paid", "fulfilled"]);
const DEAD_ORDER_STATUSES = new Set(["failed", "expired", "cancelled"]);

export function isOrderSettled(status: string): boolean {
  return SETTLED_ORDER_STATUSES.has(status);
}
export function isOrderDead(status: string): boolean {
  return DEAD_ORDER_STATUSES.has(status);
}

// ───────────────────────── Current plan + subscription ─────────────────────

export interface EntitlementLimits {
  queuePriority: number;
  imageDaily: number;
  videoDaily: number;
  chatDaily: number;
  workflowDaily: number;
  uploadMB: number;
  chatPerMinute: number;
  /** null = contract-managed / unlimited. */
  concurrentJobs: number | null;
  queuedJobs: number | null;
}

export interface EntitlementSnapshot {
  planKey: string;
  rank: number;
  source: string;
  status: "active" | "expired" | string;
  expiresAt: string | null;
  limits: EntitlementLimits;
}

export interface ActiveSubscription {
  id: string;
  status: "incomplete" | "active" | "past_due" | "canceled" | "expired" | string;
  planKey: string | null;
  productType: string;
  subjectType: "user" | "workspace" | string;
  currency: string;
  amountMinor: string;
  interval: "one_time" | "month" | "year" | string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
}

export interface MyEntitlement {
  entitlement: EntitlementSnapshot;
  /** The active Nest subscription backing the plan, or null when granted. */
  subscription: ActiveSubscription | null;
}

/** The caller's current plan + the subscription that backs it (for renew/cancel). */
export function getMyEntitlement(workspaceId?: string | null, signal?: AbortSignal) {
  return api.get<MyEntitlement>("/aurora/billing/entitlement/me", {
    signal,
    requestScope: "user",
    headers: workspaceId ? { "x-fizz-workspace-id": workspaceId } : undefined,
  });
}

/** Cancel a recurring subscription. Access continues until currentPeriodEnd. */
export function cancelSubscription(
  subscriptionId: string,
  workspaceId?: string | null,
  signal?: AbortSignal
) {
  return api.post<ActiveSubscription>(`/aurora/billing/subscriptions/${subscriptionId}/cancel`, {
    data: {},
    requestScope: "user",
    headers: workspaceId ? { "x-fizz-workspace-id": workspaceId } : undefined,
    signal,
  });
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
export function redeemVoucher(code: string, signal?: AbortSignal) {
  return api.post<RedeemVoucherResult>("/aurora/billing/vouchers/redeem", {
    data: { code },
    signal,
    requestScope: "user",
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
export function getCheckInStatus(signal?: AbortSignal) {
  return api.get<CheckInStatus>("/aurora/billing/check-in/status", { signal });
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
export function listActiveCampaigns(signal?: AbortSignal) {
  return api.get<{ items: ActiveCampaign[] }>("/aurora/billing/campaigns/active", {
    signal,
    requestScope: "user",
  });
}

export interface CampaignClaimResult {
  granted: RedeemVoucherResult["granted"];
  alreadyClaimed: boolean;
}

/** Claim a campaign's free credits (once per user; idempotent server-side). */
export function claimCampaign(campaignId: string, signal?: AbortSignal) {
  return api.post<CampaignClaimResult>(`/aurora/billing/campaigns/${campaignId}/claim`, {
    data: {},
    signal,
    requestScope: "user",
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

export function createComputeCustomRecharge(
  input: CreateComputeCustomRechargeInput,
  signal?: AbortSignal
) {
  return api.post<ComputePaymentResult>("/aurora/billing/recharge-custom", {
    data: { ...input, currency: "compute_point" },
    signal,
    requestScope: "user",
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
  urls: { successUrl: string; backUrl: string },
  assertCurrent: () => void = () => {}
): Promise<"fulfilled" | "redirecting"> {
  assertCurrent();
  if (result.order.status === "fulfilled" && !result.paymentIntent) return "fulfilled";

  const pi = result.paymentIntent;
  if (pi?.checkoutUrl) {
    window.location.assign(pi.checkoutUrl);
    return "redirecting";
  }
  if (result.order.provider === "airwallex" && pi?.providerPaymentIntentId && pi.clientSecret) {
    const { init } = await import("@airwallex/components-sdk");
    assertCurrent();
    const aw = await init({ env: result.env, enabledElements: ["payments"] });
    assertCurrent();
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

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

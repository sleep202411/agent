import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const subscriptionSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  planKey: z.string().nullable(),
  productType: z.string(),
  subjectType: z.enum(["user", "workspace"]),
  currency: z.string(),
  amountMinor: z.string().regex(/^\d+$/),
  interval: z.string(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
const planSchema = z.object({
  entitlement: z.object({
    planKey: z.string().min(1),
    status: z.string(),
    expiresAt: z.string().nullable(),
  }),
  subscription: subscriptionSchema.nullable(),
});
export type MobilePlan = z.infer<typeof planSchema>;
export type SubscriptionScope = { generation: number; workspaceId?: string };
function current(scope: SubscriptionScope, signal: AbortSignal) {
  signal.throwIfAborted();
  if (scope.generation !== getAuthGeneration()) throw Error("Subscription session expired.");
  if (scope.workspaceId) z.string().uuid().parse(scope.workspaceId);
}
export async function getMobilePlan(scope: SubscriptionScope, signal: AbortSignal) {
  current(scope, signal);
  const result = await api.get("/billing/entitlement/me", {
    service: "aurora",
    cache: "no-store",
    signal,
    headers: scope.workspaceId ? { "x-fizz-workspace-id": scope.workspaceId } : undefined,
  });
  current(scope, signal);
  const plan = planSchema.parse(result);
  if (!scope.workspaceId && plan.subscription?.subjectType === "workspace")
    throw Error("Subscription scope mismatch.");
  return plan;
}
export async function cancelMobileSubscription(
  id: string,
  scope: SubscriptionScope,
  signal: AbortSignal
) {
  z.string().uuid().parse(id);
  current(scope, signal);
  const result = await api.post(`/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {
    service: "aurora",
    data: {},
    signal,
    retry: false,
  });
  current(scope, signal);
  const subscription = subscriptionSchema.parse(result);
  if (subscription.id !== id || (!scope.workspaceId && subscription.subjectType === "workspace"))
    throw Error("Subscription scope mismatch.");
  if (!subscription.cancelAtPeriodEnd && !["canceled", "expired"].includes(subscription.status))
    throw Error("Subscription cancellation was not confirmed. Refresh the plan before retrying.");
  return subscription;
}
export function canCancelMobileSubscription(plan: MobilePlan) {
  const subscription = plan.subscription;
  return (
    !!subscription &&
    subscription.status === "active" &&
    !subscription.cancelAtPeriodEnd &&
    ["month", "year"].includes(subscription.interval)
  );
}
/** Keep whole minor-unit integers exact instead of converting large balances through Number. */
export function subscriptionAmount(amount: string, currency: string, locale: string) {
  const minor = BigInt(amount);
  return `${currency} ${(minor / 100n).toLocaleString(locale)}.${(minor % 100n).toString().padStart(2, "0")}`;
}

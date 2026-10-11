import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  cancelMobileSubscription,
  canCancelMobileSubscription,
  getMobilePlan,
  subscriptionAmount,
} from "./subscription-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "00000000-0000-4000-8000-000000000001";
export const subscription = {
  id,
  status: "active",
  planKey: "pro",
  productType: "membership_plan",
  subjectType: "user" as const,
  currency: "USD",
  amountMinor: "2999",
  interval: "month",
  currentPeriodEnd: "2026-11-04T00:00:00Z",
  cancelAtPeriodEnd: false,
  canceledAt: null,
  endedAt: null,
};
const plan = { entitlement: { planKey: "pro", status: "active", expiresAt: null }, subscription };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("reads explicit workspace scope without caching", async () => {
  vi.mocked(api.get).mockResolvedValue(plan);
  const signal = new AbortController().signal;
  expect(await getMobilePlan({ generation: 1, workspaceId: id }, signal)).toEqual(plan);
  expect(api.get).toHaveBeenCalledWith(
    "/billing/entitlement/me",
    expect.objectContaining({ headers: { "x-fizz-workspace-id": id }, cache: "no-store", signal })
  );
});
it("rejects a workspace subscription in a personal response", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...plan,
    subscription: { ...subscription, subjectType: "workspace" },
  });
  await expect(getMobilePlan({ generation: 1 }, new AbortController().signal)).rejects.toThrow(
    "scope mismatch"
  );
});
it("cancels only the requested subscription and rejects mismatched receipts", async () => {
  vi.mocked(api.post).mockResolvedValue({
    ...subscription,
    id: "00000000-0000-4000-8000-000000000002",
  });
  await expect(
    cancelMobileSubscription(id, { generation: 1 }, new AbortController().signal)
  ).rejects.toThrow("scope mismatch");
  expect(api.post).toHaveBeenCalledWith(
    `/billing/subscriptions/${id}/cancel`,
    expect.objectContaining({ data: {}, retry: false })
  );
});
it("blocks old-account and aborted writes before dispatch", async () => {
  h.generation = 2;
  await expect(
    cancelMobileSubscription(id, { generation: 1 }, new AbortController().signal)
  ).rejects.toThrow();
  const c = new AbortController();
  c.abort();
  await expect(cancelMobileSubscription(id, { generation: 2 }, c.signal)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { status: "canceled" },
  { status: "past_due" },
  { cancelAtPeriodEnd: true },
  { interval: "one_time" },
])("does not offer cancellation for %j", (change) => {
  expect(
    canCancelMobileSubscription({ ...plan, subscription: { ...subscription, ...change } })
  ).toBe(false);
});
it("allows active recurring cancellation and keeps large price amounts exact", () => {
  expect(canCancelMobileSubscription(plan)).toBe(true);
  expect(subscriptionAmount("9007199254740993", "USD", "en-US")).toBe("USD 90,071,992,547,409.93");
});

it("does not report cancellation from an unchanged active receipt", async () => {
  vi.mocked(api.post).mockResolvedValue(subscription);
  await expect(
    cancelMobileSubscription(id, { generation: 1 }, new AbortController().signal)
  ).rejects.toThrow("not confirmed");
});

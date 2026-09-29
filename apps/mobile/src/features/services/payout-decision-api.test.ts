import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  decidePayout,
  fetchPayoutDecisionAccess,
  payoutDecisionInput,
  type DecisionPayout,
} from "./payout-decision-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const record: DecisionPayout = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  userId: "recipient",
  currency: "USD",
  amountMinor: "1000",
  netAmountMinor: "800",
  withholdingAmountMinor: "200",
  note: null,
  createdAt: "2026-09-29T00:00:00Z",
  status: "pending",
  version: 2,
};
const input = {
  action: "pay" as const,
  paymentMethod: "bank_transfer" as const,
  paymentReference: "reference",
};
const response = {
  ...record,
  version: 3,
  status: "paid",
  paidByUserId: "manager",
  voidedByUserId: null,
  voidReason: null,
  paymentMethod: "bank_transfer",
  paymentReference: "reference",
  paymentProofUrl: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("requires payout management independently of ledger visibility", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "manager", permissions: ["finance.ledger.view"] });
  expect(await fetchPayoutDecisionAccess("crew", "manager", new AbortController().signal)).toBe(
    false
  );
  await expect(
    fetchPayoutDecisionAccess("crew", "other", new AbortController().signal)
  ).rejects.toThrow("account mismatch");
});
it("records external payment metadata and original version only", async () => {
  vi.mocked(api.post).mockResolvedValue(response);
  await decidePayout(record, input, "manager", 1);
  expect(api.post).toHaveBeenCalledExactlyOnceWith(`/crew-payouts/${record.id}/pay`, {
    service: "aurora",
    data: { expectedVersion: 2, paymentMethod: "bank_transfer", paymentReference: "reference" },
  });
});
it("voids with a trimmed required reason", async () => {
  vi.mocked(api.post).mockResolvedValue({
    ...response,
    status: "voided",
    voidedByUserId: "manager",
    voidReason: "Duplicate",
  });
  await decidePayout(record, { action: "void", reason: " Duplicate " }, "manager", 1);
  expect(api.post).toHaveBeenCalledWith(`/crew-payouts/${record.id}/void`, {
    service: "aurora",
    data: { expectedVersion: 2, reason: "Duplicate" },
  });
});
it.each([
  { ...input, paymentReference: " " },
  { ...input, paymentProofUrl: "javascript:alert(1)" },
  { ...input, paymentProofUrl: "https://user:pass@example.com" },
  { action: "void", reason: " " },
])("validates payment/reference/reason input before posting", (value) => {
  expect(payoutDecisionInput.safeParse(value).success).toBe(false);
});
it.each([
  { version: 2 },
  { amountMinor: "1001" },
  { netAmountMinor: "799" },
  { withholdingAmountMinor: "201" },
  { userId: "other" },
  { crewId: "other" },
  { currency: "CNY" },
  { paidByUserId: "other" },
  { paymentReference: "wrong" },
  { status: "pending" },
])("rejects wrong financial response", async (patch) => {
  vi.mocked(api.post).mockResolvedValue({ ...response, ...patch });
  await expect(decidePayout(record, input, "manager", 1)).rejects.toThrow("response mismatch");
});
it("rejects settled payouts and stale accounts without writing", async () => {
  await expect(decidePayout({ ...record, status: "paid" }, input, "manager", 1)).rejects.toThrow(
    "pending"
  );
  h.generation = 2;
  await expect(decidePayout(record, input, "manager", 1)).rejects.toThrow("session expired");
  expect(api.post).not.toHaveBeenCalled();
});
it("preserves server conflicts without retry", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Version conflict"));
  await expect(decidePayout(record, input, "manager", 1)).rejects.toThrow("Version conflict");
  expect(api.post).toHaveBeenCalledOnce();
});

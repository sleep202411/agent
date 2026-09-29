import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchFinanceDetail, financeProofUrl } from "./crew-finance-detail-api";
import type { FinanceRow } from "./crew-finance-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const selected: FinanceRow = {
  id,
  userId: "user",
  currency: "USD",
  amountMinor: "100",
  createdAt: "2026-09-29T00:00:00Z",
  status: "posted",
  title: "Reward",
  description: null,
};
const event = {
  id,
  actorUserId: "manager",
  action: "earning.posted",
  createdAt: selected.createdAt,
};
const earning = {
  ...selected,
  crewId: "crew",
  sourceType: "task_reward",
  version: 1,
  task: null,
  agreement: null,
  rejectionReason: null,
  reversalReason: null,
  postedAt: selected.createdAt,
  rejectedAt: null,
  reversedAt: null,
  events: [event],
};
const payout = {
  ...selected,
  crewId: "crew",
  status: "paid",
  netAmountMinor: "80",
  withholdingAmountMinor: "20",
  note: null,
  paymentMethod: "bank_transfer",
  paymentReference: "ref",
  paymentProofUrl: null,
  voidReason: null,
  paidAt: selected.createdAt,
  voidedAt: null,
  allocations: [{ id, amountMinor: "100", earning: { id, title: "Reward", task: null } }],
  events: [{ ...event, action: "payout.paid" }],
};
const signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
it("loads authoritative earning detail and decisions", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...earning,
    status: "reversed",
    reversalReason: "Correction",
  });
  const record = await fetchFinanceDetail("crew", "earnings", selected, signal);
  expect(record.status).toBe("reversed");
  expect(api.get).toHaveBeenCalledWith(`/crew-earnings/${id}`, { service: "aurora", signal });
});
it.each([
  { id: "22222222-2222-4222-8222-222222222222" },
  { crewId: "other" },
  { userId: "other" },
  { currency: "CNY" },
  { events: [event, event] },
])("rejects mismatched financial details", async (patch) => {
  vi.mocked(api.get).mockResolvedValue({ ...earning, ...patch });
  await expect(fetchFinanceDetail("crew", "earnings", selected, signal)).rejects.toThrow(
    "scope mismatch"
  );
});
it("loads payout allocations and rejects duplicate allocations", async () => {
  vi.mocked(api.get).mockResolvedValue(payout);
  expect(await fetchFinanceDetail("crew", "payouts", selected, signal)).toMatchObject({
    netAmountMinor: "80",
    allocations: payout.allocations,
  });
  vi.mocked(api.get).mockResolvedValue({
    ...payout,
    allocations: [...payout.allocations, ...payout.allocations],
  });
  await expect(fetchFinanceDetail("crew", "payouts", selected, signal)).rejects.toThrow(
    "Duplicate payout allocations"
  );
});
it("preserves forbidden errors instead of falling back to stale list data", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Forbidden"));
  await expect(fetchFinanceDetail("crew", "earnings", selected, signal)).rejects.toThrow(
    "Forbidden"
  );
});
it.each([
  null,
  "",
  "javascript:alert(1)",
  "file:///private/test",
  "http://example.com/proof",
  "https://user:pass@example.com/proof",
  "not a url",
])("does not open unsafe proof URLs: %s", (value) => {
  expect(financeProofUrl(value)).toBeNull();
});
it("preserves HTTPS proof query signatures", () => {
  expect(financeProofUrl("https://example.com/proof?token=abc")).toBe(
    "https://example.com/proof?token=abc"
  );
});

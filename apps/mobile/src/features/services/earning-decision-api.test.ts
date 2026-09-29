import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  decideEarning,
  fetchEarningDecisionAccess,
  type DecisionEarning,
} from "./earning-decision-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const record: DecisionEarning = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  userId: "recipient",
  currency: "USD",
  amountMinor: "100",
  createdAt: "2026-09-29T00:00:00Z",
  title: "Bonus",
  description: null,
  sourceType: "milestone_bonus",
  status: "pending",
  version: 2,
};
const response = {
  ...record,
  version: 3,
  status: "posted",
  approvedByUserId: "manager",
  rejectedByUserId: null,
  reversedByUserId: null,
  rejectionReason: null,
  reversalReason: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("checks independent decision permissions and current account", async () => {
  vi.mocked(api.get).mockResolvedValue({
    userId: "manager",
    permissions: ["finance.earnings.reverse", "finance.ledger.view"],
  });
  expect(await fetchEarningDecisionAccess("crew", "manager", new AbortController().signal)).toEqual(
    { approve: false, reverse: true }
  );
  await expect(
    fetchEarningDecisionAccess("crew", "other", new AbortController().signal)
  ).rejects.toThrow("account mismatch");
});
it("approves the original version without changing money or recipient", async () => {
  vi.mocked(api.post).mockResolvedValue(response);
  await decideEarning(record, "approve", "", "manager", 1);
  expect(api.post).toHaveBeenCalledWith(`/crew-earnings/${record.id}/approve`, {
    service: "aurora",
    data: { expectedVersion: 2 },
  });
});
it.each(["reject", "reverse"] as const)("sends a trimmed reason for %s", async (action) => {
  const original = {
    ...record,
    status: action === "reverse" ? ("posted" as const) : ("pending" as const),
  };
  vi.mocked(api.post).mockResolvedValue({
    ...response,
    status: action === "reject" ? "rejected" : "reversed",
    [action === "reject" ? "rejectedByUserId" : "reversedByUserId"]: "manager",
    [action === "reject" ? "rejectionReason" : "reversalReason"]: "Correction",
  });
  await decideEarning(original, action, " Correction ", "manager", 1);
  expect(api.post).toHaveBeenCalledWith(`/crew-earnings/${record.id}/${action}`, {
    service: "aurora",
    data: { expectedVersion: 2, reason: "Correction" },
  });
});
it("blocks invalid transitions, missing reasons and expired sessions", async () => {
  await expect(decideEarning(record, "reverse", "Correction", "manager", 1)).rejects.toThrow();
  await expect(decideEarning(record, "reject", " ", "manager", 1)).rejects.toThrow();
  h.generation = 2;
  await expect(decideEarning(record, "approve", "", "manager", 1)).rejects.toThrow(
    "session expired"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { version: 2 },
  { userId: "foreign" },
  { crewId: "foreign" },
  { currency: "CNY" },
  { amountMinor: "101" },
  { approvedByUserId: "other" },
  { status: "pending" },
])("rejects an incorrect financial acknowledgement", async (patch) => {
  vi.mocked(api.post).mockResolvedValue({ ...response, ...patch });
  await expect(decideEarning(record, "approve", "", "manager", 1)).rejects.toThrow(
    "response mismatch"
  );
});
it("preserves payout-allocation conflicts without retrying", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("CREW_EARNING_ALREADY_ALLOCATED"));
  await expect(
    decideEarning({ ...record, status: "posted" }, "reverse", "Correction", "manager", 1)
  ).rejects.toThrow("CREW_EARNING_ALREADY_ALLOCATED");
  expect(api.post).toHaveBeenCalledTimes(1);
});

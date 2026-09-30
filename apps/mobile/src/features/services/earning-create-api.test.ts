import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createEarning,
  earningAmountMinor,
  fetchEarningCreateAccess,
  newEarning,
} from "./earning-create-api";
const h = vi.hoisted(() => ({ generation: 1, cn: false }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({
  get isChinaRegion() {
    return h.cn;
  },
}));
const input = {
  crewMemberId: "member",
  sourceType: "milestone_bonus" as const,
  title: "Bonus",
  currency: "USD" as const,
  amountMinor: "101",
  idempotencyKey: "unique-retry-key",
};
const receipt = {
  ...input,
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  userId: "recipient",
  createdByUserId: "manager",
  description: null,
  status: "pending",
  version: 1,
  createdAt: "2026-09-30T00:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.cn = false;
  vi.mocked(api.post).mockResolvedValue(receipt);
});
it.each([
  ["0.01", "1"],
  ["1.1", "110"],
  ["90071992547409.93", "9007199254740993"],
  ["92233720368547758.07", "9223372036854775807"],
])("converts %s without floating point loss", (value, expected) => {
  expect(earningAmountMinor(value)).toBe(expected);
});
it.each([
  "0",
  "-1",
  "1e3",
  "1.001",
  "01",
  "NaN",
  "1,000",
  "92233720368547758.08",
  "99999999999999999999999999999999",
])("rejects invalid amount %s", (value) => {
  expect(earningAmountMinor(value)).toBeUndefined();
});
it("uses creation permission independently of ledger access and validates account", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "manager", permissions: ["finance.ledger.view"] });
  expect(await fetchEarningCreateAccess("crew", "manager", new AbortController().signal)).toBe(
    false
  );
  vi.mocked(api.get).mockResolvedValue({
    userId: "manager",
    permissions: ["finance.earnings.create"],
  });
  expect(await fetchEarningCreateAccess("crew", "manager", new AbortController().signal)).toBe(
    true
  );
  await expect(
    fetchEarningCreateAccess("crew", "other", new AbortController().signal)
  ).rejects.toThrow("account mismatch");
});
it("posts only validated fields and preserves the same key on retry", async () => {
  await createEarning("crew", "recipient", input, "manager", 1);
  await createEarning("crew", "recipient", input, "manager", 1);
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post).toHaveBeenLastCalledWith("/crews/crew/earnings", {
    service: "aurora",
    data: input,
  });
});
it("accepts a previously created earning subsequently approved", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...receipt, status: "posted", version: 2 });
  expect((await createEarning("crew", "recipient", input, "manager", 1)).status).toBe("posted");
});
it.each([
  { crewId: "other" },
  { userId: "other" },
  { crewMemberId: "other" },
  { createdByUserId: "other" },
  { amountMinor: "102" },
  { currency: "CNY" },
  { title: "Other" },
  { sourceType: "task_reward" },
  { description: "Unexpected" },
])("rejects mismatched receipt %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...receipt, ...change });
  await expect(createEarning("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "receipt mismatch"
  );
});
it("rejects wrong regional currency and allows CNY on CN", async () => {
  h.cn = true;
  await expect(createEarning("crew", "recipient", input, "manager", 1)).rejects.toThrow("currency");
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.post).mockResolvedValue({ ...receipt, currency: "CNY" });
  await createEarning("crew", "recipient", { ...input, currency: "CNY" }, "manager", 1);
});
it("prevents stale session requests and late receipt acceptance", async () => {
  h.generation = 2;
  await expect(createEarning("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "session expired"
  );
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(createEarning("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "session expired"
  );
});
it.each([
  { sourceType: "task_reward" },
  { sourceType: "contract_compensation" },
  { amountMinor: "0" },
  { amountMinor: "9223372036854775808" },
  { title: " " },
  { agreementId: "unexpected" },
])("rejects invalid manual input %j", (change) => {
  expect(newEarning.safeParse({ ...input, ...change }).success).toBe(false);
});
it("preserves server failure for retry without inventing a receipt", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Active crew member not found."));
  await expect(createEarning("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "Active crew member not found."
  );
});

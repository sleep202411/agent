import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createPayout,
  withholdingAmountMinor,
  fetchPayoutCreateAccess,
  newPayout,
} from "./payout-create-api";
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
  withholdingAmountMinor: "1",
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
  note: null,
  netAmountMinor: "100",
  allocations: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      amountMinor: "101",
      earning: { id: "33333333-3333-4333-8333-333333333333" },
    },
  ],
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
  expect(withholdingAmountMinor(value)).toBe(expected);
});
it.each([
  "-1",
  "1e3",
  "1.001",
  "01",
  "NaN",
  "1,000",
  "92233720368547758.08",
  "99999999999999999999999999999999",
])("rejects invalid amount %s", (value) => {
  expect(withholdingAmountMinor(value)).toBeUndefined();
});
it("uses creation permission independently of ledger access and validates account", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "manager", permissions: ["finance.ledger.view"] });
  expect(await fetchPayoutCreateAccess("crew", "manager", new AbortController().signal)).toBe(
    false
  );
  vi.mocked(api.get).mockResolvedValue({
    userId: "manager",
    permissions: ["finance.payouts.create"],
  });
  expect(await fetchPayoutCreateAccess("crew", "manager", new AbortController().signal)).toBe(true);
  await expect(
    fetchPayoutCreateAccess("crew", "other", new AbortController().signal)
  ).rejects.toThrow("account mismatch");
});
it("posts only validated fields and preserves the same key on retry", async () => {
  await createPayout("crew", "recipient", input, "manager", 1);
  await createPayout("crew", "recipient", input, "manager", 1);
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post).toHaveBeenLastCalledWith("/crews/crew/payouts", {
    service: "aurora",
    data: input,
  });
});
it("accepts a previously created payout subsequently paid", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...receipt, status: "paid", version: 2 });
  expect((await createPayout("crew", "recipient", input, "manager", 1)).status).toBe("paid");
});
it.each([
  { crewId: "other" },
  { userId: "other" },
  { crewMemberId: "other" },
  { createdByUserId: "other" },
  { amountMinor: "102" },
  { currency: "CNY" },
  { netAmountMinor: "101" },
  { withholdingAmountMinor: "2" },
  { note: "Unexpected" },
])("rejects mismatched receipt %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...receipt, ...change });
  await expect(createPayout("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "receipt mismatch"
  );
});
it("rejects wrong regional currency and allows CNY on CN", async () => {
  h.cn = true;
  await expect(createPayout("crew", "recipient", input, "manager", 1)).rejects.toThrow("currency");
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.post).mockResolvedValue({ ...receipt, currency: "CNY" });
  await createPayout("crew", "recipient", { ...input, currency: "CNY" }, "manager", 1);
});
it("prevents stale session requests and late receipt acceptance", async () => {
  h.generation = 2;
  await expect(createPayout("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "session expired"
  );
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(createPayout("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "session expired"
  );
});
it.each([
  { withholdingAmountMinor: "102" },
  { withholdingAmountMinor: "101" },
  { withholdingAmountMinor: "-1" },
  { amountMinor: "0" },
  { amountMinor: "9223372036854775808" },
  { amountMinor: "abc" },
  { agreementId: "unexpected" },
])("rejects invalid manual input %j", (change) => {
  expect(newPayout.safeParse({ ...input, ...change }).success).toBe(false);
});
it("preserves server failure for retry without inventing a receipt", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Active crew member not found."));
  await expect(createPayout("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "Active crew member not found."
  );
});

it.each(["0", "0.0", "0.00", " 0 "])("accepts zero withholding %s", (value) => {
  expect(withholdingAmountMinor(value)).toBe("0");
});
it.each([
  { allocations: [] },
  { allocations: [{ ...receipt.allocations[0], amountMinor: "100" }] },
  { allocations: [{ ...receipt.allocations[0], amountMinor: "0" }] },
  {
    allocations: [
      { ...receipt.allocations[0], amountMinor: "50" },
      { ...receipt.allocations[0], amountMinor: "51" },
    ],
  },
  {
    allocations: [
      { ...receipt.allocations[0], amountMinor: "50" },
      { ...receipt.allocations[0], id: "44444444-4444-4444-8444-444444444444", amountMinor: "51" },
    ],
  },
])("rejects incomplete or duplicate allocations %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...receipt, ...change });
  await expect(createPayout("crew", "recipient", input, "manager", 1)).rejects.toThrow();
});
it("retains authoritative insufficient-balance error without faking success", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Only USD 0.50 is available for this member."));
  await expect(createPayout("crew", "recipient", input, "manager", 1)).rejects.toThrow(
    "Only USD 0.50"
  );
});

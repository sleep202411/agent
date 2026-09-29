import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchFinanceAccess, fetchFinancePage, formatFinanceMoney } from "./crew-finance-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  crewId: "crew",
  userId: "user",
  currency: "USD",
  amountMinor: "9223372036854775807",
  createdAt: "2026-09-29T00:00:00Z",
  title: "Reward",
  description: null,
  sourceType: "task_reward",
  status: "posted",
};
const group = { count: 1, amountMinor: row.amountMinor };
const page = {
  items: [row],
  nextCursor: null,
  summary: {
    byStatus: {
      pending: { count: 0, amountMinor: "0" },
      posted: group,
      rejected: { count: 0, amountMinor: "0" },
      reversed: { count: 0, amountMinor: "0" },
    },
    postedThisMonthAmountMinor: row.amountMinor,
  },
};
const input = {
  view: "earnings" as const,
  scope: "mine" as const,
  currency: "USD" as const,
  status: "all",
  cursor: null,
};
const signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
it("formats signed large integer cents exactly", () => {
  expect(formatFinanceMoney(row.amountMinor, "USD")).toBe("USD 92233720368547758.07");
  expect(formatFinanceMoney("-101", "CNY")).toBe("CNY -1.01");
  expect(formatFinanceMoney("0", "USD")).toBe("USD 0.00");
  expect(() => formatFinanceMoney("1.25", "USD")).toThrow();
});
it("requires the current account for ledger permissions", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "other", permissions: ["finance.ledger.view"] });
  await expect(fetchFinanceAccess("crew", "user", signal)).rejects.toThrow("account mismatch");
  vi.mocked(api.get).mockResolvedValue({ userId: "user", permissions: ["production.manage"] });
  expect(await fetchFinanceAccess("crew", "user", signal)).toBe(false);
});
it("uses explicit scope and currency and server summaries without rounding", async () => {
  vi.mocked(api.get).mockResolvedValue(page);
  const result = await fetchFinancePage("crew", "user", input, signal);
  expect(result.items[0]!.amountMinor).toBe(row.amountMinor);
  expect(result.summary[0]!.amount).toBe(row.amountMinor);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/earnings", {
    service: "aurora",
    signal,
    params: { scope: "mine", currency: "USD", limit: 50 },
  });
});
it.each([{ crewId: "other" }, { userId: "other" }, { currency: "CNY" }, { amountMinor: 100 }])(
  "rejects foreign or malformed ledger records",
  async (patch) => {
    vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...row, ...patch }] });
    await expect(fetchFinancePage("crew", "user", input, signal)).rejects.toThrow();
  }
);
it("allows other recipients only in Crew scope and checks status filters", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...row, userId: "other" }] });
  expect(
    (await fetchFinancePage("crew", "user", { ...input, scope: "crew" }, signal)).items[0]!.userId
  ).toBe("other");
  vi.mocked(api.get).mockResolvedValue(page);
  await expect(
    fetchFinancePage("crew", "user", { ...input, status: "pending" }, signal)
  ).rejects.toThrow("page mismatch");
});
it("rejects duplicate entries and repeated cursors", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [row, row] });
  await expect(fetchFinancePage("crew", "user", input, signal)).rejects.toThrow("page mismatch");
  vi.mocked(api.get).mockResolvedValue({ ...page, nextCursor: id });
  await expect(fetchFinancePage("crew", "user", { ...input, cursor: id }, signal)).rejects.toThrow(
    "page mismatch"
  );
});
it("reads payout gross, withheld and net without treating reservations as paid", async () => {
  vi.mocked(api.get).mockResolvedValue({
    items: [
      {
        ...row,
        status: "pending",
        amountMinor: "1000",
        netAmountMinor: "800",
        withholdingAmountMinor: "200",
        note: "Invoice",
      },
    ],
    nextCursor: null,
    summary: {
      confirmedAmountMinor: "1500",
      availableAmountMinor: "500",
      reservedAmountMinor: "1000",
      paidAmountMinor: "0",
    },
  });
  const result = await fetchFinancePage("crew", "user", { ...input, view: "payouts" }, signal);
  expect(result.items[0]).toMatchObject({
    amountMinor: "1000",
    netAmountMinor: "800",
    withholdingAmountMinor: "200",
    description: "Invoice",
  });
  expect(result.summary).toContainEqual({ label: "paid", amount: "0" });
});
it("rejects invalid filters before making a request", async () => {
  await expect(
    fetchFinancePage("crew", "user", { ...input, view: "payouts", status: "posted" }, signal)
  ).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
});

import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCrewIncome } from "./crew-income-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  crewId: "crew",
  userId: "user",
  currency: "USD",
  amountMinor: "9223372036854775807",
  createdAt: "2026-10-01T00:00:00Z",
  title: "Reward",
  description: null,
  sourceType: "task_reward",
  status: "posted",
  postedAt: null,
  task: null,
};
const zero = { count: 0, amountMinor: "0" };
const page = {
  items: [row],
  nextCursor: null,
  summary: {
    byStatus: {
      posted: { count: 1, amountMinor: row.amountMinor },
      pending: zero,
      rejected: zero,
      reversed: zero,
    },
  },
};
const signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
it("reads personal totals without requesting ledger-admin access or passing a user ID", async () => {
  vi.mocked(api.get).mockResolvedValue(page);
  const result = await fetchCrewIncome("user", "USD", "earnings", "", null, signal);
  expect(result.summary.find((item) => item.key.endsWith(".posted"))?.amount).toBe(row.amountMinor);
  expect(api.get).toHaveBeenCalledWith("/me/crew-earnings", {
    service: "aurora",
    signal,
    retry: false,
    params: { currency: "USD", limit: 50 },
  });
});
it.each([{ userId: "other" }, { currency: "CNY" }, { crewId: "other" }, { amountMinor: 123 }])(
  "rejects foreign or lossy records",
  async (patch) => {
    vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...row, ...patch }] });
    await expect(
      fetchCrewIncome("user", "USD", "earnings", "crew", null, signal)
    ).rejects.toThrow();
  }
);
it("reads payout allocations, separate settlement balances and gross/net groups", async () => {
  const payout = {
    ...row,
    status: "paid",
    note: null,
    netAmountMinor: "800",
    withholdingAmountMinor: "200",
    amountMinor: "1000",
    paidAt: null,
    paymentReference: "bank-ref",
    voidReason: null,
    allocations: [{ id: "allocation", amountMinor: "1000", earning: { title: "Reward" } }],
  };
  vi.mocked(api.get).mockResolvedValue({
    items: [payout],
    nextCursor: null,
    summary: {
      confirmedAmountMinor: "2000",
      reservedAmountMinor: "100",
      paidAmountMinor: "1000",
      availableAmountMinor: "900",
      byStatus: [{ status: "paid", amountMinor: "1000", netAmountMinor: "800" }],
    },
  });
  const result = await fetchCrewIncome("user", "USD", "payouts", "crew", id, signal);
  expect(result.summary.find((item) => item.key.endsWith(".available"))?.amount).toBe("900");
  expect(result.summary.find((item) => item.key === "crewPersonalPayouts.paid")?.amount).toBe(
    "800"
  );
  expect(result.items[0]).toMatchObject({
    allocations: payout.allocations,
    paymentReference: "bank-ref",
  });
  expect(vi.mocked(api.get).mock.calls[0][1]?.params).toEqual({
    currency: "USD",
    limit: 50,
    crewId: "crew",
    cursor: id,
  });
});

it("passes official income filters and preserves exact monthly/source totals and provenance", async () => {
  const distribution = {
    id,
    revenueReference: "Distribution 2026-10",
    confirmedAt: "2026-10-01T00:00:00Z",
    contract: { id, filename: "Signed contract.pdf" },
    shareBps: 3333,
  };
  const source = { sourceType: "task_reward", count: 1, amountMinor: row.amountMinor };
  vi.mocked(api.get).mockResolvedValue({
    ...page,
    items: [
      { ...row, crew: { id: "crew", name: "Animation Crew" }, revenueDistribution: distribution },
    ],
    summary: {
      ...page.summary,
      postedThisMonthAmountMinor: row.amountMinor,
      postedBySource: [source],
    },
  });
  const filters = {
    status: "posted" as const,
    sourceType: "task_reward" as const,
    recordedFrom: "2026-10-01",
    recordedThrough: "2026-10-06",
  };
  const result = await fetchCrewIncome("user", "USD", "earnings", "", null, signal, filters);
  expect(api.get).toHaveBeenLastCalledWith(
    "/me/crew-earnings",
    expect.objectContaining({ params: { currency: "USD", limit: 50, ...filters } })
  );
  expect(result.summary[0]).toEqual({
    key: "crewPersonalIncome.postedThisMonth",
    amount: row.amountMinor,
  });
  expect(result.postedBySource).toEqual([source]);
  expect(result.items[0]).toMatchObject({
    revenueDistribution: distribution,
    crew: { name: "Animation Crew" },
  });
});
it.each([
  { recordedFrom: "2026-02-30" },
  { recordedThrough: "tomorrow" },
  { recordedFrom: "2026-10-07", recordedThrough: "2026-10-05" },
])("rejects invalid date filters before fetching %j", async (filters) => {
  await expect(
    fetchCrewIncome("user", "USD", "earnings", "", null, signal, filters)
  ).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
});
it("rejects responses outside the selected status/source/date scope", async () => {
  vi.mocked(api.get).mockResolvedValue(page);
  for (const filters of [
    { status: "pending" as const },
    { sourceType: "revenue_share" as const },
    { recordedFrom: "2026-10-02" },
    { recordedThrough: "2026-09-30" },
  ])
    await expect(
      fetchCrewIncome("user", "USD", "earnings", "", null, signal, filters)
    ).rejects.toThrow("mismatch");
});

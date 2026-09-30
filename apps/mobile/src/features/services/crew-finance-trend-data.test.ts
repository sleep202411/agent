import { expect, it } from "vitest";
import { financeTrendGeometry, financeProfitShare } from "./crew-finance-trend-data";
const trend = {
  timezone: "UTC",
  from: "2026-09-01T00:00:00.000Z",
  through: "2026-09-30T11:00:00.000Z",
  days: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    amountMinor: "0",
  })),
};
it("renders flat zero data with finite coordinates and a zero baseline", () => {
  const graph = financeTrendGeometry(trend)!;
  expect(graph.min).toBe("0");
  expect(graph.max).toBe("0");
  expect(graph.baseline).toBe(140);
  expect(graph.points).not.toMatch(/NaN|Infinity/);
});
it("handles large signed values without floating-point money conversion", () => {
  const days = trend.days.map((day, i) => ({
    ...day,
    amountMinor: i === 0 ? "-9223372036854775807" : "9223372036854775807",
  }));
  const graph = financeTrendGeometry({ ...trend, days })!;
  expect(graph.min).toBe("-9223372036854775807");
  expect(graph.max).toBe("9223372036854775807");
  expect(graph.baseline).toBe(80);
  expect(graph.points.startsWith("20,140 ")).toBe(true);
  expect(graph.points.endsWith("580,20")).toBe(true);
});
it.each([
  undefined,
  {},
  { ...trend, timezone: "local" },
  { ...trend, from: "2026-09-01T01:00:00.000Z" },
  { ...trend, through: "2026-10-01T00:00:00.000Z" },
  { ...trend, days: trend.days.slice(1) },
  { ...trend, days: trend.days.map((day, i) => (i === 1 ? { ...day, date: "2026-09-01" } : day)) },
  { ...trend, days: trend.days.map((day) => ({ ...day, amountMinor: 1 })) },
  { ...trend, days: trend.days.map((day) => ({ ...day, amountMinor: "1.5" })) },
])("rejects malformed or incomplete trend %j", (value) => {
  expect(financeTrendGeometry(value)).toBeNull();
});
it("sums only confirmed revenue-share source aggregates exactly", () => {
  expect(
    financeProfitShare([
      { sourceType: "revenue_share", amountMinor: "9223372036854775807" },
      { sourceType: "task_reward", amountMinor: "999" },
      { sourceType: "revenue_share", amountMinor: "-1" },
    ])
  ).toBe("9223372036854775806");
  expect(financeProfitShare([])).toBe("0");
  expect(financeProfitShare(undefined)).toBeUndefined();
  expect(financeProfitShare([{ sourceType: "revenue_share", amountMinor: 123 }])).toBeUndefined();
});

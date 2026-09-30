import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { EarningTrend, earningTrendGeometry, postedProfitShare } from "./earning-trend";
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
function trend(amount = "0") {
  return {
    timezone: "UTC",
    from: "2026-08-31T00:00:00.000Z",
    through: "2026-09-29T12:00:00.000Z",
    days: Array.from({ length: 30 }, (_, index) => {
      const date = new Date("2026-08-31T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + index);
      return { date: date.toISOString().slice(0, 10), amountMinor: amount };
    }),
  };
}
it("keeps large monetary values exact while using bounded plot coordinates", () => {
  const value = trend("9007199254740993123");
  value.days[0]!.amountMinor = "-123";
  const graph = earningTrendGeometry(value)!;
  expect(graph.max).toBe("9007199254740993123");
  expect(graph.min).toBe("-123");
  expect(graph.points).not.toMatch(/NaN|Infinity/);
  const html = renderToStaticMarkup(<EarningTrend value={value} currency="USD" locale="en-US" />);
  expect(html).toContain("90,071,992,547,409,931.23");
  expect(html).toContain("USD -1.23");
  expect(html).toContain("dailyAmounts");
});
it.each([
  null,
  {},
  { ...trend(), days: [] },
  { ...trend(), timezone: "local" },
  { ...trend(), days: [{ date: "bad", amountMinor: "oops" }, ...trend().days.slice(1)] },
])("rejects incomplete or malformed trends without claiming zero", (value) => {
  expect(earningTrendGeometry(value)).toBeNull();
  const html = renderToStaticMarkup(<EarningTrend value={value} currency="CNY" locale="en-US" />);
  expect(html).toContain("unavailable");
  expect(html).not.toContain("CNY 0.00");
});
it("hides a stale chart after a failed refresh", () => {
  const html = renderToStaticMarkup(
    <EarningTrend value={trend("12345")} failed currency="USD" locale="en-US" />
  );
  expect(html).toContain("unavailable");
  expect(html).not.toContain("123.45");
  expect(html).not.toContain("<svg");
});
it("shows a genuine zero-income period and distinguishes it from loading", () => {
  const graph = earningTrendGeometry(trend())!;
  expect(graph.min).toBe("0");
  expect(graph.max).toBe("0");
  expect(graph.points).not.toMatch(/NaN|Infinity/);
  expect(
    renderToStaticMarkup(<EarningTrend value={undefined} loading currency="USD" locale="en-US" />)
  ).toContain("loading");
});
it("computes confirmed profit share only from a valid source summary", () => {
  expect(postedProfitShare(undefined)).toBeUndefined();
  expect(postedProfitShare({})).toBeUndefined();
  expect(postedProfitShare([{ sourceType: "revenue_share", amountMinor: "bad" }])).toBeUndefined();
  expect(postedProfitShare([])).toBe("0");
  expect(
    postedProfitShare([
      { sourceType: "task_reward", amountMinor: "200" },
      { sourceType: "revenue_share", amountMinor: "9007199254740993" },
    ])
  ).toBe("9007199254740993");
});

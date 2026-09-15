import { expect, it } from "vitest";
import { commissionBpsInput, integerInput, parseRewardItems } from "./referral-inputs";
function form(value: string) {
  const data = new FormData();
  data.set("rewards", value);
  return data;
}
it("preserves the largest exact numeric amount and rejects rounded input", () => {
  expect(integerInput("9007199254740991", "amount")).toBe(Number.MAX_SAFE_INTEGER);
  for (const value of ["9007199254740992", "9007199254740993", "1.1", "1e3", "Infinity", "-1"])
    expect(() => integerInput(value, "amount")).toThrow();
  expect(integerInput("-3", "rank", 0, Number.MIN_SAFE_INTEGER)).toBe(-3);
});
it("converts percentages without rounding extra decimal places", () => {
  expect(commissionBpsInput("29.29")).toBe(2929);
  expect(commissionBpsInput("0.01")).toBe(1);
  expect(commissionBpsInput("100")).toBe(10000);
  for (const value of ["29.299", "100.01", "-1", "NaN", "1e1"])
    expect(() => commissionBpsInput(value)).toThrow();
});
it("rejects broken bundle data instead of silently removing rewards", () => {
  for (const value of [
    "",
    "{",
    "null",
    "{}",
    "[null]",
    '[{"kind":"unknown"}]',
    '[{"kind":"cash"}]',
    '[{"kind":"cash","amountMinor":"9007199254740993"}]',
  ])
    expect(() => parseRewardItems(form(value), "rewards")).toThrow();
  expect(parseRewardItems(form("[]"), "rewards")).toEqual([]);
});
it("preserves valid monetary and membership bundles and checks duration bounds", () => {
  expect(
    parseRewardItems(
      form('[{"kind":"cash","amountMinor":"123"},{"kind":"membership_compute","days":30}]'),
      "rewards"
    )
  ).toEqual([
    { kind: "cash", amountMinor: 123, days: 0 },
    { kind: "membership_compute", amountMinor: 0, days: 30 },
  ]);
  expect(() =>
    parseRewardItems(form('[{"kind":"membership_compute","days":3651}]'), "rewards")
  ).toThrow();
});

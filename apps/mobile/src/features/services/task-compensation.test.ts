import { expect, it } from "vitest";
import { compensationText, parseCompensation, taskCompensationShape } from "./task-compensation";
import { z } from "zod";
it("preserves unset, explicit zero and exact hundredths without rounding", () => {
  expect(parseCompensation("", 10000)).toBeNull();
  for (const [text, minor] of [
    ["0", 0],
    ["0.01", 1],
    ["1.10", 110],
    ["100", 10000],
  ] as const) {
    expect(parseCompensation(text, 10000)).toBe(minor);
    expect(parseCompensation(compensationText(minor), 10000)).toBe(minor);
  }
  expect(compensationText(null)).toBe("");
});
it("rejects excessive precision, negative, nonfinite and out-of-range terms", () => {
  for (const value of ["-1", "1.001", "NaN", "Infinity", "1e2", "100.01", "1,00"]) {
    expect(() => parseCompensation(value, 10000)).toThrow();
  }
  expect(parseCompensation("1000000000.00", 100000000000)).toBe(100000000000);
  expect(z.object(taskCompensationShape).safeParse({ profitShareBps: 10001 }).success).toBe(false);
});

it("retains explicit reward currencies and does not relabel historical amounts", () => {
  const schema = z.object(taskCompensationShape);
  for (const rewardCurrency of ["CNY", "USD"]) {
    expect(schema.parse({ rewardCurrency, rewardUsdMinor: 1234 })).toEqual({
      rewardCurrency,
      rewardUsdMinor: 1234,
    });
  }
  expect(schema.parse({ rewardUsdMinor: 1234 }).rewardCurrency).toBeUndefined();
  expect(schema.safeParse({ rewardCurrency: "BAD", rewardUsdMinor: 1234 }).success).toBe(false);
});

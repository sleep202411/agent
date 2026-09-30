import { expect, it } from "vitest";
import { parsePlanningNumber } from "./task-planning-number";
it("distinguishes clearing from zero and accepts bounded whole numbers", () => {
  expect(parsePlanningNumber("", 100)).toBeNull();
  expect(parsePlanningNumber("  ", 100)).toBeNull();
  expect(parsePlanningNumber("0", 100)).toBe(0);
  expect(parsePlanningNumber("100", 100)).toBe(100);
  expect(parsePlanningNumber("1000000", 1000000)).toBe(1000000);
});
it("rejects fractional, negative, exponential, non-numeric and excessive values", () => {
  for (const value of ["1.2", "-1", "1e2", "NaN", "Infinity", "101", "1,000", "9007199254740993"])
    expect(() => parsePlanningNumber(value, 100)).toThrow();
});

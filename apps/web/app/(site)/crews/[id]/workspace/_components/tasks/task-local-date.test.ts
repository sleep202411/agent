import { describe, expect, it } from "vitest";
import { taskLocalDate } from "./task-local-date";

describe("task calendar dates", () => {
  it("preserves the local deadline when UTC falls on another day", () => {
    const deadline = new Date(2026, 9, 20, 23, 59, 59).toISOString();
    expect(taskLocalDate(deadline)).toBe("2026-10-20");
    expect(taskLocalDate(deadline).slice(5).replace("-", "/")).toBe("10/20");
  });
  it("handles missing and malformed deadlines", () => {
    expect(taskLocalDate(null)).toBe("");
    expect(taskLocalDate(undefined)).toBe("");
    expect(taskLocalDate("invalid")).toBe("");
  });
});

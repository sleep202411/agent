import { expect, it } from "vitest";
import { instructorEarnedCredits } from "./instructor-income";
import type { Enrollment } from "./learning-api";
const row = {
  status: "approved",
  teacherId: "lead",
  teacherCredits: "9007199254740993000",
} as Enrollment;
it("uses immutable individual shares without losing precision or exposing another instructor's payout", () => {
  const shared = {
    ...row,
    instructorShares: [
      { teacherId: "lead", credits: "9007199254740992999" },
      { teacherId: "co", credits: "1" },
    ],
  };
  expect(instructorEarnedCredits(shared, "lead")).toBe("9007199254740992999");
  expect(instructorEarnedCredits(shared, "co")).toBe("1");
  expect(instructorEarnedCredits(shared, "other")).toBe("0");
  expect(instructorEarnedCredits({ ...shared, status: "submitted" }, "co")).toBe("0");
});
it("uses legacy single-instructor payouts only for their owner", () => {
  expect(instructorEarnedCredits(row, "lead")).toBe(row.teacherCredits);
  expect(instructorEarnedCredits(row, "co")).toBe("0");
});

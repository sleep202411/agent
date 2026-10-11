import { expect, it } from "vitest";
import { instructorEarnedCredits, type Enrollment } from "./api";
const row = {
  status: "approved",
  teacherId: "200",
  teacherCredits: "50",
  instructorShares: [
    { teacherId: "200", credits: "40" },
    { teacherId: "201", credits: "10" },
  ],
} as Enrollment;
it("shows each instructor's recorded share rather than the combined payout", () => {
  expect(instructorEarnedCredits(row, "200")).toBe("40");
  expect(instructorEarnedCredits(row, "201")).toBe("10");
  expect(instructorEarnedCredits(row, "999")).toBe("0");
});
it("only shows earned credits after approval", () => {
  expect(instructorEarnedCredits({ ...row, status: "submitted" }, "200")).toBe("0");
});
it.each([null, undefined, []])(
  "keeps legacy single-teacher payouts with shares=%s",
  (instructorShares) => {
    expect(instructorEarnedCredits({ ...row, instructorShares }, "200")).toBe("50");
    expect(instructorEarnedCredits({ ...row, instructorShares }, "201")).toBe("0");
  }
);
it("preserves large integer credit amounts exactly", () => {
  expect(
    instructorEarnedCredits(
      { ...row, instructorShares: [{ teacherId: "201", credits: "9007199254740993" }] },
      "201"
    )
  ).toBe("9007199254740993");
});

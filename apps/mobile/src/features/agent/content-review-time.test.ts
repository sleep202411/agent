import { expect, it } from "vitest";
import { parseReviewTimeOffset, formatReviewTimecode } from "./content-review-time";
it("matches Web timestamp units and rejects invalid clock offsets", () => {
  expect(parseReviewTimeOffset("20000ms")).toBe(20);
  expect(parseReviewTimeOffset("20s")).toBe(20);
  expect(parseReviewTimeOffset("00:20")).toBe(20);
  expect(parseReviewTimeOffset("01:02:03.5")).toBe(3723.5);
  expect(parseReviewTimeOffset("20000")).toBe(20);
  expect(parseReviewTimeOffset("00:99")).toBeNull();
  expect(parseReviewTimeOffset("-1s")).toBeNull();
  expect(parseReviewTimeOffset("bad")).toBeNull();
  expect(formatReviewTimecode(3723.5)).toBe("01:02:03");
});

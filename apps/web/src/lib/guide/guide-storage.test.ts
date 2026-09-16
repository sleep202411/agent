import { afterEach, expect, it, vi } from "vitest";
import { isGuideCompleted, markGuideCompleted, resetGuide, resetAllGuides } from "./guide-storage";
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it.each(["null", '"stale"', "42", "[]"])("recovers malformed stored state %s", (raw) => {
  localStorage.setItem("fizzdragon_guide", raw);
  expect(isGuideCompleted("storyboard")).toBe(false);
  markGuideCompleted("storyboard");
  expect(isGuideCompleted("storyboard")).toBe(true);
  resetGuide("storyboard");
  expect(isGuideCompleted("storyboard")).toBe(false);
});
it("tolerates blocked storage when resetting guides", () => {
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage denied");
  });
  expect(() => resetAllGuides()).not.toThrow();
});

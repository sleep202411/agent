import { expect, it } from "vitest";
import { resultDetails, resultCreatedAt } from "./result-details";
const output = {
  id: "clip",
  type: "video" as const,
  url: "https://test/clip.mp4",
  width: 1920,
  height: 1080,
  durationSeconds: 2.125,
};
it("preserves a fractional provider duration and reduces the actual output dimensions", () => {
  expect(resultDetails(output, "en-US")).toEqual([
    ["aiLab.resultResolution", "1920 × 1080"],
    ["aiLab.resultRatio", "16:9"],
    ["aiLab.resultDuration", "2.125"],
  ]);
});
it("omits invalid metadata without losing the valid duration", () => {
  expect(resultDetails({ ...output, width: -1, height: 0 }, "en-US")).toEqual([
    ["aiLab.resultDuration", "2.125"],
  ]);
  expect(
    resultDetails({ ...output, width: 1.5, height: 2, durationSeconds: Infinity }, "en-US")
  ).toEqual([]);
});
it("does not invent missing values or display invalid dates", () => {
  expect(
    resultDetails({ id: "image", type: "image", url: "https://test/image.png" }, "zh-HK")
  ).toEqual([]);
  expect(resultCreatedAt("not a date", "en-US")).toBeNull();
  expect(resultCreatedAt("2026-10-02T12:00:00Z", "en-US")).toContain("2026");
});

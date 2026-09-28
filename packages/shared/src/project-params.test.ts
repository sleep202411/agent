import { expect, it } from "vitest";
import { getMissingProjectParams, isProjectParamsComplete } from "./project-params.js";
const detail = { aspectRatioType: "wide", chapterLength: 5, stylePainting: "style" };
it.each([NaN, Infinity, -Infinity, 0, -1])("rejects unusable duration %s", (chapterLength) => {
  expect(getMissingProjectParams({ ...detail, chapterLength })).toEqual(["chapterLength"]);
  expect(isProjectParamsComplete({ ...detail, chapterLength })).toBe(false);
});
it("requires meaningful identifiers and retains valid duration semantics", () => {
  expect(getMissingProjectParams({ ...detail, aspectRatioType: " ", stylePainting: "\t" })).toEqual(
    ["aspectRatioType", "stylePainting"]
  );
  expect(isProjectParamsComplete(detail)).toBe(true);
  expect(isProjectParamsComplete({ ...detail, chapterLength: 2.5 })).toBe(true);
});

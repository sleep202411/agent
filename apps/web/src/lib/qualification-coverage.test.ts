import { expect, it } from "vitest";
import { coveredQualificationIds } from "./qualification-coverage";
const levels = ["I", "II", "III", "IV", "V"].map((name, index) => ({
  id: 700 + index,
  name: `FD-${name} · Creator`,
  type: 1,
}));
it.each([0, 1, 2, 3, 4])("covers only equal/lower ranks for approved index %i", (index) => {
  expect([...coveredQualificationIds(levels, new Set([700 + index]))].sort()).toEqual(
    levels.slice(0, index + 1).map((v) => v.id)
  );
});
it("does not infer approval from available levels or unrelated certificates", () => {
  expect([...coveredQualificationIds(levels, new Set())]).toEqual([]);
  expect([
    ...coveredQualificationIds([...levels, { id: 900, name: "FD-V", type: 4 }], new Set([900])),
  ]).toEqual([900]);
});
it("preserves skill/partner certificates while covering lower director ranks", () => {
  expect([...coveredQualificationIds(levels, new Set([702, 900, 901]))].sort()).toEqual([
    700, 701, 702, 900, 901,
  ]);
});

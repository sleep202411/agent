import { describe, expect, it } from "vitest";
import { prioritizeForYou } from "./prioritize-for-you";

describe("prioritizeForYou", () => {
  it("puts for-you placements first and drops duplicates from the ranked list", () => {
    const ranked = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const forYou = [{ id: "c" }, { id: "d" }];
    expect(prioritizeForYou(ranked, forYou).map((item) => item.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("keeps ranked order when the rail is empty", () => {
    const ranked = [{ id: "a" }, { id: "b" }];
    expect(prioritizeForYou(ranked, []).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("dedupes repeated for-you ids", () => {
    expect(
      prioritizeForYou([{ id: "a" }], [{ id: "b" }, { id: "b" }, { id: "a" }]).map(
        (item) => item.id
      )
    ).toEqual(["b", "a"]);
  });
});

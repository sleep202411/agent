import { describe, expect, it } from "vitest";
import { parseStoryPlaytestSource } from "./story-playtest-source";

describe("Story playtest source", () => {
  it("defaults to the current saved draft", () => {
    expect(parseStoryPlaytestSource({})).toEqual({ kind: "draft" });
  });

  it("uses the first non-empty immutable build identity", () => {
    expect(parseStoryPlaytestSource({ buildId: [" build-42 ", "build-43"] })).toEqual({
      kind: "build",
      buildId: "build-42",
    });
  });
});

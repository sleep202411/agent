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

  it("carries the chosen scene so the walk starts there", () => {
    expect(parseStoryPlaytestSource({ chapter: "chapter-9", node: " clip:S05A " })).toEqual({
      kind: "draft",
      chapterId: "chapter-9",
      nodeId: "clip:S05A",
    });
  });

  it("drops a blank scene param instead of an empty string", () => {
    expect(parseStoryPlaytestSource({ node: "  " })).toEqual({ kind: "draft" });
  });
});

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

  it("carries the chosen scene so the walk enters there", () => {
    expect(parseStoryPlaytestSource({ scene: " clip:S05A " })).toEqual({
      kind: "draft",
      sceneId: "clip:S05A",
    });
  });

  it("drops a blank scene param instead of an empty string", () => {
    expect(parseStoryPlaytestSource({ scene: "  " })).toEqual({ kind: "draft" });
  });

  it("carries the saved-revision freshness token", () => {
    expect(parseStoryPlaytestSource({ rev: "12", vsh: "a".repeat(64) })).toEqual({
      kind: "draft",
      revision: 12,
      videoSnapshotHash: "a".repeat(64),
    });
  });

  it("ignores a non-numeric revision instead of caching on NaN", () => {
    expect(parseStoryPlaytestSource({ rev: "latest" })).toEqual({ kind: "draft" });
  });
});

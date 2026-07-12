import assert from "node:assert/strict";
import test from "node:test";
import {
  applyJinlingStoryEffects,
  createJinlingStoryProgress,
  JINLING_ENDING_IDS,
  JINLING_STORY_CHAPTERS,
  resolveJinlingEnding,
} from "./fast-story";

test("film cut has four choices separated by continuous cinematic sequences", () => {
  assert.equal(JINLING_STORY_CHAPTERS.length, 4);
  assert.deepEqual(
    JINLING_STORY_CHAPTERS.map((chapter) => chapter.clips.length),
    [4, 2, 12, 6]
  );
  assert.deepEqual(
    JINLING_STORY_CHAPTERS.map((chapter) => chapter.choices.length),
    [3, 3, 4, 4]
  );
  assert.equal(
    JINLING_STORY_CHAPTERS.reduce((total, chapter) => total + chapter.clips.length, 0),
    24
  );
});

test("every choice has a distinct voiced reaction film", () => {
  const reactions = JINLING_STORY_CHAPTERS.flatMap((chapter) =>
    chapter.choices.map((choice) => choice.reactionVideo)
  );
  assert.equal(reactions.length, 14);
  assert.equal(new Set(reactions).size, reactions.length);
  assert.ok(reactions.every((video) => video.endsWith(".mp4")));
});

test("all five endings are reachable from four authored final actions", () => {
  const base = createJinlingStoryProgress().scores;
  const endings = new Set([
    resolveJinlingEnding({ ...base, trust: 3 }, "daiyu"),
    resolveJinlingEnding(base, "xifeng"),
    resolveJinlingEnding({ ...base, insight: 2 }, "keep"),
    resolveJinlingEnding(base, "burn"),
    resolveJinlingEnding(base, "daiyu"),
  ]);
  assert.deepEqual([...endings].sort(), [...JINLING_ENDING_IDS].sort());
});

test("choice effects accumulate without mutating prior state", () => {
  const initial = createJinlingStoryProgress().scores;
  const next = applyJinlingStoryEffects(initial, { trust: 2, insight: 1 });
  assert.equal(initial.trust, 0);
  assert.equal(next.trust, 2);
  assert.equal(next.insight, 1);
});

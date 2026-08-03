import { describe, expect, it } from "vitest";
import {
  StoryBibleDraftSchema,
  StorySkeletonSchema,
  validateStorySkeleton,
  type StorySkeleton,
} from "./story-authoring-pipeline.js";

function skeleton(overrides: Partial<StorySkeleton> = {}): StorySkeleton {
  return {
    entryId: "opening",
    nodes: [
      { id: "opening", clipKey: "OPENING", beat: "The visitor arrives.", nextIds: ["gate"] },
      { id: "gate", clipKey: "GATE", beat: "A choice at the gate.", nextIds: ["truth", "leave"] },
      { id: "truth", clipKey: "TRUTH", beat: "The truth is faced.", nextIds: [] },
      { id: "leave", clipKey: "LEAVE", beat: "The visitor retreats.", nextIds: [] },
    ],
    ...overrides,
  };
}

describe("validateStorySkeleton", () => {
  it("passes a sound, fully reachable film skeleton", () => {
    expect(validateStorySkeleton(skeleton())).toEqual([]);
  });

  it("rejects dangling, missing-entry, and unreachable clips", () => {
    const dangling = validateStorySkeleton(
      skeleton({
        nodes: [{ id: "opening", clipKey: "OPENING", beat: "Arrive.", nextIds: ["missing"] }],
      })
    );
    expect(dangling.map((issue) => issue.code)).toContain("DANGLING_NEXT");
    expect(validateStorySkeleton(skeleton({ entryId: "nowhere" })).map((i) => i.code)).toContain(
      "ENTRY_NOT_FOUND"
    );
    expect(
      validateStorySkeleton(
        skeleton({
          nodes: [
            { id: "opening", clipKey: "OPENING", beat: "Arrive.", nextIds: [] },
            { id: "orphan", clipKey: "ORPHAN", beat: "Never reached.", nextIds: [] },
          ],
        })
      ).map((i) => i.code)
    ).toContain("UNREACHABLE_NODE");
  });

  it("rejects duplicate node ids and clip keys", () => {
    const codes = validateStorySkeleton({
      entryId: "a",
      nodes: [
        { id: "a", clipKey: "SAME", beat: "One.", nextIds: [] },
        { id: "a", clipKey: "SAME", beat: "Two.", nextIds: [] },
      ],
    }).map((issue) => issue.code);
    expect(codes).toContain("DUPLICATE_NODE_ID");
    expect(codes).toContain("DUPLICATE_CLIP_KEY");
  });
});

describe("film authoring stage schemas", () => {
  it("accepts the complete film-foundation shape", () => {
    const bible = {
      logline: "One night, one gate.",
      synopsis: "A visitor probes a sealed villa.",
      characters: [],
    };
    expect(StoryBibleDraftSchema.safeParse(bible).success).toBe(true);
  });

  it("requires every planned node to identify a film clip", () => {
    expect(StorySkeletonSchema.safeParse(skeleton()).success).toBe(true);
    expect(
      StorySkeletonSchema.safeParse({
        entryId: "x",
        nodes: [{ id: "x", beat: "b", nextIds: [] }],
      }).success
    ).toBe(false);
  });
});

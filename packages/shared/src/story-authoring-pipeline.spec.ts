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
      { id: "opening", kind: "text", beat: "The visitor arrives.", nextIds: ["gate"] },
      { id: "gate", kind: "text", beat: "A choice at the gate.", nextIds: ["truth", "leave"] },
      { id: "truth", kind: "text", beat: "The truth is faced.", nextIds: [] },
      { id: "leave", kind: "text", beat: "The visitor retreats.", nextIds: [] },
    ],
    ...overrides,
  };
}

describe("validateStorySkeleton", () => {
  it("passes a sound, fully-reachable skeleton", () => {
    expect(validateStorySkeleton(skeleton())).toEqual([]);
  });

  it("catches a dangling successor deterministically (the failure mode the pipeline prevents)", () => {
    const issues = validateStorySkeleton(
      skeleton({
        nodes: [
          { id: "opening", kind: "text", beat: "Arrive.", nextIds: ["gate"] },
          { id: "gate", kind: "text", beat: "Branch.", nextIds: ["recovery_path"] },
        ],
      })
    );
    expect(issues.map((i) => i.code)).toContain("DANGLING_NEXT");
    expect(issues.find((i) => i.code === "DANGLING_NEXT")?.detail).toContain("recovery_path");
  });

  it("flags a missing entry node", () => {
    const issues = validateStorySkeleton(skeleton({ entryId: "nowhere" }));
    expect(issues.map((i) => i.code)).toContain("ENTRY_NOT_FOUND");
  });

  it("flags unreachable orphan beats", () => {
    const issues = validateStorySkeleton(
      skeleton({
        nodes: [
          { id: "opening", kind: "text", beat: "Arrive.", nextIds: [] },
          { id: "orphan", kind: "text", beat: "Never reached.", nextIds: [] },
        ],
      })
    );
    expect(issues.map((i) => i.code)).toContain("UNREACHABLE_NODE");
  });

  it("enforces clip-key rules per node kind", () => {
    const issues = validateStorySkeleton(
      skeleton({
        entryId: "a",
        nodes: [
          { id: "a", kind: "clip", beat: "No key.", nextIds: ["b"] },
          { id: "b", kind: "text", clipKey: "STRAY", beat: "Text with key.", nextIds: [] },
        ],
      })
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("CLIP_KEY_REQUIRED");
    expect(codes).toContain("CLIP_KEY_ON_TEXT");
  });

  it("catches duplicate node ids and clip keys", () => {
    const issues = validateStorySkeleton({
      entryId: "a",
      nodes: [
        { id: "a", kind: "clip", clipKey: "K", beat: "One.", nextIds: [] },
        { id: "a", kind: "clip", clipKey: "K", beat: "Two.", nextIds: [] },
      ],
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("DUPLICATE_NODE_ID");
    expect(codes).toContain("DUPLICATE_CLIP_KEY");
  });
});

describe("stage product schemas", () => {
  it("requires the bible to declare at least one ending", () => {
    const base = {
      logline: "One night, one gate.",
      synopsis: "A visitor probes a sealed villa.",
      worldview: "A mythic villa at night.",
      characters: [],
    };
    expect(StoryBibleDraftSchema.safeParse({ ...base, endings: [] }).success).toBe(false);
    expect(
      StoryBibleDraftSchema.safeParse({
        ...base,
        endings: [{ id: "truth", title: { "zh-CN": "真相" } }],
      }).success
    ).toBe(true);
  });

  it("accepts a well-formed skeleton and rejects unknown keys", () => {
    expect(StorySkeletonSchema.safeParse(skeleton()).success).toBe(true);
    expect(
      StorySkeletonSchema.safeParse({
        ...skeleton(),
        nodes: [{ id: "x", kind: "text", beat: "b", nextIds: [], stray: true }],
      }).success
    ).toBe(false);
  });
});

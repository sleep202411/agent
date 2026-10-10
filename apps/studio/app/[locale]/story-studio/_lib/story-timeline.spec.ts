import { describe, expect, it } from "vitest";
import type { StoryStoryboardClip, StoryStoryboardSequence } from "@/lib/story-production-api";
import {
  appendStoryTimelineClip,
  createManualStoryTimelineClipStableKey,
  removeStoryTimelineClip,
  storySequenceToTimeline,
} from "./story-timeline";

describe("Story timeline domain", () => {
  it("projects a sequence into an ordered visual track without copying branching", () => {
    const sequence = fixtureSequence();
    sequence.clips = [fixtureClip({ id: "clip-2", rank: 1, startMs: 2_000 }), fixtureClip()];

    const timeline = storySequenceToTimeline(sequence);

    expect(timeline.sequenceId).toBe("sequence-1");
    expect(timeline.visualTrack.id).toBe("visual");
    expect(timeline.visualTrack.clips.map((clip) => clip.id)).toEqual(["clip-1", "clip-2"]);
    expect(timeline).not.toHaveProperty("branches");
  });

  it("appends through one continuous atomic command and preserves retained clip identities", () => {
    const input = appendStoryTimelineClip(fixtureSequence(), {
      stableKey: "manual_clip_abc123",
      kind: "video",
      title: "Reaction",
      durationMs: 1_500,
      prompt: "The kitten turns toward the window",
      description: null,
      sourceMediaAssetId: "0198f744-32a0-7000-8000-000000000002",
    });

    expect(input.expectedVersion).toBe(4);
    expect(input.durationMs).toBe(5_500);
    expect(input.clips).toEqual([
      expect.objectContaining({ id: "clip-1", expectedVersion: 7, startMs: 0, durationMs: 4_000 }),
      expect.objectContaining({
        expectedVersion: 0,
        sourceMediaAssetId: "0198f744-32a0-7000-8000-000000000002",
        stableKey: "manual_clip_abc123",
        kind: "video",
        imagePrompt: null,
        videoPrompt: "The kitten turns toward the window",
        startMs: 4_000,
        durationMs: 1_500,
      }),
    ]);
  });

  it("adds the first shot directly to a canonical empty timeline", () => {
    const empty = fixtureSequence();
    empty.durationMs = 0;
    empty.suggestedDurationMs = 0;
    empty.clips = [];

    const input = appendStoryTimelineClip(empty, {
      stableKey: "manual_clip_first",
      kind: "image",
      title: "First shot",
      durationMs: 4_000,
      prompt: "The first frame",
      description: null,
    });

    expect(input.durationMs).toBe(4_000);
    expect(input.clips).toEqual([
      expect.objectContaining({ startMs: 0, durationMs: 4_000, kind: "image" }),
    ]);
  });

  it("removes a clip and closes the timeline gap without changing retained identities", () => {
    const sequence = fixtureSequence();
    sequence.durationMs = 9_000;
    sequence.clips = [
      fixtureClip({ durationMs: 2_000 }),
      fixtureClip({ id: "clip-2", stableKey: "clip_2", rank: 1, startMs: 2_000 }),
      fixtureClip({
        id: "clip-3",
        stableKey: "clip_3",
        rank: 2,
        startMs: 6_000,
        durationMs: 3_000,
      }),
    ];

    const input = removeStoryTimelineClip(sequence, "clip-2");

    expect(input.expectedVersion).toBe(4);
    expect(input.durationMs).toBe(5_000);
    expect(input.clips).toEqual([
      expect.objectContaining({ id: "clip-1", expectedVersion: 7, startMs: 0, durationMs: 2_000 }),
      expect.objectContaining({
        id: "clip-3",
        expectedVersion: 7,
        startMs: 2_000,
        durationMs: 3_000,
      }),
    ]);
  });

  it("creates schema-safe stable keys without leaking UUID punctuation", () => {
    expect(createManualStoryTimelineClipStableKey("01234567-89ab-cdef-0123-456789abcdef")).toBe(
      "manual_clip_0123456789abcdef01234567"
    );
  });
});

function fixtureSequence(): StoryStoryboardSequence {
  return {
    id: "sequence-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    plotNodeId: "plot-1",
    stableKey: "sequence-1",
    title: "Opening",
    description: null,
    suggestedDurationMs: 4_000,
    durationMs: 4_000,
    sourceFingerprint: "source-1",
    status: "current",
    version: 4,
    userModifiedAt: null,
    subtitleTracks: [],
    subtitleTimeline: { fingerprint: "a".repeat(64), durationMs: null, ready: false, segments: [] },
    clips: [fixtureClip()],
    cues: [],
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function fixtureClip(overrides: Partial<StoryStoryboardClip> = {}): StoryStoryboardClip {
  return {
    id: "clip-1",
    stableKey: "clip_1",
    title: "Wake",
    rank: 0,
    kind: "image",
    track: "visual",
    startMs: 0,
    durationMs: 4_000,
    description: null,
    imagePrompt: "A kitten opens its eyes",
    videoPrompt: null,
    negativePrompt: null,
    generationConfig: {},
    status: "current",
    version: 7,
    selectedMediaVersionId: null,
    selectedMediaVersion: null,
    mediaVersions: [],
    latestGeneration: null,
    userModifiedAt: null,
    assetBindings: [],
    ...overrides,
  };
}

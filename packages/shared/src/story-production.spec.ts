import { describe, expect, it } from "vitest";
import {
  normalizeStoryboardAssetMentions,
  PutStoryStoryboardTimelineSchema,
  StoryAssetPlanSchema,
  StoryProductionPlanSchema,
  StoryStoryboardPlanSchema,
} from "./story-production.js";

function plan() {
  return {
    schemaVersion: "story-production-plan-v1" as const,
    assetSpecs: [
      {
        stableKey: "asset.character.shen_du",
        kind: "character" as const,
        name: "沈渡",
        description: "A weary late-Ming imperial guard.",
        imagePrompt: "Full character reference, dark-blue uniform, neutral pose.",
        sourceCharacterId: "character.shen_du",
        sourceNodeIds: ["scene.opening"],
      },
    ],
    storyboardSequences: [
      {
        plotNodeId: "scene.opening",
        title: "Snow-night order",
        description: "Shen Du receives the dispatch at the snowed-in gate.",
        durationMs: 10_000,
        clips: [
          {
            stableKey: "shot.opening.establishing",
            kind: "image" as const,
            title: "The sealed city",
            description: "Snow falls beyond the city gate.",
            startMs: 0,
            durationMs: 4_000,
            imagePrompt:
              "Wide establishing shot of a sealed late-Ming city gate at night, @asset.character.shen_du silhouetted on the wall.",
          },
          {
            stableKey: "shot.opening.order",
            kind: "video" as const,
            title: "The order arrives",
            description: "Shen Du receives the blood-stained dispatch.",
            startMs: 4_000,
            durationMs: 6_000,
            videoPrompt:
              "Slow push-in as @asset.character.shen_du opens the blood-stained dispatch.",
          },
        ],
        cues: [],
      },
    ],
  };
}

describe("StoryProductionPlanSchema", () => {
  it("accepts logical empty assets and a mixed image/video sequence", () => {
    expect(StoryProductionPlanSchema.parse(plan())).toEqual(plan());
  });

  it("rejects missing logical asset references", () => {
    const value = plan();
    value.storyboardSequences[0]!.clips[0]!.imagePrompt =
      "A gate shot framing @asset.missing at dusk.";
    const result = StoryProductionPlanSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("missing Asset Spec"))).toBe(
      true
    );
  });

  it("rejects overlapping visual clips and clips outside the sequence", () => {
    const overlapping = plan();
    overlapping.storyboardSequences[0]!.clips[1]!.startMs = 3_000;
    expect(
      StoryProductionPlanSchema.safeParse(overlapping).error?.issues.some((issue) =>
        issue.message.includes("continuous, non-overlapping")
      )
    ).toBe(true);

    const overflowing = plan();
    overflowing.storyboardSequences[0]!.clips[1]!.durationMs = 7_000;
    expect(
      StoryProductionPlanSchema.safeParse(overflowing).error?.issues.some((issue) =>
        issue.message.includes("within its sequence")
      )
    ).toBe(true);
  });

  it("normalizes aliases and degrades unknown mentions to ordinary prompt text", () => {
    const value = plan();
    const sequence = value.storyboardSequences[0]!;
    const clip = sequence.clips[0]!;
    if (clip.kind !== "image") throw new Error("Expected image fixture");
    clip.imagePrompt = "Frame @character.shen_du beside @invented_extra.";

    const normalized = normalizeStoryboardAssetMentions(sequence, value.assetSpecs);

    expect(normalized.clips[0]).toMatchObject({
      imagePrompt: "Frame @asset.character.shen_du beside invented_extra.",
    });
  });

  it("keeps Plot topology external and stores only a decision cue reference", () => {
    const value = plan();
    value.storyboardSequences[0]!.cues = [
      {
        stableKey: "cue.opening.decision",
        kind: "decision",
        atMs: 10_000,
        decisionId: "decision.escape_route",
      },
    ];
    expect(StoryProductionPlanSchema.safeParse(value).success).toBe(true);
    expect(value.storyboardSequences[0]).not.toHaveProperty("choices");
    expect(value.storyboardSequences[0]).not.toHaveProperty("nextNodeIds");
  });
});

describe("independent production stage schemas", () => {
  it("rejects duplicate logical keys inside an Asset-only proposal", () => {
    const value = plan();
    const asset = value.assetSpecs[0]!;
    const result = StoryAssetPlanSchema.safeParse({
      assetSpecs: [asset, { ...asset }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("must be unique"))).toBe(
      true
    );
  });

  it("validates a Storyboard structurally without embedding the Asset plan", () => {
    const value = plan();
    value.storyboardSequences[0]!.clips[0]!.imagePrompt =
      "A gate shot framing @asset.approved.in.another.stage at dusk.";
    expect(
      StoryStoryboardPlanSchema.safeParse({
        storyboardSequences: value.storyboardSequences,
      }).success
    ).toBe(true);
  });

  it("still rejects an invalid timeline in a Storyboard-only proposal", () => {
    const value = plan();
    value.storyboardSequences[0]!.clips[1]!.startMs = 3_000;
    const result = StoryStoryboardPlanSchema.safeParse({
      storyboardSequences: value.storyboardSequences,
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.message.includes("continuous, non-overlapping"))
    ).toBe(true);
  });
});

describe("PutStoryStoryboardTimelineSchema", () => {
  it("accepts the canonical empty timeline for a Plot node without shots", () => {
    expect(
      PutStoryStoryboardTimelineSchema.safeParse({
        expectedVersion: 0,
        durationMs: 0,
        clips: [],
      }).success
    ).toBe(true);
  });

  it("rejects a non-zero empty timeline", () => {
    expect(
      PutStoryStoryboardTimelineSchema.safeParse({
        expectedVersion: 0,
        durationMs: 1_000,
        clips: [],
      }).success
    ).toBe(false);
  });

  it("accepts one continuous atomic replacement with retained and new clips", () => {
    expect(
      PutStoryStoryboardTimelineSchema.safeParse({
        expectedVersion: 3,
        durationMs: 6_000,
        clips: [
          {
            id: "0198f744-32a0-7000-8000-000000000001",
            expectedVersion: 4,
            stableKey: "opening",
            title: "Opening",
            kind: "image",
            startMs: 0,
            durationMs: 4_000,
            description: null,
            negativePrompt: null,
            imagePrompt: "The room before dawn",
            videoPrompt: null,
          },
          {
            expectedVersion: 0,
            sourceMediaAssetId: "0198f744-32a0-7000-8000-000000000002",
            stableKey: "manual_clip_1",
            title: "Reaction",
            kind: "video",
            startMs: 4_000,
            durationMs: 2_000,
            description: null,
            negativePrompt: null,
            imagePrompt: null,
            videoPrompt: "The kitten turns toward the light",
          },
        ],
      }).success
    ).toBe(true);
  });

  it("rejects source media on a retained clip", () => {
    const result = PutStoryStoryboardTimelineSchema.safeParse({
      expectedVersion: 3,
      durationMs: 4_000,
      clips: [
        {
          id: "0198f744-32a0-7000-8000-000000000001",
          expectedVersion: 4,
          sourceMediaAssetId: "0198f744-32a0-7000-8000-000000000002",
          stableKey: "opening",
          title: "Opening",
          kind: "image",
          startMs: 0,
          durationMs: 4_000,
          description: null,
          negativePrompt: null,
          imagePrompt: "The room before dawn",
          videoPrompt: null,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "clips.0.sourceMediaAssetId"
    );
  });

  it("rejects gaps and a non-zero version on a new clip", () => {
    const result = PutStoryStoryboardTimelineSchema.safeParse({
      expectedVersion: 3,
      durationMs: 2_000,
      clips: [
        {
          expectedVersion: 1,
          stableKey: "manual_clip_1",
          title: "Reaction",
          kind: "video",
          startMs: 500,
          durationMs: 1_500,
          description: null,
          negativePrompt: null,
          imagePrompt: null,
          videoPrompt: "The kitten turns toward the light",
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["clips.0.expectedVersion", "clips.0.startMs"])
    );
  });
});

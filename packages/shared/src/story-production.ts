import { z } from "zod";

/**
 * Chapter production specifications derived from an approved screenplay.
 *
 * These contracts deliberately describe work to be produced, not generated
 * media. An asset spec is a durable, referenceable placeholder even when it
 * has no image or video. A storyboard sequence is the production projection
 * of one Plot Tree node; it never owns a second branching graph.
 */

export const STORY_PRODUCTION_PLAN_SCHEMA_VERSION = "story-production-plan-v1" as const;

export const StoryProductionStableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  // Must stay expressible by STORY_ASSET_MENTION_PATTERN below: word groups
  // joined by single separators, never trailing or doubled punctuation —
  // otherwise a schema-valid key could be unmentionable in a prompt.
  .regex(/^[A-Za-z][A-Za-z0-9_]*(?:[.:-][A-Za-z0-9_]+)*$/, "Use a stable identifier.");

/**
 * Asset Specs are the three ENTITY anchors of a chapter. Overall visual style
 * is the project's creative-profile field and is written into every generation
 * prompt by the planner — it is deliberately not a bindable spec. Recurring
 * non-physical visual motifs (visions, projections, on-screen documents) are
 * prop specs.
 */
export const StoryAssetSpecKindSchema = z.enum(["character", "location", "prop"]);
export type StoryAssetSpecKind = z.infer<typeof StoryAssetSpecKindSchema>;

export const StoryAssetSpecPlanItemSchema = z
  .object({
    stableKey: StoryProductionStableKeySchema,
    kind: StoryAssetSpecKindSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(4_000),
    /** Default still/reference-image generation prompt. */
    imagePrompt: z.string().trim().min(1).max(12_000),
    /** Optional motion treatment when this logical asset is rendered as video. */
    videoPrompt: z.string().trim().min(1).max(12_000).optional(),
    negativePrompt: z.string().trim().min(1).max(4_000).optional(),
    /** Canonical Story Bible character id when this is a character spec. */
    sourceCharacterId: StoryProductionStableKeySchema.optional(),
    /** Plot node ids that justify this spec and its chapter-local lifetime. */
    sourceNodeIds: z.array(StoryProductionStableKeySchema).min(1).max(200),
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.kind === "character" && asset.sourceCharacterId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceCharacterId"],
        message: "Character Asset Specs must reference their canonical Story Bible character.",
      });
    }
    if (asset.kind !== "character" && asset.sourceCharacterId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceCharacterId"],
        message: "Only character Asset Specs may carry sourceCharacterId.",
      });
    }
  });
export type StoryAssetSpecPlanItem = z.infer<typeof StoryAssetSpecPlanItemSchema>;

/** Model-stage envelope used before storyboard sequences bind the specs. */
export const StoryAssetPlanSchema = z
  .object({
    assetSpecs: z.array(StoryAssetSpecPlanItemSchema).max(500),
  })
  .strict();
export type StoryAssetPlan = z.infer<typeof StoryAssetPlanSchema>;

/**
 * Prompts are the authoritative carrier of asset references: an asset is used
 * exactly when its `@stableKey` token is written inline in a prompt, the same
 * contract as the platform prompt composer. The token carries the durable
 * stableKey (never the display name), so renames cannot break a mention and
 * deleting the token IS deleting the reference. Structured binding rows are a
 * derived index over these mentions.
 */
export const STORY_ASSET_MENTION_PATTERN = /@([A-Za-z][A-Za-z0-9_]*(?:[.:-][A-Za-z0-9_]+)*)/g;

/** Ordered, deduplicated `@stableKey` mentions found in a prompt text. */
export function extractStoryAssetMentions(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(STORY_ASSET_MENTION_PATTERN)) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** All asset mentions across a clip's prompts, in first-appearance order. */
export function storyClipAssetMentions(clip: {
  imagePrompt?: string | null;
  videoPrompt?: string | null;
}): string[] {
  return extractStoryAssetMentions([clip.imagePrompt ?? "", clip.videoPrompt ?? ""].join("\n"));
}

const StoryStoryboardClipBaseSchema = z.object({
  stableKey: StoryProductionStableKeySchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4_000),
  /** Millisecond timeline coordinates; no fixed frame length is implied. */
  startMs: z.number().int().min(0).max(3_600_000),
  durationMs: z.number().int().min(250).max(3_600_000),
  negativePrompt: z.string().trim().min(1).max(4_000).optional(),
});

export const StoryStoryboardImageClipSchema = StoryStoryboardClipBaseSchema.extend({
  kind: z.literal("image"),
  imagePrompt: z.string().trim().min(1).max(12_000),
}).strict();

/**
 * Each clip carries exactly its own kind's prompt: image clips an imagePrompt,
 * video clips a videoPrompt. A held opening frame is modelled as its own image
 * clip in the sequence, never as a second prompt hidden on a video clip.
 */
export const StoryStoryboardVideoClipSchema = StoryStoryboardClipBaseSchema.extend({
  kind: z.literal("video"),
  videoPrompt: z.string().trim().min(1).max(12_000),
}).strict();

export const StoryStoryboardClipPlanItemSchema = z.discriminatedUnion("kind", [
  StoryStoryboardImageClipSchema,
  StoryStoryboardVideoClipSchema,
]);
export type StoryStoryboardClipPlanItem = z.infer<typeof StoryStoryboardClipPlanItemSchema>;

export const StoryStoryboardCuePlanItemSchema = z
  .object({
    stableKey: StoryProductionStableKeySchema,
    kind: z.literal("decision"),
    atMs: z.number().int().min(0).max(3_600_000),
    /** The decision id already owned by the corresponding Plot Tree node. */
    decisionId: StoryProductionStableKeySchema,
  })
  .strict();
export type StoryStoryboardCuePlanItem = z.infer<typeof StoryStoryboardCuePlanItemSchema>;

export const StoryStoryboardSequencePlanItemSchema = z
  .object({
    /** Exact stable Plot Tree node id. One chapter may have at most one sequence per node. */
    plotNodeId: StoryProductionStableKeySchema,
    title: z.string().trim().min(1).max(160),
    /** One-or-two-sentence summary of what this node's footage shows. */
    description: z.string().trim().min(1).max(4_000),
    durationMs: z.number().int().min(250).max(3_600_000),
    clips: z.array(StoryStoryboardClipPlanItemSchema).min(1).max(200),
    cues: z.array(StoryStoryboardCuePlanItemSchema).max(16),
  })
  .strict();
export type StoryStoryboardSequencePlanItem = z.infer<typeof StoryStoryboardSequencePlanItemSchema>;

export const StoryProductionPlanSchema = z
  .object({
    schemaVersion: z.literal(STORY_PRODUCTION_PLAN_SCHEMA_VERSION),
    assetSpecs: z.array(StoryAssetSpecPlanItemSchema).max(500),
    storyboardSequences: z.array(StoryStoryboardSequencePlanItemSchema).min(1).max(200),
  })
  .strict()
  .superRefine((plan, context) => {
    const assetKeys = new Set<string>();
    plan.assetSpecs.forEach((asset, assetIndex) => {
      if (assetKeys.has(asset.stableKey)) {
        context.addIssue({
          code: "custom",
          path: ["assetSpecs", assetIndex, "stableKey"],
          message: "Asset stable keys must be unique within a production plan.",
        });
      }
      assetKeys.add(asset.stableKey);
    });

    const plotNodeIds = new Set<string>();
    const clipKeys = new Set<string>();
    const cueKeys = new Set<string>();
    plan.storyboardSequences.forEach((sequence, sequenceIndex) => {
      if (plotNodeIds.has(sequence.plotNodeId)) {
        context.addIssue({
          code: "custom",
          path: ["storyboardSequences", sequenceIndex, "plotNodeId"],
          message: "A Plot Tree node may have only one storyboard sequence.",
        });
      }
      plotNodeIds.add(sequence.plotNodeId);

      const orderedClips = [...sequence.clips].sort(
        (left, right) =>
          left.startMs - right.startMs || left.stableKey.localeCompare(right.stableKey)
      );
      let previousEndMs = 0;
      orderedClips.forEach((clip) => {
        const clipIndex = sequence.clips.indexOf(clip);
        if (clipKeys.has(clip.stableKey)) {
          context.addIssue({
            code: "custom",
            path: ["storyboardSequences", sequenceIndex, "clips", clipIndex, "stableKey"],
            message: "Storyboard clip stable keys must be unique within a production plan.",
          });
        }
        clipKeys.add(clip.stableKey);
        if (clip.startMs !== previousEndMs) {
          context.addIssue({
            code: "custom",
            path: ["storyboardSequences", sequenceIndex, "clips", clipIndex, "startMs"],
            message: "Visual clips must form one continuous, non-overlapping sequence timeline.",
          });
        }
        const endMs = clip.startMs + clip.durationMs;
        if (endMs > sequence.durationMs) {
          context.addIssue({
            code: "custom",
            path: ["storyboardSequences", sequenceIndex, "clips", clipIndex, "durationMs"],
            message: "A storyboard clip must end within its sequence duration.",
          });
        }
        previousEndMs = Math.max(previousEndMs, endMs);
        storyClipAssetMentions(clip).forEach((mentionKey) => {
          if (!assetKeys.has(mentionKey)) {
            context.addIssue({
              code: "custom",
              path: [
                "storyboardSequences",
                sequenceIndex,
                "clips",
                clipIndex,
                clip.kind === "video" ? "videoPrompt" : "imagePrompt",
              ],
              message: `Storyboard clip mentions missing Asset Spec "@${mentionKey}".`,
            });
          }
        });
      });

      if (previousEndMs !== sequence.durationMs) {
        context.addIssue({
          code: "custom",
          path: ["storyboardSequences", sequenceIndex, "durationMs"],
          message: "Storyboard clips must cover the complete sequence duration.",
        });
      }

      sequence.cues.forEach((cue, cueIndex) => {
        if (cueKeys.has(cue.stableKey)) {
          context.addIssue({
            code: "custom",
            path: ["storyboardSequences", sequenceIndex, "cues", cueIndex, "stableKey"],
            message: "Storyboard cue stable keys must be unique within a production plan.",
          });
        }
        cueKeys.add(cue.stableKey);
        if (cue.atMs > sequence.durationMs) {
          context.addIssue({
            code: "custom",
            path: ["storyboardSequences", sequenceIndex, "cues", cueIndex, "atMs"],
            message: "A storyboard cue must occur within its sequence duration.",
          });
        }
      });
    });
  });
export type StoryProductionPlan = z.infer<typeof StoryProductionPlanSchema>;

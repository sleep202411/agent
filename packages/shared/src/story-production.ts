import { z } from "zod";

/** Authoring limits shared by imports, editable drafts and production forms. */
export const STORY_CHAPTER_NODES_MAX = 5_000;
export const STORY_CHAPTER_ASSETS_MAX = 2_000;
export const STORY_AUTHORING_TEXT_MAX = 32_000;
export const STORY_AUTHORING_DESCRIPTION_MAX = 100_000;
export const STORY_AUTHORING_PROMPT_MAX = 50_000;
export const STORY_AUTHORING_NEGATIVE_PROMPT_MAX = 16_000;

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
    description: z.string().trim().min(1).max(STORY_AUTHORING_DESCRIPTION_MAX),
    /** Default still/reference-image generation prompt. */
    imagePrompt: z.string().trim().min(1).max(STORY_AUTHORING_PROMPT_MAX),
    /** Optional motion treatment when this logical asset is rendered as video. */
    videoPrompt: z.string().trim().min(1).max(STORY_AUTHORING_PROMPT_MAX).optional(),
    negativePrompt: z.string().trim().min(1).max(STORY_AUTHORING_NEGATIVE_PROMPT_MAX).optional(),
    /** Optional link to a Story Bible character; standalone character assets are valid. */
    sourceCharacterId: StoryProductionStableKeySchema.optional(),
    /** Plot node relevance hints. Manual chapter assets may begin unattached. */
    sourceNodeIds: z.array(StoryProductionStableKeySchema).max(200),
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.kind !== "character" && asset.sourceCharacterId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceCharacterId"],
        message: "Only character Asset Specs may carry sourceCharacterId.",
      });
    }
  });
export type StoryAssetSpecPlanItem = z.infer<typeof StoryAssetSpecPlanItemSchema>;

const StoryAssetSpecsSchema = z.array(StoryAssetSpecPlanItemSchema).max(STORY_CHAPTER_ASSETS_MAX);

/** Model-stage envelope used before storyboard sequences bind the specs. */
export const StoryAssetPlanSchema = z
  .object({
    assetSpecs: StoryAssetSpecsSchema,
  })
  .strict()
  .superRefine(addAssetPlanIssues);
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
  description: z.string().trim().min(1).max(STORY_AUTHORING_DESCRIPTION_MAX),
  /** Millisecond timeline coordinates; no fixed frame length is implied. */
  startMs: z.number().int().min(0).max(3_600_000),
  durationMs: z.number().int().min(250).max(3_600_000),
  negativePrompt: z.string().trim().min(1).max(STORY_AUTHORING_NEGATIVE_PROMPT_MAX).optional(),
});

export const StoryStoryboardImageClipSchema = StoryStoryboardClipBaseSchema.extend({
  kind: z.literal("image"),
  imagePrompt: z.string().trim().min(1).max(STORY_AUTHORING_PROMPT_MAX),
}).strict();

/**
 * Each clip carries exactly its own kind's prompt: image clips an imagePrompt,
 * video clips a videoPrompt. A held opening frame is modelled as its own image
 * clip in the sequence, never as a second prompt hidden on a video clip.
 */
export const StoryStoryboardVideoClipSchema = StoryStoryboardClipBaseSchema.extend({
  kind: z.literal("video"),
  videoPrompt: z.string().trim().min(1).max(STORY_AUTHORING_PROMPT_MAX),
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
    description: z.string().trim().min(1).max(STORY_AUTHORING_DESCRIPTION_MAX),
    durationMs: z.number().int().min(250).max(3_600_000),
    clips: z.array(StoryStoryboardClipPlanItemSchema).min(1).max(200),
    cues: z.array(StoryStoryboardCuePlanItemSchema).max(16),
  })
  .strict();
export type StoryStoryboardSequencePlanItem = z.infer<typeof StoryStoryboardSequencePlanItemSchema>;

/**
 * Resolve model-friendly Asset aliases without turning prompt syntax into an
 * authoring gate. Exact keys stay intact, unambiguous kind-prefixed aliases
 * become canonical keys, and unknown mentions become ordinary prompt text.
 */
export function normalizeStoryboardAssetMentions(
  sequence: StoryStoryboardSequencePlanItem,
  assets: readonly StoryAssetSpecPlanItem[]
): StoryStoryboardSequencePlanItem {
  const exactKeys = new Set(assets.map((asset) => asset.stableKey));
  const normalizedKeys = new Map<string, string | null>();
  for (const asset of assets) {
    const normalized = normalizeAssetReferenceKey(asset.stableKey);
    const previous = normalizedKeys.get(normalized);
    normalizedKeys.set(
      normalized,
      previous === undefined || previous === asset.stableKey ? asset.stableKey : null
    );
  }

  const normalizePrompt = (prompt: string): string =>
    prompt.replace(STORY_ASSET_MENTION_PATTERN, (_match, key: string) => {
      if (exactKeys.has(key)) return `@${key}`;
      const canonical = normalizedKeys.get(normalizeAssetReferenceKey(key));
      return canonical ? `@${canonical}` : key;
    });

  return StoryStoryboardSequencePlanItemSchema.parse({
    ...sequence,
    clips: sequence.clips.map((clip) =>
      clip.kind === "image"
        ? { ...clip, imagePrompt: normalizePrompt(clip.imagePrompt) }
        : { ...clip, videoPrompt: normalizePrompt(clip.videoPrompt) }
    ),
  });
}

function normalizeAssetReferenceKey(value: string): string {
  let normalized = value.toLowerCase();
  for (;;) {
    const next = normalized.replace(/^(?:asset|character|location|scene|prop)[._:-]+/, "");
    if (next === normalized) break;
    normalized = next;
  }
  return normalized.replace(/[^a-z0-9]/g, "");
}

const StoryStoryboardTimelineClipInputBaseSchema = z
  .object({
    /** Omit only when creating a brand-new clip in an atomic timeline replacement. */
    id: z.uuid().optional(),
    /** Existing clips require an exact CAS; new clips must use zero. */
    expectedVersion: z.number().int().nonnegative(),
    /**
     * Optional project-candidate media imported as version 1 of a brand-new
     * clip. Existing clips keep their media history and cannot set this.
     */
    sourceMediaAssetId: z.uuid().optional(),
    stableKey: StoryProductionStableKeySchema,
    title: z.string().trim().min(1).max(160),
    startMs: z.number().int().min(0).max(3_600_000),
    durationMs: z.number().int().min(250).max(3_600_000),
    description: z.string().trim().max(STORY_AUTHORING_DESCRIPTION_MAX).nullable(),
    negativePrompt: z.string().trim().min(1).max(STORY_AUTHORING_NEGATIVE_PROMPT_MAX).nullable(),
  })
  .strict();

/**
 * One visual clip in the server-authoritative, atomic timeline command.
 *
 * This is deliberately a product-domain contract rather than a third-party
 * editor shape. UI adapters may project it into any timeline widget, while
 * retained clip ids keep media versions and Asset bindings attached.
 */
export const StoryStoryboardTimelineClipInputSchema = z.discriminatedUnion("kind", [
  StoryStoryboardTimelineClipInputBaseSchema.extend({
    kind: z.literal("image"),
    imagePrompt: z.string().trim().min(1).max(STORY_AUTHORING_PROMPT_MAX),
    videoPrompt: z.null(),
  }).strict(),
  StoryStoryboardTimelineClipInputBaseSchema.extend({
    kind: z.literal("video"),
    imagePrompt: z.null(),
    videoPrompt: z.string().trim().min(1).max(STORY_AUTHORING_PROMPT_MAX),
  }).strict(),
]);
export type StoryStoryboardTimelineClipInput = z.infer<
  typeof StoryStoryboardTimelineClipInputSchema
>;

/**
 * Complete replacement of one plot node's visual timeline. Editing is atomic
 * because every intermediate multi-request state would violate continuous
 * coverage. Branching remains authoritative in StoryDraft and is not copied
 * into this document.
 */
export const PutStoryStoryboardTimelineSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    // A Plot node exists before its first shot. Zero duration with no clips is
    // the canonical empty timeline; every non-empty timeline still has the
    // ordinary 250ms minimum through its clip schema.
    durationMs: z.number().int().min(0).max(3_600_000),
    clips: z.array(StoryStoryboardTimelineClipInputSchema).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    const stableKeys = new Set<string>();
    let cursor = 0;
    for (const [index, clip] of value.clips.entries()) {
      if (!clip.id && clip.expectedVersion !== 0) {
        context.addIssue({
          code: "custom",
          path: ["clips", index, "expectedVersion"],
          message: "A new Storyboard clip must use expectedVersion 0.",
        });
      }
      if (clip.id && clip.sourceMediaAssetId) {
        context.addIssue({
          code: "custom",
          path: ["clips", index, "sourceMediaAssetId"],
          message: "Only a new Storyboard clip can import source media.",
        });
      }
      if (clip.id && ids.has(clip.id)) {
        context.addIssue({
          code: "custom",
          path: ["clips", index, "id"],
          message: "A Storyboard clip id can appear only once in a timeline.",
        });
      }
      if (stableKeys.has(clip.stableKey)) {
        context.addIssue({
          code: "custom",
          path: ["clips", index, "stableKey"],
          message: "A Storyboard clip stable key can appear only once in a timeline.",
        });
      }
      if (clip.startMs !== cursor) {
        context.addIssue({
          code: "custom",
          path: ["clips", index, "startMs"],
          message: `Visual clips must be ordered and continuous; expected startMs ${cursor}.`,
        });
      }
      if (clip.id) ids.add(clip.id);
      stableKeys.add(clip.stableKey);
      cursor = clip.startMs + clip.durationMs;
    }
    if (cursor !== value.durationMs) {
      context.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "Sequence duration must equal the end of its continuous visual clips.",
      });
    }
    if (value.clips.length === 0 && value.durationMs !== 0) {
      context.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "An empty Storyboard timeline must have zero duration.",
      });
    }
  });
export type PutStoryStoryboardTimelineInput = z.infer<typeof PutStoryStoryboardTimelineSchema>;

const StoryboardSequencesSchema = z.array(StoryStoryboardSequencePlanItemSchema).min(1).max(200);

/**
 * Model-stage envelope for the independently reviewable Storyboard proposal.
 * Asset references are validated against the separately approved Asset plan by
 * the Server because this stage must never smuggle a second Asset proposal.
 */
export const StoryStoryboardPlanSchema = z
  .object({
    storyboardSequences: StoryboardSequencesSchema,
  })
  .strict()
  .superRefine(addStoryboardPlanIssues);
export type StoryStoryboardPlan = z.infer<typeof StoryStoryboardPlanSchema>;

/**
 * Legacy/composition contract. New authoring proposals persist and approve the
 * Asset and Storyboard plans independently; this combined shape remains useful
 * for old durable snapshots and whole-plan validation helpers only.
 */
export const StoryProductionPlanSchema = z
  .object({
    schemaVersion: z.literal(STORY_PRODUCTION_PLAN_SCHEMA_VERSION),
    assetSpecs: StoryAssetSpecsSchema,
    storyboardSequences: StoryboardSequencesSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    addAssetPlanIssues(plan, context);
    addStoryboardPlanIssues(plan, context);
    addStoryboardAssetReferenceIssues(plan, context);
  });
export type StoryProductionPlan = z.infer<typeof StoryProductionPlanSchema>;

function addAssetPlanIssues(
  plan: { assetSpecs: StoryAssetSpecPlanItem[] },
  context: z.RefinementCtx
): void {
  const assetKeys = new Set<string>();
  plan.assetSpecs.forEach((asset, assetIndex) => {
    if (assetKeys.has(asset.stableKey)) {
      context.addIssue({
        code: "custom",
        path: ["assetSpecs", assetIndex, "stableKey"],
        message: "Asset stable keys must be unique within an Asset plan.",
      });
    }
    assetKeys.add(asset.stableKey);
  });
}

function addStoryboardPlanIssues(
  plan: { storyboardSequences: StoryStoryboardSequencePlanItem[] },
  context: z.RefinementCtx
): void {
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
      (left, right) => left.startMs - right.startMs || left.stableKey.localeCompare(right.stableKey)
    );
    let previousEndMs = 0;
    orderedClips.forEach((clip) => {
      const clipIndex = sequence.clips.indexOf(clip);
      if (clipKeys.has(clip.stableKey)) {
        context.addIssue({
          code: "custom",
          path: ["storyboardSequences", sequenceIndex, "clips", clipIndex, "stableKey"],
          message: "Storyboard clip stable keys must be unique within a Storyboard plan.",
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
          message: "Storyboard cue stable keys must be unique within a Storyboard plan.",
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
}

function addStoryboardAssetReferenceIssues(
  plan: {
    assetSpecs: StoryAssetSpecPlanItem[];
    storyboardSequences: StoryStoryboardSequencePlanItem[];
  },
  context: z.RefinementCtx
): void {
  const assetKeys = new Set(plan.assetSpecs.map((asset) => asset.stableKey));
  plan.storyboardSequences.forEach((sequence, sequenceIndex) => {
    sequence.clips.forEach((clip, clipIndex) => {
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
  });
}

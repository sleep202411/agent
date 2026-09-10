import {
  STORY_AGENT_BRIEF_MAX_CHARS,
  StoryAgentCharacterSchema,
  StoryAgentClipKeySchema,
  StoryAgentGraphNodeSchema,
  StoryAgentHotspotInteractionSchema,
  StoryAgentLocalizedTextSchema,
  StoryAgentRunStatusSchema,
  StoryAgentStableIdSchema,
  StoryPatchOperationsSchema,
} from "@repo/shared/story-agent";
import { z } from "zod";
import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";

import type { ToolDefinition } from "./types.js";
import { AgentExternalJobHandoffSchema } from "./handoff.js";
import { StoryCreativeProfileLanguageSchema } from "./story-creative-profile.js";

const StorySceneDraftSchema = z
  .object({
    nodeId: StoryAgentStableIdSchema,
    clipKey: StoryAgentClipKeySchema,
    name: z.string().trim().max(120).optional(),
    description: z.string().trim().max(4_000).optional(),
  })
  .strict();

const StoryMutationBaseSchema = z
  .object({
    baseDraftRevision: z.number().int().nonnegative(),
  })
  .strict();

export const StoryReadInputSchema = z.object({}).strict();

const StoryProductionStageStatusSchema = z.enum(["missing", "current"]);

/**
 * Canonical chapter-stage readiness projected by the Server. The model uses
 * this state to choose create, incremental completion, or no-op; transcript
 * prose and graph emptiness are never substitutes for these stage statuses.
 */
export const StoryProductionStateSchema = z
  .object({
    projectId: z.string().uuid(),
    chapterId: z.string().uuid(),
    profile: z.object({ status: StoryProductionStageStatusSchema }).strict(),
    script: z
      .object({
        status: StoryProductionStageStatusSchema,
        documentId: z.string().uuid().nullable(),
        sequence: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    plotTree: z
      .object({
        status: StoryProductionStageStatusSchema,
        nodeCount: z.number().int().nonnegative(),
      })
      .strict(),
    assets: z
      .object({
        status: StoryProductionStageStatusSchema,
        currentCount: z.number().int().nonnegative(),
      })
      .strict(),
    storyboard: z
      .object({
        status: StoryProductionStageStatusSchema,
        sequenceCount: z.number().int().nonnegative(),
        missingPlotNodeIds: z.array(StoryAgentStableIdSchema).max(500),
      })
      .strict(),
    ready: z.boolean(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.script.status !== "missing" &&
      (state.script.documentId === null || state.script.sequence === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["script"],
        message: "An existing Script stage requires its canonical document id and sequence.",
      });
    }
    const allCurrent = [
      state.profile.status,
      state.script.status,
      state.plotTree.status,
      state.assets.status,
      state.storyboard.status,
    ].every((status) => status === "current");
    if (state.ready !== allCurrent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ready"],
        message: "ready must exactly reflect all canonical production stages being current.",
      });
    }
  });
export type StoryProductionState = z.infer<typeof StoryProductionStateSchema>;

/**
 * Furthest reviewable specification the creator asked this production request
 * to prepare. The model decides this scope once from the creator's words; the
 * durable workflow then advances deterministically. Desktop pauses at every
 * specification; trusted H5 uses the explicit Plot Continue decision to
 * auto-persist Asset Specs before sequential paid image generation.
 */
export const StoryProductionTargetStageSchema = z.enum(["script", "plot", "assets", "storyboard"]);
export type StoryProductionTargetStage = z.infer<typeof StoryProductionTargetStageSchema>;

export const StoryProductionContinuationPlanSchema = z
  .object({
    continueThrough: StoryProductionTargetStageSchema,
    /** Pending explicit re-authoring intent, consumed once that stage is applied. */
    regenerateStage: z.enum(["plot", "assets", "storyboard"]).optional(),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    brief: z.string().trim().min(1).max(STORY_AGENT_BRIEF_MAX_CHARS),
    /** Presentation context only; this does not authorize paid generation. */
    experience: z.literal("mobile_h5").optional(),
    /**
     * Server-owned H5 policy. A creator's Continue decision on the Plot Tree
     * authorizes the logical Asset Specs to be persisted without manufacturing
     * a second user decision.
     */
    autoApplyAssetSpecs: z.boolean().optional(),
    /** Server-owned H5 authorization, never sourced from model arguments. */
    autoGenerateAssetImages: z.boolean().optional(),
    /** Server-owned H5 authorization from Continue on Storyboard Specs. */
    autoGenerateStoryboardMedia: z.boolean().optional(),
  })
  .strict();
export type StoryProductionContinuationPlan = z.infer<typeof StoryProductionContinuationPlanSchema>;

const STORY_PRODUCTION_STAGE_ORDER = [
  "script",
  "plot",
  "assets",
  "storyboard",
] as const satisfies readonly StoryProductionTargetStage[];

const STORY_PRODUCTION_STAGE_TERMS: Readonly<
  Record<StoryProductionTargetStage, readonly RegExp[]>
> = {
  script: [/剧本/giu, /劇本/giu, /\bscreenplay\b/giu, /\bscript\b/giu],
  plot: [/情节树/giu, /情節樹/giu, /剧情树/giu, /劇情樹/giu, /\bplot[\s-]*(?:tree|topology)\b/giu],
  assets: [
    /资产规格/giu,
    /資產規格/giu,
    /逻辑资产/giu,
    /邏輯資產/giu,
    /\basset[\s-]*(?:specs?|specifications?)\b/giu,
  ],
  storyboard: [/分镜规格/giu, /分鏡規格/giu, /分镜/giu, /分鏡/giu, /\bstoryboards?\b/giu],
};

const STORY_PRODUCTION_SCOPE_DIRECTIVE =
  /(?:逐阶段|逐階段|分阶段|分階段|分别审核|分別審核|全部阶段|全部階段|完整流程|完整制作|完整製作|后续制作|後續製作|all\s+stages|each\s+stage|stage\s+by\s+stage|end[\s-]*to[\s-]*end|complete\s+production)/iu;
const STORY_PRODUCTION_SINGLE_STAGE_DIRECTIVE =
  /(?:生成|创建|創建|制作|製作|准备|準備|提供|完成|推进|推進|做|写|寫|起草|改编|改編|generate|create|build|prepare|provide|complete|continue|write|draft|produce|adapt)/iu;
const STORY_PRODUCTION_BROAD_DIRECTIVE =
  /(?:生成|创建|創建|制作|製作|完成|继续|繼續|完善|推进|推進|改编|改編|适配|適配|generate|create|build|complete|continue|finish|adapt|produce)/iu;
const STORY_PRODUCTION_NARROWING_DIRECTIVE =
  /(?:只|仅|僅|先做|先生成|只需要|只需|为止|為止|到此|不要后续|不要後續|only|just|stop\s+at|through\s+only|no\s+later)/iu;
const STORY_PRODUCTION_NEGATED_STAGE_PREFIX =
  /(?:不要|不需要|无需|無需|别|別|跳过|跳過|略过|略過|排除|do\s+not|don't|without|skip|exclude)[^，,。；;!?\n]{0,48}$/iu;
const STORY_PRODUCTION_SOURCE_PREFIX =
  /(?:根据|根據|基于|基於|参考|參考|依照|按照|使用|用|from|based\s+on|using|reference)[^，,。；;!?\n]{0,24}$/iu;

/**
 * Resolve the production boundary from the creator's immutable request and
 * canonical chapter state. The model proposal is only an ambiguity fallback:
 * a canonically empty chapter defaults to the complete reviewable production
 * path, while only a direct stage request or explicit narrowing may stop it
 * earlier. Merely naming source material ("generate from this script") never
 * turns that source noun into an output boundary.
 */
export function resolveStoryProductionTargetStage(input: {
  creatorRequest: string | null | undefined;
  proposed: StoryProductionTargetStage;
  productionState: Pick<StoryProductionState, "script">;
}): StoryProductionTargetStage {
  const request = input.creatorRequest?.trim();
  if (!request) {
    return input.productionState.script.status === "missing" ? "storyboard" : input.proposed;
  }

  const mentioned = STORY_PRODUCTION_STAGE_ORDER.filter((stage) =>
    STORY_PRODUCTION_STAGE_TERMS[stage].some((term) =>
      [...request.matchAll(term)].some((match) => !storyStageMentionIsNegated(request, match.index))
    )
  );
  const directlyRequested = STORY_PRODUCTION_STAGE_ORDER.filter((stage) =>
    STORY_PRODUCTION_STAGE_TERMS[stage].some((term) =>
      [...request.matchAll(term)].some(
        (match) =>
          !storyStageMentionIsNegated(request, match.index) &&
          storyStageMentionIsDirectRequest(request, match.index, match[0]?.length ?? 0)
      )
    )
  );
  const explicitlyExcluded = STORY_PRODUCTION_STAGE_ORDER.filter((stage) =>
    STORY_PRODUCTION_STAGE_TERMS[stage].some((term) =>
      [...request.matchAll(term)].some((match) => storyStageMentionIsNegated(request, match.index))
    )
  );

  const explicitlyScopesMultipleStages = STORY_PRODUCTION_SCOPE_DIRECTIVE.test(request);
  const explicitlyNarrowsScope = STORY_PRODUCTION_NARROWING_DIRECTIVE.test(request);
  if (explicitlyNarrowsScope && directlyRequested.length > 0) {
    return directlyRequested.at(-1) ?? input.proposed;
  }
  const firstExcludedStage = explicitlyExcluded.at(0);
  if (firstExcludedStage) {
    const excludedIndex = STORY_PRODUCTION_STAGE_ORDER.indexOf(firstExcludedStage);
    if (excludedIndex > 0) return STORY_PRODUCTION_STAGE_ORDER[excludedIndex - 1] ?? "script";
  }
  if (explicitlyScopesMultipleStages) {
    return mentioned.length > 1 ? (mentioned.at(-1) ?? "storyboard") : "storyboard";
  }
  if (directlyRequested.length > 0 && STORY_PRODUCTION_SINGLE_STAGE_DIRECTIVE.test(request)) {
    return directlyRequested.at(-1) ?? input.proposed;
  }
  if (
    input.productionState.script.status === "missing" ||
    STORY_PRODUCTION_BROAD_DIRECTIVE.test(request)
  ) {
    return "storyboard";
  }

  return input.proposed;
}

function storyStageMentionIsDirectRequest(
  request: string,
  matchIndex: number | undefined,
  matchLength: number
): boolean {
  if (matchIndex === undefined) return false;
  const clauseStart = storyClauseStart(request, matchIndex);
  const clauseEnd = storyClauseEnd(request, matchIndex + matchLength);
  const prefix = request.slice(clauseStart, matchIndex);
  if (STORY_PRODUCTION_SOURCE_PREFIX.test(prefix)) return false;

  const suffix = request.slice(matchIndex + matchLength, clauseEnd);
  const directPrefix =
    /(?:生成|创建|創建|制作|製作|准备|準備|提供|完成|推进|推進|做|写|寫|起草|改编|改編|只要|只需|仅需|僅需)[^，,。；;!?\n]{0,24}$/iu;
  const directEnglishPrefix =
    /\b(?:generate|create|build|prepare|provide|complete|continue|write|draft|produce|adapt)\b(?:\s+(?:a|an|the|this|that|new|complete|full|final|reviewable|production))*\s*$/iu;
  const directSuffix =
    /^\s*(?:(?:先|请|請|帮我|幫我)?\s*(?:生成|创建|創建|制作|製作|准备|準備|完成|推进|推進|做|写|寫|起草)|(?:为止|為止)|(?:(?:please\s+)?(?:generate|create|build|prepare|complete|continue|write|draft|produce)))/iu;
  return directPrefix.test(prefix) || directEnglishPrefix.test(prefix) || directSuffix.test(suffix);
}

function storyStageMentionIsNegated(request: string, matchIndex: number | undefined): boolean {
  if (matchIndex === undefined) return false;
  const clauseStart = storyClauseStart(request, matchIndex);
  const prefix = request.slice(clauseStart, matchIndex);
  return STORY_PRODUCTION_NEGATED_STAGE_PREFIX.test(prefix);
}

function storyClauseStart(request: string, before: number): number {
  return (
    Math.max(
      request.lastIndexOf("。", before - 1),
      request.lastIndexOf("；", before - 1),
      request.lastIndexOf(";", before - 1),
      request.lastIndexOf("!", before - 1),
      request.lastIndexOf("?", before - 1),
      request.lastIndexOf("\n", before - 1)
    ) + 1
  );
}

function storyClauseEnd(request: string, after: number): number {
  const candidates = ["。", "；", ";", "!", "?", "\n"]
    .map((separator) => request.indexOf(separator, after))
    .filter((index) => index >= 0);
  return candidates.length > 0 ? Math.min(...candidates) : request.length;
}

/** True while any stage inside the creator-authorized scope is not current. */
export function storyProductionNeedsContinuation(
  state: StoryProductionState,
  continueThrough: StoryProductionTargetStage
): boolean {
  const targetIndex = STORY_PRODUCTION_STAGE_ORDER.indexOf(continueThrough);
  const statuses = {
    script: state.script.status,
    assets: state.assets.status,
    plot: state.plotTree.status,
    storyboard: state.storyboard.status,
  } as const;
  return STORY_PRODUCTION_STAGE_ORDER.slice(0, targetIndex + 1).some(
    (stage) => statuses[stage] !== "current"
  );
}

/**
 * Cast authoring is withdrawn from the agent surface: character cards project
 * out of `storyBible.characters`, and the canvas no longer offers a way to
 * create them, so letting the agent write them back would resurrect the very
 * entry point that was removed. Stored casts keep rendering — only authoring
 * is closed, on both the tool schema and the patch path below.
 */
const CHARACTER_OPERATION_KINDS = new Set([
  "story_bible.put_character",
  "story_bible.remove_character",
]);

export const StoryUpdateBibleInputSchema = z
  .object({
    baseDraftRevision: z.number().int().nonnegative(),
    logline: z.string().max(1_000).optional(),
    synopsis: z.string().max(20_000).optional(),
    productionNotes: z.array(z.string().max(2_000)).max(200).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.logline !== undefined ||
      value.synopsis !== undefined ||
      value.productionNotes !== undefined,
    "At least one Story bible change is required."
  );

export const StoryAddSceneInputSchema = StoryMutationBaseSchema.extend({
  afterNodeId: StoryAgentStableIdSchema.nullable().optional(),
  scene: StorySceneDraftSchema,
}).strict();

export const StoryAddBranchInputSchema = StoryMutationBaseSchema.extend({
  afterNodeId: StoryAgentStableIdSchema,
  decisionId: StoryAgentStableIdSchema,
  prompt: StoryAgentLocalizedTextSchema,
  branches: z
    .array(
      z
        .object({
          choiceId: StoryAgentStableIdSchema,
          label: StoryAgentLocalizedTextSchema,
          scene: StorySceneDraftSchema,
        })
        .strict()
    )
    .min(2)
    .max(6),
}).strict();

export const StoryEditNodeInputSchema = StoryMutationBaseSchema.extend({
  nodeId: StoryAgentStableIdSchema,
  name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(4_000).optional(),
})
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    "At least one narrative field is required."
  );

/**
 * Semantic interaction writes deliberately replace the canonical interaction
 * by id. The model never has to reconstruct the containing scene or emit raw
 * StoryPatch operations, and manual editing and Agent editing therefore share
 * exactly the same interaction contract.
 */
export const StoryPutInteractionInputSchema = StoryMutationBaseSchema.extend({
  nodeId: StoryAgentStableIdSchema,
  interaction: StoryAgentHotspotInteractionSchema,
}).strict();

export const StoryRemoveInteractionInputSchema = StoryMutationBaseSchema.extend({
  nodeId: StoryAgentStableIdSchema,
  interactionId: StoryAgentStableIdSchema,
}).strict();

export const StoryRemoveSubtreeInputSchema = StoryMutationBaseSchema.extend({
  nodeId: StoryAgentStableIdSchema,
}).strict();

export const StorySetEntryInputSchema = StoryMutationBaseSchema.extend({
  nodeId: StoryAgentStableIdSchema.nullable(),
}).strict();

export const StoryReorderInputSchema = StoryMutationBaseSchema.extend({
  nodeIds: z.array(StoryAgentStableIdSchema).max(500),
}).strict();

export const StoryApplyPatchInputSchema = StoryMutationBaseSchema.extend({
  // The shared patch vocabulary still carries cast operations for the executor
  // and the copilot; this surface refuses them so the raw patch path cannot
  // route around the withdrawn `updateBible` fields.
  operations: StoryPatchOperationsSchema.superRefine((operations, ctx) => {
    for (const operation of operations) {
      if (!CHARACTER_OPERATION_KINDS.has(operation.kind)) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${operation.kind} is not available: character authoring is disabled.`,
      });
    }
  }),
}).strict();

const StoryMutationOutputSchema = z
  .object({
    chapterId: z.string().uuid(),
    draftRevision: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    affectedNodeIds: z.array(StoryAgentStableIdSchema),
    createdNodeIds: z.array(StoryAgentStableIdSchema),
  })
  .strict();

// ── Storyboard sequence/clip editing ────────────────────────────────────────
//
// Storyboard rows live outside the Story draft: each Plot node projects to one
// sequence whose ordered clips and decision cues are addressed by globally
// unique ids. The agent contract is deliberately friction-free: no CAS version
// tokens, no read-before-write dance. Writes are last-write-wins — the Server
// resolves row versions inside the mutation transaction, and the shared
// timeline continuity rules are validated server-side as the single source.

export const StoryStoryboardClipViewSchema = z
  .object({
    clipId: z.string().uuid(),
    stableKey: z.string().min(1),
    kind: z.enum(["image", "video"]),
    title: z.string().nullable(),
    description: z.string().nullable(),
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    imagePrompt: z.string().nullable(),
    videoPrompt: z.string().nullable(),
    negativePrompt: z.string().nullable(),
    userModifiedAt: z.string().datetime().nullable(),
  })
  .strict();
export type StoryStoryboardClipView = z.infer<typeof StoryStoryboardClipViewSchema>;

export const StoryStoryboardCueViewSchema = z
  .object({
    cueId: z.string().uuid(),
    stableKey: z.string().min(1),
    kind: z.string().min(1),
    atMs: z.number().int().nonnegative(),
    decisionId: z.string().min(1).nullable(),
  })
  .strict();
export type StoryStoryboardCueView = z.infer<typeof StoryStoryboardCueViewSchema>;

export const StoryStoryboardSequenceViewSchema = z
  .object({
    sequenceId: z.string().uuid(),
    plotNodeId: StoryAgentStableIdSchema,
    description: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),
    suggestedDurationMs: z.number().int().nonnegative(),
    userModifiedAt: z.string().datetime().nullable(),
    clips: z.array(StoryStoryboardClipViewSchema),
    cues: z.array(StoryStoryboardCueViewSchema),
  })
  .strict();
export type StoryStoryboardSequenceView = z.infer<typeof StoryStoryboardSequenceViewSchema>;

export const StoryStoryboardReadInputSchema = z.object({}).strict();

export const StoryStoryboardReadOutputSchema = z
  .object({
    chapterId: z.string().uuid(),
    sequences: z.array(StoryStoryboardSequenceViewSchema),
  })
  .strict();

const StoryAgentTimelineClipInputBaseSchema = z.object({
  /** Omit for a brand-new clip; include to retain and update an existing clip. */
  clipId: z.string().uuid().optional(),
  stableKey: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).nullable(),
  startMs: z.number().int().min(0).max(3_600_000),
  durationMs: z.number().int().min(250).max(3_600_000),
  negativePrompt: z.string().trim().min(1).max(4_000).nullable().optional(),
});

export const StoryAgentTimelineClipInputSchema = z.discriminatedUnion("kind", [
  StoryAgentTimelineClipInputBaseSchema.extend({
    kind: z.literal("image"),
    imagePrompt: z.string().trim().min(1).max(12_000),
  }),
  StoryAgentTimelineClipInputBaseSchema.extend({
    kind: z.literal("video"),
    videoPrompt: z.string().trim().min(1).max(12_000),
  }),
]);

/**
 * Full-timeline replacement for one sequence. Shape-only validation here; the
 * continuity rules (clips contiguous from 0 exactly covering durationMs) are
 * enforced once, server-side, against the same contract the visual editor
 * uses.
 */
export const StoryStoryboardPutTimelineInputSchema = z
  .object({
    sequenceId: z.string().uuid(),
    durationMs: z.number().int().min(0).max(3_600_000),
    clips: z.array(StoryAgentTimelineClipInputSchema).max(1_000),
  })
  .strict();

export const StoryStoryboardPutTimelineOutputSchema = z
  .object({
    chapterId: z.string().uuid(),
    sequence: StoryStoryboardSequenceViewSchema,
  })
  .strict();

/** Single-clip semantic patch addressed by the globally unique clip id. */
export const StoryStoryboardPatchClipInputSchema = z
  .object({
    clipId: z.string().uuid(),
    kind: z.enum(["image", "video"]).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
    imagePrompt: z.string().trim().min(1).max(12_000).nullable().optional(),
    videoPrompt: z.string().trim().min(1).max(12_000).nullable().optional(),
    negativePrompt: z.string().trim().min(1).max(4_000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "clipId"),
    "At least one Storyboard clip field must be updated."
  );

export const StoryStoryboardPatchClipOutputSchema = z
  .object({
    chapterId: z.string().uuid(),
    clip: StoryStoryboardClipViewSchema,
  })
  .strict();

/**
 * Hand an explicit Story production request to the Server-side canonical
 * planner. Unlike the fine-grained Plot mutation tools, this command never
 * makes the model reconstruct a whole project from transcript history. The
 * Server inspects the chapter's durable stages and decides whether a screenplay
 * proposal or only downstream specification work is required.
 */
export const StoryAuthorInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    brief: z.string().trim().min(1).max(STORY_AGENT_BRIEF_MAX_CHARS),
    /** Furthest independently reviewable stage authorized by this request. */
    continueThrough: StoryProductionTargetStageSchema,
    /** Full source from script.readSection or the current turn attachment list. */
    sourceAttachmentId: z.string().uuid().optional(),
    /** Only for an explicit request to redo existing specifications, never for media generation. */
    regenerateStage: z.enum(["plot", "assets", "storyboard"]).optional(),
    /** Natural acknowledgement shown as soon as durable planning starts; never claims success. */
    startedMessage: z.string().trim().min(1).max(2_000),
    /**
     * Stage-accurate result shown when the handoff completes. A screenplay may
     * be reviewable; downstream specs are never a second review artifact. It
     * distinguishes durable specifications from generated media and directs the
     * creator to Generate for any later image/video production.
     */
    completionMessage: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const StoryConfirmCreativeProfileInputSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    aspectRatio: z.enum(["landscape_16_9", "portrait_9_16"]),
    targetRuntime: z.enum(["short_5_15", "medium_15_30", "long_30_60"]),
    visualDirection: z.enum(STORY_VISUAL_STYLE_SKILL_SLUGS),
    storyLanguage: StoryCreativeProfileLanguageSchema,
  })
  .strict();

const StoryCreativeProfileOutputSchema = z
  .object({
    frameProfile: z.enum(["landscape_16_9", "portrait_9_16"]),
    durationPreset: z.enum(["short_5_15", "medium_15_30", "long_30_60"]),
    visualStyle: z.enum(STORY_VISUAL_STYLE_SKILL_SLUGS),
    storyLanguage: StoryCreativeProfileLanguageSchema,
    confirmedAt: z.string().datetime(),
  })
  .strict();

const StoryAuthorOutputSchema = z
  .object({
    runId: z.string().uuid(),
    status: z.literal("authoring"),
    agentHandoff: AgentExternalJobHandoffSchema,
  })
  .strict();

const StoryGenerationBatchStatusSchema = z.enum([
  "awaiting_confirmation",
  "blocked",
  "queued",
  "running",
  "cancelling",
  "completed",
  "partial_failed",
  "cancelled",
  "failed",
  "expired",
]);
const StoryGenerationBatchItemStatusSchema = z.enum([
  "awaiting_confirmation",
  "ready",
  "dispatching",
  "submitted",
  "completed",
  "failed",
  "cancelled",
]);

export const StoryQuoteAssetGenerationBatchInputSchema = z
  .object({
    assetIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    assetKinds: z
      .array(z.enum(["character", "location", "prop"]))
      .min(1)
      .max(3)
      .optional(),
    outputKind: z.enum(["image", "video"]).default("image"),
    modelId: z.string().trim().min(1).max(180).optional(),
    schemaVersion: z.string().trim().min(1).max(180).optional(),
    options: z
      .record(
        z.string().trim().min(1).max(120),
        z.union([
          z.boolean(),
          z.number().finite(),
          z.string().trim().min(1).max(180),
          z
            .array(z.union([z.boolean(), z.number().finite(), z.string().trim().min(1).max(180)]))
            .max(32),
        ])
      )
      .default({}),
    /** Deterministic H5 continuation only; hidden from the free-form model binding. */
    dispatchMode: z.literal("sequential").optional(),
  })
  .strict()
  .refine((value) => Boolean(value.modelId) === Boolean(value.schemaVersion), {
    message: "modelId and schemaVersion must be supplied together.",
  });

export const StoryConfirmGenerationBatchInputSchema = z
  .object({
    batchId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    expectedItemCount: z.number().int().positive().max(500),
    expectedTotalPoints: z.number().int().nonnegative(),
  })
  .strict();
export const StoryGetGenerationBatchInputSchema = z.object({ batchId: z.string().uuid() }).strict();

export const StoryQuoteStoryboardGenerationBatchInputSchema = z
  .object({
    clipIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    /** Deterministic H5 continuation only; hidden from the free-form model binding. */
    dispatchMode: z.literal("sequential").optional(),
  })
  .strict();

const StoryGenerationBatchOutputSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    chapterId: z.string().uuid(),
    status: StoryGenerationBatchStatusSchema,
    dispatchMode: z.enum(["parallel", "sequential"]),
    totalPoints: z.number().int().nonnegative(),
    availablePoints: z.string().regex(/^\d+$/).nullable(),
    itemCount: z.number().int().positive().max(500),
    version: z.number().int().nonnegative(),
    quoteExpiresAt: z.string().datetime(),
    confirmedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    blockedAt: z.string().datetime().nullable(),
    blockReason: z.unknown().nullable(),
    canCancel: z.boolean(),
    agentHandoff: AgentExternalJobHandoffSchema.optional(),
    counts: z.record(StoryGenerationBatchItemStatusSchema, z.number().int().nonnegative()),
    items: z.array(
      z
        .object({
          id: z.string().uuid(),
          ordinal: z.number().int().nonnegative(),
          status: StoryGenerationBatchItemStatusSchema,
          targetKind: z.enum(["asset_spec", "storyboard_clip"]),
          targetId: z.string().uuid(),
          sequenceId: z.string().uuid().nullable(),
          targetVersion: z.number().int().nonnegative(),
          outputKind: z.enum(["image", "video"]),
          modelId: z.string().min(1),
          schemaVersion: z.string().min(1),
          quotedPoints: z.number().int().nonnegative(),
          generationId: z.string().uuid().nullable(),
          error: z.unknown().nullable(),
        })
        .strict()
    ),
  })
  .strict();

export const STORY_AGENT_OS_TOOLS = [
  {
    id: "story.read",
    description:
      "Read the active Story chapter and current durable authoring-run status, including story bible, graph topology, production notes, revision, content hash, and the Server-owned productionState for profile, Script, Plot Tree, Asset Specs, and Storyboard specs. Call before every Story write, before story.author, and before claiming that a background run or production stage is active/current/missing. productionState, not transcript prose or graph emptiness, selects create, incremental completion, or no-op.",
    kind: "query",
    risk: "read",
    inputSchema: StoryReadInputSchema,
    outputSchema: z
      .object({
        chapterId: z.string().uuid(),
        draftRevision: z.number().int().nonnegative(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        storyBible: z.object({
          logline: z.string(),
          synopsis: z.string(),
          characters: z.array(StoryAgentCharacterSchema),
        }),
        graph: z.object({
          entryNodeId: StoryAgentStableIdSchema.nullable(),
          nodes: z.array(StoryAgentGraphNodeSchema),
        }),
        productionNotes: z.array(z.string()),
        productionState: StoryProductionStateSchema,
        creativeProfile: z
          .object({
            frameProfile: z.enum(["landscape_16_9", "portrait_9_16"]),
            durationPreset: z.enum(["short_5_15", "medium_15_30", "long_30_60"]).nullable(),
            visualStyle: z.enum(STORY_VISUAL_STYLE_SKILL_SLUGS).nullable(),
            storyLanguage: z.string().min(2).max(16),
            confirmed: z.boolean(),
          })
          .strict(),
        /**
         * Current durable authoring lifecycle. Conversation text is historical
         * and can say "drafting" long after a creator discarded that run; the
         * model must use this projection instead of inferring job state from
         * an earlier assistant message.
         */
        authoringRun: z
          .object({
            runId: z.string().uuid(),
            status: StoryAgentRunStatusSchema,
          })
          .strict()
          .nullable(),
      })
      .strict(),
  },
  {
    id: "story.confirmCreativeProfile",
    description:
      "Atomically confirm the Story project's complete aspect ratio, runtime, visual direction, and story language. Use values the creator already supplied directly, plus answers from a story_creative_profile interaction when some values were missing. Pass that interaction's requestId when one was used; the server validates every requested answer against these values.",
    kind: "command",
    risk: "reversible",
    inputSchema: StoryConfirmCreativeProfileInputSchema,
    outputSchema: StoryCreativeProfileOutputSchema,
  },
  {
    id: "story.updateBible",
    description:
      "Update the Story bible overview or production notes atomically against baseDraftRevision. Cast authoring is not available.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryUpdateBibleInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.addScene",
    description:
      "Atomically add one linear scene and connect it after an auto-exit predecessor. Omit afterNodeId only for an empty graph or to append after the current final node.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryAddSceneInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.addBranch",
    description:
      "Atomically turn one existing scene into a choice and create every target scene, so the graph can never contain dangling branch references.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryAddBranchInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.editNode",
    description: "Edit one scene's narrative name or description without changing graph topology.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryEditNodeInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.putInteraction",
    description:
      "Create or replace one scene interaction by interactionId using the same tap, swipe, press-hold, timing, hotspot, and outcome protocol as the visual editor.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryPutInteractionInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.removeInteraction",
    description:
      "Remove one scene interaction by interactionId without changing the scene's video or narrative topology.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryRemoveInteractionInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.removeSubtree",
    description:
      "Remove a scene and descendants that become unreachable, while retaining any shared descendants still referenced from outside the removed subtree.",
    kind: "command",
    risk: "critical",
    inputSchema: StoryRemoveSubtreeInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.setEntry",
    description: "Set or clear the active chapter's entry scene against baseDraftRevision.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StorySetEntryInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.reorder",
    description:
      "Reorder all scenes in the active chapter. nodeIds must contain every current scene exactly once.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryReorderInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.applyPatch",
    description:
      "Apply canonical StoryPatch operations for complex graph refactors that cannot be expressed by the intent-level Story tools.",
    kind: "command",
    risk: "critical",
    inputSchema: StoryApplyPatchInputSchema,
    outputSchema: StoryMutationOutputSchema,
  },
  {
    id: "story.storyboard.read",
    description:
      "Read the active chapter's Storyboard timelines: one sequence per Plot node with its ordered clips (prompts, timings, kinds) and decision cues, each addressed by a globally unique id. Sequences with zero clips are unplanned placeholders. Call before describing or editing shot content.",
    kind: "query",
    risk: "read",
    inputSchema: StoryStoryboardReadInputSchema,
    outputSchema: StoryStoryboardReadOutputSchema,
  },
  {
    id: "story.storyboard.putTimeline",
    description:
      "Atomically replace one sequence's complete visual timeline. Clips must be ordered and contiguous from startMs 0 and exactly cover durationMs; an image clip carries only imagePrompt, a video clip only videoPrompt. Include a clip's clipId to retain and update it; omit clipId to create a new clip; existing clips left out of the list are archived. Continuity is validated server-side against the same contract as the visual editor.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryStoryboardPutTimelineInputSchema,
    outputSchema: StoryStoryboardPutTimelineOutputSchema,
  },
  {
    id: "story.storyboard.patchClip",
    description:
      "Patch one clip's semantic fields (kind, title, description, imagePrompt, videoPrompt, negativePrompt) addressed by its globally unique clipId. Prefer this over putTimeline for small single-shot tweaks; a kind change must leave the prompt fields consistent with the new kind.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryStoryboardPatchClipInputSchema,
    outputSchema: StoryStoryboardPatchClipOutputSchema,
  },
  {
    id: "story.author",
    description:
      "Hand an explicit Story creation or continue-production request to the Server-side canonical next-stage planner. Never call for greetings, casual conversation, capability questions, unrelated requests, or merely because Story mode is open. Call story.read first. For an uploaded source script, pass its sourceAttachmentId so the Server can read the complete text, without copying sections into the brief. For an explicit request to redo existing Plot, Asset Specs, or Storyboard Specs, set regenerateStage to that stage. Omit it for ordinary continuation and for media rendering requests. The Server reuses every other valid chapter stage and selects exactly one next artifact in Script -> Plot -> Asset Specs -> Storyboard order. Set continueThrough once to the furthest stage authorized by the creator: broad create/complete/adapt/continue-production requests normally select storyboard, while an explicit stage-only request selects that stage. The durable workflow re-reads canonical state and advances through this scope after each successful apply; it never asks the model to infer the old intent again. Only when no valid Script exists may the Server author a screenplay proposal, asking for missing project-profile values first when necessary. A Plot proposal compiles the approved Script into the single canonical Plot topology. An Asset Specs artifact derives stably referenceable logical specs from that approved Plot and its Script interpretation. A Storyboard proposal creates one Storyboard sequence per Plot node with one or more ordered clips and consumes the approved Asset Specs. On desktop, Script, Plot, Asset Specs, and Storyboard each remain a separate creator approval boundary, and the creator uses Generate later. On the trusted mobile_h5 surface, Script and Plot remain Continue/Don't continue boundaries; choosing Continue on Plot authorizes the Server to prepare and persist Asset Specs without a second Asset confirmation, then quote, confirm, and generate every current asset image sequentially with per-item compute-point billing. Storyboard remains a separate Continue/Don't continue boundary; choosing Continue on Storyboard authorizes its clips to generate sequentially in story order with per-item billing. The model must not call paid generation tools itself. This tool itself never generates media directly; the authoritative Server continuation owns auto-apply, quoting, billing, ordering, failure-stop, and resume semantics. For a narrow edit to an existing Plot, use the fine-grained story.* tools instead. Provide a specific startedMessage that acknowledges work without claiming success. completionMessage must name only the artifact selected by canonical state and must not claim it was already applied. If the Server-selected stage is not exposed, use neutral handoff copy rather than predicting it. Runs asynchronously and returns a durable external-job handoff.",
    kind: "command",
    // Reversible at the Agent tool boundary: this durably schedules the Server
    // plan and never starts paid media generation. The stage-specific
    // creator-facing proposal is the only write gate for this run.
    risk: "reversible",
    inputSchema: StoryAuthorInputSchema,
    outputSchema: StoryAuthorOutputSchema,
  },
  {
    id: "story.generation.quoteAssets",
    description:
      "Create a durable, expiring compute-point quote for generating current Asset Specs. For category-scoped requests, pass assetKinds: use character for roles/characters, location for scenes/locations, and prop for props. Pass assetIds for an explicit subset; both filters may be combined. Omit both only when the creator explicitly requests every current Asset Spec in the active chapter. This does not generate media or reserve points. Show totalPoints and itemCount to the creator before asking to confirm the paid batch.",
    kind: "command",
    risk: "reversible",
    inputSchema: StoryQuoteAssetGenerationBatchInputSchema,
    outputSchema: StoryGenerationBatchOutputSchema,
  },
  {
    id: "story.generation.quoteStoryboard",
    description:
      "Quote current Storyboard clips as one durable generation batch. Image and video clips keep their planned media kind and use the project's saved default model for that kind. On mobile_h5 this is called only by the deterministic post-Storyboard continuation, which requests sequential dispatch; the free-form model must not use it to bypass the Storyboard Continue boundary.",
    kind: "command",
    risk: "reversible",
    inputSchema: StoryQuoteStoryboardGenerationBatchInputSchema,
    outputSchema: StoryGenerationBatchOutputSchema,
  },
  {
    id: "story.generation.confirmBatch",
    description:
      "Propose confirmation of an unexpired generation quote and begin fair queued execution only after the runtime approval card is accepted. Call this immediately after quoteAssets with the exact batch id, version, itemCount, and totalPoints; the mandatory tool approval is the single explicit creator confirmation and must never be replaced by conversational consent.",
    kind: "command",
    risk: "critical",
    inputSchema: StoryConfirmGenerationBatchInputSchema,
    outputSchema: StoryGenerationBatchOutputSchema,
  },
  {
    id: "story.generation.getBatch",
    description:
      "Read the current durable status and per-item progress of a Story media generation batch.",
    kind: "query",
    risk: "read",
    inputSchema: StoryGetGenerationBatchInputSchema,
    outputSchema: StoryGenerationBatchOutputSchema,
  },
  {
    id: "story.generation.cancelBatch",
    description:
      "Cancel a Story generation batch. Undispatched items stop immediately and already-submitted jobs receive best-effort cancellation.",
    kind: "command",
    risk: "sensitive",
    inputSchema: StoryGetGenerationBatchInputSchema,
    outputSchema: StoryGenerationBatchOutputSchema,
  },
] as const satisfies readonly ToolDefinition[];

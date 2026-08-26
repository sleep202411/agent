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

const StoryProductionStageStatusSchema = z.enum(["missing", "current", "stale"]);

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
        staleCount: z.number().int().nonnegative(),
      })
      .strict(),
    storyboard: z
      .object({
        status: StoryProductionStageStatusSchema,
        sequenceCount: z.number().int().nonnegative(),
        staleCount: z.number().int().nonnegative(),
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
 * durable workflow then advances deterministically and still pauses for a
 * separate approval at every stage.
 */
export const StoryProductionTargetStageSchema = z.enum(["script", "plot", "assets", "storyboard"]);
export type StoryProductionTargetStage = z.infer<typeof StoryProductionTargetStageSchema>;

export const StoryProductionContinuationPlanSchema = z
  .object({
    continueThrough: StoryProductionTargetStageSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    brief: z.string().trim().min(1).max(STORY_AGENT_BRIEF_MAX_CHARS),
  })
  .strict();
export type StoryProductionContinuationPlan = z.infer<typeof StoryProductionContinuationPlanSchema>;

const STORY_PRODUCTION_STAGE_ORDER = [
  "script",
  "plot",
  "assets",
  "storyboard",
] as const satisfies readonly StoryProductionTargetStage[];

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

const StoryGenerationBatchOutputSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid(),
    chapterId: z.string().uuid(),
    status: StoryGenerationBatchStatusSchema,
    totalPoints: z.number().int().nonnegative(),
    itemCount: z.number().int().positive().max(500),
    version: z.number().int().nonnegative(),
    quoteExpiresAt: z.string().datetime(),
    confirmedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    canCancel: z.boolean(),
    counts: z.record(StoryGenerationBatchItemStatusSchema, z.number().int().nonnegative()),
    items: z.array(
      z
        .object({
          id: z.string().uuid(),
          ordinal: z.number().int().nonnegative(),
          status: StoryGenerationBatchItemStatusSchema,
          targetId: z.string().uuid(),
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
    id: "story.author",
    description:
      "Hand an explicit Story creation or continue-production request to the Server-side canonical next-stage planner. Never call for greetings, casual conversation, capability questions, unrelated requests, or merely because Story mode is open. Call story.read first. The Server reuses every valid chapter stage and selects exactly one reviewable proposal: the earliest missing or stale artifact in Script -> Plot -> Asset Specs -> Storyboard order. Set continueThrough once to the furthest separately reviewable stage authorized by the creator: broad create/complete/adapt/continue-production requests normally select storyboard, while an explicit stage-only request selects that stage. The durable workflow re-reads canonical state and advances through this scope after each successful apply; it never asks the model to infer the old intent again. One call creates one independently auditable Story run and one approval boundary; approval writes only that artifact and never approves or applies the following stage. Preparing the next proposal may be automatic; approving it never is. Only when no valid Script exists may the Server author a screenplay proposal, asking for missing project-profile values first when necessary. A Plot proposal compiles the approved Script into the single canonical Plot topology. An Asset Specs proposal derives stably referenceable logical specs from that approved Plot and its Script interpretation and may have zero generated media. A Storyboard proposal creates one Storyboard sequence per Plot node with one or more ordered clips and consumes the approved Asset Specs. This tool never generates images or videos and never incurs media-generation work; the creator must use Generate later. For a narrow edit to an existing Plot, use the fine-grained story.* tools instead. Provide a specific startedMessage that acknowledges work without claiming success. completionMessage must name only the one proposal selected by canonical state and say that it is ready for creator review, not already applied. If the Server-selected stage is not exposed, use neutral handoff copy rather than predicting it. Always say that media has not been generated. The authoritative Server apply continuation announces only the single artifact persisted after approval. Runs asynchronously and returns a durable external-job handoff.",
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

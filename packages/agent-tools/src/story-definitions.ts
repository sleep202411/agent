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
 * Kick off the deterministic five-baton authoring pipeline from a brief. Unlike
 * the fine-grained mutation tools, this does not touch the draft directly — it
 * files an async authoring run that lands as a reviewable proposal, so no
 * baseDraftRevision is required.
 */
export const StoryAuthorInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    brief: z.string().trim().min(1).max(STORY_AGENT_BRIEF_MAX_CHARS),
    /** Natural assistant handoff shown as soon as the background job starts. */
    startedMessage: z.string().trim().min(1).max(2_000),
    /** Natural assistant result shown when the reviewable proposal is ready. */
    completionMessage: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const StoryConfirmCreativeProfileInputSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    aspectRatio: z.enum(["landscape_16_9", "portrait_9_16"]),
    targetRuntime: z.enum(["short_5_15", "medium_15_30", "long_30_60"]),
    visualDirection: z.enum([
      "cinematic_realism",
      "stylized_3d",
      "graphic_novel",
      "anime_cinematic",
    ]),
    storyLanguage: StoryCreativeProfileLanguageSchema,
  })
  .strict();

const StoryCreativeProfileOutputSchema = z
  .object({
    frameProfile: z.enum(["landscape_16_9", "portrait_9_16"]),
    durationPreset: z.enum(["short_5_15", "medium_15_30", "long_30_60"]),
    visualStyle: z.enum(["cinematic_realism", "stylized_3d", "graphic_novel", "anime_cinematic"]),
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

export const STORY_AGENT_OS_TOOLS = [
  {
    id: "story.read",
    description:
      "Read the active Story chapter and current durable authoring-run status, including story bible, graph topology, production notes, revision, and content hash. Call before every Story write and before claiming that a background authoring run is active.",
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
        creativeProfile: z
          .object({
            frameProfile: z.enum(["landscape_16_9", "portrait_9_16"]),
            durationPreset: z.enum(["short_5_15", "medium_15_30", "long_30_60"]).nullable(),
            visualStyle: z
              .enum(["cinematic_realism", "stylized_3d", "graphic_novel", "anime_cinematic"])
              .nullable(),
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
      "Draft an interactive story from a brief. Hands title + summary + the source brief (a script or idea) to the deterministic five-baton authoring pipeline (bible → structure → branches → scenes → validate), which files a reviewable proposal for the whole tree with no dangling references. Use this to CREATE a story from scratch; use the fine-grained story.* tools only to edit an existing tree. Provide a concise, natural startedMessage acknowledging the handoff and a concise completionMessage for when the proposal is ready. Runs asynchronously and returns a durable external-job handoff the author confirms later.",
    kind: "command",
    // Reversible, not critical: it writes nothing — it files a proposal the
    // author applies or discards in the panel — so it auto-runs instead of
    // gating behind a raw-JSON tool approval that duplicates that decision.
    risk: "reversible",
    inputSchema: StoryAuthorInputSchema,
    outputSchema: StoryAuthorOutputSchema,
  },
] as const satisfies readonly ToolDefinition[];

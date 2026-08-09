import {
  StoryAgentCharacterSchema,
  StoryAgentClipKeySchema,
  StoryAgentGraphNodeSchema,
  StoryAgentLocalizedTextSchema,
  StoryAgentStableIdSchema,
  StoryPatchOperationsSchema,
} from "@repo/shared/story-agent";
import { z } from "zod";

import type { ToolDefinition } from "./types.js";

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

export const STORY_AGENT_OS_TOOLS = [
  {
    id: "story.read",
    description:
      "Read the active Story chapter, including story bible, graph topology, production notes, revision, and content hash. Call before every Story write.",
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
      })
      .strict(),
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
] as const satisfies readonly ToolDefinition[];

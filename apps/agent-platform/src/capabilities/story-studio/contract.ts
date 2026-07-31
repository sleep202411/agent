import { z } from "zod";

const stableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, "Use a stable identifier.");
const clipKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_-]*$/, "Use an uppercase stable clip key.");
const localizedTextSchema = z.record(z.string().min(2).max(16), z.string().max(4_000));
const localizedBodySchema = z.record(z.string().min(2).max(16), z.string().max(20_000));

const characterSchema = z
  .object({
    id: stableIdSchema,
    name: localizedTextSchema,
    summary: z.string().max(4_000),
  })
  .strict();

const endingSchema = z
  .object({
    id: stableIdSchema,
    title: localizedTextSchema,
    summary: localizedTextSchema.optional(),
  })
  .strict();

const choiceSchema = z
  .object({
    choiceId: stableIdSchema,
    label: localizedTextSchema,
    nextNodeId: stableIdSchema,
  })
  .strict();

const exitSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("auto"),
      nextNodeId: stableIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("choice"),
      decisionId: stableIdSchema,
      prompt: localizedTextSchema,
      choices: z.array(choiceSchema).max(6),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ending"),
      endingId: stableIdSchema,
    })
    .strict(),
]);

const graphNodeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("clip"),
      nodeId: stableIdSchema,
      clipKey: clipKeySchema,
      name: z.string().trim().max(120).optional(),
      description: z.string().trim().max(4_000).optional(),
      exit: exitSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      nodeId: stableIdSchema,
      title: localizedTextSchema.optional(),
      body: localizedBodySchema,
      exit: exitSchema,
    })
    .strict(),
]);

/**
 * Model-authored Story commands. The Domain Gateway deterministically adds
 * operationId and summary bookkeeping before parsing with the authoritative
 * Story domain schema. Media bindings never cross this boundary; replacing a
 * node preserves its existing human-owned music binding in the domain layer.
 */
export const storyOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("story_bible.update_overview"),
      payload: z
        .object({
          logline: z.string().max(1_000).optional(),
          synopsis: z.string().max(20_000).optional(),
          worldview: z.string().max(20_000).optional(),
        })
        .strict()
        .refine(
          (payload) =>
            payload.logline !== undefined ||
            payload.synopsis !== undefined ||
            payload.worldview !== undefined,
          "At least one overview field is required."
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("story_bible.put_character"),
      payload: z
        .object({
          intent: z.enum(["create", "replace"]),
          character: characterSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("story_bible.remove_character"),
      payload: z.object({ characterId: stableIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("story_bible.put_ending"),
      payload: z
        .object({
          intent: z.enum(["create", "replace"]),
          ending: endingSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("story_bible.remove_ending"),
      payload: z.object({ endingId: stableIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("story_graph.set_entry_node"),
      payload: z.object({ nodeId: stableIdSchema.nullable() }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("story_graph.put_node"),
      payload: z
        .object({
          intent: z.enum(["create", "replace"]),
          node: graphNodeSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("story_graph.remove_node"),
      payload: z.object({ nodeId: stableIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("story_graph.reorder_nodes"),
      payload: z.object({ nodeIds: z.array(stableIdSchema).max(500) }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("production.replace_notes"),
      payload: z
        .object({
          productionNotes: z.array(z.string().max(2_000)).max(200),
        })
        .strict(),
    })
    .strict(),
]);

export const storyChangeSetSchema = z
  .object({
    schemaVersion: z.literal("story-change-set/v2"),
    chapterId: z.uuid(),
    baseDraftRevision: z.number().int().nonnegative(),
    baseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseLayoutRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    operations: z.array(storyOperationSchema).min(1).max(100),
  })
  .strict();

export type StoryOperation = z.infer<typeof storyOperationSchema>;
export type StoryChangeSet = z.infer<typeof storyChangeSetSchema>;

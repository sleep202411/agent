import { z } from "zod";

import type { CapabilityPack } from "../types.js";
import { storyChangeSetSchema } from "./contract.js";

const storyApplyInputSchema = z
  .object({
    schemaVersion: z.literal("story-apply/v1"),
    changeSet: storyChangeSetSchema,
  })
  .strict();

const storySourceQueryInputSchema = z
  .object({
    schemaVersion: z.literal("story-source-material-query/v1"),
    attachmentId: z.uuid(),
    mode: z.enum(["overview", "search", "range", "entity", "continuity"]),
    query: z.string().trim().min(1).max(500).optional(),
    cursor: z
      .string()
      .regex(/^chunk-[0-9]{6}$/u)
      .optional(),
    limit: z.number().int().min(1).max(12).default(6),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.mode === "search" || input.mode === "entity") && !input.query) {
      context.addIssue({
        code: "custom",
        path: ["query"],
        message: `query is required for ${input.mode} mode`,
      });
    }
    if (input.cursor && input.mode !== "range") {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "cursor is only supported in range mode",
      });
    }
  });

const storySourceAnalysisInputSchema = z
  .object({
    schemaVersion: z.literal("story-source-analysis-query/v1"),
    attachmentId: z.uuid(),
    lens: z
      .enum([
        "overview",
        "structure",
        "characters",
        "locations",
        "plot",
        "continuity",
        "themes",
        "production",
      ])
      .default("overview"),
    limit: z.number().int().min(1).max(8).default(8),
  })
  .strict();

export const storyStudioCapabilityPack = Object.freeze({
  id: "story-studio",
  surface: "story-studio",
  instructions: `
You are operating inside FizzDragon Story Studio.

Treat the signed Story project as a versioned, multi-chapter domain aggregate,
never as a generic node graph. Read the authoritative chapter directory and
draft before modifying it. Story content is localized; preserve every locale
you are not explicitly asked to change. Human-owned media bindings are outside
your authoring authority.

The exhaustive analysis of an uploaded document is a durable background job.
It starts when the document is registered and takes many minutes on a
feature-length script, so it is never ready in the turn that uploads it.
story_get_source_analysis is a non-blocking read of that job, not a request for
it: "ready" carries the finished analysis, "processing" carries
progress.percent, and "failed" carries the reason. A not-ready read is a
successful read, not an error. Relay the exact state and percentage to the
creator, answer the current request in the same turn from bounded
story_query_source_material, and say that the exhaustive pass will be available
to a later request. Never wait on the job, never poll it repeatedly inside one
turn, and never end a turn whose only outcome is a pending analysis.

Submit all interdependent Story operations in one story_apply_change_set call
with the exact chapterId, draft revision, content hash, and layout revision
returned by story_get_snapshot. Include every newly referenced node or ending
in the same change set. Before proposing the tool call, explain the creative
effect and the concrete scenes, choices, characters, or notes that will change.
The signed conversation policy decides whether that exact call pauses for
approval. A
rejected compare-and-swap means the project changed: read again and construct a
new proposal. Never resubmit stale revisions and never claim success from text.
  `.trim(),
  tools: [
    {
      id: "story_get_source_analysis",
      description:
        'Read a bounded lens from the durable background analysis of a registered Story document. This read never waits: it returns status "ready" with the exhaustive analysis and exact chunk evidence, "processing" with progress.percent for a pass that is still running, or "failed" with the reason. "processing" and "failed" are successful reads, not errors — report that state and its percentage to the creator and answer the request now from bounded story_query_source_material. Never poll this tool inside one turn and never end a turn on a pending analysis.',
      inputSchema: storySourceAnalysisInputSchema,
      requiredPermission: "story.read",
      approvalClass: "none",
      execute: ({ arguments: toolArguments, context, idempotencyKey, gateway, signal }) =>
        gateway.execute({
          toolId: "story_get_source_analysis",
          arguments: toolArguments,
          context,
          idempotencyKey,
          signal,
        }),
    },
    {
      id: "story_query_source_material",
      description:
        "Retrieve a bounded, relevant portion of a registered Story Studio document. Use overview for structure, search for a topic, entity for character evidence, continuity for scene/time evidence, or range for exhaustive paged reading. Never request an entire long document in one model turn.",
      inputSchema: storySourceQueryInputSchema,
      requiredPermission: "story.read",
      approvalClass: "none",
      execute: ({ arguments: toolArguments, context, idempotencyKey, gateway, signal }) =>
        gateway.execute({
          toolId: "story_query_source_material",
          arguments: toolArguments,
          context,
          idempotencyKey,
          signal,
        }),
    },
    {
      id: "story_get_snapshot",
      description:
        "Read the authoritative, versioned Story Studio graph for the signed project scope.",
      inputSchema: z
        .object({
          schemaVersion: z.literal("story-read/v2"),
          chapterId: z.uuid().optional(),
          nodeCursor: z
            .string()
            .trim()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
            .optional(),
          nodeLimit: z.number().int().min(1).max(100).default(50),
          includeStoryBible: z.boolean().default(true),
          includeAssets: z.boolean().default(false),
        })
        .strict(),
      requiredPermission: "story.read",
      approvalClass: "none",
      execute: ({ arguments: toolArguments, context, idempotencyKey, gateway, signal }) =>
        gateway.execute({
          toolId: "story_get_snapshot",
          arguments: toolArguments,
          context,
          idempotencyKey,
          signal,
        }),
    },
    {
      id: "story_apply_change_set",
      description:
        "Atomically compare-and-swap a complete Story Studio graph change set after human approval.",
      inputSchema: storyApplyInputSchema,
      requiredPermission: "story.write",
      approvalClass: (input) => {
        const parsed = storyApplyInputSchema.parse(input);
        return parsed.changeSet.operations.some((operation) =>
          [
            "story_bible.remove_character",
            "story_bible.remove_ending",
            "story_graph.remove_node",
          ].includes(operation.kind)
        )
          ? "sensitive"
          : "routine";
      },
      execute: ({ arguments: toolArguments, context, idempotencyKey, gateway, signal }) =>
        gateway.execute({
          toolId: "story_apply_change_set",
          arguments: toolArguments,
          context,
          idempotencyKey,
          signal,
        }),
    },
  ],
} satisfies CapabilityPack);

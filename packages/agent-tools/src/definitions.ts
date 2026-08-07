import { z } from "zod";

import type { ToolDefinition } from "./types.js";

const stableKey = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);

const localizedName = z.record(z.string().min(2).max(16), z.string().min(1).max(200));

export const ScriptReadSectionInputSchema = z
  .object({
    attachmentId: z.uuid(),
    /** 0-based section index after ingestion split. */
    sectionIndex: z.number().int().nonnegative().max(10_000),
    maxChars: z.number().int().positive().max(50_000).default(8_000),
  })
  .strict();

export const ScriptReadSectionOutputSchema = z
  .object({
    attachmentId: z.uuid(),
    sectionIndex: z.number().int().nonnegative(),
    totalSections: z.number().int().positive(),
    text: z.string().max(50_000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const CharactersUpsertInputSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    characters: z
      .array(
        z
          .object({
            id: stableKey,
            name: localizedName,
            summary: z.string().trim().min(1).max(4_000),
            intent: z.enum(["create", "replace"]).default("create"),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();

export const CharactersUpsertOutputSchema = z
  .object({
    projectRevision: z.number().int().nonnegative(),
    written: z.array(
      z
        .object({
          id: stableKey,
          name: z.string().min(1),
        })
        .strict()
    ),
  })
  .strict();

export const CharactersListInputSchema = z.object({}).strict();

export const CharactersListOutputSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    characters: z.array(
      z
        .object({
          id: stableKey,
          name: z.string().min(1),
          summary: z.string(),
        })
        .strict()
    ),
  })
  .strict();

export const CanvasReadInputSchema = z.object({}).strict();

export const CanvasReadOutputSchema = z
  .object({
    projectId: z.uuid(),
    draftRevision: z.number().int().nonnegative(),
    layoutRevision: z.number().int().nonnegative(),
    nodeCount: z.number().int().nonnegative(),
    selectedSummaries: z
      .array(
        z
          .object({
            id: z.string(),
            kind: z.string(),
            title: z.string().optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

export const CanvasApplyPatchInputSchema = z
  .object({
    baseDraftRevision: z.number().int().nonnegative(),
    baseLayoutRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.string().trim().min(1).max(4_000).optional(),
    operations: z
      .array(
        z
          .object({
            operationId: z.uuid(),
            kind: z.string().min(1).max(128),
            payload: z.record(z.string(), z.unknown()),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();

export const CanvasApplyPatchOutputSchema = z
  .object({
    draftRevision: z.number().int().nonnegative(),
    layoutRevision: z.number().int().nonnegative(),
    appliedOperationIds: z.array(z.uuid()),
  })
  .strict();

/**
 * Phase-1 tool surface for Agent OS.
 * Golden path A: script.readSection + characters.upsert
 * Golden path B: canvas.read + canvas.applyPatch
 */
export const AGENT_OS_TOOLS = [
  {
    id: "script.store",
    description:
      "Store full script text into project Agent OS state as bounded sections (platform projects).",
    kind: "command",
    risk: "reversible",
    inputSchema: z
      .object({
        text: z.string().min(1).max(200_000),
        sectionSize: z.number().int().positive().max(50_000).optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        sectionCount: z.number().int().nonnegative(),
        surface: z.string().optional(),
      })
      .strict(),
  },
  {
    id: "script.readSection",
    description:
      "Read one bounded section of an uploaded script/attachment. Prefer multiple calls over loading the entire script.",
    kind: "query",
    risk: "read",
    inputSchema: ScriptReadSectionInputSchema,
    outputSchema: ScriptReadSectionOutputSchema,
  },
  {
    id: "characters.list",
    description: "List characters currently stored on the project.",
    kind: "query",
    risk: "read",
    inputSchema: CharactersListInputSchema,
    outputSchema: CharactersListOutputSchema,
  },
  {
    id: "characters.upsert",
    description:
      "Create or replace project characters in the database. Requires baseRevision. Prefer preview/approval before large batches.",
    kind: "command",
    risk: "sensitive",
    inputSchema: CharactersUpsertInputSchema,
    outputSchema: CharactersUpsertOutputSchema,
  },
  {
    id: "canvas.read",
    description: "Read the current project canvas snapshot and revisions.",
    kind: "query",
    risk: "read",
    inputSchema: CanvasReadInputSchema,
    outputSchema: CanvasReadOutputSchema,
  },
  {
    id: "canvas.applyPatch",
    description: "Apply a typed, versioned patch to the project canvas (nodes/edges/layout).",
    kind: "command",
    risk: "sensitive",
    inputSchema: CanvasApplyPatchInputSchema,
    outputSchema: CanvasApplyPatchOutputSchema,
  },
] as const satisfies readonly ToolDefinition[];

export type AgentOsToolId = (typeof AGENT_OS_TOOLS)[number]["id"];

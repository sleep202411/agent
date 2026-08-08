import { randomUUID } from "node:crypto";
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
    /** Uploaded attachment id from Agent OS file upload API. */
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
    totalSections: z.number().int().nonnegative(),
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
    surface: z.string().optional(),
    written: z.array(
      z
        .object({
          id: stableKey,
          name: z.string().min(1),
        })
        .strict()
    ),
    idempotencyKey: z.string().optional(),
  })
  .strict();

export const CharactersListInputSchema = z.object({}).strict();

export const CharactersListOutputSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    surface: z.string().optional(),
    contentHash: z.string().optional(),
    chapterId: z.string().optional(),
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

/** Models often invent invalid UUIDs; mint a real one when missing/invalid. */
function coerceOperationUuid(value: unknown): string {
  if (typeof value === "string") {
    const parsed = z.string().uuid().safeParse(value.trim());
    if (parsed.success) return parsed.data;
  }
  return randomUUID();
}

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
            operationId: z.preprocess(coerceOperationUuid, z.uuid()),
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
      "Create a project attachment from raw script text (returns attachmentId). Prefer user file uploads; use this only when the user pasted text in chat.",
    kind: "command",
    risk: "reversible",
    inputSchema: z
      .object({
        text: z.string().min(1).max(1_000_000),
        sectionSize: z.number().int().positive().max(50_000).optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        sectionCount: z.number().int().nonnegative(),
        surface: z.string().optional(),
        attachmentId: z.uuid().optional(),
      })
      .strict(),
  },
  {
    id: "script.readSection",
    description:
      "Read one bounded section of an uploaded attachment by attachmentId. Prefer multiple calls over loading the entire script.",
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
    id: "storyboard.listShots",
    description:
      "List Agent OS storyboard shot drafts (title, prompt, notes). Use before writes or when the user asks to show/list shots — not for bare chat/poetry.",
    kind: "query",
    risk: "read",
    inputSchema: z.object({}).strict(),
    outputSchema: z
      .object({
        revision: z.number().int().nonnegative(),
        surface: z.string().optional(),
        shots: z.array(
          z
            .object({
              id: z.string(),
              title: z.string(),
              prompt: z.string(),
              notes: z.string().optional(),
            })
            .strict()
        ),
      })
      .strict(),
  },
  {
    id: "storyboard.upsertShots",
    description:
      "Write storyboard shots to project canvas + Agent OS state. Call ONLY when the user explicitly asked " +
      "to add/create/update/storyboard shots — never for bare poetic phrases or candidate titles alone. " +
      "Requires baseRevision from storyboard.listShots. " +
      "Per-shot intent: 'create' (default) = NEW id only (existing id → SHOT_EXISTS); " +
      "'replace' = update an existing id. " +
      "To ADD one shot, pass ONLY the new shot with intent create — do NOT resubmit the full board. " +
      "To rewrite many shots at once, pass only those rows with intent replace (or create for brand-new ids). " +
      "To REMOVE shots, use storyboard.deleteShots — not upsert. Storyboard surface only.",
    kind: "command",
    risk: "sensitive",
    inputSchema: z
      .object({
        baseRevision: z.number().int().nonnegative(),
        shots: z
          .array(
            z
              .object({
                id: z
                  .string()
                  .trim()
                  .min(1)
                  .max(120)
                  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/),
                title: z.string().trim().min(1).max(200),
                prompt: z.string().trim().min(1).max(8_000),
                notes: z.string().trim().max(4_000).optional(),
                intent: z.enum(["create", "replace"]).optional(),
              })
              .strict()
          )
          .min(1)
          .max(200),
      })
      .strict(),
    outputSchema: z
      .object({
        projectRevision: z.number().int().nonnegative(),
        written: z.array(z.object({ id: z.string(), title: z.string() }).strict()),
        surface: z.string().optional(),
      })
      .strict(),
  },
  {
    id: "storyboard.deleteShots",
    description:
      "Delete storyboard shots by stable id from project canvas + Agent OS state. Requires baseRevision from storyboard.listShots. Prefer this over replace-with-remaining-list when the user asks to remove specific shots. Only available on the storyboard surface.",
    kind: "command",
    risk: "sensitive",
    inputSchema: z
      .object({
        baseRevision: z.number().int().nonnegative(),
        shotIds: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(120)
              .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/)
          )
          .min(1)
          .max(200),
      })
      .strict(),
    outputSchema: z
      .object({
        projectRevision: z.number().int().nonnegative(),
        deleted: z.array(z.object({ id: z.string(), title: z.string() }).strict()),
        surface: z.string().optional(),
      })
      .strict(),
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
    description:
      "Apply a typed, versioned patch to the project canvas CRDT. Call ONLY when the user explicitly asked to edit the graph " +
      "(not for bare poetic phrases or candidate titles). Call canvas.read first for baseDraftRevision/baseLayoutRevision. " +
      "Each operation needs kind + payload. operationId may be omitted or any string — the server mints a valid UUID if missing/invalid. " +
      "Kinds: node.patchData {nodeId,data}, node.move {nodeId,x,y}, node.delete {nodeId}, edge.connect {edgeId,source,target}, edge.remove {edgeId}, shot.upsert {id,title,prompt,notes?}. " +
      "On canvas surface use shot.upsert here to add/edit a shot node — do not call storyboard.upsertShots. Canvas surface only.",
    kind: "command",
    risk: "sensitive",
    inputSchema: CanvasApplyPatchInputSchema,
    outputSchema: CanvasApplyPatchOutputSchema,
  },
] as const satisfies readonly ToolDefinition[];

export type AgentOsToolId = (typeof AGENT_OS_TOOLS)[number]["id"];

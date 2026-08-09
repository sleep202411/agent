import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  SHOT_ID_PATTERN,
  SHOT_LIMITS,
  SHOT_MOVEMENT_OPTIONS,
  SHOT_PERSPECTIVE_OPTIONS,
  SHOT_SIZE_OPTIONS,
  type ShotWrite,
} from "@repo/shared";

import type { ToolDefinition } from "./types.js";
import { STORY_AGENT_OS_TOOLS } from "./story-definitions.js";

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

const shotId = z.string().trim().min(1).max(SHOT_LIMITS.idMax).regex(SHOT_ID_PATTERN);

const ShotWriteSchema = z
  .object({
    id: shotId,
    intent: z.enum(["create", "replace"]).default("create"),
    after: shotId.nullish(),
    title: z.string().trim().min(1).max(SHOT_LIMITS.titleMax).optional(),
    prompt: z.string().trim().max(SHOT_LIMITS.promptMax).optional(),
    description: z.string().trim().max(SHOT_LIMITS.descriptionMax).optional(),
    notes: z.string().trim().max(SHOT_LIMITS.notesMax).optional(),
    dialogue: z.string().trim().max(SHOT_LIMITS.dialogueMax).optional(),
    videoPrompt: z.string().trim().max(SHOT_LIMITS.videoPromptMax).optional(),
    shotSize: z.enum(SHOT_SIZE_OPTIONS).optional(),
    perspective: z.enum(SHOT_PERSPECTIVE_OPTIONS).optional(),
    movement: z.enum(SHOT_MOVEMENT_OPTIONS).optional(),
    durationSeconds: z.number().nonnegative().max(SHOT_LIMITS.durationSecondsMax).optional(),
  })
  .strict()
  .refine((shot) => shot.intent !== "create" || Boolean(shot.title), {
    message: "title is required when creating a shot",
    path: ["title"],
  });

/** Compile-time guard: this schema must keep producing the shared shape. */
type _ShotWriteMatchesShared = z.infer<typeof ShotWriteSchema> extends ShotWrite ? true : never;

export const ShotsUpsertInputSchema = z
  .object({
    baseRevision: z.number().int().nonnegative().optional(),
    shots: z.array(ShotWriteSchema).min(1).max(SHOT_LIMITS.batchMax),
  })
  .strict();

export const ShotsDeleteInputSchema = z
  .object({
    baseRevision: z.number().int().nonnegative().optional(),
    shotIds: z.array(shotId).min(1).max(SHOT_LIMITS.batchMax),
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
    /** Canvas nodes this patch created or changed — the UI links to them. */
    nodeIds: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Core + Platform capability tools for Agent OS.
 * Golden path A: script.readSection + characters.upsert
 * Golden path B: canvas.read + canvas.applyPatch
 */
const PLATFORM_AGENT_OS_TOOLS = [
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
        attachmentId: z.uuid(),
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
      "List every shot on the project's storyboard, in board order — including shots the user " +
      "authored by hand, which are addressable exactly like your own. Fields the user left blank " +
      "are omitted. Use before writes (for baseRevision) or when the user asks to show/list " +
      "shots — not for bare chat/poetry.",
    kind: "query",
    risk: "read",
    inputSchema: z.object({}).strict(),
    outputSchema: z
      .object({
        revision: z.number().int().nonnegative(),
        shots: z.array(
          z
            .object({
              id: z.string(),
              /** Fractional index — the board's row order. Absent only on malformed rows. */
              order: z.string().optional(),
              authoredBy: z.enum(["agent", "human"]),
              title: z.string(),
              /** 图片提示词 — the prompt fed to image generation. */
              prompt: z.string().optional(),
              notes: z.string().optional(),
              /** 画面描述 — the human-readable framing/light/mood note. */
              description: z.string().optional(),
              shotSize: z.string().optional(),
              perspective: z.string().optional(),
              movement: z.string().optional(),
              dialogue: z.string().optional(),
              /** 视频提示词 — the prompt fed to video generation. */
              videoPrompt: z.string().optional(),
              durationSeconds: z.number().optional(),
            })
            .strict()
        ),
      })
      .strict(),
  },
  {
    id: "storyboard.upsertShots",
    description:
      "Write shots to the project's storyboard. Call ONLY when the user explicitly asked " +
      "to add/create/update shots — never for bare poetic phrases or candidate titles alone. " +
      "A write PATCHES the fields you name and leaves the rest alone, so send only what you " +
      "are changing; do NOT resubmit the whole board. " +
      "Per-shot intent: 'create' (default) = a NEW id only (existing id → SHOT_EXISTS); " +
      "'replace' = update a shot that exists, including one the user authored. " +
      "Use `after` to place a row (the id it should follow, or null for the top); omit it to " +
      "append on create or leave the row where it is on replace. " +
      "shotSize / perspective / movement take the stable option key (e.g. 'closeUp', 'lowAngle' " +
      "→ 'low', 'dolly'), never a localized label. " +
      "`prompt` is the image-generation prompt; `description` is the human-facing 画面描述 — " +
      "do not put the same text in both. " +
      "To REMOVE shots, use storyboard.deleteShots — not upsert. Storyboard workbench only.",
    kind: "command",
    risk: "sensitive",
    inputSchema: ShotsUpsertInputSchema,
    outputSchema: z
      .object({
        revision: z.number().int().nonnegative(),
        written: z.array(
          z
            .object({
              id: z.string(),
              title: z.string(),
              /** Canvas node the shot lives on — the UI links to it. */
              nodeId: z.string().optional(),
            })
            .strict()
        ),
        /** Set when the baseRevision you sent was behind: the write still applied. */
        staleBaseRevision: z.boolean().optional(),
      })
      .strict(),
  },
  {
    id: "storyboard.deleteShots",
    description:
      "Delete shots from the project's storyboard by id, including shots the user authored. " +
      "Prefer this over replace-with-remaining-list when the user asks to remove specific shots. " +
      "Deleting removes the row and its wires; call storyboard.listShots first if unsure of an id. " +
      "Only available in the storyboard workbench.",
    kind: "command",
    risk: "sensitive",
    inputSchema: ShotsDeleteInputSchema,
    outputSchema: z
      .object({
        revision: z.number().int().nonnegative(),
        deleted: z.array(z.object({ id: z.string(), title: z.string() }).strict()),
        staleBaseRevision: z.boolean().optional(),
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
      "In the canvas workbench use shot.upsert here to add/edit a shot node — do not call storyboard.upsertShots. Canvas workbench only.",
    kind: "command",
    risk: "sensitive",
    inputSchema: CanvasApplyPatchInputSchema,
    outputSchema: CanvasApplyPatchOutputSchema,
  },
] as const satisfies readonly ToolDefinition[];

export const AGENT_OS_TOOLS = [...PLATFORM_AGENT_OS_TOOLS, ...STORY_AGENT_OS_TOOLS] as const;

export type AgentOsToolId = (typeof AGENT_OS_TOOLS)[number]["id"];

import { z } from 'zod';
import {
  SHOT_ID_PATTERN,
  SHOT_LIMITS,
  SHOT_MOVEMENT_OPTIONS,
  SHOT_PERSPECTIVE_OPTIONS,
  SHOT_SIZE_OPTIONS,
  type ShotWrite,
} from '@repo/shared';

const stableKey = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);

const localizedName = z.record(
  z.string().min(2).max(16),
  z.string().min(1).max(200),
);

const ExecutionProofSchema = z
  .object({
    executionToken: z.string().uuid(),
    executionAttemptId: z.string().uuid(),
    executionEpoch: z.number().int().positive(),
    executionOwnerId: z.string().uuid(),
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
            intent: z.enum(['create', 'replace']).default('create'),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const ScriptReadSectionInputSchema = z
  .object({
    /** Required — file uploaded via Agent OS attachments API. */
    attachmentId: z.string().uuid(),
    sectionIndex: z.number().int().nonnegative().max(10_000),
    maxChars: z.number().int().positive().max(50_000).optional(),
  })
  .strict();

export const ScriptStoreInputSchema = z
  .object({
    text: z.string().min(1).max(1_000_000),
    sectionSize: z.number().int().positive().max(50_000).optional(),
  })
  .strict();

/**
 * Shot ids accept a leading digit: rows a human created in the storyboard table
 * are raw UUIDs, and the agent must be able to address them.
 */
const shotId = z
  .string()
  .trim()
  .min(1)
  .max(SHOT_LIMITS.idMax)
  .regex(SHOT_ID_PATTERN);

/**
 * Built from @repo/shared primitives rather than importing the tool package's
 * schema object: the two tiers run different physical zod installs, so only the
 * values and the `ShotWrite` type cross the boundary. The guard below keeps the
 * shapes from drifting apart anyway.
 */
const ShotWriteSchema: z.ZodType<ShotWrite> = z
  .object({
    id: shotId,
    intent: z.enum(['create', 'replace']).default('create'),
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
    durationSeconds: z
      .number()
      .nonnegative()
      .max(SHOT_LIMITS.durationSecondsMax)
      .optional(),
  })
  .strict()
  .refine((shot) => shot.intent !== 'create' || Boolean(shot.title), {
    message: 'title is required when creating a shot',
    path: ['title'],
  });

export const ShotsUpsertInputSchema = z
  .object({
    /** Advisory only — reported back as stale, never a rejection. */
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

export const AgentOsDomainExecuteBodySchema = z
  .object({
    runId: z.string().uuid(),
    conversationId: z.string().uuid(),
    turnId: z.string().uuid(),
    toolCallId: z.string().trim().min(1).max(256),
    actorId: z.string().trim().min(1).max(128),
    projectId: z.string().uuid(),
    skillResolutionId: z.string().uuid(),
    skillVersionIds: z.array(z.string().uuid()).max(32),
    workbenchContext: z.record(z.string(), z.string()).optional(),
    idempotencyKey: z.string().trim().min(8).max(512),
    startExecution: ExecutionProofSchema.optional(),
    continuationExecution: ExecutionProofSchema.optional(),
    arguments: z.unknown(),
  })
  .strict()
  .refine((body) => !(body.startExecution && body.continuationExecution), {
    message:
      'A Domain tool invocation cannot carry initial and continuation execution proofs together.',
  });

export type AgentOsDomainExecuteBody = z.infer<
  typeof AgentOsDomainExecuteBodySchema
>;

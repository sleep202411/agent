import { z } from 'zod';

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

export const ShotsUpsertInputSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    shots: z
      .array(
        z
          .object({
            id: stableKey,
            title: z.string().trim().min(1).max(200),
            prompt: z.string().trim().min(1).max(8_000),
            notes: z.string().trim().max(4_000).optional(),
            intent: z.enum(['create', 'replace']).default('create'),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const ShotsDeleteInputSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    shotIds: z.array(stableKey).min(1).max(200),
  })
  .strict();

export const AgentOsDomainExecuteBodySchema = z
  .object({
    actorId: z.string().trim().min(1).max(128),
    projectId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(8).max(512),
    arguments: z.unknown(),
  })
  .strict();

export type AgentOsDomainExecuteBody = z.infer<
  typeof AgentOsDomainExecuteBodySchema
>;

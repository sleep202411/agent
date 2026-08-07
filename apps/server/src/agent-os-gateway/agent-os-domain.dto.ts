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

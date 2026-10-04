import { z } from 'zod';
import { ExperienceJourneyDeltaSchema } from '@repo/shared/experience-runtime';

/**
 * The save slot address. chapterId travels as a query param because path
 * params cannot be empty strings — single-chapter works have no chapter
 * identity and simply omit it (normalized to "").
 */
export const SaveSlotQuerySchema = z.object({
  chapterId: z.string().max(128).default(''),
});

// Leave room for the increment in the database's signed 32-bit integer.
const ExpectedRevisionSchema = z.number().int().min(0).max(2_147_483_646);

export const ClearSaveQuerySchema = SaveSlotQuerySchema.extend({
  expectedRevision: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .transform(Number)
    .pipe(ExpectedRevisionSchema),
});

/**
 * Save payload. `state` is an ExperienceRuntimeState snapshot and `events`
 * the event batch parked at a paid gate (normally empty). The server stores
 * the engine checkpoint and media cursor verbatim — semantic validation
 * happens on restore, against the live manifest in the player.
 */
export const SaveBodySchema = z
  .object({
    contentVersion: z.string().min(1).max(128),
    state: z.record(z.string(), z.unknown()),
    events: z.array(z.record(z.string(), z.unknown())).max(64),
    playback: z.record(z.string(), z.unknown()).nullable().optional(),
    journeyDelta: ExperienceJourneyDeltaSchema.optional(),
    expectedRevision: ExpectedRevisionSchema,
  })
  .strict();

export type SaveSlotQuery = z.infer<typeof SaveSlotQuerySchema>;
export type SaveBody = z.infer<typeof SaveBodySchema>;

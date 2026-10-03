import { z } from 'zod';

/**
 * The save slot address. chapterId travels as a query param because path
 * params cannot be empty strings — single-chapter works have no chapter
 * identity and simply omit it (normalized to "").
 */
export const SaveSlotQuerySchema = z.object({
  chapterId: z.string().max(128).default(''),
});

/**
 * Save payload. `state` is an ExperienceRuntimeState snapshot and `events`
 * the event batch parked at a paid gate (normally empty). The server stores
 * both verbatim — semantic validation happens on restore, against the live
 * manifest in the web runtime.
 */
export const SaveBodySchema = z
  .object({
    contentVersion: z.string().min(1).max(128),
    state: z.record(z.string(), z.unknown()),
    events: z.array(z.record(z.string(), z.unknown())).max(64),
  })
  .strict();

export type SaveSlotQuery = z.infer<typeof SaveSlotQuerySchema>;
export type SaveBody = z.infer<typeof SaveBodySchema>;

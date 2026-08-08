import { z } from "zod";

/** Stable product identifiers used across Agent OS. */
export const AgentOsIdSchema = z.uuid();
export type AgentOsId = z.infer<typeof AgentOsIdSchema>;

export const AgentOsNonEmptyIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const AgentOsIsoTimestampSchema = z.iso.datetime({ offset: true });

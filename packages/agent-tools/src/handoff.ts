import { z } from "zod";

/**
 * A domain tool may hand the turn to a durable job owned outside LangGraph.
 * The worker persists the receipt and pauses the run instead of pretending the
 * turn completed while the product is still working.
 */
export const AgentExternalJobHandoffSchema = z
  .object({
    kind: z.literal("external_job"),
    jobId: z.string().uuid(),
    startedMessage: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type AgentExternalJobHandoff = z.infer<typeof AgentExternalJobHandoffSchema>;

/** Extract a validated handoff from an otherwise tool-specific result. */
export function agentExternalJobHandoffFromResult(value: unknown): AgentExternalJobHandoff | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = AgentExternalJobHandoffSchema.safeParse(
    (value as Record<string, unknown>).agentHandoff
  );
  return parsed.success ? parsed.data : null;
}

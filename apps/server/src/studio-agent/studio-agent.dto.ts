import { z } from 'zod';

export const StudioAgentThreadParamsSchema = z
  .object({
    threadId: z.uuid(),
  })
  .strict();

export const StudioAgentRunParamsSchema = z
  .object({
    threadId: z.uuid(),
    runId: z.uuid(),
  })
  .strict();

export const StudioAgentArtifactParamsSchema = z
  .object({
    threadId: z.uuid(),
    artifactId: z.uuid(),
  })
  .strict();

export const StudioAgentApprovalParamsSchema = z
  .object({
    threadId: z.uuid(),
    approvalId: z.uuid(),
  })
  .strict();

export const StudioAgentEventQuerySchema = z
  .object({
    afterSequence: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

export const StudioAgentEventStreamQuerySchema = z
  .object({
    afterSequence: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

export const StudioAgentSnapshotQuerySchema = z
  .object({
    /**
     * Root run id of the oldest turn the caller already holds. The response
     * carries the turns immediately before it; omit it for the live tail.
     */
    beforeRootRunId: z.uuid().optional(),
  })
  .strict();

export type StudioAgentThreadParams = z.infer<
  typeof StudioAgentThreadParamsSchema
>;
export type StudioAgentRunParams = z.infer<typeof StudioAgentRunParamsSchema>;
export type StudioAgentArtifactParams = z.infer<
  typeof StudioAgentArtifactParamsSchema
>;
export type StudioAgentApprovalParams = z.infer<
  typeof StudioAgentApprovalParamsSchema
>;
export type StudioAgentEventQuery = z.infer<typeof StudioAgentEventQuerySchema>;
export type StudioAgentEventStreamQuery = z.infer<
  typeof StudioAgentEventStreamQuerySchema
>;
export type StudioAgentSnapshotQuery = z.infer<
  typeof StudioAgentSnapshotQuerySchema
>;

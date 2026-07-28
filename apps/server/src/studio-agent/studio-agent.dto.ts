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
export type StudioAgentSnapshotQuery = z.infer<
  typeof StudioAgentSnapshotQuerySchema
>;

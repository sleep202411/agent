import { z } from 'zod';

export const WorldModelWorkspaceIdSchema = z.uuid();

export const WorldModelProjectParamsSchema = z
  .object({ projectId: z.uuid() })
  .strict();

export const WorldModelWorldParamsSchema = z
  .object({ projectId: z.uuid(), worldId: z.uuid() })
  .strict();

export const WorldModelSessionParamsSchema = z
  .object({ projectId: z.uuid(), sessionId: z.uuid() })
  .strict();

export const WorldModelTravelParamsSchema = z
  .object({ projectId: z.uuid(), travelId: z.uuid() })
  .strict();

export type WorldModelProjectParams = z.infer<
  typeof WorldModelProjectParamsSchema
>;
export type WorldModelWorldParams = z.infer<typeof WorldModelWorldParamsSchema>;
export type WorldModelSessionParams = z.infer<
  typeof WorldModelSessionParamsSchema
>;
export type WorldModelTravelParams = z.infer<
  typeof WorldModelTravelParamsSchema
>;

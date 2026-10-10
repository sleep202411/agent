import { z } from "zod";

const identity = { nodeId: z.string().min(1), edgeId: z.string().min(1) };
export const canvasShotMediaSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("refresh") }).strict(),
  z
    .object({
      ...identity,
      edgeId: z.string().uuid(),
      action: z.literal("attach"),
      sourceId: z.string().min(1),
    })
    .strict(),
  z.object({ ...identity, action: z.literal("detach") }).strict(),
  z
    .object({
      nodeId: identity.nodeId,
      action: z.literal("prefer"),
      edgeId: z.string().min(1).optional(),
    })
    .strict(),
]);
export type CanvasShotMedia = z.infer<typeof canvasShotMediaSchema>;

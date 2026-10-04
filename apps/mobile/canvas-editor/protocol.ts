import { z } from "zod";
const id = z.string().uuid();
export const encodedCanvasState = z
  .string()
  .min(4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const identity = {
  sessionId: id,
  documentId: id,
  sequence: z.number().int().nonnegative(),
  requestId: z.number().int().positive(),
};
const collection = z.record(z.unknown());
export const canvasSnapshotSchema = z
  .object({
    meta: collection,
    nodes: collection,
    edges: collection,
    groups: collection,
    assets: collection,
  })
  .strict();
export const canvasHostMessage = z
  .object({
    type: z.literal("load"),
    ...identity,
    snapshot: encodedCanvasState,
    updates: z.array(encodedCanvasState),
  })
  .strict();
export const canvasRuntimeMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), sessionId: id }).strict(),
  z
    .object({
      type: z.literal("loaded"),
      ...identity,
      state: encodedCanvasState,
      snapshot: canvasSnapshotSchema,
    })
    .strict(),
  z.object({ type: z.literal("error"), ...identity, message: z.string() }).strict(),
]);
export type CanvasHostMessage = z.infer<typeof canvasHostMessage>;
export type CanvasRuntimeMessage = z.infer<typeof canvasRuntimeMessage>;
export type CanvasSnapshot = z.infer<typeof canvasSnapshotSchema>;

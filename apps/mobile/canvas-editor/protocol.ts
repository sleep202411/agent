import { canvasGroupEditSchema } from "./group-schema";
import { canvasShotMediaSchema } from "./shot-media-schema";
import { z } from "zod";
import { canvasNodeEditSchema, canvasNodeCreateSchema } from "./schema";
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
export const canvasUpdateSchema = z
  .object({ clientKey: id, yjsUpdateBase64: encodedCanvasState })
  .strict();
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
export const canvasHostMessage = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("group"),
      ...identity,
      snapshot: encodedCanvasState,
      group: canvasGroupEditSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("reconcileShotMedia"), ...identity, snapshot: encodedCanvasState })
    .strict(),
  z
    .object({
      type: z.literal("shotMedia"),
      ...identity,
      snapshot: encodedCanvasState,
      media: canvasShotMediaSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("create"),
      ...identity,
      snapshot: encodedCanvasState,
      create: canvasNodeCreateSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("load"),
      ...identity,
      snapshot: encodedCanvasState,
      updates: z.array(encodedCanvasState),
    })
    .strict(),
  z
    .object({
      type: z.literal("edit"),
      ...identity,
      snapshot: encodedCanvasState,
      edit: canvasNodeEditSchema,
    })
    .strict(),
]);
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
  z
    .object({
      type: z.literal("edited"),
      ...identity,
      state: encodedCanvasState,
      snapshot: canvasSnapshotSchema,
      yjsUpdateBase64: encodedCanvasState.nullable(),
    })
    .strict(),
]);
export type CanvasHostMessage = z.infer<typeof canvasHostMessage>;
export type CanvasRuntimeMessage = z.infer<typeof canvasRuntimeMessage>;
export type CanvasSnapshot = z.infer<typeof canvasSnapshotSchema>;
export type CanvasLoaded = Extract<CanvasRuntimeMessage, { type: "loaded" }>;

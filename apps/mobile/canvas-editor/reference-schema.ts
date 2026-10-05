import { z } from "zod";

/** Catalog projection for the target's current model/mode, never a mode switch. */
export const canvasReferenceTargetSchema = z
  .object({
    modelId: z.string().min(1),
    mode: z.string().optional(),
    fields: z.array(
      z
        .object({
          field: z.string().min(1),
          kind: z.enum(["image", "video", "audio"]),
          maxItems: z.number().int().positive(),
        })
        .strict()
    ),
  })
  .strict();
export type CanvasReferenceTarget = z.infer<typeof canvasReferenceTargetSchema>;
const identity = { nodeId: z.string().min(1), edgeId: z.string().min(1) };
export const canvasReferenceEditSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...identity,
      action: z.literal("attach"),
      edgeId: z.string().uuid(),
      sourceId: z.string().min(1),
      target: canvasReferenceTargetSchema,
    })
    .strict(),
  z
    .object({ ...identity, action: z.literal("refresh"), target: canvasReferenceTargetSchema })
    .strict(),
  z.object({ ...identity, action: z.literal("detach") }).strict(),
]);
export type CanvasReferenceEdit = z.infer<typeof canvasReferenceEditSchema>;

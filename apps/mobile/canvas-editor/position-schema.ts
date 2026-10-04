import { z } from "zod";
export const canvasPositionEditSchema = z
  .object({
    action: z.literal("moveNodes"),
    positions: z
      .array(
        z
          .object({
            nodeId: z.string().min(1),
            x: z.number().finite(),
            y: z.number().finite(),
          })
          .strict()
      )
      .min(1)
      .refine(
        (items) => new Set(items.map((item) => item.nodeId)).size === items.length,
        "A canvas node may only be moved once per command."
      ),
  })
  .strict();
export type CanvasPositionEdit = z.infer<typeof canvasPositionEditSchema>;

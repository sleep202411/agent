import { z } from "zod";
/** Web CANVAS_ROOT_SCHEMA / Server document-modes.ts: all roots are Y.Maps. */
export const CANVAS_ROOTS = ["meta", "nodes", "edges", "groups", "assets"] as const;
export const canvasNodeEditSchema = z
  .object({
    nodeId: z.string().min(1),
    kind: z.enum(["rename", "prompt", "text", "remove"]),
    value: z.string(),
  })
  .strict()
  .refine(
    (edit) => edit.kind !== "remove" || edit.value === "",
    "Removal cannot contain replacement text."
  );
export type CanvasNodeEdit = z.infer<typeof canvasNodeEditSchema>;

const newNode = {
  nodeId: z.string().uuid(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
};
export const canvasNodeCreateSchema = z.discriminatedUnion("type", [
  z
    .object({ ...newNode, type: z.literal("note"), data: z.object({ text: z.string() }).strict() })
    .strict(),
  // The current last shot determines the order inside the runtime transaction.
  z.object({ ...newNode, type: z.literal("shot") }).strict(),
  ...(["prompt", "video", "audio"] as const).map((type) =>
    z
      .object({
        ...newNode,
        type: z.literal(type),
        data: z
          .object({
            name: z.string(),
            prompt: z.string(),
            modelId: z.string().min(1).optional(),
            modelName: z.string().optional(),
            mode: z.string().min(1).optional(),
            settings: z.record(
              z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.unknown())])
            ),
          })
          .strict(),
      })
      .strict()
  ),
]);
export type CanvasNodeCreate = z.infer<typeof canvasNodeCreateSchema>;

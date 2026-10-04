import { z } from "zod";
/** Web CANVAS_ROOT_SCHEMA / Server document-modes.ts: all roots are Y.Maps. */
export const CANVAS_ROOTS = ["meta", "nodes", "edges", "groups", "assets"] as const;
export const canvasNodeEditSchema = z
  .object({
    nodeId: z.string().min(1),
    kind: z.enum(["rename", "prompt", "remove"]),
    value: z.string(),
  })
  .strict()
  .refine(
    (edit) => edit.kind !== "remove" || edit.value === "",
    "Removal cannot contain replacement text."
  );
export type CanvasNodeEdit = z.infer<typeof canvasNodeEditSchema>;

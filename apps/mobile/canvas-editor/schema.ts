import { z } from "zod";
/** Web CANVAS_ROOT_SCHEMA / Server document-modes.ts: all roots are Y.Maps. */
export const CANVAS_ROOTS = ["meta", "nodes", "edges", "groups", "assets"] as const;
export const canvasNodeEditSchema = z
  .object({ nodeId: z.string().min(1), kind: z.enum(["rename", "prompt"]), value: z.string() })
  .strict();
export type CanvasNodeEdit = z.infer<typeof canvasNodeEditSchema>;

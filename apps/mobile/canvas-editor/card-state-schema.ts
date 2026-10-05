import { z } from "zod";
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)])
);
/** Only authoring fields; excludes layout, collaborators' names and job results. */
export const canvasCardStateSchema = z.object({
  prompt: z.string().default(""),
  modelId: z.string().nullable().default(null),
  mode: z.string().nullable().default(null),
  settings: z.record(json).default({}),
  references: z.record(z.array(z.record(json))).default({}),
  skillSelection: z
    .object({
      includeInstallationIds: z.array(z.string().uuid()).optional(),
      excludeInstallationIds: z.array(z.string().uuid()).optional(),
    })
    .nullable()
    .default(null),
});
export const canvasCardEditSchema = z
  .object({ before: canvasCardStateSchema, after: canvasCardStateSchema })
  .strict();
export type CanvasCardState = z.infer<typeof canvasCardStateSchema>;

export const CANVAS_CARD_CONFLICT = "CANVAS_CARD_CONFLICT: ";
/** The encoder rejected authoring changes before producing a write. */
export class CanvasCardConflictError extends Error {
  constructor(public readonly current: CanvasCardState) {
    super("The canvas card changed while composing. Review the latest values before generating.");
  }
}

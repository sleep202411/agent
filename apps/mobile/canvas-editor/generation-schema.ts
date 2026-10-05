import { z } from "zod";

const measure = z.number().finite().nonnegative().optional();
export const canvasGenerationJobSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  documentBlockId: z.string().min(1),
  sourceSurface: z.literal("fizzstudio-canvas"),
  idempotencyKey: z.string().min(1),
  modelId: z.string().min(1),
  type: z.enum(["image", "video", "audio"]),
  status: z.enum([
    "in_queue",
    "queued",
    "in_progress",
    "running",
    "completed",
    "failed",
    "expired",
    "cancelled",
    "canceled",
  ]),
  prompt: z.string(),
  createdAt: z.string().datetime(),
  progress: measure,
  queuePosition: measure,
  estimatedTotalSeconds: measure,
  error: z.object({ code: z.string().optional(), userMessage: z.string() }).optional(),
  outputs: z.array(
    z.object({
      id: z.string().min(1),
      assetId: z.string().min(1).optional(),
      type: z.enum(["image", "video", "audio"]),
      url: z
        .string()
        .url()
        .refine((value) => /^https?:\/\//i.test(value)),
      accessUrl: z.string().url().optional(),
      width: measure,
      height: measure,
      durationSeconds: measure,
      bytes: measure,
    })
  ),
});
export type CanvasGenerationJob = z.infer<typeof canvasGenerationJobSchema>;

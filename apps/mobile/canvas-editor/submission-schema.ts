import { z } from "zod";
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)])
);
export const canvasSubmissionSchema = z
  .object({
    ownerId: z.string().min(1),
    type: z.enum(["image", "video", "audio"]),
    submission: z
      .object({
        context: z
          .object({
            workspaceId: z.string().uuid(),
            storyProjectId: z.string().uuid(),
            documentId: z.string().uuid(),
            documentBlockId: z.string().min(1).max(128),
            sourceSurface: z.literal("fizzstudio-canvas"),
          })
          .strict(),
        idempotencyKey: z.string().min(1),
        modelId: z.string().min(1),
        schemaVersion: z.string().min(1),
        input: z.record(json),
        presetId: z.string().optional(),
        campaignId: z.string().optional(),
        skillSelection: z
          .object({
            includeInstallationIds: z.array(z.string().uuid()).optional(),
            excludeInstallationIds: z.array(z.string().uuid()).optional(),
          })
          .optional(),
        promptDocument: json.optional(),
        referenceBindings: z.array(json).optional(),
      })
      .strict(),
  })
  .strict();
export type CanvasSubmission = z.infer<typeof canvasSubmissionSchema>;

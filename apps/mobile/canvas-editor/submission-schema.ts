import { canvasCardEditSchema } from "./card-state-schema";
import { z } from "zod";
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)])
);
export const canvasSubmissionSchema = z
  .object({
    ownerId: z.string().min(1),
    type: z.enum(["image", "video", "audio"]),
    cardEdit: canvasCardEditSchema.optional(),
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

/** Retry reuses the server's frozen job input, not a reconstructed submission. */
export const canvasRetrySchema = z
  .object({
    ownerId: z.string().min(1),
    type: z.enum(["image", "video", "audio"]),
    retry: z
      .object({
        documentId: z.string().uuid(),
        documentBlockId: z.string().min(1).max(128),
        jobId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();
export type CanvasRetry = z.infer<typeof canvasRetrySchema>;
export const canvasReceiptSchema = z
  .object({
    ownerId: z.string().min(1),
    type: z.enum(["image", "video", "audio"]),
    receipt: z
      .object({
        documentId: z.string().uuid(),
        documentBlockId: z.string().min(1).max(128),
        submissionKey: z.string().min(1),
        jobId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();
export const canvasAuthoringSchema = z
  .object({
    ownerId: z.string().min(1),
    type: z.enum(["image", "video", "audio"]),
    authoring: z
      .object({
        documentId: z.string().uuid(),
        documentBlockId: z.string().min(1).max(128),
        edit: canvasCardEditSchema,
      })
      .strict(),
  })
  .strict();
export type CanvasAuthoring = z.infer<typeof canvasAuthoringSchema>;
export const canvasSubmissionRecordSchema = z.union([
  canvasSubmissionSchema,
  canvasRetrySchema,
  canvasReceiptSchema,
  canvasAuthoringSchema,
]);
export type CanvasSubmissionRecord = z.infer<typeof canvasSubmissionRecordSchema>;

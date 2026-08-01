import { z } from "zod";

const chunkIdSchema = z.string().regex(/^chunk-[0-9]{6}$/u);
export const longDocumentWorkflowInputSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-analysis-workflow/v1"),
    jobId: z.uuid(),
  })
  .strict();

export const longDocumentArtifactRefSchema = z
  .object({
    artifactId: z.uuid(),
    kind: z.enum(["section", "reduce", "final"]),
    level: z.number().int().nonnegative().max(16),
    ordinal: z.number().int().nonnegative().max(511),
    sourceChunkIds: z.array(chunkIdSchema).min(1).max(256),
  })
  .strict();

export const longDocumentMapActivityInputSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-map-activity/v1"),
    jobId: z.uuid(),
    chunkId: chunkIdSchema,
    ordinal: z.number().int().nonnegative().max(255),
  })
  .strict();

export const longDocumentReduceActivityInputSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-reduce-activity/v1"),
    jobId: z.uuid(),
    level: z.number().int().positive().max(16),
    ordinal: z.number().int().nonnegative().max(255),
    inputArtifactIds: z.array(z.uuid()).min(1).max(8),
  })
  .strict();

export const longDocumentFinalizeActivityInputSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-finalize-activity/v1"),
    jobId: z.uuid(),
    level: z.number().int().positive().max(16),
    inputArtifactId: z.uuid(),
    chunkCount: z.number().int().positive().max(256),
  })
  .strict();

export const longDocumentCompleteActivityInputSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-complete-activity/v1"),
    jobId: z.uuid(),
    finalArtifactId: z.uuid(),
  })
  .strict();

export const longDocumentFailActivityInputSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-fail-activity/v1"),
    jobId: z.uuid(),
    error: z
      .object({
        code: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Z][A-Z0-9_]*$/u),
        message: z.string().min(1).max(2_000),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type LongDocumentWorkflowInput = z.infer<typeof longDocumentWorkflowInputSchema>;
export type LongDocumentArtifactRef = Readonly<{
  artifactId: string;
  kind: "section" | "reduce" | "final";
  level: number;
  ordinal: number;
  sourceChunkIds: readonly string[];
}>;
export type LongDocumentManifest = Readonly<{
  schemaVersion: "agent-long-document-manifest/v1";
  jobId: string;
  attachmentId: string;
  locale: string;
  sourceContentHash: string;
  document: Readonly<{
    title: string;
    format: "screenplay" | "markdown" | "prose";
    characterCount: number;
    chunkCount: number;
  }>;
  sections: readonly Readonly<{
    chunkId: string;
    ordinal: number;
    heading: string | null;
    abstract: string;
  }>[];
  completedArtifacts: readonly LongDocumentArtifactRef[];
}>;

export type LongDocumentMapActivityInput = z.infer<typeof longDocumentMapActivityInputSchema>;
export type LongDocumentReduceActivityInput = z.infer<typeof longDocumentReduceActivityInputSchema>;
export type LongDocumentFinalizeActivityInput = z.infer<
  typeof longDocumentFinalizeActivityInputSchema
>;
export type LongDocumentCompleteActivityInput = z.infer<
  typeof longDocumentCompleteActivityInputSchema
>;
export type LongDocumentFailActivityInput = z.infer<typeof longDocumentFailActivityInputSchema>;

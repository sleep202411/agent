import { z } from 'zod';

const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/)
  .optional();

const JsonObjectSchema = z.record(z.string(), z.unknown());
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const ProjectDocumentsParamsSchema = z.object({
  projectId: z.string().uuid(),
});
export type ProjectDocumentsParams = z.infer<
  typeof ProjectDocumentsParamsSchema
>;

export const DocumentParamsSchema = z.object({
  documentId: z.string().uuid(),
});
export type DocumentParams = z.infer<typeof DocumentParamsSchema>;

export const DocumentThreadParamsSchema = z.object({
  documentId: z.string().uuid(),
  threadId: z.string().uuid(),
});
export type DocumentThreadParams = z.infer<typeof DocumentThreadParamsSchema>;

export const DocumentVersionParamsSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
});
export type DocumentVersionParams = z.infer<typeof DocumentVersionParamsSchema>;

export const DocumentTypeSchema = z.enum([
  'brief',
  'script',
  'storyboard',
  'shot_plan',
  'timeline',
  'asset_board',
  'course_outline',
  'gig_requirement',
  'canvas',
]);

export const ProjectDocumentEnsureParamsSchema = z.object({
  projectId: z.string().uuid(),
  type: DocumentTypeSchema,
});
export type ProjectDocumentEnsureParams = z.infer<
  typeof ProjectDocumentEnsureParamsSchema
>;

export const ListProjectDocumentsQuerySchema = z.object({
  type: DocumentTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListProjectDocumentsQuery = z.infer<
  typeof ListProjectDocumentsQuerySchema
>;

export const CreateDocumentSchema = z.object({
  type: DocumentTypeSchema,
  title: z.string().trim().min(1).max(160),
  slug: SlugSchema,
  schemaVersion: z.string().trim().min(1).max(32).default('2026-05-27'),
  collaborationDialect: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .default('fizzdragon.document.v1'),
  contentSnapshot: JsonObjectSchema.default({}),
});
export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;

export const UpdateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  slug: SlugSchema.nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
  contentSnapshot: OptionalJsonObjectSchema,
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>;

export const ListDocumentOperationsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListDocumentOperationsQuery = z.infer<
  typeof ListDocumentOperationsQuerySchema
>;

export const AppendDocumentOperationSchema = z
  .object({
    operationType: z
      .enum(['patch', 'yjs_update', 'snapshot', 'comment', 'system'])
      .default('patch'),
    clientMutationId: z.string().trim().max(128).optional(),
    idempotencyKey: z.string().trim().max(160).optional(),
    baseSequence: z.number().int().min(0).optional(),
    patch: OptionalJsonObjectSchema,
    yjsUpdateBase64: z.string().trim().min(1).optional(),
    snapshot: OptionalJsonObjectSchema,
    materializedContent: OptionalJsonObjectSchema,
    metadata: JsonObjectSchema.default({}),
  })
  .superRefine((value, ctx) => {
    if (value.operationType === 'system') return;
    if (
      value.operationType === 'patch' &&
      value.patch === undefined &&
      value.materializedContent === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patch'],
        message: 'patch or materializedContent is required.',
      });
    }
    if (
      value.operationType === 'yjs_update' &&
      value.yjsUpdateBase64 === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['yjsUpdateBase64'],
        message: 'yjsUpdateBase64 is required.',
      });
    }
    if (value.operationType === 'snapshot' && value.snapshot === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['snapshot'],
        message: 'snapshot is required.',
      });
    }
  });
export type AppendDocumentOperationInput = z.infer<
  typeof AppendDocumentOperationSchema
>;

export const CreateDocumentVersionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  source: z
    .enum(['autosave', 'manual', 'import', 'ai', 'system'])
    .default('manual'),
  sourceId: z.string().trim().max(128).optional(),
  snapshot: OptionalJsonObjectSchema,
  crdtStateBase64: z.string().trim().min(1).optional(),
  metadata: JsonObjectSchema.default({}),
});
export type CreateDocumentVersionInput = z.infer<
  typeof CreateDocumentVersionSchema
>;

/**
 * Restore the document to a prior version. The client supplies its exact
 * pre-restore state so the server can stamp an accurate "before restore"
 * safety checkpoint; the actual content revert is applied client-side and
 * streamed as a normal CRDT operation so every collaborator converges.
 */
export const RestoreDocumentVersionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  currentCrdtStateBase64: z.string().trim().min(1).optional(),
  currentSnapshot: OptionalJsonObjectSchema,
});
export type RestoreDocumentVersionInput = z.infer<
  typeof RestoreDocumentVersionSchema
>;

export const UpsertDocumentPresenceSchema = z.object({
  connectionId: z.string().trim().min(1).max(128),
  cursor: OptionalJsonObjectSchema,
  selection: OptionalJsonObjectSchema,
  metadata: JsonObjectSchema.default({}),
  ttlSeconds: z.number().int().min(5).max(120).default(30),
});
export type UpsertDocumentPresenceInput = z.infer<
  typeof UpsertDocumentPresenceSchema
>;

export const CreateCommentThreadSchema = z.object({
  blockId: z.string().trim().min(1).max(128).optional(),
  anchor: OptionalJsonObjectSchema,
  title: z.string().trim().min(1).max(160).optional(),
  body: z.string().trim().min(1).max(5000),
});
export type CreateCommentThreadInput = z.infer<
  typeof CreateCommentThreadSchema
>;

export const AddCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type AddCommentInput = z.infer<typeof AddCommentSchema>;

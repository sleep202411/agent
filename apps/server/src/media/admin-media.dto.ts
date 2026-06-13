import { z } from 'zod';

const JsonObjectSchema = z.record(z.string(), z.unknown());

export const ListAdminMediaAssetsQuerySchema = z.object({
  kind: z.enum(['image', 'video', 'audio', 'document', 'other']).optional(),
  source: z.enum(['user_upload', 'ai_output', 'imported', 'system']).optional(),
  status: z.enum(['uploading', 'ready', 'failed', 'deleted']).optional(),
  moderationStatus: z
    .enum(['unreviewed', 'approved', 'flagged', 'blocked'])
    .optional(),
  storageProvider: z
    .enum(['azure_blob', 'aliyun_oss', 's3_compatible', 'external_url'])
    .optional(),
  workspaceId: z.string().uuid().optional(),
  userId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});
export type ListAdminMediaAssetsQuery = z.infer<
  typeof ListAdminMediaAssetsQuerySchema
>;

export const ListAdminMediaModerationActionsQuerySchema = z.object({
  actionType: z
    .enum([
      'approve',
      'flag',
      'block',
      'unblock',
      'takedown',
      'restore',
      'restrict_visibility',
      'purge_cdn',
      'delete_object',
    ])
    .optional(),
  status: z.enum(['pending', 'completed', 'failed', 'cancelled']).optional(),
  assetId: z.string().uuid().optional(),
  dead: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});
export type ListAdminMediaModerationActionsQuery = z.infer<
  typeof ListAdminMediaModerationActionsQuerySchema
>;

export const ListAdminMediaProcessingJobsQuerySchema = z.object({
  jobType: z
    .enum([
      'thumbnail',
      'poster',
      'transcode',
      'hls_stream',
      'waveform',
      'metadata_probe',
      'moderation_scan',
      'backfill_original_placement',
    ])
    .optional(),
  status: z
    .enum(['pending', 'processing', 'completed', 'failed', 'cancelled', 'dead'])
    .optional(),
  assetId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});
export type ListAdminMediaProcessingJobsQuery = z.infer<
  typeof ListAdminMediaProcessingJobsQuerySchema
>;

export const AdminMediaAssetParamsSchema = z.object({
  assetId: z.string().uuid(),
});
export type AdminMediaAssetParams = z.infer<typeof AdminMediaAssetParamsSchema>;

export const UpdateAdminMediaAssetModerationSchema = z.object({
  moderationStatus: z.enum(['unreviewed', 'approved', 'flagged', 'blocked']),
  reason: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateAdminMediaAssetModerationInput = z.infer<
  typeof UpdateAdminMediaAssetModerationSchema
>;

export const AdminMediaActionParamsSchema = z.object({
  actionId: z.string().uuid(),
});
export type AdminMediaActionParams = z.infer<
  typeof AdminMediaActionParamsSchema
>;

export const AdminMediaProcessingJobParamsSchema = z.object({
  jobId: z.string().uuid(),
});
export type AdminMediaProcessingJobParams = z.infer<
  typeof AdminMediaProcessingJobParamsSchema
>;

export const CreateAdminMediaProcessingJobSchema = z.object({
  jobType: z.enum([
    'thumbnail',
    'poster',
    'transcode',
    'hls_stream',
    'waveform',
    'metadata_probe',
    'moderation_scan',
    'backfill_original_placement',
  ]),
  sourceVariantId: z.string().uuid().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(10_000).optional(),
  input: JsonObjectSchema.optional(),
});
export type CreateAdminMediaProcessingJobInput = z.infer<
  typeof CreateAdminMediaProcessingJobSchema
>;

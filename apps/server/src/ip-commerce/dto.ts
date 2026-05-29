import { z } from 'zod';
export const IpContentTypeSchema = z.enum([
  'series',
  'interactive_film',
  'film',
  'course',
  'collection',
  'other',
]);
export const IpTargetTypeSchema = z.enum(['title', 'episode']);
export const IpReportReasonSchema = z.enum([
  'copyright',
  'unsafe_content',
  'fraud',
  'misleading',
  'privacy',
  'harassment',
  'other',
]);
export const IpUserBlockTargetTypeSchema = z.enum(['title', 'creator']);
export const IpPublicationStatusSchema = z.enum([
  'draft',
  'submitted',
  'in_review',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'hidden',
  'suspended',
  'archived',
]);
export const IpListingVisibilitySchema = z.enum([
  'private',
  'unlisted',
  'public',
]);
export const IpReportStatusSchema = z.enum([
  'submitted',
  'triaged',
  'actioned',
  'dismissed',
]);
export const IpModerationActionTypeSchema = z.enum([
  'hide',
  'suspend_sales',
  'takedown',
  'region_block',
  'age_gate',
  'restore',
  'reject',
  'approve',
]);

function queryValueParts(value: unknown): string[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => queryValueParts(item));
  }
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return [];
  }
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const UuidListFromQuerySchema = z.preprocess(
  queryValueParts,
  z.array(z.string().uuid()).max(100).default([]),
);

export const ListIpTitlesQuerySchema = z.object({
  contentType: IpContentTypeSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListIpTitlesQuery = z.infer<typeof ListIpTitlesQuerySchema>;

export const ListAdminIpTitlesQuerySchema = z.object({
  contentType: IpContentTypeSchema.optional(),
  status: IpPublicationStatusSchema.optional(),
  listingVisibility: IpListingVisibilitySchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminIpTitlesQuery = z.infer<
  typeof ListAdminIpTitlesQuerySchema
>;

export const IpTitleParamsSchema = z.object({
  titleId: z.string().uuid(),
});
export type IpTitleParams = z.infer<typeof IpTitleParamsSchema>;

export const IpReportParamsSchema = z.object({
  reportId: z.string().uuid(),
});
export type IpReportParams = z.infer<typeof IpReportParamsSchema>;

export const UpdateAdminIpTitlePublicationSchema = z
  .object({
    status: IpPublicationStatusSchema,
    listingVisibility: IpListingVisibilitySchema.optional(),
    scheduledAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(1).max(1000),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();
export type UpdateAdminIpTitlePublicationInput = z.infer<
  typeof UpdateAdminIpTitlePublicationSchema
>;

export const ResolveAdminIpReportSchema = z
  .object({
    status: z.enum(['triaged', 'actioned', 'dismissed']),
    actionType: IpModerationActionTypeSchema.optional(),
    resolutionNote: z.string().trim().max(2000).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'actioned' && !value.actionType) {
      ctx.addIssue({
        code: 'custom',
        path: ['actionType'],
        message: 'actionType is required when status is actioned.',
      });
    }
    if (value.actionType && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'reason is required when actionType is provided.',
      });
    }
  });
export type ResolveAdminIpReportInput = z.infer<
  typeof ResolveAdminIpReportSchema
>;

export const IpTitleAccessQuerySchema = z.object({
  episodeIds: UuidListFromQuerySchema,
});
export type IpTitleAccessQuery = z.infer<typeof IpTitleAccessQuerySchema>;

export const CreateIpPurchaseSchema = z
  .object({
    titleId: z.string().uuid(),
    targetType: IpTargetTypeSchema,
    episodeId: z.string().uuid().optional(),
    priceRuleId: z.string().uuid().optional(),
    referralCode: z.string().trim().min(1).max(64).optional(),
    idempotencyKey: z.string().trim().min(8).max(160),
  })
  .superRefine((value, ctx) => {
    if (value.targetType === 'episode' && !value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId is required when targetType is episode.',
      });
    }
    if (value.targetType === 'title' && value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId must be empty when targetType is title.',
      });
    }
  });
export type CreateIpPurchaseInput = z.infer<typeof CreateIpPurchaseSchema>;

export const CreateIpContentReportSchema = z
  .object({
    targetType: z.enum(['title', 'episode']),
    targetId: z.string().uuid(),
    reason: IpReportReasonSchema,
    description: z.string().trim().max(2000).optional(),
    evidenceAssetId: z.string().uuid().optional(),
  })
  .strict();
export type CreateIpContentReportInput = z.infer<
  typeof CreateIpContentReportSchema
>;

export const UpsertIpUserBlockSchema = z
  .object({
    targetType: IpUserBlockTargetTypeSchema,
    targetId: z.string().trim().min(1).max(128),
    reason: z.string().trim().max(160).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.targetType === 'title' &&
      !z.string().uuid().safeParse(value.targetId).success
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'targetId must be a UUID when targetType is title.',
      });
    }
  });
export type UpsertIpUserBlockInput = z.infer<typeof UpsertIpUserBlockSchema>;

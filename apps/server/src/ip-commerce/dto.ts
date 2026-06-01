import { z } from 'zod';
export const IpTargetTypeSchema = z.enum(['ip', 'episode']);
export const IpTaxonomyTermTypeSchema = z.enum(['genre', 'tag']);
export const IpTaxonomyTermStatusSchema = z.enum([
  'active',
  'hidden',
  'archived',
]);
export const IpMediaUploadKindSchema = z.enum([
  'image',
  'video',
  'audio',
  'document',
  'other',
]);
export const IpMediaUploadPurposeSchema = z.enum([
  'cover',
  'trailer',
  'episode_cover',
  'episode_media',
  'episode_trailer',
  'source_material',
  'report_evidence',
]);
export const IpAssetPurposeSchema = z.enum([
  'source_material',
  'reference_art',
  'production_asset',
]);
export const IpPriceRuleStatusSchema = z.enum([
  'draft',
  'active',
  'disabled',
  'archived',
]);
export const IpContentCurrencySchema = z.literal('community_point');
export const IpReportReasonSchema = z.enum([
  'copyright',
  'unsafe_content',
  'fraud',
  'misleading',
  'privacy',
  'harassment',
  'other',
]);
export const IpUserBlockTargetTypeSchema = z.enum(['ip', 'creator']);
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
export const IpAgeRatingSchema = z.enum([
  'general',
  'teen',
  'mature',
  'restricted',
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

const TaxonomyCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

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
const TaxonomyCodeListFromQuerySchema = (max: number) =>
  z.preprocess(
    queryValueParts,
    z.array(TaxonomyCodeSchema).max(max).default([]),
  );

const GenreCodesSchema = z.array(TaxonomyCodeSchema).min(1).max(8);
const TagCodesSchema = z.array(TaxonomyCodeSchema).max(20);
export const SupportedIpLocaleSchema = z.enum(['en-US', 'zh-CN', 'zh-HK']);

export const LocaleQuerySchema = SupportedIpLocaleSchema.optional();

export const ListIpsQuerySchema = z.object({
  genreCodes: TaxonomyCodeListFromQuerySchema(8),
  tagCodes: TaxonomyCodeListFromQuerySchema(20),
  locale: LocaleQuerySchema,
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListIpsQuery = z.infer<typeof ListIpsQuerySchema>;

export const ListIpTaxonomyTermsQuerySchema = z.object({
  type: IpTaxonomyTermTypeSchema.optional(),
  locale: LocaleQuerySchema,
});
export type ListIpTaxonomyTermsQuery = z.infer<
  typeof ListIpTaxonomyTermsQuerySchema
>;

export const AdminIpTaxonomyTermParamsSchema = z.object({
  termId: z.string().uuid(),
});
export type AdminIpTaxonomyTermParams = z.infer<
  typeof AdminIpTaxonomyTermParamsSchema
>;

export const AdminIpTaxonomyLocalizationSchema = z
  .object({
    locale: SupportedIpLocaleSchema,
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable().optional(),
    aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  })
  .strict();

export const CreateAdminIpTaxonomyTermSchema = z
  .object({
    type: IpTaxonomyTermTypeSchema,
    code: TaxonomyCodeSchema.optional(),
    status: IpTaxonomyTermStatusSchema.default('active'),
    displayOrder: z.number().int().min(0).max(1_000_000).default(0),
    localizations: z.array(AdminIpTaxonomyLocalizationSchema).min(1).max(12),
  })
  .strict();
export type CreateAdminIpTaxonomyTermInput = z.infer<
  typeof CreateAdminIpTaxonomyTermSchema
>;

export const UpdateAdminIpTaxonomyTermSchema = z
  .object({
    status: IpTaxonomyTermStatusSchema.optional(),
    displayOrder: z.number().int().min(0).max(1_000_000).optional(),
    localizations: z
      .array(AdminIpTaxonomyLocalizationSchema)
      .min(1)
      .max(12)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.displayOrder !== undefined ||
      value.localizations !== undefined,
    {
      message: 'At least one taxonomy field is required.',
    },
  );
export type UpdateAdminIpTaxonomyTermInput = z.infer<
  typeof UpdateAdminIpTaxonomyTermSchema
>;

// ---------------------------------------------------------------------------
// IP discovery placements (IP Plaza hero / for-you / pinned recommendations)
// ---------------------------------------------------------------------------

export const IpDiscoveryPlacementKeySchema = z.enum([
  'ip_plaza_hero',
  'ip_plaza_for_you',
  'ip_plaza_list_pinned',
]);

export const IpDiscoveryRecommendationStatusSchema = z.enum([
  'draft',
  'enabled',
  'paused',
  'archived',
]);

export const ListAdminIpDiscoveryQuerySchema = z.object({
  placementKey: IpDiscoveryPlacementKeySchema.optional(),
  status: IpDiscoveryRecommendationStatusSchema.optional(),
  locale: LocaleQuerySchema,
});
export type ListAdminIpDiscoveryQuery = z.infer<
  typeof ListAdminIpDiscoveryQuerySchema
>;

export const AdminIpDiscoveryParamsSchema = z.object({
  recommendationId: z.string().uuid(),
});
export type AdminIpDiscoveryParams = z.infer<
  typeof AdminIpDiscoveryParamsSchema
>;

export const AdminIpDiscoveryLocalizationSchema = z
  .object({
    locale: SupportedIpLocaleSchema,
    eyebrow: z.string().trim().max(80).nullable().optional(),
    title: z.string().trim().max(160).nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    ctaLabel: z.string().trim().max(80).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.eyebrow || value.title || value.description || value.ctaLabel,
      ),
    { message: 'At least one localized copy field is required per locale.' },
  );

const DiscoveryAssetIdSchema = z.string().uuid().nullable().optional();

export const CreateAdminIpDiscoverySchema = z
  .object({
    placementKey: IpDiscoveryPlacementKeySchema,
    ipId: z.string().uuid(),
    status: IpDiscoveryRecommendationStatusSchema.default('draft'),
    sortOrder: z.number().int().min(0).max(1_000_000).default(0),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    imageAssetId: DiscoveryAssetIdSchema,
    mobileImageAssetId: DiscoveryAssetIdSchema,
    trailerAssetId: DiscoveryAssetIdSchema,
    localizations: z
      .array(AdminIpDiscoveryLocalizationSchema)
      .max(12)
      .optional(),
  })
  .strict();
export type CreateAdminIpDiscoveryInput = z.infer<
  typeof CreateAdminIpDiscoverySchema
>;

export const UpdateAdminIpDiscoverySchema = z
  .object({
    status: IpDiscoveryRecommendationStatusSchema.optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    imageAssetId: DiscoveryAssetIdSchema,
    mobileImageAssetId: DiscoveryAssetIdSchema,
    trailerAssetId: DiscoveryAssetIdSchema,
    localizations: z
      .array(AdminIpDiscoveryLocalizationSchema)
      .max(12)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });
export type UpdateAdminIpDiscoveryInput = z.infer<
  typeof UpdateAdminIpDiscoverySchema
>;

export const ReorderAdminIpDiscoverySchema = z
  .object({
    placementKey: IpDiscoveryPlacementKeySchema,
    orderedIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();
export type ReorderAdminIpDiscoveryInput = z.infer<
  typeof ReorderAdminIpDiscoverySchema
>;

export const ListPublicIpDiscoveryQuerySchema = z.object({
  placementKey: IpDiscoveryPlacementKeySchema,
  locale: LocaleQuerySchema,
});
export type ListPublicIpDiscoveryQuery = z.infer<
  typeof ListPublicIpDiscoveryQuerySchema
>;

export const UploadAdminDiscoveryMediaQuerySchema = z.object({
  kind: z.enum(['image', 'video']),
});
export type UploadAdminDiscoveryMediaQuery = z.infer<
  typeof UploadAdminDiscoveryMediaQuerySchema
>;

export const ListCreatorIpsQuerySchema = z.object({
  locale: LocaleQuerySchema,
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListCreatorIpsQuery = z.infer<typeof ListCreatorIpsQuerySchema>;

export const CreateIpDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    summary: z.string().trim().max(280).optional(),
    genreCodes: GenreCodesSchema,
    tagCodes: TagCodesSchema.default([]),
    sourceLocale: SupportedIpLocaleSchema,
  })
  .strict();
export type CreateIpDraftInput = z.infer<typeof CreateIpDraftSchema>;

export const UpdateCreatorIpProfileSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    summary: z.string().trim().max(280).optional(),
    description: z.string().trim().max(3000).nullable().optional(),
    listingVisibility: IpListingVisibilitySchema.optional(),
    ageRating: IpAgeRatingSchema.optional(),
    genreCodes: GenreCodesSchema.optional(),
    tagCodes: TagCodesSchema.optional(),
    copyrightOwner: z.string().trim().max(160).nullable().optional(),
    rightsSummary: z
      .object({
        statement: z.string().trim().max(1000).optional(),
      })
      .strict()
      .optional(),
    aiDisclosure: z
      .object({
        generatedVisuals: z.boolean().optional(),
        generatedCopy: z.boolean().optional(),
        statement: z.string().trim().max(1000).optional(),
      })
      .strict()
      .optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.summary !== undefined ||
      value.description !== undefined ||
      value.listingVisibility !== undefined ||
      value.ageRating !== undefined ||
      value.genreCodes !== undefined ||
      value.tagCodes !== undefined ||
      value.copyrightOwner !== undefined ||
      value.rightsSummary !== undefined ||
      value.aiDisclosure !== undefined,
    {
      message: 'At least one profile field is required.',
    },
  );
export type UpdateCreatorIpProfileInput = z.infer<
  typeof UpdateCreatorIpProfileSchema
>;

export const SubmitCreatorIpReviewSchema = z
  .object({
    expectedVersion: z.number().int().min(0).optional(),
    changeSummary: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type SubmitCreatorIpReviewInput = z.infer<
  typeof SubmitCreatorIpReviewSchema
>;

export const UpdateCreatorIpAssetsSchema = z
  .object({
    coverAssetId: z.string().uuid().nullable().optional(),
    trailerAssetId: z.string().uuid().nullable().optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.coverAssetId !== undefined || value.trailerAssetId !== undefined,
    {
      message: 'At least one asset field is required.',
    },
  );
export type UpdateCreatorIpAssetsInput = z.infer<
  typeof UpdateCreatorIpAssetsSchema
>;

export const CreateCreatorIpEpisodeSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    summary: z.string().trim().max(280).optional(),
    episodeNo: z.number().int().positive().max(10_000).optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    durationSeconds: z.number().int().positive().max(86_400).optional(),
    isFreePreview: z.boolean().optional(),
    coverAssetId: z.string().uuid().optional(),
    mediaAssetId: z.string().uuid().optional(),
    trailerAssetId: z.string().uuid().optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();
export type CreateCreatorIpEpisodeInput = z.infer<
  typeof CreateCreatorIpEpisodeSchema
>;

export const UpdateCreatorIpEpisodeSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    summary: z.string().trim().max(280).optional(),
    episodeNo: z.number().int().positive().max(10_000).optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .max(86_400)
      .nullable()
      .optional(),
    isFreePreview: z.boolean().optional(),
    status: IpPublicationStatusSchema.optional(),
    coverAssetId: z.string().uuid().nullable().optional(),
    mediaAssetId: z.string().uuid().nullable().optional(),
    trailerAssetId: z.string().uuid().nullable().optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.summary !== undefined ||
      value.episodeNo !== undefined ||
      value.sortOrder !== undefined ||
      value.durationSeconds !== undefined ||
      value.isFreePreview !== undefined ||
      value.status !== undefined ||
      value.coverAssetId !== undefined ||
      value.mediaAssetId !== undefined ||
      value.trailerAssetId !== undefined,
    {
      message: 'At least one episode field is required.',
    },
  );
export type UpdateCreatorIpEpisodeInput = z.infer<
  typeof UpdateCreatorIpEpisodeSchema
>;

export const UploadCreatorIpMediaQuerySchema = z
  .object({
    kind: IpMediaUploadKindSchema,
    purpose: IpMediaUploadPurposeSchema,
  })
  .strict();
export type UploadCreatorIpMediaQuery = z.infer<
  typeof UploadCreatorIpMediaQuerySchema
>;

export const ListCreatorIpAssetsQuerySchema = z
  .object({
    purpose: IpAssetPurposeSchema.optional(),
  })
  .strict();
export type ListCreatorIpAssetsQuery = z.infer<
  typeof ListCreatorIpAssetsQuerySchema
>;

export const UpsertCreatorIpPriceRuleSchema = z
  .object({
    targetType: IpTargetTypeSchema,
    episodeId: z.string().uuid().optional(),
    status: IpPriceRuleStatusSchema.default('active'),
    currency: IpContentCurrencySchema.default('community_point'),
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,18}$/)
      .optional(),
    originalAmount: z
      .string()
      .trim()
      .regex(/^\d{1,18}$/)
      .nullable()
      .optional(),
    priority: z.number().int().min(0).max(10_000).default(100),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    unlocksAt: z.coerce.date().nullable().optional(),
    maxPerUser: z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .nullable()
      .optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.targetType === 'episode' && !value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId is required when targetType is episode.',
      });
    }
    if (value.targetType === 'ip' && value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId must be empty when targetType is ip.',
      });
    }
    if (value.status !== 'disabled' && value.status !== 'archived') {
      if (!value.amount) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: 'amount is required for an active price rule.',
        });
      } else if (BigInt(value.amount) <= 0n) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: 'amount must be greater than zero.',
        });
      }
    }
    if (value.amount && value.originalAmount) {
      const amount = BigInt(value.amount);
      const originalAmount = BigInt(value.originalAmount);
      if (originalAmount < amount) {
        ctx.addIssue({
          code: 'custom',
          path: ['originalAmount'],
          message: 'originalAmount must be greater than or equal to amount.',
        });
      }
    }
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'endsAt must be after startsAt.',
      });
    }
  });
export type UpsertCreatorIpPriceRuleInput = z.infer<
  typeof UpsertCreatorIpPriceRuleSchema
>;

export const ListAdminIpsQuerySchema = z.object({
  genreCodes: TaxonomyCodeListFromQuerySchema(8),
  tagCodes: TaxonomyCodeListFromQuerySchema(20),
  status: IpPublicationStatusSchema.optional(),
  listingVisibility: IpListingVisibilitySchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  locale: LocaleQuerySchema,
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminIpsQuery = z.infer<typeof ListAdminIpsQuerySchema>;

export const IpPurchaseOrderStatusSchema = z.enum([
  'pending',
  'paid',
  'fulfilled',
  'canceled',
  'failed',
  'refunded',
  'partially_refunded',
]);
export const IpEntitlementStatusSchema = z.enum([
  'active',
  'expired',
  'revoked',
  'refunded',
]);

export const ListAdminIpOrdersQuerySchema = z.object({
  ipId: z.string().uuid().optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  status: IpPurchaseOrderStatusSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  locale: LocaleQuerySchema,
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminIpOrdersQuery = z.infer<
  typeof ListAdminIpOrdersQuerySchema
>;

export const ListAdminIpEntitlementsQuerySchema = z.object({
  ipId: z.string().uuid().optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  targetType: IpTargetTypeSchema.optional(),
  status: IpEntitlementStatusSchema.optional(),
  locale: LocaleQuerySchema,
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminIpEntitlementsQuery = z.infer<
  typeof ListAdminIpEntitlementsQuerySchema
>;

export const IpParamsSchema = z.object({
  ipId: z.string().uuid(),
});
export type IpParams = z.infer<typeof IpParamsSchema>;

export const IpEpisodeParamsSchema = IpParamsSchema.extend({
  episodeId: z.string().uuid(),
});
export type IpEpisodeParams = z.infer<typeof IpEpisodeParamsSchema>;

export const IpAssetParamsSchema = IpParamsSchema.extend({
  assetId: z.string().uuid(),
});
export type IpAssetParams = z.infer<typeof IpAssetParamsSchema>;

export const IpLocaleQuerySchema = z.object({
  locale: LocaleQuerySchema,
});
export type IpLocaleQuery = z.infer<typeof IpLocaleQuerySchema>;

export const IpReportParamsSchema = z.object({
  reportId: z.string().uuid(),
});
export type IpReportParams = z.infer<typeof IpReportParamsSchema>;

export const IpEntitlementParamsSchema = z.object({
  entitlementId: z.string().uuid(),
});
export type IpEntitlementParams = z.infer<typeof IpEntitlementParamsSchema>;

export const GrantAdminIpEntitlementSchema = z
  .object({
    userId: z.string().trim().min(1).max(64),
    ipId: z.string().uuid(),
    targetType: IpTargetTypeSchema,
    episodeId: z.string().uuid().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.targetType === 'episode' && !value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId is required when targetType is episode.',
      });
    }
    if (value.targetType === 'ip' && value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId must be empty when targetType is ip.',
      });
    }
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'endsAt must be after startsAt.',
      });
    }
  });
export type GrantAdminIpEntitlementInput = z.infer<
  typeof GrantAdminIpEntitlementSchema
>;

export const RevokeAdminIpEntitlementSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export type RevokeAdminIpEntitlementInput = z.infer<
  typeof RevokeAdminIpEntitlementSchema
>;

export const UpdateAdminIpPublicationSchema = z
  .object({
    status: IpPublicationStatusSchema,
    listingVisibility: IpListingVisibilitySchema.optional(),
    scheduledAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(1).max(1000),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();
export type UpdateAdminIpPublicationInput = z.infer<
  typeof UpdateAdminIpPublicationSchema
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

export const IpAccessQuerySchema = z.object({
  episodeIds: UuidListFromQuerySchema,
  locale: LocaleQuerySchema,
});
export type IpAccessQuery = z.infer<typeof IpAccessQuerySchema>;

export const CreateIpPurchaseSchema = z
  .object({
    ipId: z.string().uuid(),
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
    if (value.targetType === 'ip' && value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId must be empty when targetType is ip.',
      });
    }
  });
export type CreateIpPurchaseInput = z.infer<typeof CreateIpPurchaseSchema>;

export const CreateIpContentReportSchema = z
  .object({
    targetType: z.enum(['ip', 'episode']),
    targetId: z.string().uuid(),
    reason: IpReportReasonSchema,
    description: z.string().trim().max(2000).optional(),
    evidenceAssetId: z.string().uuid().optional(),
  })
  .strict();
export type CreateIpContentReportInput = z.infer<
  typeof CreateIpContentReportSchema
>;

export const UpsertIpCollectionItemSchema = z
  .object({
    targetType: IpTargetTypeSchema,
    ipId: z.string().uuid(),
    episodeId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.targetType === 'episode' && !value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId is required when targetType is episode.',
      });
    }
    if (value.targetType === 'ip' && value.episodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['episodeId'],
        message: 'episodeId must be empty when targetType is ip.',
      });
    }
  });
export type UpsertIpCollectionItemInput = z.infer<
  typeof UpsertIpCollectionItemSchema
>;

export const UpsertIpUserBlockSchema = z
  .object({
    targetType: IpUserBlockTargetTypeSchema,
    targetId: z.string().trim().min(1).max(128),
    reason: z.string().trim().max(160).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.targetType === 'ip' &&
      !z.string().uuid().safeParse(value.targetId).success
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'targetId must be a UUID when targetType is ip.',
      });
    }
  });
export type UpsertIpUserBlockInput = z.infer<typeof UpsertIpUserBlockSchema>;

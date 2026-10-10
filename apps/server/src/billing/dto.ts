import { z } from 'zod';
import { MembershipBenefitsSchema } from '../entitlements/membership-benefits';

export const CheckoutPaymentProviderSchema = z.enum([
  'airwallex',
  'wechat_pay',
  'alipay',
]);
export const AdminPaymentProviderSchema = z.enum([
  'airwallex',
  'wechat_pay',
  'alipay',
  'manual',
  'internal',
]);
export const BillingProductTypeSchema = z.enum([
  'compute_point_pack',
  'community_point_pack',
  'membership_plan',
  'team_membership_plan',
  'community_membership_plan',
]);
export const BillingOrderStatusSchema = z.enum([
  'draft',
  'pending_payment',
  'paid',
  'fulfilled',
  'canceled',
  'expired',
  'failed',
  'refunded',
  'partially_refunded',
]);
export const BillingRefundStatusSchema = z.enum([
  'requested',
  'provider_pending',
  'succeeded',
  'failed',
  'canceled',
]);
export const BillingLedgerJournalTypeSchema = z.enum([
  'payment_capture',
  'fulfillment_allocation',
  'settlement',
  'refund',
  'chargeback',
  'revenue_recognition',
  'provider_fee',
  'manual_adjustment',
  'reversal',
]);
export const BillingSettlementStatusSchema = z.enum([
  'pending',
  'reconciled',
  'partially_reconciled',
  'failed',
]);
export const BillingReconciliationStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
]);
export const BillingPriceIntervalSchema = z.enum(['one_time', 'month', 'year']);
export const BillingSubjectTypeSchema = z.enum(['user', 'workspace']);
export const WalletCurrencyTypeSchema = z.enum([
  'compute_point',
  'community_point',
]);
export const WalletBalanceKindSchema = z.enum(['consumable', 'withdrawable']);
export const AdminWalletCreditGrantTypeSchema = z.enum([
  'admin_adjustment',
  'check_in_reward',
  'campaign_reward',
  'system_grant',
  'other',
]);
export const BillingProviderBindingStatusSchema = z.enum([
  'active',
  'inactive',
  'sync_pending',
  'sync_failed',
]);
export const BillingPromotionStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'archived',
]);
export const BillingPromotionDurationTypeSchema = z.enum([
  'once',
  'forever',
  'repeating',
]);
export const BillingPromotionApplyModeSchema = z.enum(['code', 'automatic']);
export const BillingProviderEventStatusSchema = z.enum([
  'received',
  'processed',
  'ignored',
  'failed',
]);
export const BillingMembershipPlanStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'archived',
]);

export const ListBillingPricesQuerySchema = z.object({
  productType: BillingProductTypeSchema.optional(),
  provider: CheckoutPaymentProviderSchema.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export type ListBillingPricesQuery = z.infer<
  typeof ListBillingPricesQuerySchema
>;

// Optional AppLovin (Axon) ad-attribution captured browser-side and threaded
// through checkout so the post-payment server-to-server conversion report can be
// matched + deduplicated against the browser pixel's purchase event. Every field
// is optional and best-effort — its absence never affects checkout. The client
// only knows `aleid` (the AppLovin click id); the controller backfills
// clientIp / clientUserAgent / countryCode from the request (the browser can't
// see its own public IP, and a client-asserted IP can't be trusted).
export const BillingAttributionSchema = z.object({
  aleid: z.string().trim().max(256).optional(),
  clientUserAgent: z.string().trim().max(1024).optional(),
  clientIp: z.string().trim().max(64).optional(),
  countryCode: z.string().trim().length(2).optional(),
});
export type BillingAttributionInput = z.infer<typeof BillingAttributionSchema>;

export const CreateBillingCheckoutSchema = z.object({
  priceId: z.string().uuid(),
  provider: CheckoutPaymentProviderSchema.optional(),
  promotionCode: z.string().trim().min(3).max(64).optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  workspaceId: z.string().uuid().optional(),
  successUrl: z.string().trim().url().max(2048),
  backUrl: z.string().trim().url().max(2048),
  attribution: BillingAttributionSchema.optional(),
});
export type CreateBillingCheckoutInput = z.infer<
  typeof CreateBillingCheckoutSchema
>;

// Ad-hoc, arbitrary-amount community-point recharge (Airwallex Payment Intents).
// Whole US dollars only; the server derives amountMinor = dollars * 100 and the
// granted points from the hidden custom-recharge anchor SKU's ratio. No priceId:
// the amount is the input, not a catalog selection.
export const CreateCustomRechargeSchema = z.object({
  amountDollars: z.coerce.number().int().min(10).max(5000),
  // Which wallet the recharge funds. Defaults to community_point for backward
  // compatibility with the existing user recharge; compute_point funds the
  // AI-generation wallet and may target a team workspace.
  currency: WalletCurrencyTypeSchema.default('community_point'),
  provider: CheckoutPaymentProviderSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  // When set, fund the workspace's wallet instead of the caller's own (requires
  // the billing role on that workspace). Only honored for compute_point.
  workspaceId: z.string().uuid().optional(),
  successUrl: z.string().trim().url().max(2048),
  backUrl: z.string().trim().url().max(2048),
  attribution: BillingAttributionSchema.optional(),
});
export type CreateCustomRechargeInput = z.infer<
  typeof CreateCustomRechargeSchema
>;

export const CreateComputePointTopupSchema = z.object({
  priceId: z.string().uuid(),
  provider: CheckoutPaymentProviderSchema.optional(),
  promotionCode: z.string().trim().min(3).max(64).optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  // When set, fund the workspace's compute_point wallet instead of the caller's
  // own (requires the billing role on that workspace). The pack price stays a
  // user-subject catalog SKU; only the order's subject is directed at the team.
  workspaceId: z.string().uuid().optional(),
  successUrl: z.string().trim().url().max(2048),
  backUrl: z.string().trim().url().max(2048),
});
export type CreateComputePointTopupInput = z.infer<
  typeof CreateComputePointTopupSchema
>;

export const ListWalletLedgerQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  currency: WalletCurrencyTypeSchema.default('compute_point'),
  balanceKind: WalletBalanceKindSchema.default('consumable'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWalletLedgerQuery = z.infer<typeof ListWalletLedgerQuerySchema>;

export const WalletDailyUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  projectId: z.string().uuid().optional(),
  currency: z.string().default('compute_point'),
  balanceKind: z.string().default('consumable'),
});
export type WalletDailyUsageQuery = z.infer<typeof WalletDailyUsageQuerySchema>;

// Per-member compute usage for a team workspace, optionally scoped to one
// project. Admin-only (surfaces teammates' consumption). Fixed to the compute
// pot — the only workspace-owned currency.
export const WalletMemberUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  projectId: z.string().uuid().optional(),
});
export type WalletMemberUsageQuery = z.infer<
  typeof WalletMemberUsageQuerySchema
>;

export const CreateAdminWalletAdjustmentSchema = z
  .object({
    amount: z.coerce
      .bigint()
      .refine((value) => value !== 0n, 'Adjustment amount cannot be zero.'),
    grantType: AdminWalletCreditGrantTypeSchema.default('admin_adjustment'),
    expiresAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(6).max(1000),
    idempotencyKey: z.string().trim().min(8).max(180),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    if (value.amount < 0n && value.grantType !== 'admin_adjustment') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grantType'],
        message: 'Negative adjustments must use admin_adjustment.',
      });
    }
    if (value.amount < 0n && value.expiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Negative adjustments cannot set expiry.',
      });
    }
    if (value.expiresAt && value.expiresAt <= new Date()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Expiry must be in the future.',
      });
    }
  });
export type CreateAdminWalletAdjustmentInput = z.infer<
  typeof CreateAdminWalletAdjustmentSchema
>;

// Compute credits are adjusted through an explicit workspace ID.
export const CreateAdminWorkspaceWalletCreditSchema = z
  .object({
    workspaceId: z.string().uuid(),
    amount: z.coerce
      .bigint()
      .refine((value) => value !== 0n, 'Amount cannot be zero.'),
    grantType: AdminWalletCreditGrantTypeSchema.default('admin_adjustment'),
    expiresAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().trim().min(8).max(180),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    if (value.expiresAt && value.expiresAt <= new Date()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Expiry must be in the future.',
      });
    }
    // Debits (negative) are only legitimate as an admin adjustment — mirrors the
    // account-adjustment guard (both share one service).
    if (value.amount < 0n && value.grantType !== 'admin_adjustment') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grantType'],
        message: 'Only admin_adjustment may be negative.',
      });
    }
  });
export type CreateAdminWorkspaceWalletCreditInput = z.infer<
  typeof CreateAdminWorkspaceWalletCreditSchema
>;

// Read-only compute_point balance for one workspace.
export const GetAdminWorkspaceWalletCreditQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});
export type GetAdminWorkspaceWalletCreditQueryInput = z.infer<
  typeof GetAdminWorkspaceWalletCreditQuerySchema
>;

// Workspace search powering the admin wallet picker; `query` matches workspace id,
// name (case-insensitive contains), or ownerUserId (exact).
export const ListAdminWorkspacesQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  /**
   * Every workspace this user BELONGS to — owned or joined. Unlike `query`
   * (which matches ownerUserId only), this follows the membership table, which
   * is what "show me this person's workspaces" actually means. Each row then
   * carries the user's own role in it.
   */
  relatedUserId: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListAdminWorkspacesQueryInput = z.infer<
  typeof ListAdminWorkspacesQuerySchema
>;

/**
 * Cross-workspace compute consumption for ops: who spent how much from which
 * workspace pot over the last N days. Results are person × workspace pairs,
 * rolled up per member and sorted by credits desc.
 */
export const ListAdminComputeMemberUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  /**
   * personal = default-for-user pot; shared = every other workspace;
   * all = no kind filter.
   */
  workspaceKind: z.enum(['personal', 'shared', 'all']).default('all'),
  workspaceId: z.string().uuid().optional(),
  /** Substring match against workspace name. */
  workspaceQuery: z.string().trim().min(1).max(160).optional(),
  /** Raw or encoded Java client user id. */
  userId: z.string().trim().min(1).max(64).optional(),
  /**
   * Phone / email — resolved through the legacy user bridge before filtering.
   * Ignored when `userId` is set.
   */
  userQuery: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListAdminComputeMemberUsageQuery = z.infer<
  typeof ListAdminComputeMemberUsageQuerySchema
>;

/**
 * Cross-workspace project consumption for ops: which projects spent how
 * much from which workspace pot. Rows are workspace × project pairs,
 * rolled up per workspace and sorted by credits desc.
 */
export const ListAdminComputeProjectUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  workspaceKind: z.enum(['personal', 'shared', 'all']).default('all'),
  /** credits = heaviest spend; recent = last settle/debit first. */
  sort: z.enum(['credits', 'recent']).default('credits'),
  workspaceId: z.string().uuid().optional(),
  workspaceQuery: z.string().trim().min(1).max(160).optional(),
  /** Substring match against current project name. */
  projectQuery: z.string().trim().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListAdminComputeProjectUsageQuery = z.infer<
  typeof ListAdminComputeProjectUsageQuerySchema
>;

export const ListAdminBillingPricesQuerySchema = z.object({
  productType: BillingProductTypeSchema.optional(),
  provider: AdminPaymentProviderSchema.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export type ListAdminBillingPricesQuery = z.infer<
  typeof ListAdminBillingPricesQuerySchema
>;

const MetadataSchema = z.record(z.string(), z.unknown()).default({});
const PlanKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => /^[a-z][a-z0-9_]{1,63}$/.test(value),
    'Plan key must be lowercase snake_case and start with a letter.',
  );

export const ListMembershipPlansQuerySchema = z.object({
  productType: z
    .enum([
      'membership_plan',
      'team_membership_plan',
      'community_membership_plan',
    ])
    .optional(),
  subjectType: BillingSubjectTypeSchema.optional(),
  provider: CheckoutPaymentProviderSchema.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
});
export type ListMembershipPlansQuery = z.infer<
  typeof ListMembershipPlansQuerySchema
>;

export const ListAdminMembershipPlansQuerySchema = z.object({
  productType: z
    .enum([
      'membership_plan',
      'team_membership_plan',
      'community_membership_plan',
    ])
    .optional(),
  subjectType: BillingSubjectTypeSchema.optional(),
  status: BillingMembershipPlanStatusSchema.optional(),
  includeArchived: z.coerce.boolean().default(false),
});
export type ListAdminMembershipPlansQuery = z.infer<
  typeof ListAdminMembershipPlansQuerySchema
>;

const MembershipPlanShape = {
  planKey: PlanKeySchema,
  productType: z.enum(['membership_plan', 'team_membership_plan']),
  subjectType: BillingSubjectTypeSchema,
  status: BillingMembershipPlanStatusSchema.default('draft'),
  rank: z.coerce.number().int().min(0).max(100),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  includedComputeCredits: z.coerce.bigint().min(0n).default(0n),
  includedSeats: z.coerce.number().int().min(1).max(100000).default(1),
  maxSeats: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  seatOverageAllowed: z.coerce.boolean().default(false),
  billingIntervalDefault: BillingPriceIntervalSchema.optional(),
  /** Every paid plan must state its complete runtime policy at creation. */
  benefits: MembershipBenefitsSchema,
  marketing: MetadataSchema.optional(),
  metadata: MetadataSchema.optional(),
} satisfies z.ZodRawShape;

const MembershipPlanObjectSchema = z.object(MembershipPlanShape);

const MembershipPlanBaseSchema = MembershipPlanObjectSchema.superRefine(
  (value, ctx) => {
    if (
      value.productType === 'membership_plan' &&
      value.subjectType !== 'user'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subjectType'],
        message: 'Individual membership plans must use user subject type.',
      });
    }
    if (
      value.productType === 'team_membership_plan' &&
      value.subjectType !== 'workspace'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subjectType'],
        message: 'Team membership plans must use workspace subject type.',
      });
    }
    if (value.maxSeats != null && value.maxSeats < value.includedSeats) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxSeats'],
        message: 'Maximum seats cannot be below included seats.',
      });
    }
  },
);

export const CreateAdminMembershipPlanSchema = MembershipPlanBaseSchema;
export type CreateAdminMembershipPlanInput = z.infer<
  typeof CreateAdminMembershipPlanSchema
>;

export const UpdateAdminMembershipPlanSchema =
  MembershipPlanObjectSchema.partial()
    .omit({ planKey: true, benefits: true })
    .superRefine((value, ctx) => {
      if (
        value.productType === 'membership_plan' &&
        value.subjectType &&
        value.subjectType !== 'user'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['subjectType'],
          message: 'Individual membership plans must use user subject type.',
        });
      }
      if (
        value.productType === 'team_membership_plan' &&
        value.subjectType &&
        value.subjectType !== 'workspace'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['subjectType'],
          message: 'Team membership plans must use workspace subject type.',
        });
      }
      if (
        value.maxSeats != null &&
        value.includedSeats != null &&
        value.maxSeats < value.includedSeats
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxSeats'],
          message: 'Maximum seats cannot be below included seats.',
        });
      }
    });
export type UpdateAdminMembershipPlanInput = z.infer<
  typeof UpdateAdminMembershipPlanSchema
>;

export const BillingMembershipPlanParamsSchema = z.object({
  planId: z.string().uuid(),
});
export type BillingMembershipPlanParams = z.infer<
  typeof BillingMembershipPlanParamsSchema
>;

/** Full-replace write of a plan's validated benefits. */
export const UpdateAdminMembershipPlanBenefitsSchema = z.object({
  benefits: MembershipBenefitsSchema,
});
export type UpdateAdminMembershipPlanBenefitsInput = z.infer<
  typeof UpdateAdminMembershipPlanBenefitsSchema
>;

const ProviderBindingInputSchema = z.object({
  provider: AdminPaymentProviderSchema,
  providerProductId: z.string().trim().min(1).max(128).optional(),
  providerPriceId: z.string().trim().min(1).max(128).optional(),
  providerMode: z.string().trim().min(1).max(32).optional(),
  status: BillingProviderBindingStatusSchema.default('active'),
  metadata: MetadataSchema.optional(),
});

export const CreateAdminBillingPriceSchema = z
  .object({
    itemCode: z
      .string()
      .trim()
      .min(3)
      .max(96)
      .transform((value) => value.toUpperCase())
      .optional(),
    itemName: z.string().trim().min(2).max(160),
    itemDescription: z.string().trim().max(2000).optional(),
    productType: BillingProductTypeSchema,
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    amountMinor: z.coerce.bigint().min(1n),
    interval: BillingPriceIntervalSchema.default('one_time'),
    subjectType: BillingSubjectTypeSchema.default('user'),
    grantsWalletCurrency: WalletCurrencyTypeSchema.optional(),
    grantsWalletAmount: z.coerce.bigint().min(1n).optional(),
    grantsPlanKey: z.string().trim().min(2).max(64).optional(),
    grantDurationDays: z.coerce.number().int().min(1).max(3660).optional(),
    itemMetadata: MetadataSchema.optional(),
    priceMetadata: MetadataSchema.optional(),
    providerBindings: z.array(ProviderBindingInputSchema).max(8).default([]),
  })
  .superRefine((value, ctx) => {
    const hasWalletGrant =
      Boolean(value.grantsWalletCurrency) ||
      value.grantsWalletAmount !== undefined;
    if (
      hasWalletGrant &&
      (!value.grantsWalletCurrency || value.grantsWalletAmount === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grantsWalletAmount'],
        message: 'Wallet grants require currency and amount.',
      });
    }
    if (value.grantsWalletCurrency && value.grantsPlanKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grantsPlanKey'],
        message:
          'Membership included credits are configured on the membership plan, not on the price.',
      });
    }
    if (
      (value.productType === 'membership_plan' ||
        value.productType === 'team_membership_plan') &&
      !value.grantsPlanKey
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grantsPlanKey'],
        message: 'Membership prices must grant a plan key.',
      });
    }
    if (
      value.productType === 'membership_plan' &&
      value.subjectType !== 'user'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subjectType'],
        message: 'Individual membership prices must grant to user subjects.',
      });
    }
    if (
      value.productType === 'team_membership_plan' &&
      value.subjectType !== 'workspace'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subjectType'],
        message: 'Team membership prices must grant to workspace subjects.',
      });
    }
  });
export type CreateAdminBillingPriceInput = z.infer<
  typeof CreateAdminBillingPriceSchema
>;

export const BillingPriceParamsSchema = z.object({
  priceId: z.string().uuid(),
});
export type BillingPriceParams = z.infer<typeof BillingPriceParamsSchema>;

export const UpdateAdminBillingPriceSchema = z.object({
  itemName: z.string().trim().min(2).max(160).optional(),
  itemDescription: z.string().trim().max(2000).nullable().optional(),
  isActive: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  priceMetadata: MetadataSchema.optional(),
});
export type UpdateAdminBillingPriceInput = z.infer<
  typeof UpdateAdminBillingPriceSchema
>;

export const UpsertAdminBillingProviderBindingSchema =
  ProviderBindingInputSchema;
export type UpsertAdminBillingProviderBindingInput = z.infer<
  typeof UpsertAdminBillingProviderBindingSchema
>;

export const BillingProviderBindingParamsSchema = z.object({
  bindingId: z.string().uuid(),
});
export type BillingProviderBindingParams = z.infer<
  typeof BillingProviderBindingParamsSchema
>;

export const ListAdminBillingPromotionsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: BillingPromotionStatusSchema.optional(),
  provider: AdminPaymentProviderSchema.optional(),
  includeArchived: z.coerce.boolean().default(false),
});
export type ListAdminBillingPromotionsQuery = z.infer<
  typeof ListAdminBillingPromotionsQuerySchema
>;

export const CreateAdminBillingPromotionSchema = z
  .object({
    applyMode: BillingPromotionApplyModeSchema.default('code'),
    // Required for code mode, omitted for automatic (enforced in superRefine).
    code: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .transform((value) => value.toUpperCase())
      .optional(),
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
    status: BillingPromotionStatusSchema.default('draft'),
    percentOffBps: z.coerce.number().int().min(1).max(10000).optional(),
    amountOffMinor: z.coerce.number().int().min(1).optional(),
    amountOffCurrency: z.enum(['USD', 'CNY']).optional(),
    durationType: BillingPromotionDurationTypeSchema.default('once'),
    durationCount: z.coerce.number().int().min(1).max(120).optional(),
    durationUnit: z.enum(['day', 'week', 'month', 'year']).optional(),
    appliesProductType: BillingProductTypeSchema.optional(),
    appliesItemId: z.string().uuid().optional(),
    appliesPriceId: z.string().uuid().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    maxRedemptions: z.coerce.number().int().min(1).optional(),
    maxRedemptionsPerUser: z.coerce.number().int().min(1).optional(),
    metadata: MetadataSchema.optional(),
    providerBindings: z
      .array(
        z.object({
          provider: AdminPaymentProviderSchema,
          providerCouponId: z.string().trim().min(1).max(128).optional(),
          status: BillingProviderBindingStatusSchema.default('active'),
          metadata: MetadataSchema.optional(),
        }),
      )
      .max(8)
      .default([]),
  })
  .superRefine((value, ctx) => {
    // Apply-mode invariants (mirror the DB CHECK constraints, surfaced early
    // with actionable messages instead of a raw 23514).
    if (value.applyMode === 'code' && !value.code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'A coupon (code-mode) promotion requires a code.',
      });
    }
    if (value.applyMode === 'automatic') {
      if (value.code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['code'],
          message: 'An automatic sale must not have a code.',
        });
      }
      const hasScope =
        value.appliesPriceId != null ||
        value.appliesItemId != null ||
        value.appliesProductType != null;
      if (!hasScope) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['appliesProductType'],
          message:
            'An automatic sale must be scoped to a price, product, or product type.',
        });
      }
      if (value.maxRedemptionsPerUser != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxRedemptionsPerUser'],
          message:
            'Per-user redemption limits apply to coupons only, not automatic sales.',
        });
      }
    }
    const hasPercent = value.percentOffBps != null;
    const hasAmount = value.amountOffMinor != null;
    if (hasPercent === hasAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['percentOffBps'],
        message: 'Provide exactly one of percentOffBps or amountOffMinor.',
      });
    }
    if (hasAmount && !value.amountOffCurrency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amountOffCurrency'],
        message: 'Fixed-amount promotions require a currency.',
      });
    }
    if (
      value.durationType === 'repeating' &&
      (!value.durationCount || !value.durationUnit)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationCount'],
        message: 'Repeating promotions require duration count and unit.',
      });
    }
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'Promotion end time must be after start time.',
      });
    }
  });
export type CreateAdminBillingPromotionInput = z.infer<
  typeof CreateAdminBillingPromotionSchema
>;

export const BillingPromotionParamsSchema = z.object({
  promotionId: z.string().uuid(),
});
export type BillingPromotionParams = z.infer<
  typeof BillingPromotionParamsSchema
>;

export const UpdateAdminBillingPromotionSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: BillingPromotionStatusSchema.optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  maxRedemptions: z.coerce.number().int().min(1).nullable().optional(),
  maxRedemptionsPerUser: z.coerce.number().int().min(1).nullable().optional(),
  metadata: MetadataSchema.optional(),
  archived: z.coerce.boolean().optional(),
});
export type UpdateAdminBillingPromotionInput = z.infer<
  typeof UpdateAdminBillingPromotionSchema
>;

export const UpsertAdminBillingPromotionProviderBindingSchema = z.object({
  provider: AdminPaymentProviderSchema,
  providerCouponId: z.string().trim().min(1).max(128).optional(),
  status: BillingProviderBindingStatusSchema.default('active'),
  metadata: MetadataSchema.optional(),
});
export type UpsertAdminBillingPromotionProviderBindingInput = z.infer<
  typeof UpsertAdminBillingPromotionProviderBindingSchema
>;

// --- Vouchers (兑换券 / redemption codes) ----------------------------------

export const GenerateVouchersSchema = z
  .object({
    count: z.coerce.number().int().min(1).max(1000),
    grantType: z.enum(['compute_credits']).default('compute_credits'),
    computeCreditAmount: z.coerce.number().int().min(1).optional(),
    expiresAt: z.coerce.date().optional(),
    codePrefix: z
      .string()
      .trim()
      .min(1)
      .max(12)
      .regex(/^[A-Za-z0-9]+$/, 'Prefix must be alphanumeric.')
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.grantType === 'compute_credits' && !value.computeCreditAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['computeCreditAmount'],
        message: 'Compute-credit vouchers require a credit amount.',
      });
    }
  });
export type GenerateVouchersInput = z.infer<typeof GenerateVouchersSchema>;

export const ListVouchersQuerySchema = z.object({
  status: z.enum(['active', 'redeemed', 'void', 'expired']).optional(),
  batchId: z.string().uuid().optional(),
  q: z.string().trim().max(64).optional(),
});
export type ListVouchersQuery = z.infer<typeof ListVouchersQuerySchema>;

export const RedeemVoucherSchema = z.object({
  code: z.string().trim().min(3).max(40),
});
export type RedeemVoucherInput = z.infer<typeof RedeemVoucherSchema>;

// --- Credit campaigns (claimable free-credits giveaway) -------------------

export const CreateCreditCampaignSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
    computeCreditAmount: z.coerce.number().int().min(1),
    status: z.enum(['draft', 'active', 'paused', 'ended']).default('draft'),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    maxClaims: z.coerce.number().int().min(1).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'Campaign end time must be after start time.',
      });
    }
  });
export type CreateCreditCampaignInput = z.infer<
  typeof CreateCreditCampaignSchema
>;

export const ListCreditCampaignsQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
});
export type ListCreditCampaignsQuery = z.infer<
  typeof ListCreditCampaignsQuerySchema
>;

export const UpdateCreditCampaignStatusSchema = z.object({
  status: z.enum(['draft', 'active', 'paused', 'ended']),
});
export type UpdateCreditCampaignStatusInput = z.infer<
  typeof UpdateCreditCampaignStatusSchema
>;

export const CreditCampaignParamsSchema = z.object({
  campaignId: z.string().uuid(),
});
export type CreditCampaignParams = z.infer<typeof CreditCampaignParamsSchema>;

// --- Daily check-in (每日签到) --------------------------------------------

export const UpdateCheckInConfigSchema = z.object({
  enabled: z.coerce.boolean(),
  /** The streak reward cycle (credits by day); a 1-length cycle = flat reward. */
  rewards: z
    .array(z.coerce.number().int().min(1).max(1_000_000))
    .min(1)
    .max(31),
});
export type UpdateCheckInConfigInput = z.infer<
  typeof UpdateCheckInConfigSchema
>;

export const ListAdminBillingOrdersQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: BillingOrderStatusSchema.optional(),
  provider: AdminPaymentProviderSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminBillingOrdersQuery = z.infer<
  typeof ListAdminBillingOrdersQuerySchema
>;

export const ListAdminBillingRefundsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: BillingRefundStatusSchema.optional(),
  provider: AdminPaymentProviderSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminBillingRefundsQuery = z.infer<
  typeof ListAdminBillingRefundsQuerySchema
>;

export const ListAdminBillingProviderEventsQuerySchema = z.object({
  q: z.string().trim().min(1).max(160).optional(),
  status: BillingProviderEventStatusSchema.optional(),
  provider: AdminPaymentProviderSchema.optional(),
  eventType: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminBillingProviderEventsQuery = z.infer<
  typeof ListAdminBillingProviderEventsQuerySchema
>;

export const BillingProviderEventParamsSchema = z.object({
  eventId: z.string().uuid(),
});
export type BillingProviderEventParams = z.infer<
  typeof BillingProviderEventParamsSchema
>;

export const IgnoreAdminBillingProviderEventSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type IgnoreAdminBillingProviderEventInput = z.infer<
  typeof IgnoreAdminBillingProviderEventSchema
>;

const AdminBillingRefundAmountShape = {
  amountMinor: z.coerce.bigint().min(1n).optional(),
  percentBps: z.coerce.number().int().min(1).max(10000).optional(),
};

function validateRefundAmountChoice(
  value: {
    amountMinor?: bigint;
    percentBps?: number;
  },
  ctx: z.RefinementCtx,
) {
  if (value.amountMinor !== undefined && value.percentBps !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amountMinor'],
      message: 'Refund amount and percent cannot be supplied together.',
    });
  }
}

export const QuoteAdminBillingRefundSchema = z
  .object({
    ...AdminBillingRefundAmountShape,
    orderId: z.string().uuid(),
    reasonCode: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .superRefine(validateRefundAmountChoice);
export type QuoteAdminBillingRefundInput = z.infer<
  typeof QuoteAdminBillingRefundSchema
>;

export const CreateAdminBillingRefundSchema = z
  .object({
    ...AdminBillingRefundAmountShape,
    orderId: z.string().uuid(),
    reasonCode: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .transform((value) => value.toLowerCase()),
    operatorNote: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(8).max(180),
  })
  .superRefine((value, ctx) => {
    validateRefundAmountChoice(value, ctx);
    if (value.amountMinor === undefined && value.percentBps === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amountMinor'],
        message: 'Refund requires either amountMinor or percentBps.',
      });
    }
  });
export type CreateAdminBillingRefundInput = z.infer<
  typeof CreateAdminBillingRefundSchema
>;

export const ListAdminBillingLedgerJournalsQuerySchema = z.object({
  journalType: BillingLedgerJournalTypeSchema.optional(),
  provider: AdminPaymentProviderSchema.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminBillingLedgerJournalsQuery = z.infer<
  typeof ListAdminBillingLedgerJournalsQuerySchema
>;

export const ListAdminBillingSettlementsQuerySchema = z.object({
  provider: AdminPaymentProviderSchema.optional(),
  status: BillingSettlementStatusSchema.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAdminBillingSettlementsQuery = z.infer<
  typeof ListAdminBillingSettlementsQuerySchema
>;

export const ListAdminBillingReconciliationRunsQuerySchema = z.object({
  provider: AdminPaymentProviderSchema.optional(),
  status: BillingReconciliationStatusSchema.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAdminBillingReconciliationRunsQuery = z.infer<
  typeof ListAdminBillingReconciliationRunsQuerySchema
>;

export const BillingOrderParamsSchema = z.object({
  orderId: z.string().uuid(),
});
export type BillingOrderParams = z.infer<typeof BillingOrderParamsSchema>;

export const BillingSubscriptionParamsSchema = z.object({
  id: z.string().uuid(),
});
export type BillingSubscriptionParams = z.infer<
  typeof BillingSubscriptionParamsSchema
>;

// --- Membership grants (admin 手动开会员) ----------------------------------

const MembershipGrantShape = {
  /** Shape only — WHICH keys are grantable is decided against active
   *  billing_membership_plans rows in EntitlementService.grantComplimentary. An
   *  enum here was a second copy of the plan table and drifted from it. */
  planKey: PlanKeySchema,
  durationDays: z.coerce.number().int().min(1).max(366),
  /** Required — lands in grant metadata and the audit log. */
  note: z.string().trim().min(1).max(500),
} satisfies z.ZodRawShape;

export const GrantMembershipSchema = z.discriminatedUnion('subjectType', [
  z.object({
    ...MembershipGrantShape,
    subjectType: z.literal('user'),
    subjectId: z.string().trim().min(1).max(64),
  }),
  z.object({
    ...MembershipGrantShape,
    subjectType: z.literal('workspace'),
    subjectId: z.string().uuid(),
  }),
]);
export type GrantMembershipInput = z.infer<typeof GrantMembershipSchema>;

export const ListMembershipGrantsQuerySchema = z.discriminatedUnion(
  'subjectType',
  [
    z.object({
      subjectType: z.literal('user'),
      subjectId: z.string().trim().min(1).max(64),
    }),
    z.object({
      subjectType: z.literal('workspace'),
      subjectId: z.string().uuid(),
    }),
  ],
);
export type ListMembershipGrantsQuery = z.infer<
  typeof ListMembershipGrantsQuerySchema
>;

export const MembershipGrantParamsSchema = z.object({
  grantId: z.string().uuid(),
});
export type MembershipGrantParams = z.infer<typeof MembershipGrantParamsSchema>;

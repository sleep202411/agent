import { z } from 'zod';

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

export const CreateBillingCheckoutSchema = z.object({
  priceId: z.string().uuid(),
  provider: CheckoutPaymentProviderSchema.optional(),
  promotionCode: z.string().trim().min(3).max(64).optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  workspaceId: z.string().uuid().optional(),
  successUrl: z.string().trim().url().max(2048),
  backUrl: z.string().trim().url().max(2048),
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
  currency: WalletCurrencyTypeSchema.default('compute_point'),
  balanceKind: WalletBalanceKindSchema.default('consumable'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWalletLedgerQuery = z.infer<typeof ListWalletLedgerQuerySchema>;

export const BillingWalletAccountParamsSchema = z.object({
  accountId: z.string().uuid(),
});
export type BillingWalletAccountParams = z.infer<
  typeof BillingWalletAccountParamsSchema
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

export const CreateAdminUserWalletCreditSchema = z
  .object({
    userId: z.string().trim().min(1).max(64),
    idFormat: z.enum(['public', 'raw']).default('public'),
    currency: z.literal('compute_point').default('compute_point'),
    balanceKind: z.literal('consumable').default('consumable'),
    amount: z.coerce.bigint().min(1n),
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
  });
export type CreateAdminUserWalletCreditInput = z.infer<
  typeof CreateAdminUserWalletCreditSchema
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
  productType: z.enum(['membership_plan', 'team_membership_plan']).optional(),
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
  productType: z.enum(['membership_plan', 'team_membership_plan']).optional(),
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
  topupDiscountBps: z.coerce.number().int().min(0).max(10000).default(0),
  billingIntervalDefault: BillingPriceIntervalSchema.optional(),
  featureFlags: MetadataSchema.optional(),
  limits: MetadataSchema.optional(),
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
    .omit({ planKey: true })
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
    code: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .transform((value) => value.toUpperCase()),
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
    status: BillingPromotionStatusSchema.default('draft'),
    percentOffBps: z.coerce.number().int().min(1).max(10000),
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

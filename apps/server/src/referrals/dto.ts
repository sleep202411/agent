import { z } from 'zod';

// ─── Admin config (PATCH program / CRUD milestones) ─────────────────────

const PAYOUT_TYPES = [
  'cash',
  'points_compute',
  'points_community',
  'membership_compute',
  'membership_community',
  'membership_both',
] as const;

// A reward BUNDLE item is a SINGLE payout — never membership_both (that is two
// items: membership_compute + membership_community). A tier grants ALL items.
export const REWARD_ITEM_KINDS = [
  'cash',
  'points_compute',
  'points_community',
  'membership_compute',
  'membership_community',
] as const;

/** One reward inside a tier's bundle. */
export const ReferralRewardItemSchema = z.object({
  kind: z.enum(REWARD_ITEM_KINDS),
  /** Cash minor units OR point count (per kind); 0 for membership. */
  amountMinor: z.number().int().min(0).default(0),
  /** Membership duration in days; 0 for cash/points. */
  days: z.number().int().min(0).max(3650).default(0),
});
export type ReferralRewardItemInput = z.infer<typeof ReferralRewardItemSchema>;

/** PATCH /admin/referrals/program — tune the program. All fields optional. */
export const UpdateReferralProgramSchema = z
  .object({
    enabled: z.boolean(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    holdDays: z.number().int().min(0).max(365),
    rewardPerReferralMinor: z.number().int().min(0),
    maxRewardedReferees: z.number().int().min(0),
    /** Default consumption-commission rate, bps of order actual-paid (0 = off). */
    commissionBps: z.number().int().min(0).max(10000),
    /** Anti-fraud: max referee account age (hours) at attribution; 0 = no limit. */
    refereeMaxAccountAgeHours: z
      .number()
      .int()
      .min(0)
      .max(24 * 365),
    inviteeBenefitTitle: z.string().max(120).nullable(),
    inviteeBenefitDetail: z.string().max(400).nullable(),
    inviteeBenefitMinor: z.number().int().min(0),
    inviteeBenefitExpiresInDays: z.number().int().min(0).nullable(),
    /** Invitee welcome-perk BUNDLE (社区/算力积分, 会员, 现金; multi-item).
     *  Empty array = no perk. Replaces the whole bundle when present. */
    inviteeBenefitItems: z.array(ReferralRewardItemSchema),
  })
  .partial();
export type UpdateReferralProgramInput = z.infer<
  typeof UpdateReferralProgramSchema
>;

/** Shared field shape for create/update of a milestone (阶梯奖励) tier. */
const ReferralMilestoneFieldsSchema = z.object({
  inviteeThreshold: z.number().int().min(1),
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().max(400).default(''),
  rank: z.number().int().default(0),
  // The reward BUNDLE — each tier grants ALL items. Source of truth for the
  // new admin. When present, the server derives the legacy single-reward
  // columns below from items[0] (primary) so the shipped mobile keeps working.
  rewardItems: z.array(ReferralRewardItemSchema).min(1).optional(),
  // Legacy single-reward fields. Optional now. Accepted ALONE for backward
  // compat (old clients) → the server lifts them into a one-item bundle.
  payoutType: z.enum(PAYOUT_TYPES).optional(),
  rewardMinor: z.number().int().min(0).default(0),
  payoutDays: z.number().int().min(0).max(3650).default(0),
});

/** POST /admin/referrals/milestones — add a tier. */
export const CreateReferralMilestoneSchema =
  ReferralMilestoneFieldsSchema.refine(
    (v) => (v.rewardItems?.length ?? 0) > 0 || !!v.payoutType,
    { message: 'rewardItems or payoutType is required' },
  );
export type CreateReferralMilestoneInput = z.infer<
  typeof CreateReferralMilestoneSchema
>;

/** PATCH /admin/referrals/milestones/:id — edit a tier. All fields optional. */
export const UpdateReferralMilestoneSchema =
  ReferralMilestoneFieldsSchema.partial();
export type UpdateReferralMilestoneInput = z.infer<
  typeof UpdateReferralMilestoneSchema
>;

/** POST /admin/referrals/commission-rates — create/update a per-user rate
 *  (消费返佣白名单). A row overrides the program default; 0 = explicitly off. */
export const UpsertReferralCommissionRateSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  commissionBps: z.number().int().min(0).max(10000),
  note: z.string().trim().max(200).nullable().optional(),
});
export type UpsertReferralCommissionRateInput = z.infer<
  typeof UpsertReferralCommissionRateSchema
>;

// ─── Dashboard response (server-built; mirrors the mobile contract) ─────

export type ReferralRewardStatus =
  | 'pending'
  | 'qualified'
  | 'accrued'
  | 'reversed'
  | 'voided'
  | 'paid_out';

export type ReferralPayoutType =
  | 'cash'
  | 'points_compute'
  | 'points_community'
  | 'membership_compute'
  | 'membership_community'
  | 'membership_both';

/** A single reward inside a bundle — never membership_both. */
export type ReferralRewardItemKind =
  | 'cash'
  | 'points_compute'
  | 'points_community'
  | 'membership_compute'
  | 'membership_community';

export interface ReferralRewardItemDTO {
  /** Cash currency snapshotted when earned; null for non-cash benefits. */
  currency?: string | null;
  kind: ReferralRewardItemKind;
  /** Cash minor units OR point count, as a string (JSON BigInt safe). */
  amountMinor: string;
  /** Membership reward days (0 for cash/points). */
  days: number;
}

export interface ReferralRewardDTO {
  id: string;
  title: string;
  subtitle?: string;
  payoutType: ReferralPayoutType;
  /** Cash minor units OR point count, as a string (JSON BigInt safe). */
  amountMinor: string;
  /** Membership reward days (0 for cash/points). */
  days: number;
  /** Cash currency; null for points / membership. */
  currency: string | null;
  status: ReferralRewardStatus;
  /** Accrued + out of the hold window → the user can tap 领取 (claim). */
  claimable: boolean;
  createdAt: string;
  availableAt: string | null;
  /** Full reward bundle (one+ items). ADDITIVE — older mobile builds read the
   * flat payoutType/amountMinor/days above; the next build reads this. */
  items?: ReferralRewardItemDTO[];
}

export interface ReferralMilestoneDTO {
  id: string;
  title: string;
  detail: string;
  status: 'complete' | 'active' | 'locked';
  /** Qualified-referee count that unlocks this tier. */
  inviteeThreshold: number;
  payoutType: ReferralPayoutType;
  /** Cash minor units OR point count (per payoutType). */
  amountMinor: string;
  /** Membership reward days (0 for cash/points). */
  days: number;
  currency: string | null;
  /** Full reward bundle for this tier (ADDITIVE — see ReferralRewardDTO.items). */
  items?: ReferralRewardItemDTO[];
}

export interface ReferralDashboardDTO {
  cashTotals?: Array<{
    currency: string | null;
    pendingMinor: string;
    confirmedMinor: string;
    reversedMinor: string;
  }>;
  programAvailable: boolean;
  inviteCode: string | null;
  inviteUrl: string | null;
  currency: string | null;
  totals: {
    pendingMinor: string;
    confirmedMinor: string;
    reversedMinor: string;
    inviteeCount: number;
  };
  inviteeBenefit: {
    title: string | null;
    detail: string | null;
    expiresInDays: number | null;
  };
  milestones: ReferralMilestoneDTO[];
  rewards: ReferralRewardDTO[];
}

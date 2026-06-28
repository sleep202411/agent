import { z } from 'zod';

/** POST /aurora/referrals/claim — the invited user attributes themselves. */
export const ClaimReferralSchema = z.object({
  code: z.string().trim().min(1).max(32),
});
export type ClaimReferralInput = z.infer<typeof ClaimReferralSchema>;

// ─── Admin config (PATCH program / CRUD milestones) ─────────────────────

const PAYOUT_TYPES = [
  'cash',
  'points_compute',
  'points_community',
  'membership_compute',
  'membership_community',
  'membership_both',
] as const;

/** PATCH /admin/referrals/program — tune the program. All fields optional. */
export const UpdateReferralProgramSchema = z
  .object({
    enabled: z.boolean(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    qualifyEvent: z.enum(['signup', 'first_purchase']),
    holdDays: z.number().int().min(0).max(365),
    rewardPerReferralMinor: z.number().int().min(0),
    maxRewardedReferees: z.number().int().min(0),
    inviteeBenefitTitle: z.string().max(120).nullable(),
    inviteeBenefitDetail: z.string().max(400).nullable(),
    inviteeBenefitMinor: z.number().int().min(0),
    inviteeBenefitExpiresInDays: z.number().int().min(0).nullable(),
  })
  .partial();
export type UpdateReferralProgramInput = z.infer<
  typeof UpdateReferralProgramSchema
>;

/** POST /admin/referrals/milestones — add a tier. */
export const CreateReferralMilestoneSchema = z.object({
  inviteeThreshold: z.number().int().min(1),
  payoutType: z.enum(PAYOUT_TYPES),
  rewardMinor: z.number().int().min(0).default(0),
  payoutDays: z.number().int().min(0).max(3650).default(0),
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().max(400).default(''),
  rank: z.number().int().default(0),
});
export type CreateReferralMilestoneInput = z.infer<
  typeof CreateReferralMilestoneSchema
>;

/** PATCH /admin/referrals/milestones/:id — edit a tier. */
export const UpdateReferralMilestoneSchema =
  CreateReferralMilestoneSchema.partial();
export type UpdateReferralMilestoneInput = z.infer<
  typeof UpdateReferralMilestoneSchema
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
}

export interface ReferralDashboardDTO {
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

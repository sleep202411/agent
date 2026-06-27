import { z } from 'zod';

/** POST /aurora/referrals/claim — the invited user attributes themselves. */
export const ClaimReferralSchema = z.object({
  code: z.string().trim().min(1).max(32),
});
export type ClaimReferralInput = z.infer<typeof ClaimReferralSchema>;

// ─── Dashboard response (server-built; mirrors the mobile contract) ─────

export type ReferralRewardStatus =
  | 'pending'
  | 'qualified'
  | 'accrued'
  | 'reversed'
  | 'voided'
  | 'paid_out';

export interface ReferralRewardDTO {
  id: string;
  title: string;
  subtitle?: string;
  /** Minor units (1/100), as a string to survive JSON BigInt. */
  amountMinor: string;
  currency: string;
  status: ReferralRewardStatus;
  createdAt: string;
  availableAt: string | null;
}

export interface ReferralMilestoneDTO {
  id: string;
  title: string;
  detail: string;
  status: 'complete' | 'active' | 'locked';
  rewardLabel?: string;
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

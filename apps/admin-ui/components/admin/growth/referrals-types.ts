// 邀请奖励 (referral program) admin types. Mirrors the Nest server contract.
//
// IMPORTANT money/units detail: every *Minor field comes back from the server
// as a STRING (BigInt-serialized), but the PATCH/POST bodies expect NUMBERS.
// The form parses the string for display and sends Number(...) on submit.
// minor units = cents (积分 ≡ US cent).

export type PayoutType =
  | "cash"
  | "points_compute"
  | "points_community"
  | "membership_compute"
  | "membership_community"
  | "membership_both";

export type ReferralQualifyEvent = "signup" | "first_purchase";

export type ReferralMilestoneRow = {
  id: string;
  inviteeThreshold: number;
  payoutType: PayoutType;
  /** BigInt string; parse to Number for the form, send Number() on submit. */
  rewardMinor: string;
  payoutDays: number;
  title: string;
  detail: string;
  rank: number;
  archivedAt: string | null;
};

export type ReferralConfig = {
  key: string;
  enabled: boolean;
  currency: string | null;
  qualifyEvent: ReferralQualifyEvent;
  holdDays: number;
  /** BigInt string. */
  rewardPerReferralMinor: string;
  maxRewardedReferees: number;
  inviteeBenefitTitle: string | null;
  inviteeBenefitDetail: string | null;
  /** BigInt string. */
  inviteeBenefitMinor: string;
  inviteeBenefitExpiresInDays: number | null;
  milestones: ReferralMilestoneRow[];
};

export type ReferralProgramData = ReferralConfig | null;

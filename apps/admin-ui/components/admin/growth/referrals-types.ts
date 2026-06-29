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

// A single reward inside a tier's bundle — never membership_both (express that
// as two items: membership_compute + membership_community).
export type RewardItemKind =
  | "cash"
  | "points_compute"
  | "points_community"
  | "membership_compute"
  | "membership_community";

export type RewardItem = {
  kind: RewardItemKind;
  /** BigInt string; cash minor OR point count. Number() on submit. */
  amountMinor: string;
  /** Membership days (0 for cash/points). */
  days: number;
};

export type ReferralQualifyEvent = "signup" | "first_purchase";

export type ReferralMilestoneRow = {
  id: string;
  inviteeThreshold: number;
  /** Legacy single-reward columns (mirror of the bundle's primary item). */
  payoutType: PayoutType;
  /** BigInt string; parse to Number for the form, send Number() on submit. */
  rewardMinor: string;
  payoutDays: number;
  /** The full reward bundle (one tier → many items). */
  rewardItems?: RewardItem[];
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

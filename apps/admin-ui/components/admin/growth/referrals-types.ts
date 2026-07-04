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
  /** 消费返佣默认比例，万分比（bps，3000 = 30%）；0 = 关闭（仅白名单）。 */
  commissionBps: number;
  /** 防刷：归因时被邀请人账号最大年龄（小时）；0 = 不限。 */
  refereeMaxAccountAgeHours: number;
  /** 只读：赠送积分类奖励的有效期天数（平台级常量，非本页可改）。 */
  giftedPointsValidityDays: number;
  inviteeBenefitTitle: string | null;
  inviteeBenefitDetail: string | null;
  /** BigInt string (legacy mirror of the primary invitee-benefit item). */
  inviteeBenefitMinor: string;
  inviteeBenefitExpiresInDays: number | null;
  /** Invitee welcome-perk bundle (社区/算力积分, 会员, 现金; 可多项). Empty = no perk. */
  inviteeBenefitItems: RewardItem[];
  milestones: ReferralMilestoneRow[];
};

/** A user matched by the whitelist dialog's email/phone/id lookup. */
export type UserLookupResult = {
  userId: string;
  nickName: string | null;
  email: string | null;
  phone: string | null;
};

export type ReferralProgramData = ReferralConfig | null;

/** 消费返佣白名单行（按用户覆写默认比例；0 = 对该用户显式关闭）。 */
export type CommissionRateRow = {
  id: string;
  userId: string;
  commissionBps: number;
  note: string | null;
  /** Java 侧展示信息（bridge 不可用时为 null）。 */
  nickName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

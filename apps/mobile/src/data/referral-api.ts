import { api, ApiRequestError } from "@/lib/api-client";

export type ReferralRewardStatus =
  | "pending"
  | "qualified"
  | "accrued"
  | "reversed"
  | "voided"
  | "paid_out";

export type ReferralPayoutType =
  | "cash"
  | "points_compute"
  | "points_community"
  | "membership_compute"
  | "membership_community"
  | "membership_both";

export interface ReferralReward {
  id: string;
  title: string;
  subtitle?: string;
  payoutType: ReferralPayoutType;
  /** Cash minor units OR point count (per payoutType). */
  amountMinor: string;
  /** Membership reward days (0 for cash/points). */
  days: number;
  currency: string | null;
  status: ReferralRewardStatus;
  /** Accrued + out of hold → show a 领取 button. */
  claimable: boolean;
  createdAt?: string;
  availableAt?: string | null;
}

export interface ReferralMilestone {
  id: string;
  title: string;
  detail: string;
  status: "complete" | "active" | "locked";
  rewardLabel?: string;
}

export interface ReferralDashboard {
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
  milestones: ReferralMilestone[];
  rewards: ReferralReward[];
}

type ReferralDashboardDto = Partial<ReferralDashboard> & {
  totals?: Partial<ReferralDashboard["totals"]>;
  inviteeBenefit?: Partial<ReferralDashboard["inviteeBenefit"]>;
  rewards?: Partial<ReferralReward>[];
  milestones?: Partial<ReferralMilestone>[];
};

const EMPTY_REFERRAL_DASHBOARD: ReferralDashboard = {
  programAvailable: false,
  inviteCode: null,
  inviteUrl: null,
  currency: null,
  totals: {
    pendingMinor: "0",
    confirmedMinor: "0",
    reversedMinor: "0",
    inviteeCount: 0,
  },
  inviteeBenefit: {
    title: null,
    detail: null,
    expiresInDays: null,
  },
  milestones: [],
  rewards: [],
};

export async function fetchReferralDashboard(): Promise<ReferralDashboard> {
  try {
    // auroraBaseUrl already ends in /aurora, so the path must NOT repeat it.
    const dto = await api.get<ReferralDashboardDto>("/referrals/me", {
      service: "aurora",
    });
    return normalizeDashboard(dto);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.code === "HTTP_404")) {
      return EMPTY_REFERRAL_DASHBOARD;
    }
    throw error;
  }
}

/**
 * Claim an invite code — the invited user attributes themselves as the referee.
 * Idempotent server-side (one attribution per referee, for life).
 */
export async function claimReferral(code: string): Promise<{ status: string }> {
  return api.post<{ status: string }>("/referrals/claim", {
    service: "aurora",
    data: { code },
  });
}

/** Claim (领取) an accrued reward — the server grants it by type + marks paid_out. */
export async function claimReferralReward(rewardId: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/referrals/rewards/${rewardId}/claim`, {
    service: "aurora",
  });
}

function normalizeDashboard(dto: ReferralDashboardDto | null | undefined): ReferralDashboard {
  if (!dto) return EMPTY_REFERRAL_DASHBOARD;

  return {
    programAvailable: dto.programAvailable ?? true,
    inviteCode: stringOrNull(dto.inviteCode),
    inviteUrl: stringOrNull(dto.inviteUrl),
    currency: currencyOrNull(dto.currency),
    totals: {
      pendingMinor: amountString(dto.totals?.pendingMinor),
      confirmedMinor: amountString(dto.totals?.confirmedMinor),
      reversedMinor: amountString(dto.totals?.reversedMinor),
      inviteeCount: numberOrZero(dto.totals?.inviteeCount),
    },
    inviteeBenefit: {
      title: stringOrNull(dto.inviteeBenefit?.title),
      detail: stringOrNull(dto.inviteeBenefit?.detail),
      expiresInDays:
        typeof dto.inviteeBenefit?.expiresInDays === "number"
          ? dto.inviteeBenefit.expiresInDays
          : null,
    },
    milestones: (dto.milestones ?? []).flatMap((milestone, index) => {
      const title = stringOrNull(milestone.title);
      const detail = stringOrNull(milestone.detail);
      if (!title || !detail) return [];
      return [
        {
          id: stringOrNull(milestone.id) ?? `milestone-${index}`,
          title,
          detail,
          status:
            milestone.status === "complete" ||
            milestone.status === "active" ||
            milestone.status === "locked"
              ? milestone.status
              : "locked",
          rewardLabel: stringOrNull(milestone.rewardLabel) ?? undefined,
        },
      ];
    }),
    rewards: (dto.rewards ?? []).flatMap((reward, index) => {
      const title = stringOrNull(reward.title);
      if (!title) return [];
      return [
        {
          id: stringOrNull(reward.id) ?? `reward-${index}`,
          title,
          subtitle: stringOrNull(reward.subtitle) ?? undefined,
          payoutType: isPayoutType(reward.payoutType) ? reward.payoutType : "cash",
          amountMinor: amountString(reward.amountMinor),
          days: numberOrZero(reward.days),
          currency: currencyOrNull(reward.currency),
          status: isRewardStatus(reward.status) ? reward.status : "pending",
          claimable: reward.claimable === true,
          createdAt: stringOrNull(reward.createdAt) ?? undefined,
          availableAt: stringOrNull(reward.availableAt),
        },
      ];
    }),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function currencyOrNull(value: unknown): string | null {
  const currency = stringOrNull(value);
  return currency ? currency.toUpperCase() : null;
}

function amountString(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return value.trim();
  return "0";
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isPayoutType(value: unknown): value is ReferralPayoutType {
  return (
    value === "cash" ||
    value === "points_compute" ||
    value === "points_community" ||
    value === "membership_compute" ||
    value === "membership_community" ||
    value === "membership_both"
  );
}

function isRewardStatus(value: unknown): value is ReferralRewardStatus {
  return (
    value === "pending" ||
    value === "qualified" ||
    value === "accrued" ||
    value === "reversed" ||
    value === "voided" ||
    value === "paid_out"
  );
}

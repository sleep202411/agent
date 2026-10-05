/**
 * Fetch helpers for the referral Nest endpoints at `/aurora/referrals/*`.
 *
 * Contract: the referrals controller wraps responses in a `{ code, data }`
 * envelope (unlike the bare-JSON crew endpoints), with real HTTP status
 * codes on failure (`{ statusCode, message }`). Bare `fetch()` per the
 * feature-colocation convention; cookie auth rides `credentials:"include"`.
 *
 * The reward model is TYPED (see ReferralPayoutType): the server returns raw
 * typed values (amountMinor / days / currency) plus display strings it owns
 * (`title` / `subtitle` / milestone `title` / `detail`). Render the server
 * strings verbatim — this page exists so reward copy can never drift from
 * the configured ladder again.
 */

const BASE = "/aurora";

export type ReferralPayoutType =
  | "cash"
  | "points_compute"
  | "points_community"
  | "membership_compute"
  | "membership_community"
  | "membership_both";

export type ReferralRewardStatus =
  | "pending"
  | "qualified"
  | "accrued"
  | "reversed"
  | "voided"
  | "paid_out";

export type ReferralMilestoneStatus = "complete" | "active" | "locked";

export interface ReferralRewardItem {
  currency?: string | null;
  kind: Exclude<ReferralPayoutType, "membership_both">;
  amountMinor: string;
  days: number;
}

export interface ReferralMilestone {
  items?: ReferralRewardItem[];
  id: string;
  /** Admin-authored display strings — render verbatim. */
  title: string;
  detail: string;
  /** Server-computed from QUALIFIED referees — do not recompute client-side. */
  status: ReferralMilestoneStatus;
  inviteeThreshold: number;
  payoutType: ReferralPayoutType;
  /** Cash minor units for `cash`, raw point count for `points_*`, 0 otherwise. */
  amountMinor: string;
  /** Membership days for `membership_*`, 0 otherwise. */
  days: number;
  currency: string | null;
}

export interface ReferralReward {
  items?: ReferralRewardItem[];
  id: string;
  /** Server-owned display strings — render verbatim. */
  title: string;
  subtitle?: string;
  payoutType: ReferralPayoutType;
  amountMinor: string;
  days: number;
  currency: string | null;
  status: ReferralRewardStatus;
  /** Server-computed (accrued AND past the hold window). */
  claimable: boolean;
  createdAt?: string;
  availableAt?: string | null;
}

export interface ReferralDashboard {
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
    /** Cash-payout rewards only (typed rewards are excluded by design). */
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

/** Mirror of the mobile client's fallback: a 404 from /referrals/me means
 *  the program was never provisioned — an empty dashboard, not an error. */
export const EMPTY_REFERRAL_DASHBOARD: ReferralDashboard = {
  programAvailable: false,
  inviteCode: null,
  inviteUrl: null,
  currency: null,
  totals: { pendingMinor: "0", confirmedMinor: "0", reversedMinor: "0", inviteeCount: 0 },
  inviteeBenefit: { title: null, detail: null, expiresInDays: null },
  milestones: [],
  rewards: [],
};

export class ReferralApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? `Referral API error ${status}`
    );
    this.name = "ReferralApiError";
  }
}

async function call<T>(method: string, path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body (proxy error page etc.) — fall through to status check.
  }

  if (!res.ok) {
    throw new ReferralApiError(res.status, body);
  }

  // `{ code, data }` envelope; tolerate a bare payload defensively.
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export async function fetchReferralDashboard(signal?: AbortSignal): Promise<ReferralDashboard> {
  try {
    return await call<ReferralDashboard>("GET", "/referrals/me", signal);
  } catch (error) {
    if (error instanceof ReferralApiError && error.status === 404) {
      return EMPTY_REFERRAL_DASHBOARD;
    }
    throw error;
  }
}

export async function claimReferralReward(rewardId: string): Promise<{ status: string }> {
  return call<{ status: string }>(
    "POST",
    `/referrals/rewards/${encodeURIComponent(rewardId)}/claim`
  );
}

export const referralKeys = {
  dashboard: ["referral", "dashboard"] as const,
  account: (accountId: string) => ["referral", "dashboard", accountId] as const,
};

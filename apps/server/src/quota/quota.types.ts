/**
 * Public quota types — shared between QuotaService, controller, and
 * later the WS gateway. Kept thin so the consume / peek API can stay
 * stable across phases without rippling type churn.
 *
 * Since the membership-benefits unification, QuotaService no longer
 * owns any limit numbers: every method receives a `QuotaProfile`
 * resolved from the PostgreSQL entitlement snapshot (plan row
 * `benefits` JSONB — see EntitlementService.quotaProfileFor). The
 * coarse `Tier` label survives only as a display/log label carried on
 * plan benefits (`quotaTier`).
 */
import type { QuotaDimension } from '@prisma/client';

export type { QuotaDimension };

/** Coarse quota-tier label. Display/log label only — never a limits key. */
export const QUOTA_TIERS = ['Free', 'VIP1', 'VIP2', 'VIP3'] as const;
export type Tier = (typeof QUOTA_TIERS)[number];

/**
 * Per-dimension caps resolved from the entitlement snapshot.
 * `Infinity` = no daily cap (queue concurrency is the real ceiling).
 */
export interface QuotaLimits {
  imageDaily: number;
  videoDaily: number;
  chatDaily: number;
  workflowDaily: number;
  uploadMB: number;
  chatPerMinute: number;
}

/** One plan's quota identity: key, coarse label, resolved caps. */
export interface QuotaPlanProfile {
  planKey: string;
  tier: Tier;
  limits: QuotaLimits;
}

/**
 * Snapshot-derived quota admission context. `upgrade` is the next
 * purchasable plan by billing_membership_plans rank ordering (same
 * subject axis), used for the 429 upgrade suggestion — `null` when the
 * subject is already on the highest sold plan.
 */
export interface QuotaProfile extends QuotaPlanProfile {
  upgrade: QuotaPlanProfile | null;
}

/** Map a Redis quota dimension onto its daily cap in a limit set. */
export function quotaLimitFor(
  limits: QuotaLimits,
  dimension: QuotaDimension,
): number {
  switch (dimension) {
    case 'image':
      return limits.imageDaily;
    case 'chat':
      return limits.chatDaily;
    case 'workflow':
      return limits.workflowDaily;
    case 'upload':
      return limits.uploadMB;
  }
}

/**
 * One dimension's snapshot. `limit === Infinity` is the unlimited case;
 * `remaining` is `Infinity` minus used but `percent` is reported as 0
 * (UI renders "∞" badge instead of progress bar).
 */
export interface QuotaSnapshot {
  dimension: QuotaDimension;
  used: number;
  limit: number;
  remaining: number;
  /** Float 0..100. Always 0 for Infinity-limited dimensions. */
  percent: number;
  /** ISO timestamp of when the window resets (next UTC midnight). */
  resetAt: string;
}

export interface QuotaPeek {
  tier: Tier;
  /** Each consumable dimension's snapshot. */
  dimensions: Record<QuotaDimension, QuotaSnapshot>;
  /** Chat per-minute rate limit (separate from daily). */
  chatPerMinute: { limit: number; remaining: number; resetAt: string };
}

export interface ConsumeArgs {
  userId: string;
  /** Snapshot-resolved limits + upgrade suggestion for this subject. */
  profile: QuotaProfile;
  dimension: QuotaDimension;
  /** Default 1. Upload uses MB-scaled costs. */
  cost?: number;
  /** Dedup key. Same key in same 24h = no-op. */
  idempotencyKey?: string;
  /**
   * Domain-owned durable operations may keep the Redis record until their
   * PostgreSQL coordinator reaches a terminal state. The caller must then
   * invoke `finalizeIdempotencyFor` to put the key back on a bounded TTL.
   */
  idempotencyTtlSeconds?: number | 'persistent';
  /** Exact UTC counter windows. Durable domains persist these with the debit. */
  window?: QuotaWindow;
  /** Paid state machines must fail closed when Redis cannot decide. */
  failureMode?: 'open' | 'closed';
  reason: string;
  /** Forensic metadata bag — passed through to audit log. */
  metadata?: Record<string, unknown>;
}

export interface QuotaWindow {
  dayBucket: string;
  monthBucket: string;
}

export interface QuotaFailurePolicy {
  /** Paid admission fails closed; observational/general UI paths fail open. */
  failureMode: 'open' | 'closed';
}

export interface ConsumeOk {
  ok: true;
  dimension: QuotaDimension;
  /** New used value AFTER this consume. */
  used: number;
  limit: number;
  remaining: number;
  /** True if this op was deduped (idempotencyKey match). */
  deduped: boolean;
}

export interface ConsumeRejected {
  ok: false;
  reason: 'quota_exceeded' | 'rate_limited';
  dimension: QuotaDimension;
  used: number;
  limit: number;
  /** ISO. Tells the UI when it resets — "明日 00:00" or "1 min" for rate limit. */
  resetAt: string;
  /**
   * Upgrade suggestion derived from billing_membership_plans rank
   * ordering. `nextTier` keeps the historical wire name (coarse label);
   * `nextPlanKey` identifies the actual plan; `nextTierLimit` is that
   * plan's cap on this dimension (`-1` = unlimited).
   */
  nextTier: Tier | null;
  nextPlanKey: string | null;
  nextTierLimit: number | null;
}

export type ConsumeResult = ConsumeOk | ConsumeRejected;

/**
 * Request-local proof that this invocation, rather than an earlier retry,
 * actually incremented Redis. Refund paths must require this receipt.
 */
export interface QuotaDebitReceipt {
  userId: string;
  /** Plan profile the debit was priced under; refunds reuse its limits. */
  profile: QuotaPlanProfile;
  dimension: QuotaDimension;
  cost: number;
  idempotencyKey: string;
  /** False for a dedup hit and for the explicit Redis fail-open path. */
  debited: boolean;
}

export interface RefundArgs {
  userId: string;
  idempotencyKey: string;
  /** Optional — defaults to logging "refund_unknown" in audit. */
  reason?: string;
}

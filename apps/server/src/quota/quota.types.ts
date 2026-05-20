/**
 * Public quota types — shared between QuotaService, controller, and
 * later the WS gateway. Kept thin so the consume / peek API can stay
 * stable across phases without rippling type churn.
 */
import type { QuotaDimension } from '@prisma/client';
import type { Tier } from './tiers.config';

export type { QuotaDimension };

/**
 * One dimension's snapshot. `limit === Infinity` is the VIP3 case;
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
  tier: Tier;
  dimension: QuotaDimension;
  /** Default 1. Upload uses MB-scaled costs. */
  cost?: number;
  /** Dedup key. Same key in same 24h = no-op. */
  idempotencyKey?: string;
  reason: string;
  /** Forensic metadata bag — passed through to audit log. */
  metadata?: Record<string, unknown>;
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
  /** Next tier suggestion + that tier's limit on this dimension. */
  nextTier: Tier | null;
  nextTierLimit: number | null;
}

export type ConsumeResult = ConsumeOk | ConsumeRejected;

export interface RefundArgs {
  userId: string;
  idempotencyKey: string;
  /** Optional — defaults to logging "refund_unknown" in audit. */
  reason?: string;
}

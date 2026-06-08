/**
 * Per-tier daily quotas + queue priority.
 *
 * Design notes (see also chat docs `Quota System — 产品级设计`):
 *
 *   - `Free` / `VIP1` / `VIP2` have hard daily caps. Going over the cap
 *     returns 429 with structured payload (Phase 5) so the UI can
 *     render an UpgradeDialog with the next tier's numbers.
 *
 *   - `VIP3` is sold as "unlimited" — daily caps are `Infinity`. The
 *     real upper bound is the server's BullMQ concurrency: even with
 *     N concurrent VIP3 users hammering the image queue, only
 *     IMAGE_WORKER_CONCURRENCY images execute simultaneously across
 *     the cluster (so $/month has a queue-imposed ceiling).
 *
 *   - VIP3 still has a per-minute chat rate limit to stop script
 *     abuse (a human can't sustainably send >60 messages/min).
 *
 *   - Upload is a hard cap for ALL tiers including VIP3 — uploaded
 *     files become permanent OSS storage cost, which the queue can't
 *     throttle. A single VIP3 spamming 1TB of video would blow the
 *     OSS bill out independently of generation queues.
 *
 *   - Priority is BullMQ's `priority` field; smaller value = higher
 *     priority. Free workflows wait behind VIP3 when the queue is
 *     contended (Phase 6).
 *
 * Numbers below are starting guesses. Phase 1 observation will reveal
 * the actual distribution and we'll adjust; this file is the only
 * place to edit.
 */

export type Tier = 'Free' | 'VIP1' | 'VIP2' | 'VIP3';

export interface TierLimits {
  /** Daily caps. `Infinity` = no daily cap; queue is the real ceiling. */
  image: number;
  chat: number;
  workflow: number;
  uploadMB: number;
  /** Chat per-minute rate limit. Applies to ALL tiers — even VIP3. */
  chatPerMinute: number;
  /** BullMQ priority — smaller = served first when queue is contended. */
  priority: number;
}

export const TIERS: Record<Tier, TierLimits> = {
  Free: {
    image: 5,
    chat: 30,
    workflow: 3,
    uploadMB: 100,
    chatPerMinute: 20,
    priority: 10,
  },
  VIP1: {
    image: 30,
    chat: 200,
    workflow: 10,
    uploadMB: 1024,
    chatPerMinute: 40,
    priority: 5,
  },
  VIP2: {
    image: 100,
    chat: 500,
    workflow: 30,
    uploadMB: 5_120,
    chatPerMinute: 60,
    priority: 3,
  },
  VIP3: {
    image: Number.POSITIVE_INFINITY,
    chat: Number.POSITIVE_INFINITY,
    workflow: Number.POSITIVE_INFINITY,
    uploadMB: 30_720,
    chatPerMinute: 60,
    priority: 1,
  },
};

/** Tier rank (lower = lower) for upgrade-suggestion logic. */
const RANK: Record<Tier, number> = { Free: 0, VIP1: 1, VIP2: 2, VIP3: 3 };

export function tierRank(tier: string | null | undefined): number {
  if (!tier) return RANK.Free;
  return RANK[tier as Tier] ?? RANK.Free;
}

/**
 * Coerce arbitrary `userLevel` string from auth → known Tier.
 *
 * Java's content service emits the raw level it has on file, and
 * AuthService already uppercases it. We accept a wide range of
 * historical shapes here so a tier mismatch never quietly drops a
 * paying user back to Free quotas (which would be a real billing
 * incident, not just a UX glitch):
 *
 *   "VIP1" / "VIP2" / "VIP3" / "FREE"   — canonical, exact
 *   "Vip1", "vip2", "free", "Free"      — case differences
 *   "V1" / "V2" / "V3"                  — short aliases
 *   "1" / "2" / "3" / "0"               — numeric (0 = Free)
 *   "PRO" / "ENTERPRISE"                — legacy auth.types.ts hints
 *   "VIP" / "PAID"                      — generic paid → assume VIP1
 *
 * Anything truly unknown logs at module load (via the caller) and
 * falls back to Free. Add new mappings here, not at call sites.
 */
const NUMERIC_TO_TIER: Record<string, Tier> = {
  '0': 'Free',
  '1': 'VIP1',
  '2': 'VIP2',
  '3': 'VIP3',
};

const ALIAS_TO_TIER: Record<string, Tier> = {
  // Canonical / case variants
  FREE: 'Free',
  VIP1: 'VIP1',
  VIP2: 'VIP2',
  VIP3: 'VIP3',
  // Short aliases occasionally seen in Java payloads
  V1: 'VIP1',
  V2: 'VIP2',
  V3: 'VIP3',
  // Legacy `userLevel` examples from auth.types.ts JSDoc
  PRO: 'VIP1',
  ENTERPRISE: 'VIP2',
  // Bare "VIP" / "PAID" — at least give a paying tier rather than Free
  VIP: 'VIP1',
  PAID: 'VIP1',
};

export function normalizeTier(input: string | null | undefined): Tier {
  if (!input) return 'Free';
  const trimmed = String(input).trim();
  if (!trimmed) return 'Free';
  const upper = trimmed.toUpperCase();
  if (upper in ALIAS_TO_TIER) return ALIAS_TO_TIER[upper];
  if (upper in NUMERIC_TO_TIER) return NUMERIC_TO_TIER[upper];
  // Try parsing a bare integer — Java sometimes ships level as a number.
  const asInt = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(asInt) && asInt >= 0 && asInt <= 3) {
    return NUMERIC_TO_TIER[String(asInt)];
  }
  return 'Free';
}

/** Next tier up — used to suggest upgrades on hard-cap rejections. */
export function nextTier(current: Tier): Tier | null {
  if (current === 'Free') return 'VIP1';
  if (current === 'VIP1') return 'VIP2';
  if (current === 'VIP2') return 'VIP3';
  return null;
}

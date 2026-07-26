"use client";

/**
 * `useQuota(dimension)` — derived view of one quota dimension for the
 * current user. Components use this and never touch context directly.
 *
 * Returns a stable shape regardless of whether the snapshot is
 * unlimited (unlimited plan) or capped:
 *
 *   - `unlimited`  — no daily cap. Renders ∞ badge.
 *   - `used`       — count consumed today (Number, may be 0).
 *   - `limit`      — daily cap (Number.POSITIVE_INFINITY when unlimited).
 *   - `remaining`  — limit − used (or Infinity).
 *   - `percent`    — 0..100 (always 0 when unlimited).
 *   - `color`      — 'green' (<60) | 'amber' (60..80) | 'red' (>80).
 *                     'gray' = unknown / loading.
 *   - `resetAt`    — ISO timestamp of next reset (UTC midnight).
 *   - `resetIn`    — humanised "5h 32m" string ready for UI display.
 *
 * The hook intentionally does no rendering — it's a pure derivation
 * over context state, so QuotaBadge / QuotaBlocker / inline pre-action
 * hints can all share the same numbers.
 */
import { useMemo } from "react";
import { parseLimit, type QuotaDimension } from "@repo/shared";
import { useQuotaContext } from "./quota-provider";

export interface UseQuotaResult {
  loading: boolean;
  /** True when the user's tier has no daily cap on this dimension. */
  unlimited: boolean;
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  color: "green" | "amber" | "red" | "gray";
  resetAt: string | null;
  resetIn: string | null;
  /** True iff used >= limit (i.e. action would 429 right now). */
  exhausted: boolean;
  /** True iff used / limit >= 0.8 (UI shows warning chip). */
  near: boolean;
}

export function useQuota(dimension: QuotaDimension): UseQuotaResult {
  const { loading, peek } = useQuotaContext();
  return useMemo<UseQuotaResult>(() => {
    if (!peek) {
      return {
        loading,
        unlimited: false,
        used: 0,
        limit: 0,
        remaining: 0,
        percent: 0,
        color: "gray",
        resetAt: null,
        resetIn: null,
        exhausted: false,
        near: false,
      };
    }
    const snap = peek.dimensions[dimension];
    if (!snap) {
      return {
        loading,
        unlimited: false,
        used: 0,
        limit: 0,
        remaining: 0,
        percent: 0,
        color: "gray",
        resetAt: null,
        resetIn: null,
        exhausted: false,
        near: false,
      };
    }
    const limit = parseLimit(snap.limit);
    const remaining = parseLimit(snap.remaining);
    const unlimited = !Number.isFinite(limit);
    const percent = unlimited ? 0 : snap.percent;
    const color: UseQuotaResult["color"] = unlimited
      ? "green"
      : percent >= 80
        ? "red"
        : percent >= 60
          ? "amber"
          : "green";
    return {
      loading,
      unlimited,
      used: snap.used,
      limit,
      remaining,
      percent,
      color,
      resetAt: snap.resetAt,
      resetIn: humanizeDuration(snap.resetAt),
      exhausted: !unlimited && snap.used >= limit,
      near: !unlimited && percent >= 80,
    };
  }, [dimension, loading, peek]);
}

/** "5h 32m" / "12m" / "now" — ready for UI without any extra plumbing. */
function humanizeDuration(targetIso: string): string {
  const target = new Date(targetIso).getTime();
  const now = Date.now();
  const deltaMs = target - now;
  if (deltaMs <= 0) return "now";
  const totalMin = Math.floor(deltaMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

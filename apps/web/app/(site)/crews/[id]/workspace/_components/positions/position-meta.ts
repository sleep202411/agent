/**
 * Shared meta-formatting helpers for position cards / sheets.
 *
 * The same chips render in two places (card, drawer header), and the
 * salary string is needed by both; pulling these out keeps the
 * component files clean and prevents the two surfaces drifting.
 */

import {
  CURRENCY_SYMBOLS,
  ZERO_DECIMAL_CURRENCIES,
  type CrewPositionDTO,
  type PresetPositionValue,
} from "@/app/(site)/crews/_hooks/use-crew";

export function workModeKey(mode: CrewPositionDTO["workMode"]): string {
  if (mode === "remote") return "positionRemote";
  if (mode === "hybrid") return "positionHybrid";
  return "positionOnsite";
}

export function employmentTypeKey(t: CrewPositionDTO["employmentType"]): string {
  if (t === "project_based") return "employmentProjectBased";
  if (t === "freelance") return "employmentFreelance";
  if (t === "contract") return "employmentContract";
  if (t === "part_time") return "employmentPartTime";
  return "employmentFullTime";
}

export function experienceKey(level: CrewPositionDTO["experienceLevel"]): string {
  if (level === "junior") return "experienceJunior";
  if (level === "mid") return "experienceMid";
  if (level === "senior") return "experienceSenior";
  if (level === "lead") return "experienceLead";
  if (level === "master") return "experienceMaster";
  return "experienceAny";
}

export function salaryPeriodKey(p: CrewPositionDTO["salary"]["period"]): string {
  if (p === "month") return "salaryPeriodMonth";
  if (p === "episode") return "salaryPeriodEpisode";
  return "salaryPeriodProject";
}

/** Format salary range as e.g. "¥5K-8K · month" / "$5K-8K · month" / "Negotiable" / null. */
export function formatSalaryString(
  p: CrewPositionDTO,
  t: (key: string, params?: Record<string, string | number>) => string
): string | null {
  if (p.salary.negotiable) return t("salaryNegotiable");
  const { currency, minAmount, maxAmount, period } = p.salary;
  if ((minAmount == null && maxAmount == null) || currency == null) return null;
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  const toDisplay = (cents: number) => (isZeroDecimal ? cents : cents / 100);
  const fmt = (cents: number | null) => {
    if (cents == null) return "—";
    const v = toDisplay(cents);
    if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
    return String(v);
  };
  const symbol = CURRENCY_SYMBOLS[currency];
  const range = `${symbol}${fmt(minAmount)}-${fmt(maxAmount)}`;
  return period ? `${range} · ${t(salaryPeriodKey(period))}` : range;
}

/** Days until closeDate (negative if past). null when not set. */
export function daysUntilCloseDate(iso: string | null): number | null {
  if (!iso) return null;
  const ts = new Date(`${iso}T00:00:00Z`).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.ceil((ts - Date.now()) / 86_400_000);
}

/** Relative "x days ago" / "just now" — for "created at" footer. */
export function timeAgo(
  iso: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("justNow");
  if (diff < 3_600_000) return t("minutesAgo", { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("hoursAgo", { count: Math.floor(diff / 3_600_000) });
  return t("daysAgo", { count: Math.floor(diff / 86_400_000) });
}

export type { CrewPositionDTO, PresetPositionValue };

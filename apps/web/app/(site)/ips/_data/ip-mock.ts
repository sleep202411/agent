/**
 * Deterministic mock generator for IP plaza card metadata that the backend
 * doesn't expose yet (lifecycle stage, valuation / pre-order numbers,
 * episode progress, view / like counts, FD level, featured flag).
 *
 * Hash a project's id into a fixed-shape `IPMockMeta` object so cards stay
 * stable across renders and route navigations. When the real fields land on
 * the backend, wire up the merge in `useIPProjects` and delete this module.
 */

import type { IPStage } from "./ip";

export interface IPMockMeta {
  stage: IPStage;
  /** Author guild level (FD1–FD5). */
  level: string;
  views: number;
  likes: number;
  featured: boolean;

  // Investment (when stage === "investment")
  valuation: number; // in 万元 (10k yuan)
  sharesOffered: number; // 0–100
  totalShares: number; // shares for sale
  sharesSold: number;
  pricePerShare: number; // in 万元

  // Pre-order (when stage === "presale")
  presalePrice: number; // yuan
  fullPrice: number; // yuan
  presaleTarget: number; // people threshold
  presaleCurrent: number; // people so far
  presaleDeadline: string; // ISO date

  // Production / released (when stage === "producing" | "released")
  episodes: number; // current shipped
  targetEpisodes: number; // total planned
  watchPrice: number; // yuan, only meaningful for "released"
}

// ─── Hash helpers ─────────────────────────────────────

/** Simple deterministic 32-bit string hash (FNV-ish). Plenty for picking
 *  bucketed mock values per id. */
function hashId(id: number | string): number {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return Math.abs(h);
}

/** Stable PRNG seeded by id+salt — gives different streams of values for
 *  different fields of the same project. */
function seeded(id: number | string, salt: string, mod: number): number {
  return hashId(`${id}:${salt}`) % mod;
}

// ─── Public API ───────────────────────────────────────

const STAGES: IPStage[] = ["investment", "presale", "producing", "released"];

export function mockIPMeta(id: number | string): IPMockMeta {
  const stage = STAGES[seeded(id, "stage", 4)];
  const level = `FD${1 + seeded(id, "level", 5)}`;
  const views = 800 + seeded(id, "views", 30000);
  const likes = 40 + seeded(id, "likes", 2500);
  const featured = seeded(id, "feat", 5) === 0; // ~20% featured

  // Investment
  const sharesOffered = 10 + seeded(id, "off", 25); // 10–34%
  const totalShares = 4 + seeded(id, "ts", 7); // 4–10
  const sharesSold = seeded(id, "ss", totalShares + 1);
  const valuation = 200 + seeded(id, "val", 1800); // 200–1999 万
  const pricePerShare = Math.max(1, Math.round((valuation * (sharesOffered / 100)) / totalShares));

  // Pre-order
  const presaleTarget = 100;
  const presaleCurrent = seeded(id, "pc", presaleTarget + 30); // can overshoot
  const presalePrice = [9, 18, 30, 49][seeded(id, "pp", 4)];
  const fullPrice = presalePrice * (2 + seeded(id, "fp", 3)); // 2–4× pre-order
  const deadlineDays = 14 + seeded(id, "dd", 80); // 14–93 days out
  const presaleDeadline = new Date(Date.now() + deadlineDays * 86400000).toISOString().slice(0, 10);

  // Production / released
  const targetEpisodes = [6, 8, 10, 12][seeded(id, "te", 4)];
  const episodes = stage === "released" ? targetEpisodes : seeded(id, "ep", targetEpisodes); // 0..target-1 while producing
  const watchPrice = [49, 69, 99, 129][seeded(id, "wp", 4)];

  return {
    stage,
    level,
    views,
    likes,
    featured,
    valuation,
    sharesOffered,
    totalShares,
    sharesSold,
    pricePerShare,
    presalePrice,
    fullPrice,
    presaleTarget,
    presaleCurrent,
    presaleDeadline,
    episodes,
    targetEpisodes,
    watchPrice,
  };
}

// ─── Tag helpers ──────────────────────────────────────

/** Backend stores tags as a single string (comma / pipe / semi-colon /
 *  space separated, varies by data origin). Split tolerantly. */
export function splitTags(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,|;、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Stable color hash for an avatar fallback initial. */
const AVATAR_COLORS = [
  "bg-amber-500/20 text-amber-300",
  "bg-rose-500/20 text-rose-300",
  "bg-violet-500/20 text-violet-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-sky-500/20 text-sky-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
];

export function avatarFallbackTone(seed: string | number | null | undefined): string {
  if (seed === null || seed === undefined) return AVATAR_COLORS[0];
  return AVATAR_COLORS[hashId(String(seed)) % AVATAR_COLORS.length];
}

/** Compact "12.4k" formatter. */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Creator-services domain — shared wire types for the marketplace.
 *
 * A CreatorService is one offering a creator publishes ("音乐定制",
 * "角色设计", "短片剪辑"). Each service carries 1-3 ServicePackages
 * (basic / standard / premium tiers) that buyers choose from when
 * placing an order.
 *
 * Status state machine:
 *
 *   draft ──publish──> listed ──pause──> paused
 *                       │  ▲              │
 *                       │  └──resume──────┘
 *                       │
 *                       └──archive──> archived
 *
 *   archive is one-way (mirrors crew listingStatus + soft-delete
 *   pattern — we don't actually delete because order history will
 *   reference services after Phase 1b lands).
 *
 *   `listed` requires ≥ 1 package; service.publish() rejects services
 *   with no packages.
 *
 * Money: price is stored in the smallest currency unit (USD cents,
 * CNY 分, JPY yen). UI converts ×100 / ×1 for display.
 *
 * Tiers: rows in service_packages, NOT columns on the service. This
 * lets orders later reference a stable ServicePackage.id, and lets
 * a service publish only one tier (the cheap "basic-only" case)
 * without NULL-padding the other two columns.
 */

import type { CurrencyCode } from "./crew.js";

// ─── Enums ───────────────────────────────────────────────────

export const CREATOR_SERVICE_STATUSES = ["draft", "listed", "paused", "archived"] as const;
export type CreatorServiceStatus = (typeof CREATOR_SERVICE_STATUSES)[number];

/**
 * Three-tier package model — modeled after Fiverr / Upwork.
 * Order matters: this is the rendering order in the package picker.
 */
export const SERVICE_TIERS = ["basic", "standard", "premium"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

/**
 * Service category. Free-form on the wire (validated at the
 * controller boundary) so we can rev categories without a migration.
 * Web-side label dictionary is in `messages/<locale>.json` under
 * `creatorService.category.<value>`.
 */
export const SERVICE_CATEGORIES = [
  "video_production",
  "animation",
  "art_illustration",
  "storyboard",
  "character_design",
  "scene_design",
  "voice_acting",
  "music_sound",
  "writing_script",
  "editing_post",
  "consulting",
  "other",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(SERVICE_CATEGORIES);
export function isServiceCategory(v: string): v is ServiceCategory {
  return CATEGORY_SET.has(v);
}

/**
 * `revisions = -1` means unlimited. Storing as Int lets us keep one
 * canonical column instead of a nullable + bool pair.
 */
export const UNLIMITED_REVISIONS = -1;

// ─── DTOs ────────────────────────────────────────────────────

export interface ServicePackageDTO {
  id: string;
  tier: ServiceTier;
  /** Buyer-facing label, e.g. "30-second cut · 1080p". ≤ 80 chars. */
  title: string;
  /** What's included — long-form, supports newlines. ≤ 2000 chars. */
  description: string;
  /**
   * Display price (yuan / dollar / yen). Server stores smallest unit;
   * this is the converted display value so the UI doesn't have to
   * carry currency-decimal logic.
   */
  price: number;
  /** ISO 4217. CNY / USD / etc. */
  currency: CurrencyCode;
  /** Calendar-day turnaround. 1-365. */
  deliveryDays: number;
  /** -1 means unlimited. */
  revisions: number;
  /** Free-form bullets shown under the tier card. ≤ 12 items. */
  scope: string[];
}

/**
 * One free-form question the creator pre-defines for buyers to
 * answer before a questionnaire-first order can be submitted. The
 * full list rides on `CreatorServiceDTO.requirementQuestions` (in
 * display order) and snapshots into `OrderDTO.questionnaire` at
 * submit time.
 */
export interface ServiceRequirementQuestionDTO {
  id: string;
  /** Prompt rendered to the buyer. ≤ 240 chars. */
  prompt: string;
  /** Optional helper text under the prompt. ≤ 240 chars. */
  helpText: string;
  /** Submit blocked until a non-blank answer is provided. */
  required: boolean;
  /** Sort key — lower first. Caller-controlled; server preserves. */
  displayOrder: number;
}

export interface CreatorServiceDTO {
  id: string;
  /** String projection of the Java userId. */
  creatorId: string;
  title: string;
  /** One-paragraph pitch. ≤ 1000 chars, supports newlines. */
  summary: string;
  /** OSS-relative cover path. UI prefixes with BANNER_BASE_URL. */
  coverPath: string;
  category: ServiceCategory;
  /** Free-form skill / style tags (max 10). */
  tags: string[];
  /** Buyer-facing pre-order questionnaire. ≤ 20 entries. */
  requirementQuestions: ServiceRequirementQuestionDTO[];
  status: CreatorServiceStatus;
  /**
   * ISO timestamp when the service first transitioned to `listed`.
   * Used as the "newest first" sort key in the marketplace plaza.
   */
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Optimistic concurrency token. Bumped server-side on every owner
   * write. Clients must echo it back in update requests via
   * `expectedVersion` so a stale tab can't silently overwrite a
   * newer save. Server returns 409 when the round-tripped value
   * doesn't match.
   */
  version: number;
  /** 1-3 tier rows; ordered basic → standard → premium. */
  packages: ServicePackageDTO[];
}

/**
 * Marketplace card projection — drops fields the plaza card doesn't
 * render (description, full scope arrays) so the listing endpoint
 * can return many rows cheaply.
 */
export interface CreatorServiceCardDTO {
  id: string;
  creatorId: string;
  title: string;
  summary: string;
  coverPath: string;
  category: ServiceCategory;
  tags: string[];
  publishedAt: string;
  /** Smallest-price tier — drives the "starting at" chip. */
  startingPrice: number;
  currency: CurrencyCode;
  /** Delivery days of the cheapest tier — "from N days" chip. */
  startingDeliveryDays: number;
  /** Tier count (1-3) so cards can show "3 packages" hint. */
  packageCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────

const TIER_ORDER: Record<ServiceTier, number> = {
  basic: 0,
  standard: 1,
  premium: 2,
};

export function compareTiers(a: ServiceTier, b: ServiceTier): number {
  return TIER_ORDER[a] - TIER_ORDER[b];
}

/**
 * Cheapest package = the "starting at" price shown on the plaza card.
 * Falls back to the first package if all prices are equal.
 */
export function startingPackage<T extends { price: number }>(packages: T[]): T | null {
  if (packages.length === 0) return null;
  return packages.reduce((min, p) => (p.price < min.price ? p : min));
}

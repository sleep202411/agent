/**
 * Crew domain — shared wire types and the preset position list.
 *
 * Preset positions provide a stable, translatable taxonomy for recruitment
 * and member-position classification. A member position may instead use a
 * custom title, so production responsibility is never confused with access
 * control or ownership.
 *
 *   1. Append to PRESET_POSITIONS below.
 *   2. Add the i18n entry under "crew.position.<value>" in
 *      apps/web/src/i18n/locales/<locale>.ts.
 *   3. Done. No migration — server validates against this list at the
 *      controller boundary.
 *
 * Removing a preset would break existing rows that reference it —
 * never remove, only add. To retire a position from the UI dropdown
 * without breaking history, add a separate `archived` set later.
 */

export const PRESET_POSITIONS = [
  { value: "director", label: "Director" },
  { value: "screenwriter", label: "Screenwriter" },
  { value: "storyboard", label: "Storyboard Artist" },
  { value: "character_design", label: "Character Designer" },
  { value: "background_design", label: "Background Designer" },
  { value: "animator", label: "Animator" },
  { value: "voice_actor", label: "Voice Actor" },
  { value: "sound_designer", label: "Sound Designer" },
  { value: "music_composer", label: "Music Composer" },
  { value: "editor", label: "Editor" },
  { value: "compositor", label: "Compositor" },
  { value: "producer", label: "Producer" },
  { value: "marketing", label: "Marketing Lead" },
] as const;

export type PresetPositionValue = (typeof PRESET_POSITIONS)[number]["value"];

const PRESET_VALUE_SET = new Set(PRESET_POSITIONS.map((p) => p.value));

export function isPresetPosition(value: string): value is PresetPositionValue {
  return PRESET_VALUE_SET.has(value as PresetPositionValue);
}

// ─── DTOs (wire shapes) ──────────────────────────────────────

export type CrewPositionStatus = "open" | "frozen" | "full";
export type CrewListingStatus = "unlisted" | "listed";
export type CrewMemberStatus = "active" | "suspended" | "removed";
export type CrewJoinSource = "creation" | "application" | "invitation" | "ownership_transfer";
export type CrewApplicationStatus = "pending" | "approved" | "rejected";

// ─── Authorization ───────────────────────────────────────────

/**
 * Active membership always grants the member baseline. Policies are additive
 * bundles, not mutually-exclusive roles: the same member may be both an
 * administrator and a finance manager.
 */
export const CREW_POLICY_KEYS = ["admin", "finance"] as const;
export type CrewPolicyKey = (typeof CREW_POLICY_KEYS)[number];

export const CREW_PERMISSION_KEYS = [
  "crew.settings.manage",
  "crew.delete",
  "ownership.transfer",
  "members.view",
  "members.invite",
  "members.manage",
  "members.permissions.manage",
  "openings.manage",
  "applications.review",
  "tasks.view",
  "tasks.manage",
  "tasks.comment",
  "tasks.submit_assigned",
  "tasks.review",
  "assets.view",
  "assets.upload",
  "assets.manage",
  "agreements.view_own",
  "agreements.manage",
  "finance.ledger.view",
  "finance.earnings.create",
  "finance.earnings.approve",
  "finance.earnings.reverse",
  "finance.payouts.create",
  "finance.payouts.manage",
  "studio.view",
  "studio.edit",
  "production.view",
  "production.deliver",
  "production.manage",
  "production.review",
] as const;
export type CrewPermissionKey = (typeof CREW_PERMISSION_KEYS)[number];
export type CrewPermissionEffect = "allow" | "deny";

/** Permissions every active crew member receives. */
export const CREW_MEMBER_PERMISSIONS = [
  "members.view",
  "tasks.view",
  "tasks.comment",
  "tasks.submit_assigned",
  "assets.view",
  "assets.upload",
  "agreements.view_own",
  "studio.view",
  "production.view",
  "production.deliver",
] as const satisfies readonly CrewPermissionKey[];

/** Additive, code-owned policy bundles. */
export const CREW_POLICY_PERMISSIONS = {
  admin: [
    "crew.settings.manage",
    "members.view",
    "members.invite",
    "members.manage",
    "openings.manage",
    "applications.review",
    "tasks.view",
    "tasks.manage",
    "tasks.comment",
    "tasks.submit_assigned",
    "tasks.review",
    "assets.view",
    "assets.upload",
    "assets.manage",
    "agreements.view_own",
    "agreements.manage",
    "studio.view",
    "studio.edit",
    "production.view",
    "production.deliver",
    "production.manage",
    "production.review",
  ],
  finance: [
    "finance.ledger.view",
    "finance.earnings.create",
    "finance.earnings.approve",
    "finance.earnings.reverse",
    "finance.payouts.create",
    "finance.payouts.manage",
  ],
} as const satisfies Record<CrewPolicyKey, readonly CrewPermissionKey[]>;

/** These capabilities are structural ownership powers and cannot be delegated. */
export const CREW_OWNER_ONLY_PERMISSIONS = [
  "crew.delete",
  "ownership.transfer",
  "members.permissions.manage",
] as const satisfies readonly CrewPermissionKey[];

const CREW_POLICY_KEY_SET = new Set<string>(CREW_POLICY_KEYS);
const CREW_PERMISSION_KEY_SET = new Set<string>(CREW_PERMISSION_KEYS);

export function isCrewPolicyKey(value: string): value is CrewPolicyKey {
  return CREW_POLICY_KEY_SET.has(value);
}

export function isCrewPermissionKey(value: string): value is CrewPermissionKey {
  return CREW_PERMISSION_KEY_SET.has(value);
}

// ─── Recruitment enums ───────────────────────────────────

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "project_based",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

// Maps 1:1 to FD certification ranks for recruiter copy:
//   junior=FD I+, mid=FD II+, senior=FD III+, lead=FD IV+, master=FD V.
// 'any' is the no-requirement default; everything else gates apply
// flow against the applicant's max FD level.
export const EXPERIENCE_LEVELS = ["any", "junior", "mid", "senior", "lead", "master"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const SALARY_PERIODS = ["month", "episode", "project"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** ISO 4217 codes the platform supports. Cell-level narrowing is
 *  enforced server-side (cn → CNY only; com → multi). */
export const ALL_CURRENCIES = [
  "CNY",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "HKD",
  "AUD",
  "CAD",
  "SGD",
] as const;
export type CurrencyCode = (typeof ALL_CURRENCIES)[number];

/** Display symbol for each currency — used by UI when rendering ranges. */
export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
};

/** Currencies whose smallest unit IS the displayed unit (no decimals).
 *  JPY is the main one in our whitelist. CNY/USD/EUR are 100x scaled. */
export const ZERO_DECIMAL_CURRENCIES = new Set<CurrencyCode>(["JPY"]);

// ─── Crew taxonomy ─────────────────────────────────────

/** Top-level format of what the crew makes. Max 5 per crew. */
export const CREW_GENRES = [
  "animation",
  "live_action",
  "documentary",
  "shortform",
  "mv",
  "commercial",
  "experimental",
  "vlog",
] as const;
export type CrewGenre = (typeof CREW_GENRES)[number];

/** Production technique — orthogonal to genre. Max 5 per crew. */
export const CREW_STYLES = [
  "2d",
  "3d",
  "mixed_media",
  "live_action",
  "stop_motion",
  "ai_assisted",
  "documentary",
] as const;
export type CrewStyle = (typeof CREW_STYLES)[number];

/** External channel platforms surfaced as social links. */
export const SOCIAL_PLATFORMS = [
  "bilibili",
  "weibo",
  "douyin",
  "xiaohongshu",
  "youtube",
  "tiktok",
  "instagram",
  "website",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

/** One curated work shown on the crew detail page. First entry is
 *  featured as the visitor-page hero background. */
export interface ShowcaseWork {
  /** Required — used as thumbnail in cards and as hero bg fallback. */
  thumbnailUrl: string;
  title: string;
  /** Outbound link (Bilibili / YouTube / 内站 video page). Optional. */
  externalUrl?: string | null;
  /** Display only — not validated against anything. */
  viewCount?: number | null;
  /** Optional release date (YYYY-MM-DD). Sort hint. */
  releaseDate?: string | null;
}

export interface CrewDTO {
  id: string;
  name: string;
  description: string;
  /** Square logo. Required. UI crops to circle. */
  logo: string;
  /** One-line hook under crew name in hero. ≤140 chars. */
  tagline: string | null;
  /** From CREW_GENRES. */
  genres: CrewGenre[];
  /** From CREW_STYLES. */
  styles: CrewStyle[];
  /** External channels. */
  socialLinks: SocialLink[];
  /** Featured works carousel. First entry powers the hero. */
  showcaseWorks: ShowcaseWork[];
  ownerUserId: string;
  /** User-controlled Crew Hall visibility. */
  listingStatus: CrewListingStatus;
  productionKind?: "interactive_film" | "series";
  studioWorkspaceId?: string | null;
  /** Last time the owner made the crew visible in Crew Hall. */
  listedAt: string | null;
  /** Optimistic concurrency token for crew-level edits. */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Aggregated counts populated by list / detail endpoints. */
  memberCount?: number;
  openPositionCount?: number;
  /** Top-3 newest open positionType strings — for plaza card
   *  "招募: 配音演员 · 音效师 +1" preview chip. */
  openPositionPreview?: string[];
  pendingApplicationCount?: number;
}

export interface CrewPositionDTO {
  recruitmentVisibility?: "public" | "private";
  /** Immutable recruitment target; absent on older clients. */
  taskId?: string | null;
  id: string;
  crewId: string;
  positionType: string;
  description: string;
  targetCount: number;
  recruitedCount: number;
  status: CrewPositionStatus;
  // ─── Employment ─────
  workMode: WorkMode;
  location: string | null;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  // ─── Skills ─────────
  requiredSkills: string[];
  // ─── Compensation ───
  paymentTerms?: TaskPaymentTerms | null;
  salary: {
    period: SalaryPeriod | null;
    currency: CurrencyCode | null;
    /** Smallest currency unit (CNY 分 / USD cents / JPY yen). UI
     *  divides by 100 for display except for zero-decimal currencies
     *  (JPY) where the integer IS the displayed value. */
    minAmount: number | null;
    maxAmount: number | null;
    negotiable: boolean;
  };
  /** Expected commitment length in months (1-60). NULL = open-ended
   *  / long-term — UI typically renders "长期" / "Long term". */
  durationMonths: number | null;
  /** Revenue-share percentage offered to this position holder.
   *  Wire value is a plain percentage (e.g. 2.5 for 2.5 %); the
   *  server stores basis points internally. Range 0.5 – 50, in
   *  0.5 steps. NULL = no share offered. */
  revenueSharePercent: number | null;
  /** Optional auto-archive date (YYYY-MM-DD). */
  closeDate: string | null;
  /**
   * Owner-only recruitment inbox totals. Public position discovery omits
   * this block so applicant activity is never leaked outside the crew.
   */
  applicationStats?: CrewApplicationStatusCounts;
  createdAt: string;
}

export interface CrewPositionPageDTO {
  items: CrewPositionDTO[];
  nextCursor: string | null;
  total: number;
}

export interface CrewMemberDTO {
  id: string;
  crewId: string;
  userId: string;
  status: CrewMemberStatus;
  joinedVia: CrewJoinSource;
  isOwner: boolean;
  positions: CrewMemberPositionDTO[];
  policyKeys: CrewPolicyKey[];
  joinedAt: string;
  removedAt: string | null;
  version: number;
}

export interface CrewMemberPositionDTO {
  id: string;
  categoryKey: PresetPositionValue | null;
  title: string | null;
  isPrimary: boolean;
  sourcePositionId: string | null;
}

export interface CrewMemberPageDTO {
  items: CrewMemberDTO[];
  nextCursor: string | null;
  total: number;
}

export interface CrewMembershipDTO {
  userId: string;
  member: CrewMemberDTO;
  permissions: CrewPermissionKey[];
}

export interface CrewApplicationDTO {
  interview?: {
    state: "not_started" | "proposed" | "confirmed" | "completed" | "cancelled";
    version: number;
    scheduledAt: string | null;
  };
  id: string;
  crewId: string;
  positionId: string;
  applicantId: string;
  message: string | null;
  /** Optional external link (LinkedIn / Behance / personal site). */
  portfolioUrl: string | null;
  /** Applicant's expected compensation in smallest currency unit. */
  expectedCompensation: {
    amount: number;
    currency: CurrencyCode;
    period: SalaryPeriod | null;
  } | null;
  /** Earliest start date (YYYY-MM-DD). */
  availableStartDate: string | null;
  yearsExperience: number | null;
  status: CrewApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewerId: string | null;
}

export interface CrewApplicationStatusCounts {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface CrewApplicationListSummary extends CrewApplicationStatusCounts {
  byPosition: Record<string, CrewApplicationStatusCounts>;
}

export interface CrewApplicationPageDTO {
  items: CrewApplicationDTO[];
  nextCursor: string | null;
  total: number;
  summary: CrewApplicationListSummary;
}

/** Agreed timing of payment; not a payment rail or a transfer instruction. */
export const TASK_PAYMENT_TERMS = ["monthly", "half_upfront", "on_completion"] as const;
export type TaskPaymentTerms = (typeof TASK_PAYMENT_TERMS)[number];

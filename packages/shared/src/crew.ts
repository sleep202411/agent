/**
 * Crew domain — shared wire types and the preset position list.
 *
 * The 13 preset positions are the only string values allowed for
 * `CrewPosition.positionType` / `CrewMember.roleType` (plus the
 * reserved literal `"owner"` for founders). Adding a position:
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

/** Reserved role for the crew founder. */
export const OWNER_ROLE = "owner";

const PRESET_VALUE_SET = new Set(PRESET_POSITIONS.map((p) => p.value));

export function isPresetPosition(value: string): value is PresetPositionValue {
  return PRESET_VALUE_SET.has(value as PresetPositionValue);
}

/** Validates `roleType` for a CrewMember — preset position OR "owner". */
export function isValidRoleType(value: string): boolean {
  return value === OWNER_ROLE || isPresetPosition(value);
}

// ─── DTOs (wire shapes) ──────────────────────────────────────

export type CrewPositionStatus = "open" | "frozen" | "full";
export type CrewMemberVia = "founder" | "application" | "manual";
export type CrewApplicationStatus = "pending" | "approved" | "rejected";
export type EpisodeStatus = "not_started" | "in_production" | "approved";
export type AssignmentStatus = "in_progress" | "submitted" | "approved" | "rejected";

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

export const EXPERIENCE_LEVELS = ["any", "junior", "mid", "senior", "lead"] as const;
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

export interface CrewDTO {
  id: string;
  name: string;
  description: string;
  coverImage: string;
  coverVideo: string | null;
  founderId: string;
  createdAt: string;
  updatedAt: string;
  /** Aggregated counts populated by list / detail endpoints. */
  memberCount?: number;
  openPositionCount?: number;
  pendingApplicationCount?: number;
}

export interface CrewPositionDTO {
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
  /** Optional auto-archive date (YYYY-MM-DD). */
  closeDate: string | null;
  createdAt: string;
}

export interface CrewMemberDTO {
  id: string;
  crewId: string;
  userId: string;
  roleType: string; // preset value or "owner"
  positionId: string | null;
  via: CrewMemberVia;
  isFinance: boolean;
  joinedAt: string;
}

export interface CrewApplicationDTO {
  id: string;
  crewId: string;
  positionId: string;
  applicantId: string;
  message: string | null;
  /** Optional external link (LinkedIn / Behance / personal site). */
  portfolioUrl: string | null;
  /** Applicant's expected salary in CNY 分. */
  expectedSalaryCents: number | null;
  /** Earliest start date (YYYY-MM-DD). */
  availableStartDate: string | null;
  yearsExperience: number | null;
  status: CrewApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewerId: string | null;
}

// ─── Episode sub-domain ─────────────────────────────────────

export interface EpisodeDTO {
  id: string;
  crewId: string;
  number: number;
  title: string | null;
  description: string | null;
  status: EpisodeStatus;
  deadline: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeAssignmentDTO {
  id: string;
  crewId: string;
  episodeId: string;
  userId: string;
  positionId: string | null;
  roleName: string | null;
  status: AssignmentStatus;
  submission: { url: string | null; note: string | null; submittedAt: string } | null;
  reviewNote: { reason: string; suggestion: string | null; rejectedAt: string } | null;
  revenue: { amount: number; currency: CurrencyCode; setAt: string; setByUserId: string } | null;
  updatedAt: string;
}

export type EpisodeActivityType =
  | "episode_created"
  | "member_assigned"
  | "member_unassigned"
  | "submission_made"
  | "submission_approved"
  | "submission_rejected"
  | "revenue_set"
  | "episode_approved";

export interface EpisodeActivityDTO {
  id: string;
  crewId: string;
  episodeId: string;
  type: EpisodeActivityType | string;
  actorUserId: string;
  actorName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

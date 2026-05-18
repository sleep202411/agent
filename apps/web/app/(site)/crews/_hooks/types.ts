/**
 * Re-export shared crew DTOs as the feature's public type surface.
 *
 * Everything user-facing in this feature should import from here (or
 * from the `use-crew` barrel that re-exports from here) — not from
 * `@repo/shared` directly. Keeping one import surface means a future
 * type migration (e.g. server splits CrewDTO into multiple wire
 * shapes) is a single-file change instead of grepping every import
 * site.
 */

export type {
  CrewDTO,
  CrewPositionDTO,
  CrewPositionStatus,
  CrewMemberDTO,
  CrewMemberVia,
  CrewApplicationDTO,
  CrewApplicationStatus,
  EpisodeDTO,
  EpisodeStatus,
  EpisodeAssignmentDTO,
  AssignmentStatus,
  EpisodeActivityDTO,
  EpisodeActivityType,
  PresetPositionValue,
  WorkMode,
  EmploymentType,
  ExperienceLevel,
  SalaryPeriod,
  CurrencyCode,
} from "@repo/shared/crew";

export {
  PRESET_POSITIONS,
  OWNER_ROLE,
  isPresetPosition,
  isValidRoleType,
  WORK_MODES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SALARY_PERIODS,
  ALL_CURRENCIES,
  CURRENCY_SYMBOLS,
  ZERO_DECIMAL_CURRENCIES,
} from "@repo/shared/crew";

// ─── Input shapes (controllers' Zod-validated body types) ─────

export interface CreateCrewInput {
  name: string;
  description: string;
  coverImage: string;
  coverVideo?: string | null;
}

export interface UpdateCrewInput extends Partial<CreateCrewInput> {
  id: string;
}

export interface SalaryInput {
  period?: "month" | "episode" | "project" | null;
  /** ISO 4217. Required when amounts are set. */
  currency?: import("@repo/shared/crew").CurrencyCode | null;
  /** Display unit (yuan / dollar / yen). Server converts to smallest unit. */
  min?: number | null;
  max?: number | null;
  negotiable?: boolean;
}

export interface CreatePositionInput {
  positionType: string;
  description: string;
  targetCount: number;
  workMode?: "remote" | "hybrid" | "onsite";
  location?: string | null;
  employmentType?: "full_time" | "part_time" | "contract" | "freelance" | "project_based";
  experienceLevel?: "any" | "junior" | "mid" | "senior" | "lead";
  requiredSkills?: string[];
  salary?: SalaryInput;
  /** YYYY-MM-DD. */
  closeDate?: string | null;
}

export interface UpdatePositionInput extends Partial<CreatePositionInput> {
  status?: "open" | "frozen";
}

export interface ApplyInput {
  message?: string | null;
  portfolioUrl?: string | null;
  /** Yuan. */
  expectedSalary?: number | null;
  /** YYYY-MM-DD. */
  availableStartDate?: string | null;
  yearsExperience?: number | null;
}

export interface AddMemberInput {
  userId: string;
  roleType: string;
}

/**
 * Zod schemas for every crew controller body. Co-located in one file
 * because each schema is small and they share a few constraints
 * (positionType validation, headcount bounds, salary range).
 */
import { z } from 'zod';
import {
  ALL_CURRENCIES,
  CREW_GENRES,
  CREW_STYLES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SALARY_PERIODS,
  SOCIAL_PLATFORMS,
  WORK_MODES,
  isPresetPosition,
} from '@repo/shared/crew';

const presetPosition = z.string().refine(isPresetPosition, {
  message: 'positionType must be one of PRESET_POSITIONS',
});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s-]{5,32}$/;

// ─── Crew CRUD ──────────────────────────────────────────────

const SocialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  url: z.string().trim().url().max(512),
});

const ShowcaseWorkSchema = z.object({
  thumbnailUrl: z.string().trim().url().max(512),
  title: z.string().trim().min(1).max(200),
  externalUrl: z.string().trim().url().max(512).nullable().optional(),
  viewCount: z.number().int().min(0).nullable().optional(),
  releaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'releaseDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

export const CreateCrewSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(2000),
  /** Square logo URL (≤512 chars). Cropped to circle in UI. */
  logo: z.string().trim().min(1).max(512),
  /** One-line hook under crew name. ≤140 chars. */
  tagline: z.string().trim().max(140).nullable().optional(),
  /** Crew taxonomy — max 5 each. */
  genres: z.array(z.enum(CREW_GENRES)).max(5).default([]),
  styles: z.array(z.enum(CREW_STYLES)).max(5).default([]),
  /** External channel links — max 10. */
  socialLinks: z.array(SocialLinkSchema).max(10).default([]),
  /** Featured works — max 10. First powers hero bg. */
  showcaseWorks: z.array(ShowcaseWorkSchema).max(10).default([]),
});
export type CreateCrewInput = z.infer<typeof CreateCrewSchema>;

export const UpdateCrewSchema = CreateCrewSchema.partial().extend({
  /// Optimistic concurrency token from the row read prior to edit.
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateCrewInput = z.infer<typeof UpdateCrewSchema>;

export const UpdateCrewListingSchema = z.object({
  listingStatus: z.enum(['unlisted', 'listed']),
  /// Optimistic concurrency token from the row read prior to action.
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateCrewListingInput = z.infer<typeof UpdateCrewListingSchema>;

export const TransferCrewOwnerSchema = z.object({
  /// External auth user id (raw Java user id) of the incoming owner.
  toUserId: z.string().trim().min(1).max(64),
  /// Whether to drop the outgoing owner from the crew. Default (false)
  /// keeps them as a normal member.
  removeOldOwner: z.boolean().optional(),
  /// Optimistic concurrency token from the row read prior to action.
  expectedVersion: z.number().int().min(0).optional(),
});
export type TransferCrewOwnerInput = z.infer<typeof TransferCrewOwnerSchema>;

// ─── Position CRUD ──────────────────────────────────────────

/// Salary block validated as a unit so we can express "max >= min"
/// and "currency required when amounts set". Display unit comes from
/// the UI — server converts to smallest currency unit at the service
/// layer (×100 for most, ×1 for JPY).
const SalarySchema = z
  .object({
    period: z.enum(SALARY_PERIODS).nullable().optional(),
    currency: z.enum(ALL_CURRENCIES).nullable().optional(),
    /// Display unit (yuan / dollar / etc.) — converted to smallest unit
    /// server-side based on the chosen currency.
    min: z.number().min(0).max(100_000_000).nullable().optional(),
    max: z.number().min(0).max(100_000_000).nullable().optional(),
    negotiable: z.boolean().optional(),
  })
  .refine((s) => s.min == null || s.max == null || s.max >= s.min, {
    message: 'salary.max must be >= salary.min',
    path: ['max'],
  })
  .refine((s) => (s.min == null && s.max == null) || s.currency != null, {
    message: 'salary.currency required when amounts are set',
    path: ['currency'],
  });

const ExpectedCompensationSchema = z
  .object({
    /// Display unit (yuan / dollar / yen). Server converts to smallest unit.
    amount: z.number().min(0).max(100_000_000).nullable().optional(),
    currency: z.enum(ALL_CURRENCIES).nullable().optional(),
    period: z.enum(SALARY_PERIODS).nullable().optional(),
  })
  .refine((v) => v.amount == null || v.currency != null, {
    message: 'expectedCompensation.currency required when amount is set',
    path: ['currency'],
  });

const PositionBaseSchema = z.object({
  positionType: presetPosition,
  description: z.string().trim().min(1).max(1000),
  targetCount: z.number().int().min(1).max(99),
  workMode: z.enum(WORK_MODES).default('remote'),
  location: z.string().trim().min(1).max(128).nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('project_based'),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).default('any'),
  requiredSkills: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  salary: SalarySchema.optional(),
  /// Tenure in months (1-60). NULL/undefined = open-ended commitment
  /// — see CrewPosition.durationMonths comment in schema.prisma.
  durationMonths: z.number().int().min(1).max(60).nullable().optional(),
  /// Revenue share percentage offered to this position holder.
  /// Wire is a plain percentage (e.g. 2.5 for 2.5 %); server stores
  /// basis points internally. 0.5 minimum keeps the value meaningful
  /// (smaller shares are noise), 50 max caps a single seat at half.
  revenueSharePercent: z
    .number()
    .min(0.5)
    .max(50)
    .multipleOf(0.5)
    .nullable()
    .optional(),
  /// YYYY-MM-DD; client supplies ISO date string.
  closeDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'closeDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

export const CreatePositionSchema = PositionBaseSchema.refine(
  (p) =>
    p.workMode === 'remote' || (p.location != null && p.location.length > 0),
  {
    message: 'location is required when workMode != remote',
    path: ['location'],
  },
);
export type CreatePositionInput = z.infer<typeof CreatePositionSchema>;

export const UpdatePositionSchema = PositionBaseSchema.partial().extend({
  /// owner-toggle status. 'full' is service-managed.
  status: z.enum(['open', 'frozen']).optional(),
});
export type UpdatePositionInput = z.infer<typeof UpdatePositionSchema>;

// ─── Application ────────────────────────────────────────────

export const ApplySchema = z.object({
  message: z.string().trim().min(1).max(1000).nullable().optional(),
  portfolioUrl: z
    .string()
    .trim()
    .url('portfolioUrl must be a valid URL')
    .max(512)
    .nullable()
    .optional(),
  expectedCompensation: ExpectedCompensationSchema.nullable().optional(),
  /// Legacy CN-only field. Kept temporarily so old clients/cached bundles
  /// keep working; new clients should send expectedCompensation.
  expectedSalary: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .nullable()
    .optional(),
  availableStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'availableStartDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
});
export type ApplyInput = z.infer<typeof ApplySchema>;

// ─── Manual member ──────────────────────────────────────────

export const AddMemberSchema = z.object({
  account: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .refine((v) => EMAIL_RE.test(v) || PHONE_RE.test(v), {
      message: 'account must be a valid email or phone',
    }),
  roleType: presetPosition,
});
export type AddMemberInput = z.infer<typeof AddMemberSchema>;

export const UpdateMemberSchema = z.object({
  isFinance: z.boolean().optional(),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

// ─── Viewer moderation ──────────────────────────────────────

/** Same reason set as ip-commerce content reports (shared moderation queue). */
export const CreateCrewReportSchema = z
  .object({
    reason: z.enum([
      'copyright',
      'unsafe_content',
      'fraud',
      'misleading',
      'privacy',
      'harassment',
      'other',
    ]),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CreateCrewReportInput = z.infer<typeof CreateCrewReportSchema>;

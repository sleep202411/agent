/**
 * Zod schemas for every crew controller body. Co-located in one file
 * because each schema is small and they share a few constraints
 * (positionType validation, headcount bounds, salary range).
 */
import { z } from 'zod';
import {
  ALL_CURRENCIES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SALARY_PERIODS,
  WORK_MODES,
  isPresetPosition,
} from '@repo/shared/crew';

const presetPosition = z.string().refine(isPresetPosition, {
  message: 'positionType must be one of PRESET_POSITIONS',
});

// ─── Crew CRUD ──────────────────────────────────────────────

export const CreateCrewSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(2000),
  coverImage: z.string().min(1),
  coverVideo: z.string().min(1).nullable().optional(),
});
export type CreateCrewInput = z.infer<typeof CreateCrewSchema>;

export const UpdateCrewSchema = CreateCrewSchema.partial().extend({
  /// Optimistic concurrency token from the row read prior to edit.
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateCrewInput = z.infer<typeof UpdateCrewSchema>;

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
  /// Yuan from the UI — converted to 分 server-side.
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
  userId: z.string().min(1),
  roleType: presetPosition,
});
export type AddMemberInput = z.infer<typeof AddMemberSchema>;

export const UpdateMemberSchema = z.object({
  isFinance: z.boolean().optional(),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

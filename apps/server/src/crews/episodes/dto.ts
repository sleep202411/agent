/**
 * Zod schemas for episode + assignment write endpoints.
 * Spec source: apps/web/app/(site)/crews/_hooks/episodes-spec.md.
 */
import { z } from 'zod';

// ─── Episode ────────────────────────────────────────────────

export const CreateEpisodeSchema = z.object({
  title: z.string().trim().max(128).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  /// YYYY-MM-DD; we parse client-side to Date in the service.
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'deadline must be YYYY-MM-DD')
    .nullable()
    .optional(),
});
export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;

// ─── Assignment ─────────────────────────────────────────────

export const AddAssignmentSchema = z.object({
  userId: z.string().min(1),
  positionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .nullable()
    .optional(),
  roleName: z.string().trim().max(64).nullable().optional(),
});
export type AddAssignmentInput = z.infer<typeof AddAssignmentSchema>;

/**
 * A submission has to carry something the reviewer can look at. Both
 * columns stay nullable in the schema — a submission is url-only or
 * note-only just as legitimately as both — but an empty `POST {}` used
 * to flip the assignment to `submitted` with nothing attached, which
 * left the admin reviewing a blank row. `.trim()` runs first, so
 * whitespace-only counts as blank.
 *
 * The issue is anchored on `url` rather than the object root because
 * ZodValidationPipe keys issues by field path, and a root-level issue
 * has no field for the form to attach the message to.
 */
export const SubmitAssignmentSchema = z
  .object({
    url: z.string().trim().max(1024).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Boolean(v.url) || Boolean(v.note), {
    message: 'A submission needs a url or a note',
    path: ['url'],
  });
export type SubmitAssignmentInput = z.infer<typeof SubmitAssignmentSchema>;

export const RejectAssignmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  suggestion: z.string().trim().max(500).nullable().optional(),
});
export type RejectAssignmentInput = z.infer<typeof RejectAssignmentSchema>;

/**
 * Revenue payload — `amount` is the SMALLEST currency unit (cents,
 * 分, 円). Currency is validated server-side against the cell
 * whitelist via `assertAllowedCurrency()` in the service layer.
 * Optional so existing callers that omit it default to the cell's
 * default currency.
 */
export const RevenueSchema = z.object({
  amount: z.number().int().min(0),
  currency: z.string().trim().length(3).optional(),
});
export type RevenueInput = z.infer<typeof RevenueSchema>;

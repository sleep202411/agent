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
  positionId: z.string().regex(/^\d+$/).nullable().optional(),
  roleName: z.string().trim().max(64).nullable().optional(),
});
export type AddAssignmentInput = z.infer<typeof AddAssignmentSchema>;

export const SubmitAssignmentSchema = z.object({
  url: z.string().trim().max(1024).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type SubmitAssignmentInput = z.infer<typeof SubmitAssignmentSchema>;

export const RejectAssignmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  suggestion: z.string().trim().max(500).nullable().optional(),
});
export type RejectAssignmentInput = z.infer<typeof RejectAssignmentSchema>;

export const RevenueSchema = z.object({
  amount: z.number().int().min(0),
  currency: z.literal('CNY').optional(),
});
export type RevenueInput = z.infer<typeof RevenueSchema>;

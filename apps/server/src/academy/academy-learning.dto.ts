import { z } from 'zod';
export const OfferingShare = z.object({
  teacherId: z.string().regex(/^[1-9]\d{0,15}$/),
  shareBps: z.number().int().min(0).max(10000),
});
export const SaveOffering = z.strictObject({
  teacherId: z.string().regex(/^[1-9]\d{0,15}$/),
  priceCredits: z.string().regex(/^(0|[1-9]\d{0,11})$/),
  teacherShareBps: z.number().int().min(0).max(10000),
  shares: z.array(OfferingShare).max(20).optional(),
  enabled: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
});
export const Enroll = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export const SubmitHomework = z.strictObject({
  expectedVersion: z.number().int().positive(),
  description: z.string().trim().min(1).max(10000),
  assetIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const ReviewHomework = z.strictObject({
  expectedVersion: z.number().int().positive(),
  decision: z.enum(['approved', 'revision']),
  score: z.number().int().min(0).max(100),
  feedback: z.string().trim().min(1).max(10000),
});
export const LearningPage = z.strictObject({ after: z.uuid().optional() });

import { z } from 'zod';
const reason = z.string().trim().min(3).max(2000);
export const CommitmentActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum(['accept', 'at_risk', 'withdraw']),
    reason: z.string().trim().max(2000).default(''),
  })
  .strict()
  .refine((v) => v.action === 'accept' || v.reason.length >= 3, {
    path: ['reason'],
    message: 'Explain the risk or withdrawal and what is ready for handover.',
  });
export type CommitmentAction = z.infer<typeof CommitmentActionSchema>;
export const HandoverSchema = z.object({ note: reason }).strict();
export const WithdrawalSchema = z.object({ reason }).strict();
export const FeedbackSchema = z
  .object({
    subjectUserId: z.string().trim().min(1).max(64),
    rating: z.number().int().min(1).max(5),
    comment: reason,
  })
  .strict();
export const FeedbackResponseSchema = z.object({ response: reason }).strict();
export const AccountabilityQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();

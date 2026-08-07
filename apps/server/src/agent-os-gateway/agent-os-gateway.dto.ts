import { z } from 'zod';

const modelProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);

export const AgentOsStartRunBodySchema = z
  .object({
    projectId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(100_000),
    /** Required — never defaulted server-side (fail loud on missing profile). */
    modelProfileId: modelProfileIdSchema,
    /** Optional inline script text for Phase 1 demos (before attachment pipeline). */
    scriptText: z.string().trim().min(1).max(200_000).optional(),
  })
  .strict();

export type AgentOsStartRunBody = z.infer<typeof AgentOsStartRunBodySchema>;

export const AgentOsApprovalBodySchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    conversationId: z.string().uuid(),
    projectId: z.string().uuid(),
    /** Required — must match the profile used for the run resume. */
    modelProfileId: modelProfileIdSchema,
  })
  .strict();

export type AgentOsApprovalBody = z.infer<typeof AgentOsApprovalBodySchema>;

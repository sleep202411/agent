import { z } from "zod";
// Validate financial snapshots before rendering or enabling a request form.
export const computeRequestsPageSchema = z.object({
  projectBudget: z
    .object({
      version: z.number().int().positive(),
      durationSeconds: z.number().int().positive(),
      totalPoints: z.string().regex(/^\d+$/),
      releasedPoints: z.string().regex(/^\d+$/),
      closed: z.boolean(),
      producerSettlement: z
        .object({
          grossMinor: z.string().regex(/^\d+$/),
          deductionMinor: z.string().regex(/^\d+$/),
          currency: z.enum(["USD", "CNY"]),
          note: z.string(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  isOwner: z.boolean(),
  consumedPoints: z.string().regex(/^\d+$/),
  totals: z.object({
    pending: z.number().int().nonnegative().optional(),
    approved: z.number().int().nonnegative().optional(),
    rejected: z.number().int().nonnegative().optional(),
  }),
  tasks: z.array(z.object({ id: z.string().min(1), title: z.string(), number: z.number().int() })),
  nextCursor: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      taskId: z.string(),
      taskTitle: z.string(),
      userId: z.string(),
      points: z.number().int().nonnegative(),
      reason: z.string(),
      status: z.enum(["pending", "approved", "rejected"]),
      createdAt: z.string(),
      decidedByAdminId: z.string().nullable().optional(),
      decidedByUserId: z.string().nullable().optional(),
      decisionNote: z.string().nullable().optional(),
    })
  ),
});

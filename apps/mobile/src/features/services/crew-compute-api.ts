import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const computeRequest = z.object({
  id: z.string().uuid(),
  crewId: identifier,
  userId: z.string().min(1),
  taskId: z.string().uuid(),
  taskTitle: z.string(),
  points: z.number().int().positive().max(2_000_000_000),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string().datetime({ offset: true }),
  decidedByAdminId: z.string().nullable(),
  decidedByUserId: z.string().nullable(),
  decisionNote: z.string().nullable(),
});
const pageSchema = z.object({
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
  tasks: z.array(z.object({ id: z.string().uuid(), title: z.string(), number: z.number().int() })),
  nextCursor: z.string().uuid().nullable(),
  items: z.array(computeRequest),
});
export type ComputePage = z.infer<typeof pageSchema>;
export const computeInput = z
  .object({
    taskId: z.string().uuid(),
    points: z.number().int().positive().max(2_000_000_000),
    reason: z.string().trim().min(1).max(2000),
    requestKey: z.string().uuid(),
  })
  .strict();
export type ComputeInput = z.infer<typeof computeInput>;
export async function fetchCompute(
  crewId: string,
  userId: string,
  cursor: string | null,
  signal: AbortSignal
) {
  identifier.parse(crewId);
  if (cursor) z.string().uuid().parse(cursor);
  const page = pageSchema.parse(
    await api.get(`/crews/${crewId}/compute-requests`, {
      service: "aurora",
      signal,
      params: cursor ? { cursor } : undefined,
    })
  );
  if (
    page.items.some((row) => row.crewId !== crewId || (!page.isOwner && row.userId !== userId)) ||
    new Set(page.items.map((r) => r.id)).size !== page.items.length ||
    new Set(page.tasks.map((r) => r.id)).size !== page.tasks.length ||
    (cursor !== null && page.nextCursor === cursor)
  )
    throw new Error("Compute request scope or pagination changed. Refresh to reload.");
  return page;
}
export async function createCompute(
  crewId: string,
  userId: string,
  input: ComputeInput,
  generation: number
) {
  identifier.parse(crewId);
  const data = computeInput.parse(input);
  if (generation !== getAuthGeneration()) throw new Error("Compute request session expired");
  const receipt = computeRequest
    .extend({ requestKey: z.string().uuid() })
    .parse(await api.post(`/crews/${crewId}/compute-requests`, { service: "aurora", data }));
  if (generation !== getAuthGeneration()) throw new Error("Compute request session expired");
  if (
    receipt.crewId !== crewId ||
    receipt.userId !== userId ||
    receipt.taskId !== data.taskId ||
    receipt.points !== data.points ||
    receipt.reason !== data.reason ||
    receipt.requestKey !== data.requestKey
  )
    throw new Error("Compute request receipt does not match. Refresh before continuing.");
  return receipt;
}

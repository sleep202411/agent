import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const computeRequest = z.object({
  id: z.string().uuid(),
  crewId: identifier,
  userId: z.string().min(1),
  kind: z.enum(["top_up", "initial_allowance", "legacy_allowance"]),
  requestedByUserId: z.string().nullable(),
  remainingWorkload: z.string().nullable(),
  workloadUnit: z.string().nullable(),
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
  isOwner: z.boolean(),
  workspaceLinked: z.boolean(),
  projectBudget: z
    .object({
      pointsPerMinute: z.number().int().positive(),
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
    .nullable(),
  taskUsage: z.array(
    z.object({
      taskId: z.string().uuid(),
      taskTitle: z.string(),
      userId: z.string(),
      approvedPoints: z.string().regex(/^\d+$/),
      creditedPoints: z.string().regex(/^\d+$/),
      pendingPoints: z.string().regex(/^\d+$/),
      consumedPoints: z.string().regex(/^\d+$/),
      committedPoints: z.string().regex(/^-?\d+$/),
    })
  ),
  consumedPoints: z.string().regex(/^\d+$/),
  totals: z.object({
    pending: z.number().int().nonnegative().optional(),
    approved: z.number().int().nonnegative().optional(),
    rejected: z.number().int().nonnegative().optional(),
  }),
  tasks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      number: z.number().int(),
      topUpRequested: z.boolean(),
      assignees: z.array(z.object({ userId: z.string().min(1) })),
    })
  ),
  nextCursor: z.string().uuid().nullable(),
  items: z.array(computeRequest),
});
export type ComputePage = z.infer<typeof pageSchema>;
export const workloadUnits = ["minutes", "hours", "days", "person_days", "percent"] as const;
export const computeInput = z
  .object({
    taskId: z.string().uuid(),
    beneficiaryUserId: z.string().trim().min(1).max(64),
    points: z.number().int().positive().max(500),
    remainingWorkload: z.number().positive().max(999_999_999_999).multipleOf(0.01),
    workloadUnit: z.enum(workloadUnits),
    reason: z.string().trim().min(1).max(2000),
    requestKey: z.string().uuid(),
  })
  .strict()
  .refine((value) => value.workloadUnit !== "percent" || value.remainingWorkload <= 100)
  .refine((value) => value.requestKey !== value.taskId);
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
    page.taskUsage.some((row) => !page.isOwner && row.userId !== userId) ||
    new Set(page.taskUsage.map((row) => `${row.taskId}:${row.userId}`)).size !==
      page.taskUsage.length ||
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
    receipt.userId !== data.beneficiaryUserId ||
    receipt.requestedByUserId !== userId ||
    Number(receipt.remainingWorkload) !== data.remainingWorkload ||
    receipt.workloadUnit !== data.workloadUnit ||
    receipt.taskId !== data.taskId ||
    receipt.points !== data.points ||
    receipt.reason !== data.reason ||
    receipt.requestKey !== data.requestKey
  )
    throw new Error("Compute request receipt does not match. Refresh before continuing.");
  return receipt;
}

export async function setupComputeWorkspace(crewId: string, generation: number) {
  identifier.parse(crewId);
  if (generation !== getAuthGeneration()) throw new Error("Compute request session expired");
  const result = await api.post(`/crews/${crewId}/compute-requests/workspace`, {
    service: "aurora",
  });
  if (generation !== getAuthGeneration()) throw new Error("Compute request session expired");
  return z.object({ workspaceId: z.string().min(1) }).parse(result);
}

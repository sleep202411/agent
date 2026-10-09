import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
export const POINTS_PER_PROJECT_MINUTE = 4460;
const minor = z.string().regex(/^\d+$/);
export const ProjectBudgetData = z.object({
  pointsPerMinute: z.number().int().positive().optional(),
  durationSeconds: z.number().int().positive().max(360000),
  totalPoints: minor,
  producerTaskId: z.string().uuid(),
  producerUserId: z.string().min(1),
  stages: z
    .array(
      z.object({
        key: z.string().uuid(),
        points: z.number().int().positive().max(2_000_000_000),
        note: z.string().min(1),
        adminId: z.string(),
        at: z.string(),
      }),
    )
    .max(1000),
  settlement: z
    .object({
      consumedPoints: minor,
      overrunPoints: minor,
      grossMinor: minor,
      deductionMinor: minor,
      currency: z.enum(['USD', 'CNY']),
      note: z.string().min(1),
      adminId: z.string(),
      at: z.string(),
    })
    .nullable(),
});
export type ProjectBudget = {
  crewId: string;
  workspaceId: string;
  version: number;
  data: z.infer<typeof ProjectBudgetData>;
};
export function projectBudgetPoints(seconds: number) {
  ProjectBudgetData.shape.durationSeconds.parse(seconds);
  return (BigInt(seconds) * BigInt(POINTS_PER_PROJECT_MINUTE) + 59n) / 60n;
}
export function releasedPoints(budget: ProjectBudget) {
  return budget.data.stages.reduce(
    (sum, stage) => sum + BigInt(stage.points),
    0n,
  );
}
export async function readProjectBudget(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  crewId: string,
) {
  const [row] = await tx.$queryRaw<
    ProjectBudget[]
  >`SELECT crew_id AS "crewId", workspace_id AS "workspaceId", version, data FROM crew_project_compute_budgets WHERE crew_id=${crewId}`;
  if (!row) return null;
  row.data = ProjectBudgetData.parse(row.data);
  return row;
}
export async function projectComputeUsage(
  tx: Prisma.TransactionClient,
  workspaceId: string,
) {
  const where = {
    currency: 'compute_point' as const,
    account: { ownerType: 'workspace' as const, ownerId: workspaceId },
    transaction: { sourceType: 'ai_job' },
  };
  const [settled, committed] = await Promise.all([
    tx.walletLedgerEntry.aggregate({
      where: { ...where, entryType: 'settle' },
      _sum: { amount: true },
    }),
    tx.walletLedgerEntry.aggregate({ where, _sum: { availableDelta: true } }),
  ]);
  return {
    consumed: settled._sum.amount ?? 0n,
    committed: -(committed._sum.availableDelta ?? 0n),
  };
}
/** Caller holds the workspace wallet lock, including during generation admission. */
export async function requireProjectBudgetAllowance(
  tx: Prisma.TransactionClient,
  workspaceId: string | null,
  amount: bigint,
) {
  if (!workspaceId) return;
  const [row] = await tx.$queryRaw<
    Array<{ crewId: string }>
  >`SELECT crew_id AS "crewId" FROM crew_project_compute_budgets WHERE workspace_id=${workspaceId}::uuid`;
  if (!row) {
    const [crew] = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM crews WHERE workspace_id=${workspaceId}::uuid AND deleted_at IS NULL`;
    if (crew)
      throw new ConflictException(
        'Configure and release the project compute budget in Admin before generation.',
      );
    return;
  }
  const budget = (await readProjectBudget(tx, row.crewId))!;
  if (budget.data.settlement)
    throw new ConflictException(
      'Project compute is closed for producer settlement.',
    );
  const usage = await projectComputeUsage(tx, workspaceId);
  if (usage.committed + amount > releasedPoints(budget))
    throw new ConflictException(
      'Project compute exceeds released stages. Request an additional Admin-approved release.',
    );
}
export function producerNetAmount(
  budget: ProjectBudget | null,
  taskId: string,
  userId: string,
  gross: bigint,
  currency: string,
) {
  if (
    !budget ||
    budget.data.producerTaskId !== taskId ||
    budget.data.producerUserId !== userId
  )
    return { net: gross, deduction: 0n };
  const settlement = budget.data.settlement;
  if (!settlement)
    throw new ConflictException(
      'Close the project compute budget and document the producer deduction before settlement.',
    );
  if (
    settlement.grossMinor !== gross.toString() ||
    settlement.currency !== currency
  )
    throw new ConflictException(
      'Producer compensation changed after budget closure. Settlement cannot proceed.',
    );
  const deduction = BigInt(settlement.deductionMinor);
  if (deduction > gross)
    throw new ConflictException(
      'Producer deduction exceeds agreed compensation.',
    );
  return { net: gross - deduction, deduction };
}

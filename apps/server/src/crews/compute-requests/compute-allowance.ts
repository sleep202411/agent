import { requireProjectBudgetAllowance } from './project-budget';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Called while holding the payer wallet lock, before writing a new job hold.
 * Existing tasks retain their billing policy until this request flow is used.
 * Holds consume allowance immediately; releases restore it, settlement retains it.
 */
export async function requireCrewComputeAllowance(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string | null;
    userId: string;
    workspaceId: string | null;
    amount: bigint;
  },
) {
  await requireProjectBudgetAllowance(tx, input.workspaceId, input.amount);
  if (!input.projectId) return false;
  const task = await tx.crewTask.findUnique({
    where: { canvasProjectId: input.projectId },
    select: {
      id: true,
      deletedAt: true,
      crew: { select: { workspaceId: true, deletedAt: true } },
      computeRequests: {
        select: {
          userId: true,
          points: true,
          status: true,
          workspaceId: true,
          createdAt: true,
        },
      },
      assignees: {
        where: { userId: input.userId, crewMember: { status: 'active' } },
        select: { userId: true },
      },
    },
  });
  if (!task) return false;
  const requests = task.computeRequests.filter(
    (request) => request.userId === input.userId,
  );
  if (!requests.length) return false;
  if (task.deletedAt || task.crew.deletedAt || !task.assignees.length)
    throw new ForbiddenException(
      'An active assignment is required to spend this task’s compute allowance',
    );
  if (task.crew.workspaceId !== input.workspaceId)
    throw new ConflictException(
      'Task compute points must use the linked Crew workspace',
    );
  const allowance = requests.reduce(
    (sum, request) =>
      sum +
      (request.status === 'approved' &&
      request.workspaceId === input.workspaceId
        ? BigInt(request.points)
        : 0n),
    0n,
  );
  const holds = await tx.walletTransaction.findMany({
    where: {
      sourceType: 'ai_job',
      projectId: input.projectId,
      actorUserId: input.userId,
      workspaceId: input.workspaceId,
      idempotencyKey: { startsWith: 'ai_job:hold:' },
      metadata: { path: ['crewComputeAllowance'], equals: true },
    },
    select: { sourceId: true },
  });
  const usage = await tx.walletLedgerEntry.aggregate({
    where: {
      currency: 'compute_point',
      transaction: {
        sourceType: 'ai_job',
        sourceId: {
          in: holds.flatMap((hold) => (hold.sourceId ? [hold.sourceId] : [])),
        },
      },
    },
    _sum: { availableDelta: true },
  });
  const committed = -(usage._sum.availableDelta ?? 0n);
  if (committed + input.amount > allowance)
    throw new ConflictException(
      'Task compute allowance exceeded. Submit an additional points request for Admin review.',
    );
  return true;
}

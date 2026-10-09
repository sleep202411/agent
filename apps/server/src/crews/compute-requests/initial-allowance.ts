import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { readProjectBudget, releasedPoints } from './project-budget';

/** Called under the Crew task-write lock in the assignment transaction.
 * The task UUID is the reserved initial-grant key per user; reassignment never
 * grants it twice. This allocates existing project points, never mints currency.
 */
export async function grantInitialTaskAllowance(
  tx: Prisma.TransactionClient,
  task: {
    id: string;
    crewId: string;
    title: string;
    computeBudgetPoints?: number | null;
  },
  userIds: string[],
  actorId: string,
) {
  const points = task.computeBudgetPoints ?? 0;
  if (!points || !userIds.length) return;
  const budget = await readProjectBudget(tx, task.crewId);
  if (!budget || budget.data.settlement)
    throw new ConflictException(
      'Configure and release an open project budget before assigning initial compute points.',
    );
  const wallet = await tx.walletAccount.findUnique({
    where: {
      ownerType_ownerId_currency_balanceKind: {
        ownerType: 'workspace',
        ownerId: budget.workspaceId,
        currency: 'compute_point',
        balanceKind: 'consumable',
      },
    },
  });
  if (!wallet || wallet.status !== 'active')
    throw new ConflictException(
      'An active project compute wallet is required.',
    );
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${wallet.id}`})::bigint)`;
  for (const userId of new Set(userIds)) {
    const existing = await tx.crewComputeRequest.findUnique({
      where: {
        crewId_userId_requestKey: {
          crewId: task.crewId,
          userId,
          requestKey: task.id,
        },
      },
    });
    if (existing) continue;
    const allocated = await tx.crewComputeRequest.aggregate({
      where: { crewId: task.crewId, status: 'approved' },
      _sum: { points: true },
    });
    if (
      BigInt(allocated._sum.points ?? 0) + BigInt(points) >
      releasedPoints(budget)
    )
      throw new ConflictException(
        'Initial task allowances exceed released project points. Ask Admin to release another stage.',
      );
    await tx.crewComputeRequest.create({
      data: {
        kind: 'initial_allowance',
        crewId: task.crewId,
        taskId: task.id,
        workspaceId: budget.workspaceId,
        userId,
        taskTitle: task.title,
        points,
        requestKey: task.id,
        reason: 'Initial task compute allowance',
        status: 'approved',
        decidedByUserId: actorId,
        decidedAt: new Date(),
        decisionNote:
          'Allocated on assignment from Admin-released project points.',
      },
    });
  }
}

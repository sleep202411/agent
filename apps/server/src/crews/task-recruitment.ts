import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export async function assertRecruitableTask(
  tx: Prisma.TransactionClient,
  crewId: string,
  taskId: string,
) {
  const task = await tx.crewTask.findFirst({
    where: { id: taskId, crewId, deletedAt: null },
    select: { workflowState: { select: { semantic: true } } },
  });
  if (!task) throw new NotFoundException('Recruitment task not found.');
  if (
    ['approved', 'cancelled', 'submitted'].includes(task.workflowState.semantic)
  )
    throw new ConflictException(
      'This task is no longer accepting recruitment.',
    );
}

/** Called under the shared task-write lock. Soft-deleting a posting must not
 * remove the agreed compensation or turn assignment into an approval bypass. */
export async function assertRecruitedTaskAssignees(
  tx: Prisma.TransactionClient,
  taskId: string,
  assignees: Array<{
    userId: string;
    currency: string;
    rewardAmountMinor?: number | null;
  }>,
) {
  const positions = await tx.crewPosition.findMany({
    where: { OR: [{ taskId }, { groupedTasks: { some: { id: taskId } } }] },
    select: { id: true },
  });
  if (!positions.length) return;
  // Hold active membership and source roles through assignment. Revocation
  // either wins before this read or waits until the authorized write commits.
  for (const assignee of [...assignees].sort((a, b) =>
    a.userId.localeCompare(b.userId),
  )) {
    await tx.$queryRaw`
      SELECT m.id FROM crew_members m
      JOIN crew_member_positions mp ON mp.member_id=m.id
      JOIN crew_positions p ON p.id=mp.source_position_id
      WHERE (p.task_id=${taskId}::uuid OR EXISTS (SELECT 1 FROM "_GroupedRecruitment" g WHERE g."A"=p.id AND g."B"=${taskId}::uuid)) AND m.user_id=${assignee.userId}
        AND m.status='active' AND m.removed_at IS NULL
      ORDER BY m.id, mp.id FOR SHARE OF m, mp
    `;
    const applications = await tx.crewApplication.findMany({
      where: {
        positionId: { in: positions.map((row) => row.id) },
        applicantId: assignee.userId,
        status: 'approved',
        position: {
          memberPositions: {
            some: {
              member: {
                userId: assignee.userId,
                status: 'active',
                removedAt: null,
              },
            },
          },
        },
        termsVersion: { gt: 0 },
      },
      include: {
        terms: true,
        position: { select: { groupedTaskTerms: true } },
      },
    });
    const matches = applications.some((app) =>
      app.terms.some(
        (term) =>
          term.version === app.termsVersion &&
          term.confirmedAt &&
          term.feePeriod === 'project' &&
          term.currency === assignee.currency &&
          (groupedTaskAmount(app.position?.groupedTaskTerms, taskId)
            ? groupedTaskAmount(app.position.groupedTaskTerms, taskId)!
                .amount === (assignee.rewardAmountMinor ?? 0)
            : term.feeAmount === BigInt(assignee.rewardAmountMinor ?? 0)),
      ),
    );
    if (!matches)
      throw new ConflictException(
        'Task assignment requires approved recruitment and confirmed project-fee terms matching the assigned reward.',
      );
  }
}

/** A bundle's accepted project fee is allocated by its published task amounts. */
export function groupedTaskAmount(
  terms: Prisma.JsonValue | null | undefined,
  taskId: string,
): { amount: number; currency: string } | null {
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) return null;
  const value = terms[taskId];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.amount !== 'number' ||
    typeof value.currency !== 'string'
  )
    return null;
  return { amount: value.amount, currency: value.currency };
}

export function assertGroupedFee(
  terms: Prisma.JsonValue | null | undefined,
  input: {
    feeAmount: string | bigint;
    currency: string;
    feePeriod: string;
    revenueShareBp?: number | null;
  },
) {
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) return;
  const allocations = Object.keys(terms).map((id) =>
    groupedTaskAmount(terms, id),
  );
  if (
    !allocations.length ||
    allocations.some((a) => !a || a.currency !== input.currency) ||
    input.feePeriod !== 'project' ||
    Boolean(input.revenueShareBp) ||
    allocations.reduce((sum, a) => sum + BigInt(a!.amount), 0n) !==
      BigInt(input.feeAmount)
  )
    throw new ConflictException(
      'Grouped recruitment requires the published total project fee and currency, preserving each task allocation.',
    );
}

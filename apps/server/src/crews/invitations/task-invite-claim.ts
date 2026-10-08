import { TASK_PAYMENT_TERMS } from '@repo/shared/crew';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { assertRecruitedTaskAssignees } from '../task-recruitment';

/** Must share the invitation redemption transaction with membership admission. */
export async function lockTaskInviteTarget(
  tx: Prisma.TransactionClient,
  crewId: string,
  taskId: string,
  expectedVersion: number,
) {
  // Same lock as task edits, deletions and recruitment mutations.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
  const task = await tx.crewTask.findFirst({
    where: { id: taskId, crewId, deletedAt: null },
    include: { assignees: true, workflowState: true },
  });
  if (!task) throw new NotFoundException('This task is no longer available.');
  if (task.version !== expectedVersion)
    throw new ConflictException({
      code: 'CREW_TASK_INVITE_CHANGED',
      message: 'This task changed. Ask the producer for a new invitation link.',
    });
  if (
    task.assignees.length ||
    ['submitted', 'approved', 'cancelled'].includes(task.workflowState.semantic)
  )
    throw new ConflictException({
      code: 'CREW_TASK_INVITE_UNAVAILABLE',
      message:
        'This task is already assigned or no longer accepting a creator.',
    });
  if (task.canvasProjectId)
    await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${task.canvasProjectId}::uuid FOR UPDATE`;
  return task;
}

const compensationSchema = z.object({
  compensation: z.object({
    paymentTerms: z.enum(TASK_PAYMENT_TERMS).nullable().optional(),
    profitShareBps: z.number().int().min(0).max(10000).nullable().optional(),
    rewardCurrency: z.enum(['USD', 'CNY']).default('USD'),
    rewardUsdMinor: z.number().int().nonnegative().safe().nullable(),
  }),
});

/** The caller has already checked the inviter's current authority and eligibility.
 * This writes assignment and canvas access, never a payment or settlement. */
export async function claimTaskInviteTarget(
  tx: Prisma.TransactionClient,
  task: Awaited<ReturnType<typeof lockTaskInviteTarget>>,
  memberId: string,
  userId: string,
  inviterId: string,
  linkId: string,
) {
  // Keep an existing member's admission valid through the assignment write.
  // A concurrent removal/suspension must either finish first or wait for us.
  await tx.$queryRaw`SELECT id FROM crew_members WHERE id = ${memberId} FOR SHARE`;
  const member = await tx.crewMember.findFirst({
    where: {
      id: memberId,
      crewId: task.crewId,
      userId,
      status: 'active',
      removedAt: null,
    },
    select: { id: true },
  });
  if (!member)
    throw new ConflictException(
      'An active Crew membership is required to claim this task.',
    );
  const parsed = compensationSchema.safeParse(task.metadata);
  if (!parsed.success)
    throw new ConflictException(
      'The task compensation is incomplete. Ask the producer to update the task.',
    );
  const rewardAmountMinor = parsed.data.compensation.rewardUsdMinor;
  const assignment = {
    userId,
    currency: parsed.data.compensation.rewardCurrency,
    rewardAmountMinor,
  };
  await assertRecruitedTaskAssignees(tx, task.id, [assignment]);
  const updated = await tx.crewTask.updateMany({
    where: {
      id: task.id,
      crewId: task.crewId,
      version: task.version,
      deletedAt: null,
      assignees: { none: {} },
    },
    data: { version: { increment: 1 } },
  });
  if (updated.count !== 1)
    throw new ConflictException(
      'This task changed before it could be claimed.',
    );
  await tx.crewTaskAssignee.create({
    data: {
      crewId: task.crewId,
      taskId: task.id,
      crewMemberId: member.id,
      userId,
      currency: assignment.currency,
      rewardAmountMinor:
        rewardAmountMinor == null ? null : BigInt(rewardAmountMinor),
    },
  });
  if (task.canvasProjectId) {
    const existing = await tx.projectMember.findFirst({
      where: { projectId: task.canvasProjectId, userId, removedAt: null },
    });
    if (!existing)
      await tx.projectMember.create({
        data: {
          projectId: task.canvasProjectId,
          userId,
          role: 'editor',
          status: 'active',
          grantedById: inviterId,
        },
      });
  }
  await tx.crewAuthorizationEvent.create({
    data: {
      crewId: task.crewId,
      memberId,
      actorUserId: userId,
      action: 'task.claimed.invite_link',
      after: {
        taskId: task.id,
        linkId,
        invitedByUserId: inviterId,
        taskVersion: task.version,
        // Capture what the recipient accepted independently of later task edits.
        compensation: {
          currency: parsed.data.compensation.rewardCurrency,
          rewardAmountMinor,
          paymentTerms: parsed.data.compensation.paymentTerms ?? null,
          profitShareBps: parsed.data.compensation.profitShareBps ?? null,
        },
      },
    },
  });
}

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// Callers hold the dispute identity lock before taking the Crew write lock.
export async function requireDisputeParticipants(
  tx: Prisma.TransactionClient,
  taskId: string,
  users: readonly string[],
) {
  const initial = await tx.crewTask.findUnique({
    where: { id: taskId },
    select: { crewId: true },
  });
  if (!initial) throw new NotFoundException('Task not found.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${initial.crewId}`},0))`;
  const task = await tx.crewTask.findUnique({
    where: { id: taskId },
    include: {
      assignees: true,
      crew: { include: { ownership: { include: { member: true } } } },
    },
  });
  if (!task) throw new NotFoundException('Task not found.');
  const participants = new Set([
    task.createdByUserId,
    task.approvedByUserId,
    task.crew.ownership?.member.userId,
    ...task.assignees.map((a) => a.userId),
  ]);
  for (const id of users) {
    if (
      !participants.has(id) &&
      !(await tx.crewTaskSubmission.findFirst({
        where: {
          taskId,
          OR: [{ submittedByUserId: id }, { reviewedByUserId: id }],
        },
        select: { id: true },
      }))
    )
      throw new ForbiddenException(
        'Dispute parties must have participated in this task.',
      );
  }
}

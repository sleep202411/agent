import { CrewTaskStatus, type Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

const NO_CREATOR_DEADLINE_RISK: CrewTaskStatus[] = [
  CrewTaskStatus.approved,
  CrewTaskStatus.cancelled,
  CrewTaskStatus.submitted,
];

/** Shared by saved views and summary counts; review delays are not creator lateness. */
export function overdueTaskPredicate(
  now = new Date(),
): Prisma.CrewTaskWhereInput {
  return {
    dueAt: { lt: now },
    workflowState: { semantic: { notIn: [...NO_CREATOR_DEADLINE_RISK] } },
  };
}

export const TASK_ADVANCE_WARNING_MS = 72 * 60 * 60 * 1000;

/** The approved advance window uses elapsed hours, independent of locale or DST. */
export function taskReminderPredicate(
  now = new Date(),
): Prisma.CrewTaskWhereInput {
  return {
    ...overdueTaskPredicate(now),
    dueAt: { lte: new Date(now.getTime() + TASK_ADVANCE_WARNING_MS) },
  };
}

/** Deadline risk is independent of workflow state; review time is not creator lateness. */
export function taskDeadlineRisk(
  status: string,
  dueAt: Date | null,
  now = new Date(),
) {
  if (
    !dueAt ||
    NO_CREATOR_DEADLINE_RISK.some((excluded) => excluded === status)
  )
    return null;
  return {
    dueAt: dueAt.toISOString(),
    overdue: dueAt.getTime() < now.getTime(),
  };
}

/** An explicit review extension never rewrites the previous submission's timing evidence. */
export function revisionDeadline(
  current: Date | null,
  requested: string | undefined,
  now: Date,
) {
  if (requested === undefined) return undefined;
  const next = new Date(requested);
  if (
    !Number.isFinite(next.getTime()) ||
    next <= now ||
    (current && next <= current)
  ) {
    throw new BadRequestException(
      'The revision deadline must be in the future and extend the current deadline.',
    );
  }
  return next;
}

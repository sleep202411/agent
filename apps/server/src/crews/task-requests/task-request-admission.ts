import { ConflictException, HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { CrewAuthorizationService } from '../crew-authorization.service';
import { taskRequestExecution } from './task-request-context';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export async function admitTaskCreation(
  db: PrismaClient,
  authorization: CrewAuthorizationService,
  crewId: string,
  requesterId: string,
  kind: string,
  input: unknown,
) {
  const execution = taskRequestExecution.getStore();
  if (execution) {
    if (execution.crewId !== crewId || execution.requesterId !== requesterId)
      throw new ConflictException(
        'Task approval belongs to another project or requester.',
      );
    await authorization.requireMembership(crewId, requesterId, execution.tx);
    return;
  }
  const result = await db.$transaction(async (tx) => {
    await authorization.requireMembership(crewId, requesterId, tx);
    const submissionKey =
      kind === 'manual' &&
      input &&
      typeof input === 'object' &&
      'submissionKey' in input
        ? input.submissionKey
        : null;
    const requestKey =
      typeof submissionKey === 'string'
        ? `manual:${submissionKey}`
        : createHash('sha256')
            .update(`${kind}:${canonical(input)}`)
            .digest('hex');
    const row = await tx.crewTaskCreationRequest.upsert({
      where: {
        crewId_requesterId_requestKey: { crewId, requesterId, requestKey },
      },
      create: {
        crewId,
        requesterId,
        kind,
        requestKey,
        input: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
      },
      update: {},
    });
    if (row.kind !== kind || canonical(row.input) !== canonical(input))
      throw new ConflictException(
        'This submission key already belongs to a different task request.',
      );
    return row;
  });
  throw new HttpException(
    {
      code: 'TASK_APPROVAL_REQUIRED',
      requestId: result.id,
      status: result.status,
      message:
        result.status === 'pending'
          ? 'Task request submitted for producer approval. No task has been published.'
          : `This task request was already ${result.status}.`,
    },
    202,
  );
}

export function taskCreationTransaction<T>(
  db: PrismaClient,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout?: number },
) {
  const execution = taskRequestExecution.getStore();
  return execution ? write(execution.tx) : db.$transaction(write, options);
}

/** Publish realtime effects only after the approval transaction has committed. */
export async function afterTaskCreationCommit(
  effect: () => Promise<unknown>,
): Promise<void> {
  const execution = taskRequestExecution.getStore();
  if (execution) execution.afterCommit.push(effect);
  else await effect();
}

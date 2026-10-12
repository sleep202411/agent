import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

/** Only the producer approval executor installs this context, never an HTTP flag. */
export type TaskRequestExecution = {
  requestId: string;
  requestedAt: Date;
  crewId: string;
  requesterId: string;
  tx: Prisma.TransactionClient;
  afterCommit: Array<() => Promise<unknown>>;
};
export const taskRequestExecution =
  new AsyncLocalStorage<TaskRequestExecution>();

import type { Prisma } from '@prisma/client';
import { taskRequestExecution } from '../task-request-context';
/** Existing creation-unit fixtures exercise execution AFTER producer approval.
 * Admission, producer authorization and atomicity have separate integration tests.
 */
export function approvedExecution<T extends object>(
  service: T,
  method: keyof T,
  tx: () => unknown,
  userIndex: number,
): T {
  const original = service[method] as (...args: unknown[]) => Promise<unknown>;
  Object.assign(service, {
    [method]: async (...args: unknown[]) => {
      const afterCommit: Array<() => Promise<unknown>> = [];
      const result = await taskRequestExecution.run(
        {
          requestId: 'approved-fixture',
          requestedAt: new Date(),
          crewId: String(args[0]),
          requesterId: String(args[userIndex]),
          tx: tx() as Prisma.TransactionClient,
          afterCommit,
        },
        () => original.apply(service, args) as Promise<unknown>,
      );
      await Promise.all(afterCommit.map((effect) => effect()));
      return result;
    },
  });
  return service;
}

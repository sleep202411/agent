import { ForbiddenException, HttpException } from '@nestjs/common';
import {
  admitTaskCreation,
  afterTaskCreationCommit,
  taskCreationTransaction,
} from './task-request-admission';
import { taskRequestExecution } from './task-request-context';

function fixture() {
  const stored = new Map<string, Record<string, unknown>>();
  const tx = {
    crewTaskCreationRequest: {
      upsert: jest.fn(
        ({
          create,
        }: {
          create: Record<string, unknown> & { requestKey: string };
        }) => {
          const existing = stored.get(create.requestKey);
          if (existing) return Promise.resolve(existing);
          const row = { ...create, id: 'request', status: 'pending' };
          stored.set(create.requestKey, row);
          return Promise.resolve(row);
        },
      ),
    },
  };
  const db = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
  };
  const auth = { requireMembership: jest.fn().mockResolvedValue({}) };
  const admit = (input: unknown = { title: 'A' }) =>
    admitTaskCreation(
      db as never,
      auth as never,
      'crew',
      'member',
      'manual',
      input,
    );
  return { tx, db, auth, admit, stored };
}
describe('Task approval admission', () => {
  it('queues members and returns a receipt without executing task creation', async () => {
    const f = fixture();
    const error = (await f.admit().catch((e: unknown) => e)) as HttpException;
    expect(error.getStatus()).toBe(202);
    expect(error.getResponse()).toMatchObject({
      code: 'TASK_APPROVAL_REQUIRED',
      status: 'pending',
      requestId: 'request',
    });
    expect(f.stored.size).toBe(1);
  });
  it('deduplicates retries and canonical property ordering', async () => {
    const f = fixture();
    await f.admit({ title: 'A', description: 'B' }).catch(() => {});
    await f.admit({ description: 'B', title: 'A' }).catch(() => {});
    expect(f.stored.size).toBe(1);
  });
  it('permits intentional duplicates with distinct keys but rejects changed-key reuse', async () => {
    const f = fixture();
    await f.admit({ title: 'A', submissionKey: 'first' }).catch(() => {});
    await f.admit({ title: 'A', submissionKey: 'second' }).catch(() => {});
    expect(f.stored.size).toBe(2);
    await expect(
      f.admit({ title: 'Changed', submissionKey: 'first' }),
    ).rejects.toThrow('different task request');
  });
  it('does not queue an inactive member', async () => {
    const f = fixture();
    f.auth.requireMembership.mockRejectedValue(new ForbiddenException());
    await expect(f.admit()).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.crewTaskCreationRequest.upsert).not.toHaveBeenCalled();
  });
  it('reuses only the matching producer transaction and defers broadcasts', async () => {
    const f = fixture(),
      effect = jest.fn().mockResolvedValue(undefined);
    const context = {
      requestId: 'request',
      requestedAt: new Date(),
      crewId: 'crew',
      requesterId: 'member',
      tx: f.tx as never,
      afterCommit: [] as Array<() => Promise<unknown>>,
    };
    await taskRequestExecution.run(context, async () => {
      await f.admit();
      expect(
        await taskCreationTransaction(f.db as never, (tx) =>
          Promise.resolve(tx),
        ),
      ).toBe(f.tx);
      await afterTaskCreationCommit(effect);
      await expect(
        admitTaskCreation(
          f.db as never,
          f.auth as never,
          'other',
          'member',
          'manual',
          {},
        ),
      ).rejects.toThrow('another project');
    });
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
    await context.afterCommit[0]();
    expect(effect).toHaveBeenCalledTimes(1);
  });
});

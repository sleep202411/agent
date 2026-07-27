import {
  retryDelayMs,
  StudioAgentCommandOutboxDispatcher,
} from './studio-agent.outbox';

const CREATED_AT = new Date('2026-07-24T12:00:00.000Z');

function command(
  id: string,
  workflowId: string,
  type: 'start' | 'signal' | 'cancel',
  sequence: number,
) {
  return {
    id,
    threadId: '019f8c10-0000-7000-8000-000000000001',
    runId: workflowId,
    workflowId,
    type,
    payload: { sequence },
    leaseToken: '019f8c10-0000-7000-8000-000000000002',
    attemptCount: 1,
    maxAttempts: 12,
    createdAt: new Date(CREATED_AT.getTime() + sequence),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function dispatchHarness(commands: ReturnType<typeof command>[]) {
  const transport = { dispatch: jest.fn() };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(commands),
    studioAgentCommandOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const dispatcher = new StudioAgentCommandOutboxDispatcher(
    prisma as never,
    {
      value: {
        commandLeaseMs: 30_000,
        commandBatchSize: 100,
      },
    } as never,
    transport as never,
    {} as never,
    {} as never,
  );
  return { dispatcher, prisma, transport };
}

describe('Studio Agent command outbox backoff', () => {
  it('uses bounded exponential retry delays', () => {
    expect(retryDelayMs(1)).toBe(500);
    expect(retryDelayMs(2)).toBe(1_000);
    expect(retryDelayMs(5)).toBe(8_000);
    expect(retryDelayMs(32)).toBe(300_000);
  });
});

describe('Studio Agent command outbox workflow ordering', () => {
  it.each([
    ['start before signal', 'start', 'signal'],
    ['signal 1 before signal 2', 'signal', 'signal'],
    ['signal before cancel', 'signal', 'cancel'],
  ] as const)(
    'dispatches %s serially for one workflow',
    async (_label, firstType, secondType) => {
      const workflowId = '019f8c10-0000-7000-8000-000000000010';
      const first = deferred();
      const calls: number[] = [];
      const { dispatcher, transport } = dispatchHarness([
        command(
          '019f8c10-0000-7000-8000-000000000012',
          workflowId,
          secondType,
          2,
        ),
        command(
          '019f8c10-0000-7000-8000-000000000011',
          workflowId,
          firstType,
          1,
        ),
      ]);
      transport.dispatch.mockImplementation(
        ({ payload }: { payload: { sequence: number } }) => {
          calls.push(payload.sequence);
          return payload.sequence === 1 ? first.promise : Promise.resolve();
        },
      );

      const draining = dispatcher.drainOnce();
      await flushAsyncWork();

      expect(calls).toEqual([1]);
      first.resolve();
      await draining;
      expect(calls).toEqual([1, 2]);
    },
  );

  it('dispatches different workflows concurrently', async () => {
    const firstWorkflow = deferred();
    const secondWorkflow = deferred();
    const calls: string[] = [];
    const { dispatcher, transport } = dispatchHarness([
      command(
        '019f8c10-0000-7000-8000-000000000021',
        '019f8c10-0000-7000-8000-000000000020',
        'start',
        1,
      ),
      command(
        '019f8c10-0000-7000-8000-000000000031',
        '019f8c10-0000-7000-8000-000000000030',
        'start',
        2,
      ),
    ]);
    transport.dispatch.mockImplementation(
      ({ workflowId }: { workflowId: string }) => {
        calls.push(workflowId);
        return workflowId.endsWith('20')
          ? firstWorkflow.promise
          : secondWorkflow.promise;
      },
    );

    const draining = dispatcher.drainOnce();
    await flushAsyncWork();

    expect(calls).toEqual([
      '019f8c10-0000-7000-8000-000000000020',
      '019f8c10-0000-7000-8000-000000000030',
    ]);
    firstWorkflow.resolve();
    secondWorkflow.resolve();
    await draining;
  });
});

describe('Studio Agent command outbox dead-letter', () => {
  it('is a no-op when a duplicate worker has already consumed the lease', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'thread' }]),
      studioAgentCommandOutbox: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const terminalizeInTransaction = jest.fn();
    const dispatcher = new StudioAgentCommandOutboxDispatcher(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { terminalizeInTransaction } as never,
    );

    await expect(
      (
        dispatcher as unknown as {
          deadLetter: (
            command: Record<string, unknown>,
            error: Record<string, unknown>,
          ) => Promise<unknown[]>;
        }
      ).deadLetter(
        {
          id: '019f8c10-0000-7000-8000-000000000001',
          threadId: '019f8c10-0000-7000-8000-000000000002',
          runId: '019f8c10-0000-7000-8000-000000000003',
          workflowId: 'workflow',
          type: 'start',
          payload: {},
          leaseToken: '019f8c10-0000-7000-8000-000000000004',
          attemptCount: 12,
          maxAttempts: 12,
        },
        {
          code: 'runtime_command_delivery_failed',
          message: 'Temporal is unavailable.',
          retryable: true,
          details: null,
        },
      ),
    ).resolves.toEqual([]);

    expect(terminalizeInTransaction).not.toHaveBeenCalled();
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.studioAgentCommandOutbox.updateMany.mock
        .invocationCallOrder[0],
    );
  });

  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'does not fail a live root when a stale child command targets a %s child',
    async (childStatus) => {
      const childRun = {
        id: '019f8c10-0000-7000-8000-000000000003',
        threadId: '019f8c10-0000-7000-8000-000000000002',
        rootRunId: '019f8c10-0000-7000-8000-000000000005',
        parentRunId: '019f8c10-0000-7000-8000-000000000005',
        status: childStatus,
      };
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'thread' }]),
        studioAgentCommandOutbox: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        studioAgentRun: {
          findUnique: jest.fn().mockResolvedValue(childRun),
        },
      };
      const prisma = {
        $transaction: jest.fn(
          (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
      };
      const terminalizeInTransaction = jest.fn();
      const dispatcher = new StudioAgentCommandOutboxDispatcher(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        { terminalizeInTransaction } as never,
      );

      await expect(
        (
          dispatcher as unknown as {
            deadLetter: (
              command: Record<string, unknown>,
              error: Record<string, unknown>,
            ) => Promise<unknown[]>;
          }
        ).deadLetter(
          {
            id: '019f8c10-0000-7000-8000-000000000001',
            threadId: childRun.threadId,
            runId: childRun.id,
            workflowId: childRun.id,
            type: 'signal',
            payload: {},
            leaseToken: '019f8c10-0000-7000-8000-000000000004',
            attemptCount: 12,
            maxAttempts: 12,
          },
          {
            code: 'runtime_command_delivery_failed',
            message: 'The child workflow is already closed.',
            retryable: true,
            details: null,
          },
        ),
      ).resolves.toEqual([]);

      expect(transaction.studioAgentRun.findUnique).toHaveBeenCalledTimes(1);
      expect(terminalizeInTransaction).not.toHaveBeenCalled();
    },
  );
});

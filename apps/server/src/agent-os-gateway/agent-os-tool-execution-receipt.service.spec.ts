import type { AgentOsCapabilityExecuteInput } from './capabilities/capability-handler';
import { AgentOsToolExecutionReceiptService } from './agent-os-tool-execution-receipt.service';

const INPUT: AgentOsCapabilityExecuteInput = {
  toolId: 'characters.upsert',
  runId: '00000000-0000-4000-8000-000000000010',
  conversationId: '00000000-0000-4000-8000-000000000011',
  turnId: '00000000-0000-4000-8000-000000000012',
  toolCallId: 'tool-call-1',
  actorId: 'creator-1',
  projectId: '00000000-0000-4000-8000-000000000013',
  skillResolutionId: '00000000-0000-4000-8000-000000000014',
  skillVersionIds: [],
  idempotencyKey: 'command-idempotency-key-1',
  startExecution: {
    executionToken: '00000000-0000-4000-8000-000000000015',
    executionAttemptId: '00000000-0000-4000-8000-000000000016',
    executionEpoch: 1,
    executionOwnerId: '00000000-0000-4000-8000-000000000017',
  },
  arguments: { baseRevision: 0, characters: [] },
};

const CONTINUATION_INPUT: AgentOsCapabilityExecuteInput = {
  ...INPUT,
  startExecution: undefined,
  continuationExecution: {
    executionToken: '00000000-0000-4000-8000-000000000025',
    executionAttemptId: '00000000-0000-4000-8000-000000000026',
    executionEpoch: 1,
    executionOwnerId: '00000000-0000-4000-8000-000000000027',
  },
};

type StoredReceipt = Record<string, unknown> & {
  id: string;
  status: string;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  response: unknown;
};

function harness() {
  let now = new Date('2026-08-21T00:00:00.000Z');
  let receipt: StoredReceipt | null = null;

  const matches = (where: Record<string, unknown>) => {
    if (!receipt) return false;
    return Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return true;
      return value === undefined || receipt?.[key] === value;
    });
  };
  const repository = {
    findFirst: jest.fn().mockImplementation(() => Promise.resolve(receipt)),
    findUnique: jest.fn().mockImplementation(() => Promise.resolve(receipt)),
    create: jest
      .fn()
      .mockImplementation(({ data }: { data: StoredReceipt }) => {
        receipt = {
          ...data,
          response: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        return Promise.resolve(receipt);
      }),
    update: jest
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        if (!receipt) throw new Error('missing receipt');
        receipt = { ...receipt, ...data, updatedAt: now };
        return Promise.resolve(receipt);
      }),
    updateMany: jest
      .fn()
      .mockImplementation(
        ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (!receipt || !matches(where)) return Promise.resolve({ count: 0 });
          receipt = { ...receipt, ...data, updatedAt: now };
          return Promise.resolve({ count: 1 });
        },
      ),
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([{ now }])),
    agentOsToolExecutionReceipt: repository,
  };
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    agentOsToolExecutionReceipt: repository,
  };
  const journal = {
    assertToolExecutionFenceInTx: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AgentOsToolExecutionReceiptService(
    prisma as never,
    journal as never,
  );
  return {
    service,
    tx,
    journal,
    receipt: () => receipt,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe('AgentOsToolExecutionReceiptService', () => {
  it('replays a completed response across a new execution epoch without re-running the command', async () => {
    const h = harness();
    const execute = jest.fn(async (input: AgentOsCapabilityExecuteInput) => {
      const response = { projectRevision: 1, written: [{ id: 'hero' }] };
      await h.service.completeSuccessInTx(h.tx as never, input, response);
      return { ok: true as const, data: response };
    });

    const first = await h.service.executeCommand(INPUT, execute);
    const staleWorkerRetry = {
      ...INPUT,
      startExecution: {
        ...INPUT.startExecution!,
        executionAttemptId: '00000000-0000-4000-8000-000000000099',
        executionEpoch: 2,
      },
    };
    const replay = await h.service.executeCommand(staleWorkerRetry, execute);

    expect(first).toEqual(replay);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(h.receipt()).toMatchObject({
      status: 'completed',
      leaseId: null,
    });
    expect(h.journal.assertToolExecutionFenceInTx).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the same toolCallId is reused with another payload', async () => {
    const h = harness();
    const first = await h.service.claim(INPUT);
    expect(first.kind).toBe('claimed');

    await expect(
      h.service.claim({
        ...INPUT,
        arguments: { baseRevision: 9, characters: [] },
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'AGENT_OS_TOOL_RECEIPT_CONFLICT',
      },
    });
  });

  it('does not cache a retryable transport/domain failure', async () => {
    const h = harness();
    const temporary = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: 'DOMAIN_UNAVAILABLE',
        message: 'temporarily unavailable',
        retryable: true,
      })
      .mockImplementationOnce(async (input: AgentOsCapabilityExecuteInput) => {
        const data = { projectRevision: 1, written: [] };
        await h.service.completeSuccessInTx(h.tx as never, input, data);
        return { ok: true, data };
      });

    await expect(h.service.executeCommand(INPUT, temporary)).resolves.toEqual(
      expect.objectContaining({ ok: false, retryable: true }),
    );
    await expect(h.service.executeCommand(INPUT, temporary)).resolves.toEqual({
      ok: true,
      data: { projectRevision: 1, written: [] },
    });
    expect(temporary).toHaveBeenCalledTimes(2);
    expect(h.receipt()).toMatchObject({ status: 'completed' });
  });

  it('rejects a late result after an expired lease was reclaimed', async () => {
    const h = harness();
    const first = await h.service.claim(INPUT, 5_000);
    expect(first.kind).toBe('claimed');
    h.advance(5_001);
    const second = await h.service.claim(INPUT, 5_000);
    expect(second.kind).toBe('claimed');
    if (first.kind !== 'claimed' || second.kind !== 'claimed') return;

    await expect(
      h.service.completeSuccessInTx(
        h.tx as never,
        { ...INPUT, toolExecutionReceipt: first.context },
        { projectRevision: 1 },
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'AGENT_OS_TOOL_EXECUTION_SUPERSEDED',
      },
    });
    await expect(
      h.service.completeSuccessInTx(
        h.tx as never,
        { ...INPUT, toolExecutionReceipt: second.context },
        { projectRevision: 1 },
      ),
    ).resolves.toEqual({ ok: true, data: { projectRevision: 1 } });
  });

  it('never reclaims an unfinished initial-turn receipt without execution proof', async () => {
    const h = harness();
    await h.service.claim(INPUT, 5_000);
    h.advance(5_001);

    await expect(
      h.service.claim({ ...INPUT, startExecution: undefined }, 5_000),
    ).rejects.toMatchObject({
      response: {
        code: 'AGENT_OS_TOOL_RECEIPT_CONFLICT',
      },
    });
  });

  it('fences an expired continuation receipt to the new epoch and rejects the old result', async () => {
    const h = harness();
    const first = await h.service.claim(CONTINUATION_INPUT, 5_000);
    expect(first.kind).toBe('claimed');
    h.advance(5_001);
    const nextInput: AgentOsCapabilityExecuteInput = {
      ...CONTINUATION_INPUT,
      continuationExecution: {
        ...CONTINUATION_INPUT.continuationExecution!,
        executionAttemptId: '00000000-0000-4000-8000-000000000029',
        executionEpoch: 2,
        executionOwnerId: '00000000-0000-4000-8000-000000000030',
      },
    };
    const second = await h.service.claim(nextInput, 5_000);
    expect(second.kind).toBe('claimed');
    if (first.kind !== 'claimed' || second.kind !== 'claimed') return;

    await expect(
      h.service.completeSuccessInTx(
        h.tx as never,
        { ...CONTINUATION_INPUT, toolExecutionReceipt: first.context },
        { projectRevision: 1 },
      ),
    ).rejects.toMatchObject({
      response: { code: 'AGENT_OS_TOOL_EXECUTION_SUPERSEDED' },
    });
    await expect(
      h.service.completeSuccessInTx(
        h.tx as never,
        { ...nextInput, toolExecutionReceipt: second.context },
        { projectRevision: 1 },
      ),
    ).resolves.toEqual({ ok: true, data: { projectRevision: 1 } });
    expect(h.journal.assertToolExecutionFenceInTx).toHaveBeenLastCalledWith(
      h.tx,
      expect.objectContaining({
        continuationExecution: nextInput.continuationExecution,
      }),
    );
  });

  it('does not let an executing continuation lose or change its proof kind', async () => {
    const h = harness();
    await h.service.claim(CONTINUATION_INPUT, 5_000);
    h.advance(5_001);

    await expect(
      h.service.claim(
        { ...CONTINUATION_INPUT, continuationExecution: undefined },
        5_000,
      ),
    ).rejects.toMatchObject({
      response: { code: 'AGENT_OS_TOOL_RECEIPT_CONFLICT' },
    });
    await expect(
      h.service.claim(
        {
          ...CONTINUATION_INPUT,
          startExecution: INPUT.startExecution,
        },
        5_000,
      ),
    ).rejects.toMatchObject({
      response: { code: 'AGENT_OS_TOOL_RECEIPT_CONFLICT' },
    });
  });
});

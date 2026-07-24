import { STUDIO_AGENT_SCHEMA_VERSION } from '@repo/shared/studio-agent';
import { StudioAgentRunTerminalService } from './studio-agent-run-terminal.service';

const THREAD_ID = '019f8c10-0000-7000-8000-000000000001';
const RUN_ID = '019f8c10-0000-7000-8000-000000000002';
const INPUT_ID = '019f8c10-0000-7000-8000-000000000003';
const MESSAGE_ID = '019f8c10-0000-7000-8000-000000000004';
const ACTIVE_RUN_ID = '019f8c10-0000-7000-8000-000000000005';
const NOW = new Date('2026-07-24T12:00:00.000Z');

const permissionPolicy = {
  schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
  policyId: '019f8c10-0000-7000-8000-000000000006',
  revision: 1,
  mode: 'full',
  rules: [],
  createdAt: NOW.toISOString(),
};

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    threadId: THREAD_ID,
    rootRunId: RUN_ID,
    parentRunId: null,
    sourceStepId: null,
    sourceToolCallId: null,
    depth: 0,
    contextBoundaryOrdinal: null,
    kind: 'turn',
    task: null,
    trigger: 'message',
    triggerMessageId: MESSAGE_ID,
    scenarioId: 'story.studio.assistant',
    scenarioVersion: '1.0.0',
    permissionPolicy,
    workflowId: RUN_ID,
    status: 'running',
    phase: 'model',
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: NOW,
    completedAt: null,
    error: null,
    ...overrides,
  };
}

function harness(options?: {
  queued?: boolean;
  activeRunId?: string | null;
  persistedRun?: ReturnType<typeof run>;
}) {
  const root = options?.persistedRun ?? run();
  const queuedInput = {
    id: INPUT_ID,
    threadId: THREAD_ID,
    targetRunId: RUN_ID,
    messageId: MESSAGE_ID,
    delivery: 'enqueue',
    status: 'accepted',
    sequence: 1n,
    promotedToRunId: null,
    acceptedAt: NOW,
    consumedAt: null,
    targetRun: root,
  };
  const createdRuns: Array<Record<string, unknown>> = [];
  const eventDrafts: Array<Record<string, unknown>> = [];
  const transaction = {
    studioAgentRun: {
      findMany: jest.fn().mockResolvedValue([root]),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...root, ...data }),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const created = run({
          ...data,
          status: 'queued',
          createdAt: NOW,
          updatedAt: NOW,
          startedAt: null,
          completedAt: null,
          error: null,
        });
        createdRuns.push(created);
        return Promise.resolve(created);
      }),
    },
    studioAgentModelAttempt: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    studioAgentMessage: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    studioAgentApproval: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    studioAgentAction: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    studioAgentCommandOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
    studioAgentThread: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        activeRunId: options?.activeRunId ?? null,
        permissionPolicy,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    studioAgentInput: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options?.queued ? queuedInput : null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    studioAgentRunBudget: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const events = {
    appendInTransaction: jest.fn(
      (_transaction: unknown, draft: Record<string, unknown>) => {
        eventDrafts.push(draft);
        return Promise.resolve({
          ...draft,
          eventId: `019f8c10-0000-7000-8000-${String(
            eventDrafts.length,
          ).padStart(12, '0')}`,
          sequence: BigInt(eventDrafts.length),
        });
      },
    ),
  };
  const config = {
    value: {
      model: {
        maxOutputTokens: 8_192,
      },
      budget: {
        maxChildDepth: 4,
        maxChildRuns: 24,
        maxConcurrentChildRuns: 8,
        maxModelStepsPerRun: 32,
        maxModelStepsPerRoot: 128,
        maxTotalTokenUnits: 1_000_000,
        maxContextBytesPerStep: 2_000_000,
        imageTokenReserveUnits: 8_192,
        minOutputTokenUnitsPerStep: 256,
        maxOutputTokenUnitsPerStep: 8_192,
        wallTimeMs: 3_600_000,
      },
      contextCompaction: {
        triggerRatio: 0.8,
        retainTailUnits: 8,
        maxOutputTokens: 2_048,
      },
    },
  };
  const quota = {
    markRootTerminalInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  return {
    root,
    transaction,
    createdRuns,
    eventDrafts,
    service: new StudioAgentRunTerminalService(
      config as never,
      events as never,
      quota as never,
    ),
    quota,
  };
}

const terminalError = {
  code: 'runtime_command_delivery_failed',
  message: 'Temporal is unavailable.',
  retryable: false,
  details: null,
};

describe('StudioAgentRunTerminalService', () => {
  it('atomically fails a root, detaches it, and leaves no work when the queue is empty', async () => {
    const { service, transaction, root, eventDrafts, quota } = harness();

    await expect(
      service.terminalizeInTransaction(
        transaction as never,
        root as never,
        {
          status: 'failed',
          error: terminalError,
          reason: terminalError.message,
        },
        NOW,
      ),
    ).resolves.toMatchObject({ run: { status: 'failed' } });

    expect(transaction.studioAgentThread.updateMany).toHaveBeenCalledWith({
      where: { id: THREAD_ID, activeRunId: RUN_ID },
      data: { activeRunId: null },
    });
    expect(quota.markRootTerminalInTransaction).toHaveBeenCalledWith(
      transaction,
      RUN_ID,
      'failed',
      NOW,
    );
    expect(transaction.studioAgentInput.updateMany).toHaveBeenCalledWith({
      where: {
        targetRunId: RUN_ID,
        status: 'accepted',
        delivery: { not: 'enqueue' },
      },
      data: { status: 'cancelled' },
    });
    expect(transaction.studioAgentInput.findFirst).toHaveBeenCalledWith({
      where: {
        targetRunId: RUN_ID,
        status: 'accepted',
        delivery: 'enqueue',
      },
      include: { targetRun: true },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    expect(transaction.studioAgentRun.create).not.toHaveBeenCalled();
    expect(eventDrafts.map((draft) => draft.type)).toEqual(['run.failed']);
  });

  it('promotes only the earliest canonical enqueue and carries the remaining queue forward', async () => {
    const { service, transaction, root, createdRuns, eventDrafts } = harness({
      queued: true,
    });

    await service.terminalizeInTransaction(
      transaction as never,
      root as never,
      { status: 'succeeded', summary: 'Done.', outputMessageId: MESSAGE_ID },
      NOW,
    );

    expect(createdRuns).toHaveLength(1);
    const promotedRunId = createdRuns[0]?.id;
    expect(transaction.studioAgentInput.update).toHaveBeenCalledWith({
      where: { id: INPUT_ID },
      data: {
        status: 'promoted',
        promotedToRunId: promotedRunId,
        consumedAt: NOW,
      },
    });
    expect(transaction.studioAgentInput.updateMany).toHaveBeenCalledWith({
      where: {
        targetRunId: RUN_ID,
        status: 'accepted',
        delivery: 'enqueue',
        id: { not: INPUT_ID },
      },
      data: { targetRunId: promotedRunId },
    });
    expect(eventDrafts.map((draft) => draft.type)).toEqual([
      'run.completed',
      'input.promoted',
      'run.created',
    ]);
  });

  it('does not promote when another active run already owns the locked thread', async () => {
    const { service, transaction, root } = harness({
      queued: true,
      activeRunId: ACTIVE_RUN_ID,
    });

    await service.terminalizeInTransaction(
      transaction as never,
      root as never,
      {
        status: 'failed',
        error: terminalError,
        reason: terminalError.message,
      },
      NOW,
    );

    expect(transaction.studioAgentRun.create).not.toHaveBeenCalled();
    expect(transaction.studioAgentInput.update).not.toHaveBeenCalled();
  });

  it('is a no-op for a duplicate terminalization attempt', async () => {
    const terminal = run({
      status: 'failed',
      completedAt: NOW,
      error: terminalError,
    });
    const { service, transaction } = harness({ persistedRun: terminal });

    await expect(
      service.terminalizeInTransaction(
        transaction as never,
        terminal as never,
        {
          status: 'failed',
          error: terminalError,
          reason: terminalError.message,
        },
        NOW,
      ),
    ).resolves.toEqual({ run: terminal, events: [] });

    expect(transaction.studioAgentRun.update).not.toHaveBeenCalled();
    expect(transaction.studioAgentThread.updateMany).not.toHaveBeenCalled();
    expect(transaction.studioAgentInput.findFirst).not.toHaveBeenCalled();
  });
});

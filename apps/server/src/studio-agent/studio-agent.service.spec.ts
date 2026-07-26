import { STUDIO_AGENT_SCHEMA_VERSION } from '@repo/shared/studio-agent';
import type { AuthUser } from '../auth';
import { studioAgentScopeKey } from './studio-agent.hash';
import { StudioAgentService } from './studio-agent.service';

const ACTOR_ID = 'actor-activity-snapshot';
const THREAD_ID = '019f8d10-0000-7000-8000-000000000001';
const WORKSPACE_ID = '019f8d10-0000-7000-8000-000000000002';
const PROJECT_ID = '019f8d10-0000-7000-8000-000000000003';
const RUN_ID = '019f8d10-0000-7000-8000-000000000004';
const ACTIVITY_ID = '019f8d10-0000-7000-8000-000000000005';
const PARENT_ACTIVITY_ID = '019f8d10-0000-7000-8000-000000000006';
const POLICY_ID = '019f8d10-0000-7000-8000-000000000007';
const MESSAGE_ID = '019f8d10-0000-7000-8000-000000000008';
const CLIENT_MESSAGE_ID = '019f8d10-0000-7000-8000-000000000009';
const QUOTA_CHARGE_ID = '019f8d10-0000-7000-8000-000000000010';
const CREATED_AT = new Date('2026-07-24T12:00:00.000Z');

function snapshotFixture(
  options: {
    rootRuns?: Array<{ id: string }>;
    subtreeRuns?: Array<Record<string, unknown>>;
    inputs?: Array<Record<string, unknown>>;
    anchor?: { createdAt: Date; id: string } | null;
    activities?: Array<Record<string, unknown>>;
  } = {},
) {
  const thread = threadRow();
  const runFindMany = jest
    .fn()
    .mockResolvedValueOnce(options.rootRuns ?? [])
    .mockResolvedValueOnce(options.subtreeRuns ?? []);
  const transaction = {
    studioAgentThread: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(thread),
    },
    studioAgentMessage: { findMany: jest.fn().mockResolvedValue([]) },
    studioAgentRun: {
      findMany: runFindMany,
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.anchor === undefined ? null : options.anchor,
        ),
    },
    studioAgentAction: { findMany: jest.fn().mockResolvedValue([]) },
    studioAgentApproval: { findMany: jest.fn().mockResolvedValue([]) },
    studioAgentInput: {
      findMany: jest.fn().mockResolvedValue(options.inputs ?? []),
    },
    studioAgentActivity: {
      findMany: jest.fn().mockResolvedValue(options.activities ?? []),
    },
    studioAgentEvent: { findMany: jest.fn() },
  };
  const prisma = {
    studioAgentThread: { findFirst: jest.fn().mockResolvedValue(thread) },
    $transaction: jest.fn(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const scopes = {
    authorize: jest.fn().mockResolvedValue({
      scenario: { scenarioId: 'story.studio.assistant', version: '1.0.0' },
      scope: threadScope(),
      grantedScopes: new Set(['studio.read']),
    }),
  };
  const service = new StudioAgentService(
    prisma as never,
    scopes as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { prisma, transaction, service, runFindMany };
}

function runRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    threadId: THREAD_ID,
    rootRunId: id,
    parentRunId: null,
    kind: 'turn',
    task: null,
    trigger: 'message',
    triggerMessageId: null,
    scenarioId: 'story.studio.assistant',
    scenarioVersion: '1.0.0',
    permissionPolicy: threadRow().permissionPolicy,
    status: 'succeeded',
    phase: null,
    error: null,
    startedAt: CREATED_AT,
    completedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe('StudioAgentService snapshot', () => {
  it('restores bounded materialized activities without scanning the event journal', async () => {
    const test = snapshotFixture({
      activities: [
        {
          id: ACTIVITY_ID,
          threadId: THREAD_ID,
          runId: RUN_ID,
          parentActivityId: PARENT_ACTIVITY_ID,
          kind: 'analyze',
          label: 'Analyze uploaded references',
          detail: 'Three references indexed.',
          progress: 0.75,
          status: 'running',
          startedAt: new Date('2026-07-24T12:00:01.000Z'),
          completedAt: null,
          firstEventSequence: 11n,
          lastEventSequence: 17n,
        },
      ],
    });

    const snapshot = await test.service.snapshot(
      { userId: ACTOR_ID } as AuthUser,
      THREAD_ID,
      {},
    );

    expect(snapshot.activities).toEqual([
      {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        activityId: ACTIVITY_ID,
        runId: RUN_ID,
        parentActivityId: PARENT_ACTIVITY_ID,
        kind: 'analyze',
        label: 'Analyze uploaded references',
        detail: 'Three references indexed.',
        progress: 0.75,
        status: 'running',
        startedAt: '2026-07-24T12:00:01.000Z',
        completedAt: null,
        firstEventSequence: 11,
        lastEventSequence: 17,
      },
    ]);
    expect(snapshot.latestEventSequence).toBe(20);
    expect(test.transaction.studioAgentActivity.findMany).toHaveBeenCalledWith({
      where: { threadId: THREAD_ID, runId: { in: [] } },
      orderBy: [{ firstEventSequence: 'asc' }, { id: 'asc' }],
    });
    expect(test.transaction.studioAgentEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns only the newest turns and reports that earlier history exists', async () => {
    const rootRuns = Array.from({ length: 21 }, (_, index) => ({
      id: `019f8d20-0000-7000-8000-0000000000${(index + 10).toString()}`,
    }));
    const test = snapshotFixture({ rootRuns });

    const snapshot = await test.service.snapshot(
      { userId: ACTOR_ID } as AuthUser,
      THREAD_ID,
      {},
    );

    expect(test.runFindMany.mock.calls[0][0]).toMatchObject({ take: 21 });
    expect(snapshot.turnWindow.hasEarlier).toBe(true);
    // The 21st row only proves earlier history exists; it must not become the
    // cursor, or paging back would silently skip a turn.
    expect(snapshot.turnWindow.earliestRootRunId).toBe(rootRuns[19].id);
  });

  it('expands each windowed turn to its whole run subtree so an approval can never outlive its action', async () => {
    const rootId = '019f8d20-0000-7000-8000-000000000001';
    const childId = '019f8d20-0000-7000-8000-000000000002';
    const test = snapshotFixture({
      rootRuns: [{ id: rootId }],
      subtreeRuns: [
        runRow(rootId),
        runRow(childId, {
          rootRunId: rootId,
          parentRunId: rootId,
          kind: 'task',
          task: { taskKey: 'analyze_references', title: 'Analyze references' },
          trigger: 'system',
        }),
      ],
    });

    await test.service.snapshot(
      { userId: ACTOR_ID } as AuthUser,
      THREAD_ID,
      {},
    );

    expect(test.runFindMany.mock.calls[1][0]).toMatchObject({
      where: { threadId: THREAD_ID, rootRunId: { in: [rootId] } },
    });
    for (const collection of [
      test.transaction.studioAgentAction,
      test.transaction.studioAgentApproval,
      test.transaction.studioAgentActivity,
    ]) {
      expect(collection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            runId: { in: [rootId, childId] },
          }),
        }),
      );
    }
  });

  it('includes the prompt of a promoted turn whose message still belongs to the previous run', async () => {
    // promoteNextInput starts a new root run for the promoted input but never
    // rewrites message.runId, so a runId-only filter amputates the prompt of
    // every enqueued turn.
    const previousRunId = '019f8d20-0000-7000-8000-000000000003';
    const promotedRunId = '019f8d20-0000-7000-8000-000000000004';
    const promptMessageId = '019f8d20-0000-7000-8000-000000000005';
    const test = snapshotFixture({
      rootRuns: [{ id: promotedRunId }],
      subtreeRuns: [runRow(promotedRunId, { trigger: 'resume' })],
      inputs: [
        {
          id: '019f8d20-0000-7000-8000-000000000006',
          threadId: THREAD_ID,
          messageId: promptMessageId,
          targetRunId: previousRunId,
          promotedToRunId: promotedRunId,
          clientMessageId: CLIENT_MESSAGE_ID,
          delivery: 'enqueue',
          status: 'promoted',
          sequence: 1n,
          acceptedAt: CREATED_AT,
          consumedAt: CREATED_AT,
        },
      ],
    });

    await test.service.snapshot(
      { userId: ACTOR_ID } as AuthUser,
      THREAD_ID,
      {},
    );

    expect(test.transaction.studioAgentInput.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { targetRunId: { in: [promotedRunId] } },
            { promotedToRunId: { in: [promotedRunId] } },
          ],
        }),
      }),
    );
    expect(test.transaction.studioAgentMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { runId: { in: [promotedRunId] } },
            { id: { in: [promptMessageId] } },
          ],
        }),
      }),
    );
  });

  it('includes a message still queued against the live turn', async () => {
    // The queued message's own runId points at the turn it was typed during,
    // which the window may exclude; only its input row reaches back to it.
    const liveRunId = '019f8d20-0000-7000-8000-000000000009';
    const queuedMessageId = '019f8d20-0000-7000-8000-000000000011';
    const test = snapshotFixture({
      rootRuns: [{ id: liveRunId }],
      subtreeRuns: [runRow(liveRunId, { status: 'running' })],
      inputs: [
        {
          id: '019f8d20-0000-7000-8000-000000000012',
          threadId: THREAD_ID,
          messageId: queuedMessageId,
          targetRunId: liveRunId,
          promotedToRunId: null,
          clientMessageId: CLIENT_MESSAGE_ID,
          delivery: 'enqueue',
          status: 'accepted',
          sequence: 2n,
          acceptedAt: CREATED_AT,
          consumedAt: null,
        },
      ],
    });

    await test.service.snapshot(
      { userId: ACTOR_ID } as AuthUser,
      THREAD_ID,
      {},
    );

    expect(test.transaction.studioAgentMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { runId: { in: [liveRunId] } },
            { id: { in: [queuedMessageId] } },
          ],
        }),
      }),
    );
  });

  it('reads the turns before the cursor with a keyset predicate', async () => {
    const anchorId = '019f8d20-0000-7000-8000-000000000007';
    const anchorCreatedAt = new Date('2026-07-24T11:00:00.000Z');
    const test = snapshotFixture({
      anchor: { createdAt: anchorCreatedAt, id: anchorId },
    });

    await test.service.snapshot({ userId: ACTOR_ID } as AuthUser, THREAD_ID, {
      beforeRootRunId: anchorId,
    });

    expect(test.transaction.studioAgentRun.findFirst).toHaveBeenCalledWith({
      where: { id: anchorId, threadId: THREAD_ID, parentRunId: null },
      select: { createdAt: true, id: true },
    });
    expect(test.runFindMany.mock.calls[0][0]).toMatchObject({
      where: {
        threadId: THREAD_ID,
        parentRunId: null,
        OR: [
          { createdAt: { lt: anchorCreatedAt } },
          { createdAt: anchorCreatedAt, id: { lt: anchorId } },
        ],
      },
    });
  });

  it('rejects a cursor that is not a root run of this conversation', async () => {
    const test = snapshotFixture({ anchor: null });

    await expect(
      test.service.snapshot({ userId: ACTOR_ID } as AuthUser, THREAD_ID, {
        beforeRootRunId: '019f8d20-0000-7000-8000-000000000008',
      }),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_TURN_CURSOR_NOT_FOUND' },
    });
    expect(test.runFindMany).not.toHaveBeenCalled();
    expect(test.transaction.studioAgentMessage.findMany).not.toHaveBeenCalled();
  });

  it('keeps the advertised latest sequence consistent with the windowed rows', async () => {
    // Under READ COMMITTED the thread row and the collection rows come from
    // different snapshots, so a row can be staler than the sequence advertised
    // beside it — and the client then discards the event that would fix it.
    const test = snapshotFixture();

    const snapshot = await test.service.snapshot(
      { userId: ACTOR_ID } as AuthUser,
      THREAD_ID,
      {},
    );

    expect(test.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'RepeatableRead' },
    );
    expect(snapshot.latestEventSequence).toBe(20);
  });
});

describe('StudioAgentService root admission', () => {
  it('finishes fail-closed rate, capacity, and debit admission before opening the product mutation transaction', async () => {
    const order: string[] = [];
    const thread = threadRow();
    const request = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      clientMessageId: CLIENT_MESSAGE_ID,
      parts: [
        {
          type: 'text' as const,
          format: 'plain_text' as const,
          text: 'Continue the story.',
        },
      ],
      scope: threadScope(),
      locale: 'en-US',
      targetRunId: null,
      delivery: null,
    };
    const profile = {
      planKey: 'basic',
      tier: 'basic' as const,
      limits: {
        imageDaily: 30,
        videoDaily: 4,
        chatDaily: 200,
        workflowDaily: 10,
        uploadMB: 1024,
        chatPerMinute: 40,
      },
      upgrade: null,
    };
    const permissionPolicy = thread.permissionPolicy;
    const transaction = {
      studioAgentThread: {
        update: jest.fn().mockImplementation(({ select }) => {
          if (select) {
            return Promise.resolve({
              activeRunId: null,
              nextMessageOrdinal: 1n,
              scenarioId: thread.scenarioId,
              scenarioVersion: thread.scenarioVersion,
              permissionPolicy,
            });
          }
          return Promise.resolve({});
        }),
      },
      studioAgentMessage: {
        create: jest.fn().mockResolvedValue({
          id: MESSAGE_ID,
          threadId: THREAD_ID,
          runId: null,
          ordinal: 0n,
          clientMessageId: CLIENT_MESSAGE_ID,
          requestHash: 'a'.repeat(64),
          role: 'user',
          status: 'completed',
          parts: request.parts,
          createdAt: CREATED_AT,
          completedAt: CREATED_AT,
        }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: MESSAGE_ID,
            threadId: THREAD_ID,
            runId: data.runId,
            ordinal: 0n,
            clientMessageId: CLIENT_MESSAGE_ID,
            requestHash: 'a'.repeat(64),
            role: 'user',
            status: 'completed',
            parts: request.parts,
            createdAt: CREATED_AT,
            completedAt: CREATED_AT,
          }),
        ),
      },
      studioAgentRun: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            parentRunId: null,
            sourceStepId: null,
            sourceToolCallId: null,
            contextBoundaryOrdinal: null,
            task: null,
            triggerMessageId: MESSAGE_ID,
            status: 'queued',
            phase: null,
            startedAt: null,
            completedAt: null,
            error: null,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
          }),
        ),
      },
      studioAgentRunBudget: {
        create: jest.fn().mockResolvedValue({}),
      },
      studioAgentCommandOutbox: {
        create: jest.fn().mockImplementation(() => {
          order.push('mutation:outbox');
          return Promise.resolve({});
        }),
      },
    };
    const prisma = {
      studioAgentThread: {
        findFirst: jest.fn().mockResolvedValue(thread),
      },
      studioAgentMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) => {
          order.push('mutation:begin');
          return callback(transaction);
        },
      ),
    };
    const scopes = {
      authorize: jest.fn().mockResolvedValue({
        scenario: {
          scenarioId: thread.scenarioId,
          version: thread.scenarioVersion,
        },
        scope: threadScope(),
        grantedScopes: new Set(['studio.read', 'studio.write']),
      }),
    };
    const events = {
      appendInTransaction: jest.fn().mockResolvedValue({
        eventId: '019f8d10-0000-7000-8000-000000000011',
      }),
      publish: jest.fn(),
    };
    const artifacts = {
      bindMessageAttachmentsInTransaction: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const quota = {
      findAttempt: jest.fn().mockResolvedValue(null),
      assertRateLimit: jest.fn().mockImplementation(() => {
        order.push('admission:rate');
        return Promise.resolve(profile);
      }),
      prepareRootAttempt: jest.fn().mockImplementation(() => {
        order.push('admission:capacity');
        return Promise.resolve({ id: QUOTA_CHARGE_ID });
      }),
      consumeAttempt: jest.fn().mockImplementation(() => {
        order.push('admission:debit');
        return Promise.resolve({ id: QUOTA_CHARGE_ID });
      }),
      attachRootInTransaction: jest.fn().mockImplementation(() => {
        order.push('mutation:attach-charge');
        return Promise.resolve();
      }),
    };
    const service = new StudioAgentService(
      prisma as never,
      scopes as never,
      events as never,
      artifacts as never,
      rootBudgetConfig() as never,
      quota as never,
    );

    await expect(
      service.submitMessage(
        { userId: ACTOR_ID } as AuthUser,
        THREAD_ID,
        request,
      ),
    ).resolves.toMatchObject({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      message: {
        clientMessageId: CLIENT_MESSAGE_ID,
        runId: expect.any(String),
      },
      run: {
        runId: expect.any(String),
        status: 'queued',
      },
      input: null,
    });

    expect(order).toEqual([
      'admission:rate',
      'admission:capacity',
      'admission:debit',
      'mutation:begin',
      'mutation:attach-charge',
      'mutation:outbox',
    ]);
    expect(quota.attachRootInTransaction).toHaveBeenCalledWith(
      transaction,
      QUOTA_CHARGE_ID,
      expect.any(String),
    );
  });
});

function threadRow() {
  return {
    id: THREAD_ID,
    workspaceId: WORKSPACE_ID,
    surfaceId: 'story.studio',
    scenarioId: 'story.studio.assistant',
    scenarioVersion: '1.0.0',
    scopeContainer: threadScope().container,
    scopeFocus: null,
    scopeKey: studioAgentScopeKey(WORKSPACE_ID, threadScope().container),
    ownerActorId: ACTOR_ID,
    locale: 'en-US',
    title: null,
    status: 'active',
    permissionPolicy: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      policyId: POLICY_ID,
      revision: 1,
      mode: 'ask',
      rules: [],
      createdAt: CREATED_AT.toISOString(),
    },
    activeRunId: null,
    nextMessageOrdinal: 0n,
    nextEventSequence: 21n,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function threadScope() {
  return {
    workspaceId: WORKSPACE_ID,
    container: {
      resourceType: 'story.project',
      resourceId: PROJECT_ID,
      revision: null,
    },
    focus: null,
  };
}

function rootBudgetConfig() {
  return {
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
        wallTimeMs: 3_600_000,
      },
      contextCompaction: {
        triggerRatio: 0.82,
        retainTailUnits: 8,
        maxOutputTokens: 2_048,
      },
    },
  };
}

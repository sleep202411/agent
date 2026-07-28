import type { Prisma } from '@prisma/client';
import { STUDIO_AGENT_SCHEMA_VERSION } from '@repo/shared/studio-agent';
import type { AuthUser } from '../auth';
import { studioAgentScopeKey } from './studio-agent.hash';
import { StudioAgentService } from './studio-agent.service';
import {
  anyFunction,
  anyString,
  objectContaining,
} from './__tests__/typed-expect';

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
  // Typed with the real query args so an assertion below reads the `where`
  // the service actually built, not an `any` that would accept any key at all.
  const runFindMany = jest
    .fn<Promise<unknown[]>, [Prisma.StudioAgentRunFindManyArgs]>()
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
    // The reaper is best-effort on this path; a double that finds nothing
    // keeps these tests about admission rather than about liveness.
    { reconcileThread: jest.fn().mockResolvedValue(null) } as never,
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
        objectContaining({
          where: objectContaining({
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
      objectContaining({
        where: objectContaining({
          OR: [
            { targetRunId: { in: [promotedRunId] } },
            { promotedToRunId: { in: [promotedRunId] } },
          ],
        }),
      }),
    );
    expect(test.transaction.studioAgentMessage.findMany).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({
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
      objectContaining({
        where: objectContaining({
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

    expect(test.prisma.$transaction).toHaveBeenCalledWith(anyFunction(), {
      isolationLevel: 'RepeatableRead',
    });
    expect(snapshot.latestEventSequence).toBe(20);
  });
});

describe('StudioAgentService root admission', () => {
  it('finishes fail-closed rate, capacity, and debit admission before opening the product mutation transaction', async () => {
    const order: string[] = [];
    const thread = threadRow();
    const request = {
      kind: 'submission' as const,
      inputEventId: 'AAAAA0LrQ:0:0',
      sessionName: `studio-agent:thread:${THREAD_ID}`,
      threadId: THREAD_ID,
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
        update: jest.fn(({ data }: { data: { runId: string | null } }) =>
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
      {
        reconcileThread: jest.fn().mockImplementation(() => {
          order.push('admission:reconcile');
          return Promise.resolve(null);
        }),
      } as never,
    );

    await expect(
      service.startInvocation({ userId: ACTOR_ID } as AuthUser, request),
    ).resolves.toMatchObject({
      threadId: THREAD_ID,
      messageId: MESSAGE_ID,
      runId: anyString(),
      inputId: null,
      channelName: `studio-agent:thread:${THREAD_ID}`,
    });

    expect(order).toEqual([
      // FIRST, and the position is the point. The capacity gate reads
      // `thread.activeRunId` itself and throws RUN_ALREADY_ACTIVE on a stale
      // one, so a reconciliation placed after it would never be reached by the
      // requests it exists to rescue — the thread would stay wedged forever
      // with the fix sitting one line too late.
      'admission:reconcile',
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
      anyString(),
    );
  });
});

describe('StudioAgentService invocation channel binding', () => {
  /**
   * `sessionName` arrives in the request body, and the client publishes to it
   * BEFORE the server is consulted. A caller holding a perfectly valid token
   * for their own thread can therefore name a DIFFERENT thread's channel — and
   * if the server believed it, the worker would open this run and stream this
   * answer onto somebody else's conversation. The channel is not a credential.
   */
  function invocation(sessionName: string) {
    return {
      kind: 'submission' as const,
      inputEventId: 'AAAAA0LrQ:0:0',
      sessionName,
      threadId: THREAD_ID,
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
  }

  function service() {
    const requireThread = jest.fn(() => Promise.resolve(threadRow()));
    const subject = new StudioAgentService(
      {} as never,
      { authorize: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { assertRateLimit: jest.fn(), findAttempt: jest.fn() } as never,
      // The reaper is best-effort on this path; a double that finds nothing
      // keeps these tests about admission rather than about liveness.
      { reconcileThread: jest.fn().mockResolvedValue(null) } as never,
    );
    (subject as unknown as { requireThread: unknown }).requireThread =
      requireThread;
    return { subject, requireThread };
  }

  it.each([
    [
      'another thread',
      'studio-agent:thread:019f8d10-0000-7000-8000-0000000000ff',
    ],
    ['a foreign namespace', `conversations:thread:${THREAD_ID}`],
    ['a bare thread id', THREAD_ID],
    ['a wildcard', 'studio-agent:thread:*'],
  ])('refuses an invocation that names %s', async (_label, sessionName) => {
    const { subject, requireThread } = service();

    const failure = await subject
      .startInvocation(
        { userId: ACTOR_ID } as AuthUser,
        invocation(sessionName),
      )
      .then(
        () => null,
        (error: unknown) => error as { response?: { code?: string } },
      );

    expect(failure?.response?.code).toBe(
      'STUDIO_AGENT_INVOCATION_CHANNEL_MISMATCH',
    );
    // Refused before any thread lookup: the mismatch is decidable from the
    // request alone, and a rejection that costs a query is a rejection that
    // can be used to probe.
    expect(requireThread).not.toHaveBeenCalled();
  });

  it('accepts the channel that belongs to the thread', async () => {
    // The positive case has to be here too, or "refuse everything" would pass
    // the four cases above.
    const { subject, requireThread } = service();

    await subject
      .startInvocation(
        { userId: ACTOR_ID } as AuthUser,
        invocation(`studio-agent:thread:${THREAD_ID}`),
      )
      .catch(() => undefined);

    expect(requireThread).toHaveBeenCalledWith({ userId: ACTOR_ID }, THREAD_ID);
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

/**
 * THE DECISION ARRIVES ON THE INVOCATION POST, AND NOWHERE ELSE.
 *
 * `POST threads/:id/approvals/:approvalId/resolve` is gone: it was a second
 * authorization path for one decision, and it never worked (the workflow it
 * signalled resumed the run's status only after trying to execute, so the
 * executor answered 409 `STUDIO_AGENT_RUN_NOT_EXECUTABLE`). The browser now
 * answers through `useChat.addToolApprovalResponse`, and the library's
 * ChatTransport publishes the `tool-approval-response` and wakes this endpoint.
 */
describe('StudioAgentService tool approval invocations', () => {
  const ACTION_ID = '019f8d10-0000-7000-8000-000000000021';
  const APPROVAL_ID = '019f8d10-0000-7000-8000-000000000022';
  const RESUME_EVENT_ID = 'AAAAA0LrQ:9:0';
  const ACTION_INPUT_HASH = 'b'.repeat(64);

  function approvalFixture(
    options: {
      runStatus?: string;
      action?: Record<string, unknown> | null;
    } = {},
  ) {
    const outboxCreate = jest.fn().mockResolvedValue({ id: 'outbox-1' });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: THREAD_ID }]),
      studioAgentRun: {
        findFirst: jest.fn().mockResolvedValue({
          id: RUN_ID,
          threadId: THREAD_ID,
          status: options.runStatus ?? 'waiting_for_approval',
        }),
      },
      studioAgentAction: {
        findFirst: jest.fn().mockResolvedValue(
          options.action === undefined
            ? {
                id: ACTION_ID,
                approval: {
                  id: APPROVAL_ID,
                  actionInputHash: ACTION_INPUT_HASH,
                },
              }
            : options.action,
        ),
      },
      studioAgentCommandOutbox: { create: outboxCreate },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const service = new StudioAgentService(
      prisma as never,
      { authorize: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      // The reaper is best-effort on this path; a double that finds nothing
      // keeps these tests about admission rather than about liveness.
      { reconcileThread: jest.fn().mockResolvedValue(null) } as never,
    );
    (service as unknown as { requireThread: unknown }).requireThread = jest
      .fn()
      .mockResolvedValue(threadRow());
    return { service, transaction, outboxCreate };
  }

  function request(approved = true) {
    return {
      kind: 'tool_approval' as const,
      inputEventId: RESUME_EVENT_ID,
      sessionName: `studio-agent:thread:${THREAD_ID}`,
      threadId: THREAD_ID,
      targetRunId: RUN_ID,
      decisions: [{ toolCallId: 'call-1', approved }],
    };
  }

  /**
   * THE FIELD WITHOUT WHICH THE TURN CANNOT COME BACK. `adoptRun()` refuses a
   * suspended run, and `createRun().start()` only publishes `ai-run-resume`
   * rather than a duplicate `ai-run-start` when its TRIGGER carries a `run-id`
   * header. That trigger is the `ai-input` this POST points at, so it has to
   * travel on the signal.
   */
  it('signals the workflow with the decision AND the trigger that resumes the run', async () => {
    const test = approvalFixture();

    await expect(
      test.service.startInvocation({ userId: ACTOR_ID } as AuthUser, request()),
    ).resolves.toMatchObject({
      kind: 'tool_approval',
      runId: RUN_ID,
      approvalIds: [APPROVAL_ID],
    });

    expect(test.outboxCreate).toHaveBeenCalledTimes(1);
    expect((test.outboxCreate.mock.calls[0] as unknown[])?.[0]).toMatchObject({
      data: {
        type: 'signal',
        runId: RUN_ID,
        idempotencyKey: `approval:${RUN_ID}:${RESUME_EVENT_ID}`,
        payload: objectContaining({
          targetRunId: RUN_ID,
          decisions: [
            {
              approvalId: APPROVAL_ID,
              actionId: ACTION_ID,
              actionInputHash: ACTION_INPUT_HASH,
              decision: 'approved',
            },
          ],
          resumeDelivery: {
            inputEventId: RESUME_EVENT_ID,
            channelName: `studio-agent:thread:${THREAD_ID}`,
          },
        }),
      },
    });
  });

  it('carries a refusal as a denial rather than dropping it', async () => {
    const test = approvalFixture();

    await test.service.startInvocation(
      { userId: ACTOR_ID } as AuthUser,
      request(false),
    );

    expect((test.outboxCreate.mock.calls[0] as unknown[])?.[0]).toMatchObject({
      data: {
        payload: objectContaining({
          decisions: [objectContaining({ decision: 'denied' })],
        }),
      },
    });
  });

  /**
   * Addressed by tool call, resolved to the durable approval: the browser only
   * ever knows the AI SDK's own per-stream `approval.id`, which means nothing to
   * Postgres. `toolCallId` is the column both stores share.
   */
  it('resolves the tool call against this run only', async () => {
    const test = approvalFixture();

    await test.service.startInvocation(
      { userId: ACTOR_ID } as AuthUser,
      request(),
    );

    expect(test.transaction.studioAgentAction.findFirst).toHaveBeenCalledWith(
      objectContaining({
        where: { threadId: THREAD_ID, runId: RUN_ID, toolCallId: 'call-1' },
      }),
    );
  });

  it('refuses a decision for a run that is not waiting on one', async () => {
    const test = approvalFixture({ runStatus: 'running' });

    await expect(
      test.service.startInvocation({ userId: ACTOR_ID } as AuthUser, request()),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_RUN_NOT_AWAITING_APPROVAL' },
    });
    expect(test.outboxCreate).not.toHaveBeenCalled();
  });

  it('refuses a tool call that has no pending approval', async () => {
    const test = approvalFixture({ action: null });

    await expect(
      test.service.startInvocation({ userId: ACTOR_ID } as AuthUser, request()),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_APPROVAL_NOT_FOUND' },
    });
    expect(test.outboxCreate).not.toHaveBeenCalled();
  });
});

/**
 * "NEW CONVERSATION" IS A STATUS FLIP, AND ITS ESCAPE-HATCH PROPERTY.
 *
 * `findActiveThread` filters on `status: 'active'`, so archiving is the entire
 * mechanism: the next resolve finds nothing and mints a fresh thread. Nothing is
 * deleted — the retired thread keeps every row it owns.
 *
 * The unconditional part is load-bearing, not laziness. A workflow that dies
 * without reporting leaves `activeRunId` pointing at a run that never
 * terminalizes, and every later message on that thread 409s. If this refused
 * while a run looked live, the creator would be stranded in exactly the thread
 * they are trying to leave. So it terminalizes what it finds directly rather
 * than asking a runtime that may already be gone.
 */
describe('StudioAgentService archive thread', () => {
  function archiveFixture(liveRuns: Array<Record<string, unknown>> = []) {
    const runUpdate = jest.fn().mockResolvedValue({});
    const threadUpdate = jest.fn().mockResolvedValue({});
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: THREAD_ID }]),
      studioAgentRun: {
        findMany: jest.fn().mockResolvedValue(liveRuns),
        update: runUpdate,
      },
      studioAgentThread: { update: threadUpdate },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const events = { appendInTransaction: jest.fn().mockResolvedValue({}) };
    const service = new StudioAgentService(
      prisma as never,
      { authorize: jest.fn() } as never,
      events as never,
      {} as never,
      {} as never,
      {} as never,
      // The reaper is best-effort on this path; a double that finds nothing
      // keeps these tests about admission rather than about liveness.
      { reconcileThread: jest.fn().mockResolvedValue(null) } as never,
    );
    (service as unknown as { requireThread: unknown }).requireThread = jest
      .fn()
      .mockResolvedValue(threadRow());
    return { service, transaction, runUpdate, threadUpdate, events };
  }

  it('retires the thread instead of deleting it, so the next resolve opens a fresh one', async () => {
    const test = archiveFixture();

    await expect(
      test.service.archiveThread({ userId: ACTOR_ID } as AuthUser, THREAD_ID),
    ).resolves.toMatchObject({ threadId: THREAD_ID, cancelledRunIds: [] });

    expect(test.threadUpdate).toHaveBeenCalledWith({
      where: { id: THREAD_ID },
      data: { status: 'archived', activeRunId: null },
    });
  });

  it('ends a run nothing else was going to end, which is the only way out of a wedged thread', async () => {
    const test = archiveFixture([
      { id: RUN_ID, rootRunId: RUN_ID, parentRunId: null },
    ]);

    await expect(
      test.service.archiveThread({ userId: ACTOR_ID } as AuthUser, THREAD_ID),
    ).resolves.toMatchObject({ cancelledRunIds: [RUN_ID] });

    // Terminalized DIRECTLY. Going through the cancel signal would wait on a
    // runtime that, in the case this exists for, is already gone.
    expect(test.runUpdate).toHaveBeenCalledWith(
      objectContaining({
        where: { id: RUN_ID },
        data: objectContaining({ status: 'cancelled' }),
      }),
    );
    expect(test.events.appendInTransaction).toHaveBeenCalledWith(
      test.transaction,
      objectContaining({ type: 'run.cancelled' }),
    );
  });
});

/**
 * THE PATH THE FIRST FIX MISSED, AND WHY IT FAILS WORSE THAN THE ONE IT COVERED.
 *
 * A dead run wedges a thread two ways. A FRESH turn 409s — loud, and the
 * creator at least knows. But the panel, seeing an "active" run, does not send
 * a fresh turn at all: it QUEUES the message against that run. So the creator
 * gets no error, and their prompt waits forever on a workflow that will never
 * consume it. Silence is the worse failure.
 *
 * The reconciliation therefore runs for EVERY submission, before the branch
 * that tells the two apart. An end-to-end drive is what caught this: the fix
 * looked right, its tests were green, and the message still vanished into a
 * queue behind a workflow that had been terminated.
 */
describe('StudioAgentService reconciles before it branches', () => {
  it('verifies liveness for a queued submission too, not only a fresh turn', async () => {
    const reconcileThread = jest.fn().mockResolvedValue(null);
    const quota = {
      assertRateLimit: jest.fn().mockResolvedValue({}),
      findAttempt: jest.fn().mockResolvedValue(null),
    };
    const service = new StudioAgentService(
      {} as never,
      {
        authorize: jest.fn().mockResolvedValue({
          scenario: { scenarioId: 'story.studio.assistant', version: '1.0.0' },
          scope: threadScope(),
          grantedScopes: new Set(['studio.write']),
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      quota as never,
      { reconcileThread } as never,
    );
    (service as unknown as { requireThread: unknown }).requireThread = jest
      .fn()
      .mockResolvedValue(threadRow());
    (service as unknown as { existingSubmission: unknown }).existingSubmission =
      jest.fn().mockResolvedValue(null);
    // Stop right after the branch — this test is about what runs BEFORE it.
    (service as unknown as { createRunInput: unknown }).createRunInput = jest
      .fn()
      .mockResolvedValue({ kind: 'input' });

    await service.startInvocation(
      { userId: ACTOR_ID } as AuthUser,
      {
        kind: 'submission',
        inputEventId: 'AAAAA0LrQ:9:0',
        sessionName: `studio-agent:thread:${THREAD_ID}`,
        threadId: THREAD_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        // NOT null: this is the queue/steer path, the one that used to swallow
        // the message silently.
        targetRunId: RUN_ID,
        delivery: 'enqueue',
        parts: [
          {
            type: 'text',
            format: 'plain_text',
            text: 'Queued behind a corpse.',
          },
        ],
        scope: threadScope(),
        locale: 'en-US',
      } as never,
    );

    expect(reconcileThread).toHaveBeenCalledWith(THREAD_ID);
  });
});

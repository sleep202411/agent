import {
  AGENT_OS_ABLY_RESYNC_NAME,
  type AgentOsAblyResyncPointer,
} from '@repo/shared';
import { AgentOsRealtimeOutboxService } from './agent-os-realtime-outbox.service';

const OLD_RUN_ID = '11111111-1111-4111-8111-111111111111';
const NEW_RUN_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';
const OLD_EVENT_ID = '55555555-5555-4555-8555-555555555555';
const OLD_EVENT_2_ID = '55555555-5555-4555-8555-555555555556';
const NEW_EVENT_ID = '66666666-6666-4666-8666-666666666666';
const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
const DB_EPOCH = Date.parse('2042-03-04T05:06:07.000Z');

describe('AgentOsRealtimeOutboxService', () => {
  it('sweeps unrelated conversations concurrently within a fixed global bound', async () => {
    const candidateIds = Array.from(
      { length: 6 },
      (_, index) => `sweep-run-${index + 1}`,
    );
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue(candidateIds.map((id) => ({ id }))),
    };
    const service = new AgentOsRealtimeOutboxService(
      prisma as never,
      { channels: { get: jest.fn() } } as never,
    );
    const releases = new Map(
      candidateIds.map((id) => [id, deferred<void>()] as const),
    );
    const firstWaveEntered = deferred<void>();
    const fifthEntered = deferred<void>();
    const entered: string[] = [];
    let active = 0;
    let maxActive = 0;
    jest.spyOn(service, 'publishRun').mockImplementation(async (runId) => {
      entered.push(runId);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (entered.length === 4) firstWaveEntered.resolve();
      if (entered.length === 5) fifthEntered.resolve();
      await releases.get(runId)?.promise;
      active -= 1;
    });

    const flush = (
      service as unknown as { flushPending(): Promise<void> }
    ).flushPending();
    await firstWaveEntered.promise;

    expect(entered).toEqual(candidateIds.slice(0, 4));
    expect(maxActive).toBe(4);

    // Conversation 1 remains hung, but releasing any other bounded worker
    // lets conversation 5 progress without waiting for conversation 1.
    releases.get(candidateIds[1] ?? '')?.resolve();
    await fifthEntered.promise;
    expect(entered).toEqual(candidateIds.slice(0, 5));
    expect(maxActive).toBe(4);

    for (const release of releases.values()) release.resolve();
    await flush;
    expect(entered).toEqual(candidateIds);
    expect(maxActive).toBe(4);
  });

  it('holds the conversation gate while a delayed old terminal is publishing', async () => {
    const fixture = createFixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    fixture.onPublish = async (ids) => {
      if (ids.includes(OLD_EVENT_ID)) {
        entered.resolve();
        await release.promise;
      }
    };

    const oldOwner = fixture.first.publishRun(NEW_RUN_ID);
    await entered.promise;

    // A second pod is scheduled for the new run while the old terminal's Ably
    // request is still unresolved. It must not enter this conversation.
    await fixture.second.publishRun(NEW_RUN_ID);
    expect(fixture.publishedIds).toEqual([OLD_EVENT_ID]);

    release.resolve();
    await oldOwner;

    expect(fixture.publishedIds).toEqual([
      OLD_EVENT_ID,
      `snap:${OLD_RUN_ID}:completed:1`,
      NEW_EVENT_ID,
      `snap:${NEW_RUN_ID}:running:1`,
    ]);
    expect(fixture.run(OLD_RUN_ID).realtimeSnapshotSequence).toBe(1);
    expect(fixture.run(NEW_RUN_ID).realtimeSnapshotSequence).toBe(1);
  });

  it('serializes two workers targeting different runs in one conversation', async () => {
    const fixture = createFixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    fixture.onPublish = async (ids) => {
      if (ids.includes(OLD_EVENT_ID)) {
        entered.resolve();
        await release.promise;
      }
    };

    const first = fixture.first.publishRun(OLD_RUN_ID);
    await entered.promise;
    const second = fixture.second.publishRun(NEW_RUN_ID);
    await second;

    expect(fixture.publishedIds).toEqual([OLD_EVENT_ID]);
    release.resolve();
    await first;

    expect(fixture.publishedIds).toEqual([
      OLD_EVENT_ID,
      `snap:${OLD_RUN_ID}:completed:1`,
      NEW_EVENT_ID,
      `snap:${NEW_RUN_ID}:running:1`,
    ]);
    expect(new Set(fixture.publishedIds).size).toBe(
      fixture.publishedIds.length,
    );
  });

  it('renews a long publish from the database clock and keeps another pod fenced', async () => {
    jest.useFakeTimers();
    try {
      const fixture = createFixture();
      const entered = deferred<void>();
      const release = deferred<void>();
      fixture.onPublish = async (ids) => {
        if (ids.includes(OLD_EVENT_ID)) {
          entered.resolve();
          await release.promise;
        }
      };

      const first = fixture.first.publishRun(OLD_RUN_ID);
      await entered.promise;
      fixture.advanceDatabaseClock(29_000);
      await jest.advanceTimersByTimeAsync(10_000);
      fixture.advanceDatabaseClock(10_000);

      await fixture.second.publishRun(NEW_RUN_ID);
      expect(fixture.publishedIds).toEqual([OLD_EVENT_ID]);
      expect(
        fixture.leaseHistory.some(
          (entry) => entry.expiresAt - entry.databaseNow === 30_000,
        ),
      ).toBe(true);
      expect(fixture.leaseHistory[0]?.expiresAt).toBe(DB_EPOCH + 30_000);
      expect(fixture.leaseHistory.at(-1)?.expiresAt).toBeGreaterThan(
        fixture.databaseNow,
      );

      release.resolve();
      await first;
    } finally {
      jest.useRealTimers();
    }
  });

  it('fences an expired owner after another worker reclaims the conversation', async () => {
    const fixture = createFixture();
    const firstPublishEntered = deferred<void>();
    const releaseExpiredOwner = deferred<void>();
    let oldEventCalls = 0;
    fixture.onPublish = async (ids) => {
      if (ids.includes(OLD_EVENT_ID) && ++oldEventCalls === 1) {
        firstPublishEntered.resolve();
        await releaseExpiredOwner.promise;
      }
    };

    const expiredOwner = fixture.first.publishRun(OLD_RUN_ID);
    await firstPublishEntered.promise;
    fixture.advanceDatabaseClock(30_001);

    await fixture.second.publishRun(NEW_RUN_ID);
    expect(fixture.publishedIds).toEqual([
      OLD_EVENT_ID,
      OLD_EVENT_ID,
      `snap:${OLD_RUN_ID}:completed:1`,
      NEW_EVENT_ID,
      `snap:${NEW_RUN_ID}:running:1`,
    ]);

    releaseExpiredOwner.resolve();
    await expiredOwner;

    // The stale pod may have completed its already-in-flight idempotent Ably
    // call, but it must not acknowledge it or emit any later snapshot/event.
    expect(
      fixture.publishedIds.filter(
        (id) => id === `snap:${OLD_RUN_ID}:completed:1`,
      ),
    ).toHaveLength(1);
    expect(
      fixture.publishedIds.filter((id) => id === NEW_EVENT_ID),
    ).toHaveLength(1);
    expect(fixture.event(OLD_EVENT_ID).realtimePublishAttempts).toBe(2);
    expect(fixture.run(OLD_RUN_ID).realtimeSnapshotSequence).toBe(1);
    expect(fixture.run(NEW_RUN_ID).realtimeSnapshotSequence).toBe(1);
  });

  it('backs off the whole conversation after failure and retries in order after lease expiry', async () => {
    const fixture = createFixture();
    let rejectOnce = true;
    fixture.onPublish = (ids) => {
      if (rejectOnce && ids.includes(OLD_EVENT_ID)) {
        rejectOnce = false;
        return Promise.reject(new Error('ably unavailable'));
      }
      return Promise.resolve();
    };

    await fixture.first.publishRun(NEW_RUN_ID);
    expect(fixture.event(OLD_EVENT_ID).realtimePublishedAt).toBeNull();
    expect(fixture.event(OLD_EVENT_ID).realtimePublishLastError).toContain(
      'ably unavailable',
    );
    expect(fixture.run(OLD_RUN_ID).realtimePublishLeaseId).not.toBeNull();
    expect(fixture.run(NEW_RUN_ID).realtimePublishLeaseId).not.toBeNull();

    await fixture.second.publishRun(NEW_RUN_ID);
    expect(fixture.event(OLD_EVENT_ID).realtimePublishAttempts).toBe(1);

    fixture.advanceDatabaseClock(30_001);
    await fixture.second.publishRun(NEW_RUN_ID);
    expect(fixture.event(OLD_EVENT_ID).realtimePublishAttempts).toBe(2);
    expect(fixture.publishedIds.slice(-4)).toEqual([
      OLD_EVENT_ID,
      `snap:${OLD_RUN_ID}:completed:1`,
      NEW_EVENT_ID,
      `snap:${NEW_RUN_ID}:running:1`,
    ]);
  });

  it('publishes an event suffix as separately idempotent batch specs and stops retrying after acknowledgement', async () => {
    const fixture = createFixture({ oldEventCount: 2 });
    let rejectOnce = true;
    fixture.onPublish = (ids) => {
      if (rejectOnce && ids.includes(OLD_EVENT_2_ID)) {
        rejectOnce = false;
        return Promise.reject(new Error('response lost after Ably accepted'));
      }
      return Promise.resolve();
    };

    await fixture.first.publishRun(OLD_RUN_ID);
    expect(fixture.batchPublishPayloads).toHaveLength(1);
    expect(batchSpecIds(fixture.batchPublishPayloads[0] ?? [])).toEqual([
      OLD_EVENT_ID,
      OLD_EVENT_2_ID,
    ]);
    expect(fixture.event(OLD_EVENT_ID).realtimePublishedAt).toBeNull();
    expect(fixture.event(OLD_EVENT_2_ID).realtimePublishedAt).toBeNull();

    fixture.advanceDatabaseClock(30_001);
    await fixture.second.publishRun(OLD_RUN_ID);
    expect(batchSpecIds(fixture.batchPublishPayloads[1] ?? [])).toEqual([
      OLD_EVENT_ID,
      OLD_EVENT_2_ID,
    ]);
    expect(
      fixture.batchPublishPayloads.flatMap((payload) =>
        payload.map((spec) => spec.messages.length),
      ),
    ).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(fixture.channelPublishPayloads).toEqual([]);
    expect(fixture.run(OLD_RUN_ID).realtimeSnapshotSequence).toBe(2);

    const publishCount = fixture.publishedIds.length;
    const batchCount = fixture.batchPublishPayloads.length;
    await fixture.first.publishRun(OLD_RUN_ID);
    expect(fixture.publishedIds).toHaveLength(publishCount);
    expect(fixture.batchPublishPayloads).toHaveLength(batchCount);
  });

  it('acknowledges successful events and retries only failures after a partial batch result', async () => {
    const fixture = createFixture({ oldEventCount: 2 });
    fixture.batchResultOverride = (specs) =>
      specs.map((spec, index) => ({
        successCount: index === 0 ? 1 : 0,
        failureCount: index === 0 ? 0 : 1,
        results: spec.channels.map((channel) => ({
          channel,
          messageId: spec.messages[0]?.id ?? '',
          serials: spec.messages.map(() => 'serial'),
        })),
      }));

    await fixture.first.publishRun(OLD_RUN_ID);

    expect(fixture.event(OLD_EVENT_ID).realtimePublishedAt).not.toBeNull();
    expect(fixture.event(OLD_EVENT_2_ID).realtimePublishedAt).toBeNull();
    expect(fixture.event(OLD_EVENT_2_ID).realtimePublishLastError).toContain(
      'batch publish failed',
    );
    expect(fixture.run(OLD_RUN_ID).realtimePublishLeaseId).not.toBeNull();
    fixture.batchResultOverride = undefined;
    fixture.advanceDatabaseClock(30_001);
    await fixture.second.publishRun(OLD_RUN_ID);
    expect(fixture.event(OLD_EVENT_ID).realtimePublishAttempts).toBe(1);
    expect(fixture.event(OLD_EVENT_2_ID).realtimePublishedAt).not.toBeNull();
  });

  it('coalesces a large backlog into one durable HTTP catch-up pointer', async () => {
    const fixture = createFixture({ oldEventCount: 101 });
    await fixture.first.publishRun(OLD_RUN_ID);
    const firstBatch = fixture.batchPublishPayloads[0] ?? [];
    expect(firstBatch).toHaveLength(1);
    expect(firstBatch[0]?.messages[0]).toMatchObject({
      name: AGENT_OS_ABLY_RESYNC_NAME,
      data: {
        kind: 'event_backlog',
        sequence: 101,
        afterSequence: 0,
        eventId: oldEventId(101),
      },
    });
    expect(fixture.event(oldEventId(101)).realtimePublishedAt).not.toBeNull();
    expect(fixture.run(OLD_RUN_ID).realtimeSnapshotSequence).toBe(101);
  });

  it('publishes an oversized UTF-8 event as a stable journal resync pointer without blocking later events', async () => {
    const fixture = createFixture({ oldEventCount: 3 });
    fixture.event(OLD_EVENT_2_ID).data = {
      turnId: TURN_ID,
      messageId: OLD_EVENT_2_ID,
      delta: '😀'.repeat(20_000),
    };

    await fixture.first.publishRun(OLD_RUN_ID);

    const firstBatch = fixture.batchPublishPayloads[0] ?? [];
    expect(batchSpecIds(firstBatch)).toEqual([
      OLD_EVENT_ID,
      `resync:event:${OLD_EVENT_2_ID}`,
      oldEventId(3),
    ]);
    const pointerMessage = firstBatch[1]?.messages[0];
    expect(pointerMessage?.name).toBe(AGENT_OS_ABLY_RESYNC_NAME);
    expect(pointerMessage?.data).toEqual({
      version: 1,
      kind: 'event_oversized',
      runId: OLD_RUN_ID,
      conversationId: CONVERSATION_ID,
      sequence: 2,
      afterSequence: 1,
      eventId: OLD_EVENT_2_ID,
    } satisfies AgentOsAblyResyncPointer);
    expect(JSON.stringify(pointerMessage?.data)).not.toContain('😀');
    expect(fixture.event(OLD_EVENT_2_ID).realtimePublishedAt).not.toBeNull();
    expect(fixture.event(oldEventId(3)).realtimePublishedAt).not.toBeNull();
  });

  it('retries the same pointer id after publish-before-ack loss and only then acknowledges the durable event', async () => {
    const fixture = createFixture({ oldEventCount: 2 });
    fixture.event(OLD_EVENT_2_ID).data = {
      turnId: TURN_ID,
      messageId: OLD_EVENT_2_ID,
      delta: 'x'.repeat(70_000),
    };
    const pointerId = `resync:event:${OLD_EVENT_2_ID}`;
    let loseFirstResponse = true;
    fixture.onPublish = (ids) => {
      if (loseFirstResponse && ids.includes(pointerId)) {
        loseFirstResponse = false;
        return Promise.reject(
          new Error('response lost after pointer accepted'),
        );
      }
      return Promise.resolve();
    };

    await fixture.first.publishRun(OLD_RUN_ID);
    expect(fixture.event(OLD_EVENT_2_ID).realtimePublishedAt).toBeNull();

    fixture.advanceDatabaseClock(30_001);
    await fixture.second.publishRun(OLD_RUN_ID);

    expect(
      fixture.publishedIds.filter((publishedId) => publishedId === pointerId),
    ).toHaveLength(2);
    expect(fixture.event(OLD_EVENT_2_ID).realtimePublishedAt).not.toBeNull();
  });

  it('replaces an oversized snapshot with a stable resync pointer and advances the snapshot watermark after acknowledgement', async () => {
    const fixture = createFixture();
    fixture.run(OLD_RUN_ID).assistantText = '😀'.repeat(60_000);

    await fixture.first.publishRun(OLD_RUN_ID);

    const snapshotMessage = fixture.batchPublishPayloads
      .flatMap((batch) => batch)
      .flatMap((spec) => spec.messages)
      .find((message) => String(message.id).startsWith('resync:snapshot:')) as
      | { id: string; name: string; data: AgentOsAblyResyncPointer }
      | undefined;
    expect(snapshotMessage).toEqual({
      id: `resync:snapshot:${OLD_RUN_ID}:1`,
      name: AGENT_OS_ABLY_RESYNC_NAME,
      data: {
        version: 1,
        kind: 'snapshot_oversized',
        runId: OLD_RUN_ID,
        conversationId: CONVERSATION_ID,
        sequence: 1,
        afterSequence: 0,
      },
    });
    expect(fixture.run(OLD_RUN_ID).realtimeSnapshotSequence).toBe(1);
    expect(fixture.channelPublishPayloads).toEqual([]);
  });
});

type RunState = {
  id: string;
  projectId: string;
  conversationId: string;
  status: string;
  lastSequence: number;
  assistantText: string | null;
  pendingApproval: null;
  pendingExternal: null;
  realtimePublishLeaseId: string | null;
  realtimePublishLeaseExpiresAt: Date | null;
  realtimeSnapshotSequence: number;
  createdAt: Date;
};

type EventState = {
  id: string;
  runId: string;
  conversationId: string;
  sequence: number;
  protocolVersion: string;
  sessionId: string;
  type: string;
  data: Record<string, unknown>;
  occurredAt: Date;
  realtimePublishedAt: Date | null;
  realtimePublishAttempts: number;
  realtimePublishLastError: string | null;
};

type BatchPublishSpecState = {
  channels: string[];
  messages: Array<{
    id?: string;
    name?: string;
    data?: unknown;
  }>;
};

type BatchPublishResultState = {
  successCount: number;
  failureCount: number;
  results: Array<{
    channel: string;
    messageId: string;
    serials: string[];
  }>;
};

type LeaseHistory = {
  leaseId: string;
  databaseNow: number;
  expiresAt: number;
};

class FakePrisma {
  databaseNow = DB_EPOCH;
  readonly leaseHistory: LeaseHistory[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(
    readonly runs: RunState[],
    readonly events: EventState[],
  ) {}

  readonly $queryRaw = jest.fn(() => Promise.resolve([]));

  readonly $transaction = async <T>(
    operation: (tx: ReturnType<FakePrisma['transactionClient']>) => Promise<T>,
  ): Promise<T> => {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation(this.transactionClient());
    } finally {
      release();
    }
  };

  advanceDatabaseClock(milliseconds: number): void {
    this.databaseNow += milliseconds;
  }

  private transactionClient() {
    return {
      $queryRaw: (query: unknown) => {
        const text = sqlText(query);
        if (text.includes('clock_timestamp')) {
          return [{ now: new Date(this.databaseNow) }];
        }
        return this.runs.map((run) => ({ id: run.id }));
      },
      agentOsRun: {
        findUnique: ({ where }: { where: { id: string } }) => {
          const run = this.runs.find((candidate) => candidate.id === where.id);
          return run ?? null;
        },
        findUniqueOrThrow: ({ where }: { where: { id: string } }) => {
          const run = this.runs.find((candidate) => candidate.id === where.id);
          if (!run) throw new Error(`missing run ${where.id}`);
          return run;
        },
        findMany: ({
          where,
        }: {
          where: { projectId: string; conversationId: string };
        }) =>
          this.runs
            .filter(
              (candidate) =>
                candidate.projectId === where.projectId &&
                candidate.conversationId === where.conversationId,
            )
            .sort(compareRuns),
        updateMany: ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const matching = this.runs.filter((run) => matchesRun(run, where));
          for (const run of matching) {
            applyRunData(run, data);
            const leaseId = data.realtimePublishLeaseId;
            const expiresAt = data.realtimePublishLeaseExpiresAt;
            if (typeof leaseId === 'string' && expiresAt instanceof Date) {
              this.leaseHistory.push({
                leaseId,
                databaseNow: this.databaseNow,
                expiresAt: expiresAt.getTime(),
              });
            } else if (
              run.realtimePublishLeaseId &&
              expiresAt instanceof Date
            ) {
              this.leaseHistory.push({
                leaseId: run.realtimePublishLeaseId,
                databaseNow: this.databaseNow,
                expiresAt: expiresAt.getTime(),
              });
            }
          }
          return { count: matching.length };
        },
      },
      agentOsRunEvent: {
        findMany: ({
          where,
          take,
        }: {
          where: { runId: string; realtimePublishedAt: null };
          take: number;
        }) =>
          this.events
            .filter(
              (event) =>
                event.runId === where.runId &&
                event.realtimePublishedAt === null,
            )
            .sort((left, right) => left.sequence - right.sequence)
            .slice(0, take),
        updateMany: ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const matching = this.events.filter((event) =>
            matchesEvent(event, where),
          );
          for (const event of matching) applyEventData(event, data);
          return { count: matching.length };
        },
        count: ({ where }: { where: { runId: string } }) =>
          this.events.filter(
            (event) =>
              event.runId === where.runId && event.realtimePublishedAt === null,
          ).length,
        findFirst: ({
          where,
        }: {
          where: { runId: string; type: { in: string[] } };
        }) =>
          this.events
            .filter(
              (event) =>
                event.runId === where.runId &&
                where.type.in.includes(event.type),
            )
            .sort((left, right) => right.sequence - left.sequence)[0] ?? null,
      },
    };
  }
}

function createFixture(options: { oldEventCount?: number } = {}) {
  const oldEventCount = options.oldEventCount ?? 1;
  if (!Number.isInteger(oldEventCount) || oldEventCount < 1) {
    throw new Error('oldEventCount must be a positive integer');
  }
  const runs: RunState[] = [
    run(OLD_RUN_ID, 'completed', 0),
    run(NEW_RUN_ID, 'running', 1),
  ];
  runs[0].lastSequence = oldEventCount;
  const events: EventState[] = [
    ...Array.from({ length: oldEventCount }, (_, index) => {
      const sequence = index + 1;
      return event(
        oldEventId(sequence),
        OLD_RUN_ID,
        sequence === 1 ? 'RunCompleted' : 'MessageDelta',
        sequence === 1
          ? { turnId: TURN_ID, status: 'completed' }
          : {
              turnId: TURN_ID,
              messageId: OLD_EVENT_2_ID,
              delta: `suffix-${sequence}`,
            },
        sequence,
      );
    }),
    event(NEW_EVENT_ID, NEW_RUN_ID, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    }),
  ];
  const prisma = new FakePrisma(runs, events);
  const publishedIds: string[] = [];
  const batchPublishPayloads: BatchPublishSpecState[][] = [];
  const channelPublishPayloads: unknown[] = [];
  const fixture = {
    onPublish: undefined as
      | ((ids: readonly string[]) => Promise<void>)
      | undefined,
    batchResultOverride: undefined as
      | ((specs: readonly BatchPublishSpecState[]) => BatchPublishResultState[])
      | undefined,
    publishedIds,
    batchPublishPayloads,
    channelPublishPayloads,
    leaseHistory: prisma.leaseHistory,
    get databaseNow() {
      return prisma.databaseNow;
    },
    advanceDatabaseClock: (milliseconds: number) =>
      prisma.advanceDatabaseClock(milliseconds),
    run: (id: string) => {
      const value = runs.find((candidate) => candidate.id === id);
      if (!value) throw new Error(`missing run ${id}`);
      return value;
    },
    event: (id: string) => {
      const value = events.find((candidate) => candidate.id === id);
      if (!value) throw new Error(`missing event ${id}`);
      return value;
    },
    first: undefined as unknown as AgentOsRealtimeOutboxService,
    second: undefined as unknown as AgentOsRealtimeOutboxService,
  };
  const publish = jest.fn(async (payload: unknown) => {
    channelPublishPayloads.push(payload);
    if (Array.isArray(payload) && !hasValidAtomicMessageIds(payload)) {
      throw new Error(
        'Client-specified message ids do not match the required format for multi-message ProtocolMessages',
      );
    }
    const ids = publicationIds(payload);
    publishedIds.push(...ids);
    await fixture.onPublish?.(ids);
  });
  const batchPublish = jest.fn(
    async (payload: BatchPublishSpecState | BatchPublishSpecState[]) => {
      const specs = Array.isArray(payload) ? payload : [payload];
      batchPublishPayloads.push(specs);
      const ids = batchSpecIds(specs);
      publishedIds.push(...ids);
      await fixture.onPublish?.(ids);
      return (
        fixture.batchResultOverride?.(specs) ??
        specs.map((spec) => ({
          successCount: spec.channels.length,
          failureCount: 0,
          results: spec.channels.map((channel) => ({
            channel,
            messageId: spec.messages[0]?.id ?? '',
            serials: spec.messages.map(() => 'serial'),
          })),
        }))
      );
    },
  );
  const ably = {
    batchPublish,
    channels: { get: jest.fn(() => ({ publish })) },
  };
  fixture.first = new AgentOsRealtimeOutboxService(
    prisma as never,
    ably as never,
  );
  fixture.second = new AgentOsRealtimeOutboxService(
    prisma as never,
    ably as never,
  );
  return fixture;
}

function run(id: string, status: string, createdOffset: number): RunState {
  return {
    id,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    status,
    lastSequence: 1,
    assistantText: null,
    pendingApproval: null,
    pendingExternal: null,
    realtimePublishLeaseId: null,
    realtimePublishLeaseExpiresAt: null,
    realtimeSnapshotSequence: 0,
    createdAt: new Date(DB_EPOCH + createdOffset),
  };
}

function event(
  id: string,
  runId: string,
  type: string,
  data: Record<string, unknown>,
  sequence = 1,
): EventState {
  return {
    id,
    runId,
    conversationId: CONVERSATION_ID,
    sequence,
    protocolVersion: 'fizz.agent.v1',
    sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
    type,
    data,
    occurredAt: new Date(DB_EPOCH),
    realtimePublishedAt: null,
    realtimePublishAttempts: 0,
    realtimePublishLastError: null,
  };
}

function matchesRun(run: RunState, where: Record<string, unknown>): boolean {
  if (typeof where.id === 'string' && run.id !== where.id) return false;
  if (isInFilter(where.id) && !where.id.in.includes(run.id)) return false;
  if (
    typeof where.projectId === 'string' &&
    run.projectId !== where.projectId
  ) {
    return false;
  }
  if (
    typeof where.conversationId === 'string' &&
    run.conversationId !== where.conversationId
  ) {
    return false;
  }
  if (
    'realtimePublishLeaseId' in where &&
    run.realtimePublishLeaseId !== where.realtimePublishLeaseId
  ) {
    return false;
  }
  const watermark = where.realtimeSnapshotSequence;
  if (
    isLessThanFilter(watermark) &&
    !(run.realtimeSnapshotSequence < watermark.lt)
  ) {
    return false;
  }
  return true;
}

function applyRunData(run: RunState, data: Record<string, unknown>): void {
  if ('realtimePublishLeaseId' in data) {
    run.realtimePublishLeaseId = data.realtimePublishLeaseId as string | null;
  }
  if ('realtimePublishLeaseExpiresAt' in data) {
    run.realtimePublishLeaseExpiresAt =
      data.realtimePublishLeaseExpiresAt as Date | null;
  }
  if ('realtimeSnapshotSequence' in data) {
    run.realtimeSnapshotSequence = data.realtimeSnapshotSequence as number;
  }
}

function matchesEvent(
  event: EventState,
  where: Record<string, unknown>,
): boolean {
  if (isInFilter(where.id) && !where.id.in.includes(event.id)) return false;
  if (
    where.realtimePublishedAt === null &&
    event.realtimePublishedAt !== null
  ) {
    return false;
  }
  return true;
}

function applyEventData(
  event: EventState,
  data: Record<string, unknown>,
): void {
  const attempts = data.realtimePublishAttempts;
  if (isIncrementFilter(attempts)) {
    event.realtimePublishAttempts += attempts.increment;
  }
  if ('realtimePublishedAt' in data) {
    event.realtimePublishedAt = data.realtimePublishedAt as Date;
  }
  if ('realtimePublishLastError' in data) {
    event.realtimePublishLastError = data.realtimePublishLastError as
      | string
      | null;
  }
}

function compareRuns(left: RunState, right: RunState): number {
  return (
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function publicationIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.map((entry) => String((entry as { id: unknown }).id));
  }
  return [String((payload as { id: unknown }).id)];
}

function batchSpecIds(specs: readonly BatchPublishSpecState[]): string[] {
  return specs.flatMap((spec) =>
    spec.messages.map((message) => String(message.id)),
  );
}

function oldEventId(sequence: number): string {
  if (sequence === 1) return OLD_EVENT_ID;
  if (sequence === 2) return OLD_EVENT_2_ID;
  return `55555555-5555-4555-8555-${String(sequence).padStart(12, '0')}`;
}

function hasValidAtomicMessageIds(payload: readonly unknown[]): boolean {
  if (payload.length <= 1) return true;
  const ids = payload.map((entry) => String((entry as { id?: unknown }).id));
  const first = ids[0];
  if (!first?.endsWith(':0')) return false;
  const base = first.slice(0, -2);
  return ids.every((id, index) => id === `${base}:${index}`);
}

function sqlText(query: unknown): string {
  if (
    query &&
    typeof query === 'object' &&
    'strings' in query &&
    Array.isArray((query as { strings: unknown }).strings)
  ) {
    return (query as { strings: string[] }).strings.join('');
  }
  return String(query);
}

function isInFilter(value: unknown): value is { in: string[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    'in' in value &&
    Array.isArray((value as { in: unknown }).in)
  );
}

function isLessThanFilter(value: unknown): value is { lt: number } {
  return (
    !!value &&
    typeof value === 'object' &&
    'lt' in value &&
    typeof (value as { lt: unknown }).lt === 'number'
  );
}

function isIncrementFilter(value: unknown): value is { increment: number } {
  return (
    !!value &&
    typeof value === 'object' &&
    'increment' in value &&
    typeof (value as { increment: unknown }).increment === 'number'
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

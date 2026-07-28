import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentEventDraft,
} from '@repo/shared/studio-agent';
import { StudioAgentEventStore } from './studio-agent.events';

const THREAD_ID = '019f8d00-0000-7000-8000-000000000001';
const RUN_ID = '019f8d00-0000-7000-8000-000000000002';
const ACTIVITY_ID = '019f8d00-0000-7000-8000-000000000003';
const PARENT_ACTIVITY_ID = '019f8d00-0000-7000-8000-000000000004';
const NOW = new Date('2026-07-24T12:00:00.000Z');

interface ActivityState {
  id: string;
  threadId: string;
  runId: string;
  parentActivityId: string | null;
  kind: string;
  label: string;
  detail: string | null;
  progress: number | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  firstEventSequence: bigint;
  lastEventSequence: bigint;
}

function harness() {
  let nextEventSequence = 1n;
  const eventsByKey = new Map<string, Record<string, unknown>>();
  const activities = new Map<string, ActivityState>();
  const transaction = {
    studioAgentEvent: {
      findFirst: jest.fn(
        ({ where }: { where: { threadId: string; idempotencyKey: string } }) =>
          Promise.resolve(
            eventsByKey.get(`${where.threadId}:${where.idempotencyKey}`) ??
              null,
          ),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: {
            threadId: string;
            runId: string;
            rootRunId: string;
            parentRunId: string | null;
            sequence: bigint;
            type: string;
            payload: unknown;
            idempotencyKey: string;
            occurredAt: Date;
          };
        }) => {
          const row = {
            eventId: `019f8d00-0000-7000-8000-${data.sequence
              .toString()
              .padStart(12, '0')}`,
            ...data,
          };
          eventsByKey.set(`${data.threadId}:${data.idempotencyKey}`, row);
          return Promise.resolve(row);
        },
      ),
    },
    studioAgentThread: {
      update: jest.fn(() => {
        nextEventSequence += 1n;
        return Promise.resolve({ nextEventSequence });
      }),
    },
    studioAgentActivity: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; threadId: string } }) => {
          const activity = activities.get(where.id);
          return Promise.resolve(
            activity?.threadId === where.threadId ? { id: activity.id } : null,
          );
        },
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { id: string };
          create: ActivityState;
        }) => {
          const existing = activities.get(where.id);
          if (existing) return Promise.resolve(existing);
          activities.set(create.id, { ...create });
          return Promise.resolve(create);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: {
            id: string;
            threadId: string;
            runId: string;
            status: string;
            lastEventSequence: { lt: bigint };
          };
          data: Partial<ActivityState>;
        }) => {
          const activity = activities.get(where.id);
          if (
            !activity ||
            activity.threadId !== where.threadId ||
            activity.runId !== where.runId ||
            activity.status !== where.status ||
            activity.lastEventSequence >= where.lastEventSequence.lt
          ) {
            return Promise.resolve({ count: 0 });
          }
          activities.set(where.id, { ...activity, ...data });
          return Promise.resolve({ count: 1 });
        },
      ),
    },
  };

  return {
    activities,
    transaction,
    store: new StudioAgentEventStore({} as never),
  };
}

describe('StudioAgentEventStore materialized activity projection', () => {
  it('projects start, progress, and terminal events in the event transaction', async () => {
    const { activities, store, transaction } = harness();

    await store.appendInTransaction(
      transaction as never,
      startedDraft(ACTIVITY_ID, null, 'activity:start'),
    );
    await store.appendInTransaction(
      transaction as never,
      progressDraft(ACTIVITY_ID, 'activity:progress'),
    );
    await store.appendInTransaction(
      transaction as never,
      completedDraft(ACTIVITY_ID, 'activity:complete'),
    );

    expect(activities.get(ACTIVITY_ID)).toMatchObject({
      id: ACTIVITY_ID,
      threadId: THREAD_ID,
      runId: RUN_ID,
      parentActivityId: null,
      kind: 'analyze',
      label: 'Analyze the story',
      detail: 'The analysis is ready.',
      progress: 0.5,
      status: 'succeeded',
      startedAt: NOW,
      completedAt: new Date(NOW.getTime() + 2_000),
      firstEventSequence: 1n,
      lastEventSequence: 3n,
    });
  });

  it('returns an existing idempotent event before touching the projection twice', async () => {
    const { activities, store, transaction } = harness();
    const draft = startedDraft(ACTIVITY_ID, null, 'activity:start');

    const first = await store.appendInTransaction(transaction as never, draft);
    const replay = await store.appendInTransaction(transaction as never, draft);

    expect(replay).toEqual(first);
    expect(transaction.studioAgentThread.update).toHaveBeenCalledTimes(1);
    expect(transaction.studioAgentEvent.create).toHaveBeenCalledTimes(1);
    expect(transaction.studioAgentActivity.upsert).toHaveBeenCalledTimes(1);
    expect(activities.size).toBe(1);
  });

  it('requires an existing parent in the same thread', async () => {
    const { store, transaction } = harness();

    await expect(
      store.appendInTransaction(
        transaction as never,
        startedDraft(ACTIVITY_ID, PARENT_ACTIVITY_ID, 'activity:child-start'),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'STUDIO_AGENT_ACTIVITY_PROJECTION_CONFLICT',
        activityId: ACTIVITY_ID,
      },
    });
  });

  it('rejects continuation events without a running activity', async () => {
    const { store, transaction } = harness();

    await expect(
      store.appendInTransaction(
        transaction as never,
        completedDraft(ACTIVITY_ID, 'activity:complete-without-start'),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'STUDIO_AGENT_ACTIVITY_PROJECTION_CONFLICT',
        activityId: ACTIVITY_ID,
      },
    });
  });
});

function startedDraft(
  activityId: string,
  parentActivityId: string | null,
  idempotencyKey: string,
): StudioAgentEventDraft {
  return {
    ...draftBase(idempotencyKey),
    type: 'activity.started',
    payload: {
      activityId,
      parentActivityId,
      kind: 'analyze',
      label: 'Analyze the story',
      startedAt: NOW.toISOString(),
    },
  };
}

function progressDraft(
  activityId: string,
  idempotencyKey: string,
): StudioAgentEventDraft {
  return {
    ...draftBase(idempotencyKey, 1_000),
    type: 'activity.progress',
    payload: {
      activityId,
      progress: 0.5,
      detail: 'Comparing story branches.',
    },
  };
}

function completedDraft(
  activityId: string,
  idempotencyKey: string,
): StudioAgentEventDraft {
  return {
    ...draftBase(idempotencyKey, 2_000),
    type: 'activity.completed',
    payload: {
      activityId,
      summary: 'The analysis is ready.',
      completedAt: new Date(NOW.getTime() + 2_000).toISOString(),
    },
  };
}

function draftBase(idempotencyKey: string, offsetMs = 0) {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: THREAD_ID,
    runId: RUN_ID,
    rootRunId: RUN_ID,
    parentRunId: null,
    occurredAt: new Date(NOW.getTime() + offsetMs).toISOString(),
    idempotencyKey,
  } as const;
}

import type { PrismaService } from '../infra/db/db.module';
import type { ConversationRealtimePublisher } from '../conversations/conversation-realtime.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';

const LOCKED_AT = new Date('2026-07-29T15:00:00.000Z');

function outbox(attempt = 0) {
  return {
    id: 'notification-outbox-1',
    notificationId: 'notification-1',
    userId: 'user-1',
    payload: {
      id: 'notification-1',
      type: 'crew.task.assigned',
      title: 'New task',
      body: 'You were assigned.',
      meta: { crewId: 'crew-1', taskId: 'task-1' },
      readAt: null,
      createdAt: '2026-07-29T15:00:00.000Z',
    },
    attempt,
    nextAttemptAt: null,
    lastError: null,
    dispatchedAt: null,
    deadAt: null,
    lockedAt: LOCKED_AT,
    lockedBy: expect.any(String) as unknown,
    createdAt: LOCKED_AT,
  };
}

function buildHarness(attempt = 0) {
  const claimed = outbox(attempt);
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([{ id: claimed.id }]),
    notificationOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([claimed]),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    notificationOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const realtime = {
    publishUserFrame: jest.fn().mockResolvedValue(undefined),
  };
  const service = new NotificationDispatcherService(
    prisma as unknown as PrismaService,
    realtime as unknown as ConversationRealtimePublisher,
  );
  return { service, prisma, tx, realtime };
}

describe('NotificationDispatcherService', () => {
  it('does not claim another notification while the current publish is stalled', async () => {
    const { service, tx, realtime } = buildHarness();
    let release!: () => void;
    let entered!: () => void;
    const publishing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    realtime.publishUserFrame.mockImplementationOnce(() => {
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const draining = service.drainOnce();
    await publishing;
    try {
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const calls = tx.$queryRaw.mock.calls as unknown[][];
      const sql = calls[0]?.[0] as { values: unknown[] };
      expect(sql.values.at(-1)).toBe(1);
      await service.drainOnce();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await draining;
    }
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('bounds a continuously replenished queue to 50 sends per drain', async () => {
    const { service, tx, realtime } = buildHarness();
    tx.$queryRaw.mockResolvedValue([{ id: 'notification-outbox-1' }]);
    await service.drainOnce();
    expect(realtime.publishUserFrame).toHaveBeenCalledTimes(50);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(50);
  });

  it('publishes a notification.created frame and acknowledges only after Ably succeeds', async () => {
    const { service, prisma, realtime } = buildHarness();

    await service.drainOnce();

    expect(realtime.publishUserFrame).toHaveBeenCalledWith(
      'user-1',
      {
        event: 'notification.created',
        data: expect.objectContaining({
          id: 'notification-1',
          type: 'crew.task.assigned',
        }) as unknown,
      },
      'notification:notification-1',
    );
    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'notification-outbox-1',
        lockedAt: LOCKED_AT,
        dispatchedAt: null,
        deadAt: null,
      }) as unknown,
      data: expect.objectContaining({
        dispatchedAt: expect.any(Date) as unknown,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      }) as unknown,
    });
  });

  it('releases its lease and schedules a bounded retry when Ably is unavailable', async () => {
    const { service, prisma, realtime } = buildHarness();
    realtime.publishUserFrame.mockRejectedValueOnce(
      new Error('Ably unavailable'),
    );

    await service.drainOnce();

    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'notification-outbox-1',
      }) as unknown,
      data: expect.objectContaining({
        attempt: 1,
        lastError: 'Ably unavailable',
        nextAttemptAt: expect.any(Date) as unknown,
        deadAt: null,
        lockedAt: null,
        lockedBy: null,
      }) as unknown,
    });
  });

  it('moves a permanently failing event to the DLQ after the retry budget', async () => {
    const { service, prisma, realtime } = buildHarness(11);
    realtime.publishUserFrame.mockRejectedValueOnce(
      new Error('permanent rejection'),
    );

    await service.drainOnce();

    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'notification-outbox-1',
      }) as unknown,
      data: expect.objectContaining({
        attempt: 12,
        lastError: 'permanent rejection',
        nextAttemptAt: null,
        deadAt: expect.any(Date) as unknown,
      }) as unknown,
    });
  });

  it('does not overlap drain cycles in one process', async () => {
    const { service, tx } = buildHarness();
    let release: (() => void) | undefined;
    tx.$queryRaw.mockReset().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );

    const first = service.drainOnce();
    await Promise.resolve();
    await service.drainOnce();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    release?.();
    await first;
  });
});

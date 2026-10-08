import { ConversationRealtimeOutboxService } from '../conversations/conversation-realtime-outbox.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationService } from './notification.service';

jest.mock('../conversations/conversation-realtime.service', () => ({
  CONVERSATION_REALTIME: Symbol('test-realtime'),
}));
jest.mock('../conversations/conversations.service', () => ({
  ConversationsService: class {},
}));

describe('Durable outbox background task isolation', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.BACKGROUND_TASKS_ENABLED;
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
    else process.env.BACKGROUND_TASKS_ENABLED = previous;
    jest.useRealTimers();
  });

  it.each([
    [
      'notifications',
      (prisma: unknown, delivery: unknown) =>
        new NotificationDispatcherService(prisma as never, delivery as never),
    ],
    [
      'conversations',
      (prisma: unknown, delivery: unknown) =>
        new ConversationRealtimeOutboxService(
          prisma as never,
          delivery as never,
        ),
    ],
  ] as const)(
    '%s does not claim, deliver, acknowledge or garbage collect',
    async (_name, create) => {
      const prisma = { $transaction: jest.fn(), $queryRaw: jest.fn() };
      const delivery = {
        publishUserFrame: jest.fn(),
        deliverMessageRealtime: jest.fn(),
      };
      const worker = create(prisma, delivery);
      const internal = worker as unknown as {
        claim(batch: number): Promise<unknown[]>;
        dispatchOne(row: unknown): Promise<void>;
        gc(): Promise<void>;
      };
      const claim = jest.spyOn(internal, 'claim');
      const dispatch = jest.spyOn(internal, 'dispatchOne');
      const gc = jest.spyOn(internal, 'gc');

      worker.onApplicationBootstrap();
      await worker.drainOnce();

      expect(jest.getTimerCount()).toBe(0);
      expect(claim).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(gc).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(delivery.publishUserFrame).not.toHaveBeenCalled();
      expect(delivery.deliverMessageRealtime).not.toHaveBeenCalled();
      await worker.onModuleDestroy();
    },
  );

  it('still persists a notification and its durable outbox while delivery is disabled', async () => {
    const row = {
      id: 'notification-1',
      userId: 'user-1',
      type: 'crew.task.assigned',
      title: 'Task assigned',
      body: 'Review the storyboard',
      meta: {},
      readAt: null,
      createdAt: new Date('2026-10-06T12:00:00Z'),
    };
    const tx = {
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      },
      notificationOutbox: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };
    const service = new NotificationService(prisma as never);

    await expect(
      service.send({
        userId: row.userId,
        type: row.type,
        title: row.title,
        body: row.body,
        idempotencyKey: 'crew.task.assigned:task-1:user-1',
      }),
    ).resolves.toMatchObject({ id: row.id });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
    expect(tx.notificationOutbox.create).toHaveBeenCalledTimes(1);
    expect(tx.notificationOutbox.create.mock.calls).toMatchObject([
      [{ data: { notificationId: row.id, userId: row.userId } }],
    ]);
  });
});

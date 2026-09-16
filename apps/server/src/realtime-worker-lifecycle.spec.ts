import { NotificationDispatcherService } from './notification/notification-dispatcher.service';
import { ConversationRealtimeOutboxService } from './conversations/conversation-realtime-outbox.service';
import { AgentOsExternalHandoffReconcilerService } from './agent-os-journal/agent-os-external-handoff-reconciler.service';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
describe.each([
  ['notifications', NotificationDispatcherService, 'notificationOutbox'],
  [
    'conversations',
    ConversationRealtimeOutboxService,
    'conversationRealtimeOutbox',
  ],
] as const)('%s shutdown boundaries', (_name, Service, delegate) => {
  it.each(['query', 'write', 'load', 'publish'])(
    'stops after an in-flight %s without starting more work',
    async (phase) => {
      const entered = deferred(),
        release = deferred();
      const wait = async (at: string) => {
        if (phase === at) {
          entered.resolve();
          await release.promise;
        }
      };
      const query = jest.fn(async () => {
        await wait('query');
        return [{ id: 'row' }];
      });
      const write = jest.fn(async () => {
        await wait('write');
        return { count: 1 };
      });
      const load = jest.fn(async () => {
        await wait('load');
        return [
          {
            id: 'row',
            notificationId: 'notification',
            userId: 'user',
            messageId: 'message',
            message: { id: 'message' },
            payload: {},
            attempt: 0,
            lockedAt: new Date(),
          },
        ];
      });
      const ack = jest.fn().mockResolvedValue({ count: 1 }),
        gc = jest.fn().mockResolvedValue({ count: 0 });
      const tx = {
        $queryRaw: query,
        [delegate]: { updateMany: write, findMany: load },
      };
      const publish = jest.fn(async () => {
        await wait('publish');
      });
      const service = new Service(
        {
          $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
          [delegate]: { updateMany: ack, deleteMany: gc },
        } as never,
        { publishUserFrame: publish, deliverMessageRealtime: publish } as never,
      );
      const work = service.drainOnce();
      await entered.promise;
      service.onModuleDestroy();
      release.resolve();
      await work;
      await service.drainOnce();
      expect(query).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledTimes(phase === 'query' ? 0 : 1);
      expect(load).toHaveBeenCalledTimes(
        ['load', 'publish'].includes(phase) ? 1 : 0,
      );
      expect(publish).toHaveBeenCalledTimes(phase === 'publish' ? 1 : 0);
      expect(ack).toHaveBeenCalledTimes(phase === 'publish' ? 1 : 0);
      expect(gc).not.toHaveBeenCalled();
      const timer = jest.spyOn(global, 'setInterval');
      try {
        service.onApplicationBootstrap();
        expect(timer).not.toHaveBeenCalled();
      } finally {
        timer.mockRestore();
      }
    },
  );
});
it.each(['candidate', 'active'])(
  'stops external-handoff recovery after %s wait',
  async (phase) => {
    const entered = deferred(),
      release = deferred();
    const query = jest.fn(async () => {
      if (phase === 'candidate') {
        entered.resolve();
        await release.promise;
      }
      return [{ externalJobId: 'one' }, { externalJobId: 'two' }];
    });
    const reconcile = jest.fn(async () => {
      if (phase === 'active') {
        entered.resolve();
        await release.promise;
      }
    });
    const service = new AgentOsExternalHandoffReconcilerService(
      { $queryRaw: query } as never,
      { reconcileExternalHandoff: reconcile } as never,
    );
    const work = service.drainOnce();
    await entered.promise;
    service.onModuleDestroy();
    release.resolve();
    await work;
    await service.drainOnce();
    expect(query).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(phase === 'active' ? 1 : 0);
  },
);

it.each([
  [NotificationDispatcherService, 'notificationOutbox'],
  [ConversationRealtimeOutboxService, 'conversationRealtimeOutbox'],
] as const)(
  'starts the lease after an eligibility-read delay',
  async (Service, delegate) => {
    jest.useFakeTimers();
    const initial = Date.parse('2026-09-14T00:00:00Z');
    jest.setSystemTime(initial);
    try {
      const entered = deferred(),
        release = deferred();
      const query = jest
        .fn()
        .mockResolvedValue([])
        .mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
          return [{ id: 'row' }];
        });
      const write = jest.fn().mockResolvedValue({ count: 1 });
      const load = jest.fn().mockResolvedValue([
        {
          id: 'row',
          notificationId: 'notification',
          userId: 'user',
          messageId: 'message',
          message: {},
          payload: {},
          attempt: 0,
          lockedAt: new Date(initial + 90000),
        },
      ]);
      const tx = {
        $queryRaw: query,
        [delegate]: { updateMany: write, findMany: load },
      };
      const service = new Service(
        {
          $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
          [delegate]: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        } as never,
        {
          publishUserFrame: jest.fn().mockResolvedValue(undefined),
          deliverMessageRealtime: jest.fn().mockResolvedValue(undefined),
        } as never,
      );
      const work = service.drainOnce();
      await entered.promise;
      jest.setSystemTime(initial + 90000);
      release.resolve();
      await work;
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lockedAt: new Date(initial + 90000),
          }) as unknown,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  },
);

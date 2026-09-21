import { NotificationDispatcherService } from './notification-dispatcher.service';
import { ConversationRealtimeOutboxService } from '../conversations/conversation-realtime-outbox.service';

jest.mock('../conversations/conversation-realtime.service', () => ({
  CONVERSATION_REALTIME: Symbol('test-realtime'),
}));

jest.mock('../conversations/conversations.service', () => ({
  ConversationsService: class {},
}));

type Outbox = {
  drainOnce(): Promise<void>;
  onModuleDestroy(): void | Promise<void>;
  claim(batch: number): Promise<unknown[]>;
  dispatchOne(row: unknown): Promise<void>;
  gc(): Promise<void>;
};
const cases = [
  [
    'notifications',
    () => new NotificationDispatcherService({} as never, {} as never),
  ],
  [
    'conversations',
    () => new ConversationRealtimeOutboxService({} as never, {} as never),
  ],
] as const;

it.each(cases)(
  '%s shutdown waits for active delivery and skips later work',
  async (_name, create) => {
    const worker = create() as unknown as Outbox;
    const claim = jest.spyOn(worker, 'claim').mockResolvedValue([{}]);
    const gc = jest.spyOn(worker, 'gc').mockResolvedValue(undefined);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const publish = jest
      .spyOn(worker, 'dispatchOne')
      .mockImplementation(async () => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
    const drain = worker.drainOnce();
    await started;
    let finished = false;
    const shutdown = Promise.resolve(worker.onModuleDestroy()).then(() => {
      finished = true;
    });
    await Promise.resolve();
    const early = finished;
    release();
    await Promise.all([drain, shutdown]);
    expect(early).toBe(false);
    await worker.drainOnce();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(gc).not.toHaveBeenCalled();
  },
);

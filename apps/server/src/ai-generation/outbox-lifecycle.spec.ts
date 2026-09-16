import { AiGenerationOutboxService } from './outbox.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it.each(['candidate', 'claim', 'payload'])(
  'stops abandoned %s reads before publication',
  async (phase) => {
    const entered = deferred(),
      release = deferred();
    const wait = async (current: string) => {
      if (phase === current) {
        entered.resolve();
        await release.promise;
      }
    };
    const lockedAt = new Date();
    const query = jest.fn(async () => {
      await wait('claim');
      return [{ id: 'row', lockedAt }];
    });
    const findMany = jest.fn(async () => {
      await wait('candidate');
      return [{ id: 'row' }];
    });
    const findFirst = jest.fn(async () => {
      await wait('payload');
      return {
        id: 'row',
        userId: 'user',
        attempt: 0,
        channel: null,
        seq: null,
        eventId: null,
        payload: { type: 'fixture' },
      };
    });
    const publish = jest.fn().mockResolvedValue(undefined);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new AiGenerationOutboxService(
      {
        $queryRaw: query,
        aiEventOutbox: {
          findMany,
          findFirst,
          updateMany,
          deleteMany: jest.fn(),
        },
      } as never,
      { publishAssetEvent: publish } as never,
    );
    const work = service['drainOnce']();
    await entered.promise;
    service.onModuleDestroy();
    release.resolve();
    await work;
    await service['tryDispatch']('row');
    await service['drainOnce']();
    expect(publish).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(phase === 'candidate' ? 0 : 1);
    expect(findFirst).toHaveBeenCalledTimes(phase === 'payload' ? 1 : 0);
    const timer = jest.spyOn(global, 'setInterval');
    try {
      service.onApplicationBootstrap();
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  },
);

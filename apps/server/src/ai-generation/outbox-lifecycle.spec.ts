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
    const shutdown = service.onModuleDestroy();
    release.resolve();
    await work;
    await shutdown;
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

it.each([
  ['scheduled', false],
  ['immediate', false],
  ['scheduled', true],
  ['immediate', true],
] as const)(
  'waits for active %s publication and acknowledgement during shutdown (failure=%s)',
  async (mode, failure) => {
    const entered = deferred(),
      release = deferred();
    const query = jest
      .fn()
      .mockResolvedValue([{ id: 'row', lockedAt: new Date() }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const publish = jest.fn(async () => {
      entered.resolve();
      await release.promise;
      if (failure) throw new Error('provider failure');
    });
    const service = new AiGenerationOutboxService(
      {
        $queryRaw: query,
        aiEventOutbox: {
          findMany: jest.fn().mockResolvedValue([{ id: 'row' }]),
          findFirst: jest.fn().mockResolvedValue({
            id: 'row',
            userId: 'user',
            attempt: 0,
            payload: { type: 'fixture' },
          }),
          updateMany,
          deleteMany: jest.fn(),
        },
      } as never,
      { publishAssetEvent: publish } as never,
    );
    const work =
      mode === 'scheduled'
        ? service['drainOnce']()
        : service['tryDispatch']('row');
    await entered.promise;
    let ended = false;
    const shutdown = Promise.resolve(service.onModuleDestroy()).then(() => {
      ended = true;
    });
    await Promise.resolve();
    const early = ended;
    release.resolve();
    await Promise.all([work, shutdown]);
    expect(early).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(1);
    await service['tryDispatch']('later');
    await service['drainOnce']();
    expect(query).toHaveBeenCalledTimes(1);
  },
);

it('waits for every immediate dispatch when publications overlap', async () => {
  const first = deferred(),
    second = deferred();
  const service = new AiGenerationOutboxService({} as never, {} as never);
  const dispatch = jest
    .spyOn(
      service as unknown as { dispatchOne(id: string): Promise<void> },
      'dispatchOne',
    )
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const one = service['tryDispatch']('one');
  const two = service['tryDispatch']('two');
  let stopped = false;
  const shutdown = service.onModuleDestroy().then(() => {
    stopped = true;
  });
  first.resolve();
  await one;
  const early = stopped;
  second.resolve();
  await Promise.all([two, shutdown]);
  expect(early).toBe(false);
  await service['tryDispatch']('three');
  expect(dispatch).toHaveBeenCalledTimes(2);
});

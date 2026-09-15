import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma, AiOutboxEventType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AiGenerationOutboxService } from './outbox.service';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const suite = databaseUrl ? describe : describe.skip;
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
suite('AI outbox claims in PostgreSQL', () => {
  let db: PrismaClient;
  const ids: string[] = [];
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '55439' && url.pathname === '/task01') ||
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test')
      )
    )
      throw new Error('Named loopback fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
  });
  afterEach(async () => {
    await db.aiEventOutbox.deleteMany({ where: { id: { in: ids.splice(0) } } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  async function create() {
    const id = `outbox-fixture-${randomUUID()}`;
    ids.push(id);
    return db.aiEventOutbox.create({
      data: {
        id,
        userId: 'fixture-user',
        eventType: AiOutboxEventType.job_update,
        payload: { type: 'fixture-event', id },
        createdAt: new Date(Date.now() + ids.length),
      },
    });
  }
  function harness(
    publish = jest
      .fn<Promise<void>, [string, unknown]>()
      .mockResolvedValue(undefined),
  ) {
    const findMany = jest.fn(
      async (args: Prisma.AiEventOutboxFindManyArgs) =>
        await db.aiEventOutbox.findMany({
          ...args,
          where: { AND: [args.where ?? {}, { id: { in: [...ids] } }] },
        }),
    );
    const updateMany = jest.fn(
      async (args: Prisma.AiEventOutboxUpdateManyArgs) =>
        await db.aiEventOutbox.updateMany(args),
    );
    const service = new AiGenerationOutboxService(
      {
        $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) =>
          db.$queryRaw(query, ...values),
        aiEventOutbox: {
          findMany,
          findFirst: (args: Prisma.AiEventOutboxFindFirstArgs) =>
            db.aiEventOutbox.findFirst(args),
          updateMany,
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as never,
      { publishAssetEvent: publish } as never,
    );
    return { service, publish, findMany, updateMany };
  }
  it('coordinates immediate and retried publication through one claim', async () => {
    const row = await create();
    const entered = deferred(),
      release = deferred();
    const { service, publish } = harness(
      jest
        .fn<Promise<void>, [string, unknown]>()
        .mockImplementation(async () => {
          entered.resolve();
          await release.promise;
        }),
    );
    const first = service['tryDispatch'](row.id);
    await entered.promise;
    try {
      await Promise.all([
        service['tryDispatch'](row.id),
        service['drainOnce'](),
      ]);
      expect(publish).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await first;
    }
    expect(
      await db.aiEventOutbox.findUnique({ where: { id: row.id } }),
    ).toMatchObject({
      attempt: 1,
      dispatchedAt: expect.any(Date) as unknown,
      lockedAt: null,
      lockedBy: null,
    });
  });
  it.each([false, true])(
    'preserves a replacement claim after a displaced publisher settles (failure=%s)',
    async (failed) => {
      const row = await create();
      const entered = deferred(),
        release = deferred();
      const { service } = harness(
        jest
          .fn<Promise<void>, [string, unknown]>()
          .mockImplementation(async () => {
            entered.resolve();
            await release.promise;
            if (failed) throw new Error('Old publisher failed');
          }),
      );
      const work = service['tryDispatch'](row.id);
      await entered.promise;
      const replacement = new Date(Date.now() + 1000);
      try {
        await db.aiEventOutbox.update({
          where: { id: row.id },
          data: {
            lockedAt: replacement,
            lockedBy: 'replacement-worker',
            attempt: 7,
            lastError: 'replacement evidence',
          },
        });
      } finally {
        release.resolve();
        await work;
      }
      expect(
        await db.aiEventOutbox.findUnique({ where: { id: row.id } }),
      ).toMatchObject({
        lockedAt: replacement,
        lockedBy: 'replacement-worker',
        attempt: 7,
        lastError: 'replacement evidence',
        dispatchedAt: null,
      });
    },
  );
  it.each(['future', 'completed'] as const)(
    'rechecks %s state after candidate selection',
    async (state) => {
      const row = await create();
      const { service, publish, findMany } = harness();
      findMany.mockImplementationOnce(async () => {
        await db.aiEventOutbox.update({
          where: { id: row.id },
          data:
            state === 'future'
              ? { nextAttemptAt: new Date(Date.now() + 60000) }
              : { dispatchedAt: new Date() },
        });
        return [row];
      });
      await service['drainOnce']();
      expect(publish).not.toHaveBeenCalled();
      expect(
        await db.aiEventOutbox.findUnique({ where: { id: row.id } }),
      ).toMatchObject({ lockedAt: null, lockedBy: null, attempt: 0 });
    },
  );
  it('leaves the next item unclaimed while publication is stalled', async () => {
    const first = await create(),
      second = await create();
    const entered = deferred(),
      release = deferred();
    const { service, publish } = harness(
      jest
        .fn<Promise<void>, [string, unknown]>()
        .mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
        })
        .mockResolvedValue(undefined),
    );
    const work = service['drainOnce']();
    await entered.promise;
    try {
      expect(
        (await db.aiEventOutbox.findUnique({ where: { id: second.id } }))
          ?.lockedAt,
      ).toBeNull();
    } finally {
      release.resolve();
      await work;
    }
    expect(publish).toHaveBeenCalledTimes(2);
    expect(
      await db.aiEventOutbox.count({
        where: {
          id: { in: [first.id, second.id] },
          dispatchedAt: { not: null },
        },
      }),
    ).toBe(2);
  });
  it('skips a locked row without aging a waiting claim, then recovers it', async () => {
    const row = await create();
    const entered = deferred(),
      release = deferred();
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_event_outbox WHERE id = ${row.id} FOR UPDATE`;
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const { service, publish } = harness();
    try {
      await service['tryDispatch'](row.id);
      expect(publish).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await holder;
    }
    await service['tryDispatch'](row.id);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('finishes active publication after shutdown without claiming the next item', async () => {
    const first = await create(),
      second = await create();
    const entered = deferred(),
      release = deferred();
    const { service, publish } = harness(
      jest
        .fn<Promise<void>, [string, unknown]>()
        .mockImplementation(async () => {
          entered.resolve();
          await release.promise;
        }),
    );
    const work = service['drainOnce']();
    await entered.promise;
    service.onModuleDestroy();
    release.resolve();
    await work;
    await service['tryDispatch'](second.id);
    await service['drainOnce']();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(
      (await db.aiEventOutbox.findUnique({ where: { id: first.id } }))
        ?.dispatchedAt,
    ).not.toBeNull();
    expect(
      await db.aiEventOutbox.findUnique({ where: { id: second.id } }),
    ).toMatchObject({ lockedAt: null, dispatchedAt: null, attempt: 0 });
  });
  it('retains retry and dead-letter behavior for the current owner', async () => {
    const row = await create();
    const { service } = harness(
      jest
        .fn<Promise<void>, [string, unknown]>()
        .mockRejectedValue(new Error('fixture unavailable')),
    );
    await service['tryDispatch'](row.id);
    expect(
      await db.aiEventOutbox.findUnique({ where: { id: row.id } }),
    ).toMatchObject({
      attempt: 1,
      nextAttemptAt: expect.any(Date) as unknown,
      deadAt: null,
      lockedAt: null,
    });
    await db.aiEventOutbox.update({
      where: { id: row.id },
      data: { attempt: 11, nextAttemptAt: null },
    });
    await service['tryDispatch'](row.id);
    expect(
      await db.aiEventOutbox.findUnique({ where: { id: row.id } }),
    ).toMatchObject({
      attempt: 12,
      nextAttemptAt: null,
      deadAt: expect.any(Date) as unknown,
      lockedAt: null,
    });
  });
  it('does not rewrite a committed acknowledgement after response loss', async () => {
    const row = await create();
    const { service, publish, updateMany } = harness();
    updateMany.mockImplementationOnce(async (args) => {
      await db.aiEventOutbox.updateMany(args);
      throw new Error('Acknowledgement response lost');
    });
    await service['tryDispatch'](row.id);
    await service['tryDispatch'](row.id);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(
      await db.aiEventOutbox.findUnique({ where: { id: row.id } }),
    ).toMatchObject({
      dispatchedAt: expect.any(Date) as unknown,
      attempt: 1,
      lastError: null,
      nextAttemptAt: null,
      deadAt: null,
    });
  });
});

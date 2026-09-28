import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type BillingPaymentProviderEvent } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { BillingService } from './billing.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `event-admin-${randomUUID()}`;
type Internals = {
  storeProviderEvent(input: {
    provider: 'airwallex';
    providerEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<BillingPaymentProviderEvent>;
  markProviderEventFailed(
    id: string,
    error: unknown,
    revision: string | null,
  ): Promise<void>;
  matchPaymentIntent(...args: unknown[]): Promise<unknown>;
};
jest.setTimeout(30000);
integration('Provider event recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let eventId: string;
  let providerEventId: string;
  const service = (client: unknown = db) =>
    new BillingService(
      client as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  const internals = (svc = service()) => svc as unknown as Internals;
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned task01 fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
  });
  beforeEach(async () => {
    providerEventId = randomUUID();
    eventId = (
      await db.billingPaymentProviderEvent.create({
        data: {
          provider: 'airwallex',
          providerEventId,
          eventType: 'fixture.unknown',
          payload: { original: true },
        },
      })
    ).id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.billingPaymentProviderEvent.delete({ where: { id: eventId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const read = () =>
    db.billingPaymentProviderEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
  const snapshot = read;
  const perform = (kind: string) =>
    kind === 'ignore'
      ? service().ignoreAdminProviderEvent(eventId, 'fixture reason')
      : service().reprocessAdminProviderEvent(eventId);
  const revision = async () => {
    const [row] = await db.$queryRaw<
      { revision: string }[]
    >`SELECT xmin::text AS revision FROM billing_payment_provider_events WHERE id=${eventId}::uuid`;
    return row.revision;
  };
  const waitForLock = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
      if (Number(row.count)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Expected event write wait');
  };
  it.each(['ignore', 'ingest'])(
    'preserves a completion committed while %s waits',
    async (kind) => {
      let ready!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((r) => {
        ready = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:provider_event:${eventId}`})::bigint)`;
        ready();
        await gate;
        await tx.billingPaymentProviderEvent.update({
          where: { id: eventId },
          data: { status: 'processed', processedAt: new Date(), error: null },
        });
      });
      await entered;
      const pending =
        kind === 'ignore'
          ? perform(kind)
          : internals().storeProviderEvent({
              provider: 'airwallex',
              providerEventId,
              eventType: 'changed.event',
              payload: { replacement: true },
            });
      void pending.catch(() => undefined);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await holder;
      if (kind === 'ignore')
        await expect(pending).rejects.toMatchObject({ status: 409 });
      else
        await expect(pending).resolves.toMatchObject({ status: 'processed' });
      expect(await read()).toMatchObject({
        status: 'processed',
        eventType: 'fixture.unknown',
        payload: { original: true },
      });
    },
  );
  it.each(['received', 'ignored', 'failed', 'processed'] as const)(
    'preserves a newer %s revision against a delayed failure',
    async (status) => {
      const old = await revision();
      await db.billingPaymentProviderEvent.update({
        where: { id: eventId },
        data: { status },
      });
      const before = await snapshot();
      await internals().markProviderEventFailed(
        eventId,
        new Error('old failure'),
        old,
      );
      expect(await snapshot()).toEqual(before);
    },
  );
  it('records the current processing failure', async () => {
    const svc = service();
    jest
      .spyOn(internals(svc), 'matchPaymentIntent')
      .mockRejectedValue(new Error('processing failure'));
    await expect(svc.reprocessAdminProviderEvent(eventId)).rejects.toThrow(
      'processing failure',
    );
    const after = await snapshot();
    expect(after).toMatchObject({
      status: 'failed',
      error: 'processing failure',
    });
  });
});

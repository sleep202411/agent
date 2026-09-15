import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BillingService } from './billing.service';
const url =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
(url ? describe : describe.skip)(
  'Subscription cancellation recording (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      userId: string,
      itemId: string,
      subscriptionId: string;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw new Error('Owned fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url,
          options: '-c timezone=UTC',
        }),
      });
      await db.$connect();
    });
    beforeEach(async () => {
      userId = randomUUID();
      const item = await db.billingCatalogItem.create({
        data: {
          productType: 'membership_plan',
          code: userId,
          name: 'Cancellation fixture',
        },
      });
      itemId = item.id;
      const price = await db.billingPrice.create({
        data: { itemId, currency: 'USD', amountMinor: 200n, interval: 'month' },
      });
      const subscription = await db.billingSubscription.create({
        data: {
          userId,
          subjectType: 'user',
          subjectId: userId,
          provider: 'airwallex',
          providerSubscriptionId: userId,
          priceId: price.id,
          status: 'active',
          currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
        },
      });
      subscriptionId = subscription.id;
    });
    afterEach(async () => {
      await db.billingSubscription.deleteMany({ where: { userId } });
      await db.billingCatalogItem.deleteMany({ where: { id: itemId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    it.each(['renewal', 'expired', 'canceled'] as const)(
      'preserves %s recorded during the local row-lock wait',
      async (change) => {
        const cancel = jest.fn().mockResolvedValue({});
        const service = new BillingService(
          db as never,
          { get: () => ({ cancelSubscription: cancel }) } as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );
        let unlock!: () => void, ready!: (tx: Prisma.TransactionClient) => void;
        const held = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        const entered = new Promise<Prisma.TransactionClient>((resolve) => {
          ready = resolve;
        });
        const blocker = db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM billing_subscriptions WHERE id=${subscriptionId}::uuid FOR UPDATE`;
            ready(tx);
            await held;
          },
          { timeout: 10000 },
        );
        const tx = await entered;
        const pending = service.cancelSubscription({ userId }, subscriptionId);
        const result = pending.then(
          (value) => ({ value, error: null }),
          (error: unknown) => ({ value: null, error }),
        );
        const end = new Date('2026-11-01T00:00:00Z');
        try {
          let waiting = false;
          for (let i = 0; i < 200; i++) {
            const rows = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%billing_subscriptions%' AND query LIKE '%FOR UPDATE%'`;
            if (Number(rows[0].count) > 0) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(true);
          await tx.billingSubscription.update({
            where: { id: subscriptionId },
            data:
              change === 'renewal'
                ? { currentPeriodEnd: end }
                : { status: change, endedAt: end, canceledAt: end },
          });
        } finally {
          unlock();
          await blocker;
        }
        const settled = await result;
        expect(settled.error).toBeNull();
        expect(settled.value?.status).toBe(
          change === 'renewal' ? 'canceled' : change,
        );
        expect(settled.value?.endedAt).toBe(end.toISOString());
        const stored = await db.billingSubscription.findUniqueOrThrow({
          where: { id: subscriptionId },
        });
        expect(stored.version).toBe(change === 'renewal' ? 1 : 0);
        expect(cancel).toHaveBeenCalledTimes(1);
      },
    );
  },
);

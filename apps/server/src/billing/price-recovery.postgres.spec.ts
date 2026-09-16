import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { BillingService } from './billing.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `price-recovery-${randomUUID()}`;
jest.setTimeout(30000);
integration('Price update recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let itemId: string;
  let priceId: string;
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
    itemId = (
      await db.billingCatalogItem.create({
        data: {
          code: randomUUID(),
          name: 'Original',
          productType: 'compute_point_pack',
        },
      })
    ).id;
    priceId = (
      await db.billingPrice.create({
        data: {
          itemId,
          currency: 'USD',
          amountMinor: 100n,
          subjectType: 'user',
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.billingProviderPriceBinding.deleteMany({ where: { priceId } });
    await db.billingPrice.delete({ where: { id: priceId } });
    await db.billingCatalogItem.delete({ where: { id: itemId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
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

  it('reuses a single binding for concurrent saves', async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        service().upsertAdminProviderBinding(priceId, {
          provider: 'airwallex',
          status: 'active',
          providerPriceId: 'fixture',
        }),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(
      await db.billingProviderPriceBinding.count({
        where: { priceId, archivedAt: null },
      }),
    ).toBe(1);
  });
  it('preserves a concurrent archive during a detail edit and supports explicit restore', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entered = new Promise<void>((r) => {
      ready = r;
    });
    const archivedAt = new Date('2026-01-01T00:00:00Z');
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_prices WHERE id=${priceId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.billingPrice.update({
        where: { id: priceId },
        data: { archivedAt },
      });
    });
    await entered;
    const pending = service().updateAdminPrice(priceId, { itemName: 'Edited' });
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await pending;
    expect(
      await db.billingPrice.findUniqueOrThrow({ where: { id: priceId } }),
    ).toMatchObject({ archivedAt });
    expect(
      await db.billingCatalogItem.findUniqueOrThrow({ where: { id: itemId } }),
    ).toMatchObject({ name: 'Edited' });
    await service().updateAdminPrice(priceId, { archived: false });
    expect(
      await db.billingPrice.findUniqueOrThrow({ where: { id: priceId } }),
    ).toMatchObject({ archivedAt: null });
  });
});

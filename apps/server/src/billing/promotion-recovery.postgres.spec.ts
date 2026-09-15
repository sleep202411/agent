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
const applicationName = `promotion-recovery-${randomUUID()}`;
jest.setTimeout(30000);
integration('Promotion update recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let promotionId: string;
  const adminId = randomUUID();
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
    const url = new URL(databaseUrl!);
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
    promotionId = (
      await db.billingPromotion.create({
        data: {
          name: 'Original',
          code: randomUUID().toUpperCase(),
          createdById: adminId,
          applyMode: 'code',
          percentOffBps: 1000,
          startsAt: new Date('2026-01-01'),
          endsAt: new Date('2026-12-31'),
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.billingPromotion.deleteMany({ where: { createdById: adminId } });
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

  it('reuses one promotion binding for simultaneous saves', async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        service().upsertAdminPromotionProviderBinding(promotionId, {
          provider: 'airwallex',
          status: 'active',
          providerCouponId: 'fixture',
        }),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(
      await db.billingPromotionProviderBinding.count({
        where: { promotionId, archivedAt: null },
      }),
    ).toBe(1);
  });
  it('rejects partial date edits invalidated by a concurrent start-time change', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entered = new Promise<void>((r) => {
      ready = r;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_promotions WHERE id=${promotionId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.billingPromotion.update({
        where: { id: promotionId },
        data: { startsAt: new Date('2026-10-01') },
      });
    });
    await entered;
    const pending = service().updateAdminPromotion(promotionId, adminId, {
      endsAt: new Date('2026-09-01'),
    });
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    const before = await db.billingPromotion.findUniqueOrThrow({
      where: { id: promotionId },
    });
    await expect(pending).rejects.toMatchObject({
      response: { code: 'BILLING_PROMOTION_TIME_WINDOW_INVALID' },
    });
    expect(
      await db.billingPromotion.findUniqueOrThrow({
        where: { id: promotionId },
      }),
    ).toEqual(before);
    await service().updateAdminPromotion(promotionId, adminId, {
      endsAt: null,
    });
    expect(
      await db.billingPromotion.findUniqueOrThrow({
        where: { id: promotionId },
      }),
    ).toMatchObject({ startsAt: new Date('2026-10-01'), endsAt: null });
  });
});

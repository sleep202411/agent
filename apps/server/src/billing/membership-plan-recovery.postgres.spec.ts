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
const applicationName = `plan-recovery-${randomUUID()}`;
jest.setTimeout(30000);
integration('Membership plan update recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let planId: string;
  const adminId = randomUUID();
  const cache = { invalidatePlanCache: jest.fn() };
  const service = (client: unknown = db) =>
    new BillingService(
      client as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cache as never,
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
    cache.invalidatePlanCache.mockClear();
    planId = (
      await db.billingMembershipPlan.create({
        data: {
          planKey: `fixture_${randomUUID().replaceAll('-', '')}`,
          name: 'Fixture',
          productType: 'team_membership_plan',
          subjectType: 'workspace',
          rank: 1,
          includedSeats: 1,
          maxSeats: 10,
          benefits: {},
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.billingMembershipPlan.delete({ where: { id: planId } });
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

  it.each(['seats', 'subject'] as const)(
    'validates %s against the state committed during its lock wait',
    async (kind) => {
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const entered = new Promise<void>((r) => {
        ready = r;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM billing_membership_plans WHERE id=${planId}::uuid FOR UPDATE`;
        ready();
        await gate;
        await tx.billingMembershipPlan.update({
          where: { id: planId },
          data:
            kind === 'seats'
              ? { includedSeats: 10 }
              : { productType: 'membership_plan', subjectType: 'user' },
        });
      });
      await entered;
      const pending = service().updateAdminMembershipPlan(
        planId,
        adminId,
        kind === 'seats' ? { maxSeats: 5 } : { subjectType: 'workspace' },
      );
      void pending.catch(() => undefined);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await holder;
      const before = await db.billingMembershipPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      await expect(pending).rejects.toMatchObject({
        response: {
          code:
            kind === 'seats'
              ? 'BILLING_MEMBERSHIP_PLAN_SEATS_INVALID'
              : 'BILLING_MEMBERSHIP_PLAN_SUBJECT_INVALID',
        },
      });
      expect(
        await db.billingMembershipPlan.findUniqueOrThrow({
          where: { id: planId },
        }),
      ).toEqual(before);
      expect(cache.invalidatePlanCache).not.toHaveBeenCalled();
    },
  );
  it('commits coordinated limits and clears the cache after success', async () => {
    await service().updateAdminMembershipPlan(planId, adminId, {
      includedSeats: 20,
      maxSeats: 30,
    });
    expect(
      await db.billingMembershipPlan.findUniqueOrThrow({
        where: { id: planId },
      }),
    ).toMatchObject({ includedSeats: 20, maxSeats: 30 });
    expect(cache.invalidatePlanCache).toHaveBeenCalledTimes(1);
    await service().updateAdminMembershipPlan(planId, adminId, {
      maxSeats: null,
    });
    expect(
      await db.billingMembershipPlan.findUniqueOrThrow({
        where: { id: planId },
      }),
    ).toMatchObject({ maxSeats: null });
  });
});

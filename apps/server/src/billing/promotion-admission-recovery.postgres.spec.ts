import { extendPrismaQueries } from '../common/__tests__/prisma-query-extension';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { VoucherService } from './voucher.service';
import { CampaignService } from './campaign.service';
import { GenerateVouchersSchema } from './dto';
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `promotion-admission-${randomUUID()}`;
jest.setTimeout(30000);
integration('Promotional administration recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let adminId: string;
  let campaignId: string;
  const vouchers = (client: unknown = db) =>
    new VoucherService(client as PrismaService, {} as never);
  const campaigns = () => new CampaignService(db as PrismaService, {} as never);
  const input = () =>
    GenerateVouchersSchema.parse({ count: 3, computeCreditAmount: 17 });
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
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
  });
  beforeEach(async () => {
    adminId = randomUUID();
    campaignId = (
      await db.creditCampaign.create({
        data: {
          name: 'Fixture',
          computeCreditAmount: 17,
          createdById: adminId,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.voucher.deleteMany({ where: { createdById: adminId } });
    await db.creditCampaign.deleteMany({ where: { id: campaignId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('does not leave usable voucher codes after the response read fails', async () => {
    const failing = extendPrismaQueries(db, {
      query: {
        voucher: {
          findMany() {
            return Promise.reject(new Error('fixture read failed'));
          },
        },
      },
    });
    await expect(
      vouchers(failing).generateVouchers(adminId, input()),
    ).rejects.toThrow('fixture read failed');
    expect(await db.voucher.count({ where: { createdById: adminId } })).toBe(0);
    const retried = await vouchers().generateVouchers(adminId, input());
    expect(retried.count).toBe(3);
    expect(await db.voucher.count({ where: { createdById: adminId } })).toBe(3);
  });
  it('preserves separate deliberate voucher batches and their configured amounts', async () => {
    const [first, second] = await Promise.all([
      vouchers().generateVouchers(adminId, input()),
      vouchers().generateVouchers(adminId, input()),
    ]);
    expect(first.batchId).not.toBe(second.batchId);
    const rows = await db.voucher.findMany({ where: { createdById: adminId } });
    expect(rows).toHaveLength(6);
    expect(
      rows.every(
        (row) => row.computeCreditAmount === 17 && row.status === 'active',
      ),
    ).toBe(true);
  });
  it('returns not-found when the campaign is deleted while admission waits', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_campaigns WHERE id=${campaignId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.creditCampaign.delete({ where: { id: campaignId } });
    });
    await acquired;
    const pending = campaigns().updateCampaignStatus(campaignId, 'paused');
    void pending.catch(() => undefined);
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        const [row] = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
        if (Number(row.count)) break;
        if (Date.now() > deadline) throw new Error('Expected campaign wait');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await holder;
    await expect(pending).rejects.toMatchObject({ status: 404 });
  });
});

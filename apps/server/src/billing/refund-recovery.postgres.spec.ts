import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService } from '../workspaces';
import { BillingService } from './billing.service';
import type {
  CreateProviderRefundInput,
  CreateProviderRefundResult,
} from './providers/payment-provider';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `refund-admin-${randomUUID()}`;
jest.setTimeout(30000);
integration('Refund administrator admission (owned PostgreSQL)', () => {
  let db: PrismaClient;
  const adminId = randomUUID();
  let orderId: string;
  let itemId: string;
  const createRefund = jest
    .fn<Promise<CreateProviderRefundResult>, [CreateProviderRefundInput]>()
    .mockResolvedValue({
      providerRefundId: 'fixture-refund',
      providerStatus: 'PENDING',
      raw: {},
    });
  const service = (client: unknown = db) =>
    new BillingService(
      client as PrismaService,
      { get: () => ({ createRefund }) } as never,
      {} as never,
      new WalletLedgerService(client as PrismaService),
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
    createRefund.mockReset().mockResolvedValue({
      providerRefundId: 'fixture-refund',
      providerStatus: 'PENDING',
      raw: {},
    });
    itemId = (
      await db.billingCatalogItem.create({
        data: {
          code: randomUUID(),
          name: 'Fixture',
          productType: 'compute_point_pack',
        },
      })
    ).id;
    const price = await db.billingPrice.create({
      data: {
        itemId,
        currency: 'USD',
        amountMinor: 1000n,
        subjectType: 'user',
      },
    });
    orderId = (
      await db.billingOrder.create({
        data: {
          orderNo: randomUUID(),
          idempotencyKey: randomUUID(),
          userId: adminId,
          subjectType: 'user',
          subjectId: adminId,
          orderType: 'compute_point_topup',
          itemId,
          priceId: price.id,
          provider: 'airwallex',
          currency: 'USD',
          amountMinor: 1000n,
          subtotalAmountMinor: 1000n,
          status: 'paid',
          paidAt: new Date(),
        },
      })
    ).id;
    await db.billingPaymentIntent.create({
      data: {
        orderId,
        provider: 'airwallex',
        kind: 'payment_intent',
        status: 'succeeded',
        requestId: randomUUID(),
        currency: 'USD',
        amountMinor: 1000n,
        providerPaymentIntentId: randomUUID(),
      },
    });
  });
  afterEach(async () => {
    await db.billingRefund.deleteMany({ where: { orderId } });
    await db.billingOrder.delete({ where: { id: orderId } });
    await db.billingPrice.deleteMany({ where: { itemId } });
    await db.billingCatalogItem.delete({ where: { id: itemId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const input = () => ({
    orderId,
    amountMinor: 100n,
    reasonCode: 'customer_request',
    idempotencyKey: randomUUID(),
  });
  const snapshot = async () => ({
    refunds: await db.billingRefund.findMany({ where: { orderId } }),
    events: await db.billingRefundEvent.findMany({
      where: { refund: { orderId } },
      orderBy: { id: 'asc' },
    }),
  });
  it('admits one concurrent intent and replays it without another provider request ', async () => {
    const request = input();
    await Promise.all([
      service().createAdminRefund(adminId, request),
      service().createAdminRefund(adminId, request),
    ]);
    const before = await snapshot();
    expect(before.refunds).toHaveLength(1);
    expect(before.refunds[0].status).toBe('provider_pending');
    expect(before.events).toHaveLength(2);
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund.mock.calls[0][0].requestId).toBe(
      before.refunds[0].requestId,
    );
    await service().createAdminRefund(adminId, request);
    expect(await snapshot()).toEqual(before);
    expect(createRefund).toHaveBeenCalledTimes(1);
  });
  it.each(['amount', 'percent', 'order', 'reason', 'note'])(
    'rejects changed %s on a retained intent',
    async (field) => {
      const request = input();
      await service().createAdminRefund(adminId, request);
      const before = await snapshot();
      const patch =
        field === 'amount'
          ? { amountMinor: 101n }
          : field === 'percent'
            ? { percentBps: 1000 }
            : field === 'order'
              ? { orderId: randomUUID() }
              : field === 'reason'
                ? { reasonCode: 'different' }
                : { operatorNote: 'different' };
      await expect(
        service().createAdminRefund(adminId, { ...request, ...patch }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await snapshot()).toEqual(before);
      expect(createRefund).toHaveBeenCalledTimes(1);
    },
  );
  it('retains compatible legacy intent replays and rejects changed known fields', async () => {
    const request = input();
    await service().createAdminRefund(adminId, request);
    await db.billingRefund.updateMany({
      where: { orderId },
      data: { metadata: {} },
    });
    const before = await snapshot();
    await service().createAdminRefund(adminId, request);
    await expect(
      service().createAdminRefund(adminId, { ...request, amountMinor: 102n }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(before);
  });
  it.each(['succeeded', 'failed', 'canceled'] as const)(
    'preserves %s recorded before a delayed provider acknowledgement',
    async (status) => {
      createRefund.mockImplementationOnce(async () => {
        await db.billingRefund.updateMany({
          where: { orderId },
          data: {
            status,
            providerRefundId: 'already-recorded',
            ...(status === 'succeeded'
              ? { succeededAt: new Date() }
              : status === 'failed'
                ? { failedAt: new Date() }
                : { canceledAt: new Date() }),
          },
        });
        return {
          providerRefundId: 'late-ack',
          providerStatus: 'PENDING',
          raw: {},
        };
      });
      await service().createAdminRefund(adminId, input());
      const after = await snapshot();
      expect(after.refunds[0].status).toBe(status);
      expect(after.refunds[0].providerRefundId).toBe('already-recorded');
      expect(after.events).toHaveLength(1);
    },
  );
  it('records a failed provider attempt without creating a second refund on replay', async () => {
    createRefund.mockRejectedValueOnce(new Error('provider unavailable'));
    const request = input();
    await expect(service().createAdminRefund(adminId, request)).rejects.toThrow(
      'provider unavailable',
    );
    expect((await snapshot()).refunds[0].status).toBe('failed');
    await service().createAdminRefund(adminId, request);
    expect(createRefund).toHaveBeenCalledTimes(1);
  });
});

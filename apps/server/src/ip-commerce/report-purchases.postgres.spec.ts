import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { IpCommerceService } from './ip-commerce.service';
import { CreateIpContentReportSchema } from './dto';
const url = process.env.REPORT_PURCHASE_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Purchase-linked complaints (isolated PostgreSQL)',
  () => {
    let db: PrismaClient, service: IpCommerceService, ipId: string;
    const buyer = randomUUID(),
      creator = randomUUID(),
      outsider = randomUUID();
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Isolated local audit database required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      service = new IpCommerceService(
        db as PrismaService,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      ipId = (
        await db.ip.create({
          data: { createdById: creator, listingVisibility: 'private' },
        })
      ).id;
    });
    afterAll(async () => {
      if (!db) return;
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'SET LOCAL session_replication_role = replica',
        );
        await tx.ipContentReport.deleteMany({ where: { ipId } });
        await tx.ipPurchaseOrder.deleteMany({ where: { ipId } });
        await tx.ip.delete({ where: { id: ipId } });
      });
      await db.$disconnect();
    });
    const user = (userId: string) => ({ userId }) as AuthUser;
    async function order(userId = buyer) {
      return db.ipPurchaseOrder.create({
        data: {
          orderNo: `TEST-${randomUUID()}`,
          userId,
          ipId,
          targetType: 'ip',
          priceAmount: 100n,
          discountAmount: 0n,
          totalAmount: 100n,
          priceSnapshot: {},
          idempotencyKey: randomUUID(),
        },
      });
    }
    it('lists only owned purchases and rejects another buyer cursor', async () => {
      const mine = await order();
      const other = await order(outsider);
      const own = await service.listMyReportPurchases(user(buyer), {
        query: mine.orderNo,
        limit: 20,
      });
      expect(own.items).toEqual([
        expect.objectContaining({
          id: mine.id,
          totalAmount: '100',
          currency: 'community_point',
        }),
      ]);
      expect(own.items[0]).not.toHaveProperty('userId');
      expect(
        (
          await service.listMyReportPurchases(user(outsider), {
            query: mine.id,
            limit: 20,
          })
        ).items,
      ).toEqual([]);
      await expect(
        service.listMyReportPurchases(user(buyer), {
          cursor: other.id,
          limit: 20,
        }),
      ).rejects.toThrow('Restart');
    });
    it('binds a private historical purchase to its buyer report without changing order state', async () => {
      const purchase = await order();
      const input = {
        requestId: randomUUID(),
        targetType: 'ip' as const,
        targetId: ipId,
        purchaseOrderId: purchase.id,
        reason: 'payment' as const,
        description: 'Paid access did not unlock',
      };
      await expect(
        service.reportContent(user(outsider), input),
      ).rejects.toThrow('Purchase not found');
      await expect(
        service.reportContent(user(buyer), {
          ...input,
          targetId: randomUUID(),
        }),
      ).rejects.toThrow('Purchase not found');
      const [result, retry] = await Promise.all([
        service.reportContent(user(buyer), input),
        service.reportContent(user(buyer), input),
      ]);
      expect(retry.report.id).toBe(result.report.id);
      expect(
        await db.ipContentReport.count({
          where: { purchaseOrderId: purchase.id },
        }),
      ).toBe(1);
      await expect(
        service.reportContent(user(buyer), {
          ...input,
          description: 'Changed details',
        }),
      ).rejects.toThrow('different details');
      const saved = await db.ipContentReport.findUniqueOrThrow({
        where: { id: result.report.id },
      });
      expect(saved).toMatchObject({
        purchaseOrderId: purchase.id,
        reporterUserId: buyer,
        reason: 'payment',
      });
      expect(
        await db.ipPurchaseOrder.findUnique({ where: { id: purchase.id } }),
      ).toEqual(purchase);
      const mine = await service.listMyContentReports(user(buyer), {
        view: 'initiated',
        limit: 20,
      });
      expect(mine.items).toContainEqual(
        expect.objectContaining({ id: saved.id, purchaseOrderId: purchase.id }),
      );
      await db.ipContentReport.update({
        where: { id: saved.id },
        data: { status: 'dismissed', resolutionNote: 'Fixture reviewed' },
      });
      const responses = await service.listMyContentReports(user(creator), {
        view: 'responses',
        limit: 20,
      });
      expect(responses.items[0]).not.toHaveProperty('purchaseOrderId');
      expect(responses.items[0]).not.toHaveProperty('description');
      expect(responses.items[0]).not.toHaveProperty('reporterUserId');
      await expect(
        db.ipContentReport.update({
          where: { id: saved.id },
          data: { purchaseOrderId: null },
        }),
      ).rejects.toThrow('immutable');
      await expect(
        db.ipContentReport.update({
          where: { id: saved.id },
          data: { reporterUserId: outsider },
        }),
      ).rejects.toThrow('own matching purchase');
      await expect(
        db.ipPurchaseOrder.delete({ where: { id: purchase.id } }),
      ).rejects.toThrow();
    });
    it('requires a verified purchase for payment classification', () => {
      expect(
        CreateIpContentReportSchema.safeParse({
          targetType: 'ip',
          targetId: ipId,
          reason: 'payment',
        }).success,
      ).toBe(false);
    });
  },
);

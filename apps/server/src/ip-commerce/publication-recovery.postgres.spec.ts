import { extendPrismaQueries } from '../common/__tests__/prisma-query-extension';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { IpCommerceService } from './ip-commerce.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `publication-admin-${randomUUID()}`;
jest.setTimeout(30000);
integration(
  'Publication and report administrator writes (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let actor: AuthUser;
    let ipId: string;
    let reportId: string;
    const service = (client: unknown = db) =>
      new IpCommerceService(
        client as PrismaService,
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
      actor = { userId: randomUUID() } as AuthUser;
      ipId = (
        await db.ip.create({
          data: {
            createdById: actor.userId,
            status: 'published',
            listingVisibility: 'public',
          },
        })
      ).id;
      reportId = (
        await db.ipContentReport.create({
          data: { ipId, targetId: ipId, targetType: 'ip', reason: 'other' },
        })
      ).id;
    });
    afterEach(async () => {
      await db.ipModerationAction.deleteMany({
        where: { actorUserId: actor.userId },
      });
      await db.ipContentReport.delete({ where: { id: reportId } });
      await db.ip.delete({ where: { id: ipId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });

    const write = (kind: string, client: unknown = db) =>
      kind === 'publication'
        ? service(client).updateAdminIpPublication(actor, ipId, {
            status: 'hidden',
            reason: 'fixture',
          })
        : service(client).resolveAdminReport(actor, reportId, {
            status: 'actioned',
            actionType: 'hide',
            reason: 'fixture',
          });
    const snapshot = async () => ({
      ip: await db.ip.findUnique({ where: { id: ipId } }),
      report: await db.ipContentReport.findUnique({ where: { id: reportId } }),
      actions: await db.ipModerationAction.findMany({
        where: { actorUserId: actor.userId },
      }),
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
      throw new Error('Expected operator lock wait');
    };
    it.each(['publication', 'report'])(
      'commits %s with its moderation evidence',
      async (kind) => {
        await write(kind);
        const after = await snapshot();
        expect(after.ip?.status).toBe('hidden');
        expect(after.actions).toHaveLength(1);
        if (kind === 'report') expect(after.report?.status).toBe('actioned');
      },
    );
    it('rolls back moderation when the report update fails', async () => {
      const before = await snapshot();
      const failing = extendPrismaQueries(db, {
        query: {
          ipContentReport: {
            update() {
              return Promise.reject(new Error('report failure'));
            },
          },
        },
      });
      await expect(write('report', failing)).rejects.toThrow('report failure');
      expect(await snapshot()).toEqual(before);
    });
    it('rejects a stale publication version without moderation changes', async () => {
      const before = await snapshot();
      await expect(
        service().updateAdminIpPublication(actor, ipId, {
          status: 'hidden',
          reason: 'fixture',
          expectedVersion: 999,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await snapshot()).toEqual(before);
    });
    it.each(['publication', 'report'])(
      'captures current %s moderation evidence after the IP lock wait',
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
          await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
          ready();
          await gate;
          await tx.ip.update({
            where: { id: ipId },
            data: { status: 'suspended', version: { increment: 1 } },
          });
        });
        await entered;
        const pending = write(kind);
        void pending.catch(() => undefined);
        try {
          await waitForLock();
        } finally {
          release();
        }
        await holder;
        await pending;
        const after = await snapshot();
        expect(after.actions[0].before).toMatchObject({
          status: 'suspended',
          version: 1,
        });
        expect(after.ip?.version).toBe(2);
      },
    );
    it('evaluates scheduled publication time after the IP lock wait', async () => {
      const before = await snapshot();
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const entered = new Promise<void>((r) => {
        ready = r;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
        ready();
        await gate;
      });
      await entered;
      const pending = service().updateAdminIpPublication(actor, ipId, {
        status: 'scheduled',
        reason: 'fixture',
        scheduledAt: new Date(Date.now() + 1000),
      });
      void pending.catch(() => undefined);
      try {
        await waitForLock();
        await db.$queryRaw`SELECT pg_sleep(1.1)::text`;
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({
        response: { code: 'IP_SCHEDULE_IN_PAST' },
      });
      expect(await snapshot()).toEqual(before);
    });
  },
);

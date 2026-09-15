import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { MembershipGrantAdminService } from './membership-grant-admin.service';
import { EntitlementService } from '../entitlements';
import { IpCommerceService } from '../ip-commerce/ip-commerce.service';
import { entitlementWorkspaceChannel } from '../infra/realtime/realtime-groups';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `grant-eligibility-${randomUUID()}`;
jest.setTimeout(30000);

integration('Grant eligibility transaction recovery', () => {
  let db: PrismaClient;
  let workspaceId: string;
  let ipId: string;
  let planKey: string;
  const adminId = randomUUID();
  const memberships = () =>
    new MembershipGrantAdminService(
      db as PrismaService,
      new EntitlementService(db as PrismaService),
    );
  const ips = () =>
    new IpCommerceService(
      db as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  const membership = () =>
    memberships().grant(adminId, {
      subjectType: 'workspace',
      subjectId: workspaceId,
      planKey,
      durationDays: 7,
      note: 'fixture',
    });
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01' ||
      url.search
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
    workspaceId = (
      await db.workspace.create({
        data: { name: 'Fixture', ownerUserId: adminId, createdById: adminId },
      })
    ).id;
    ipId = (await db.ip.create({ data: { createdById: adminId } })).id;
    planKey = `fixture_${randomUUID().replaceAll('-', '')}`;
    await db.billingMembershipPlan.create({
      data: {
        planKey,
        name: 'Fixture',
        productType: 'team_membership_plan',
        subjectType: 'workspace',
        status: 'active',
        rank: 1,
        benefits: {},
      },
    });
  });
  afterEach(async () => {
    await db.aiEventOutbox.deleteMany({
      where: { channel: entitlementWorkspaceChannel(workspaceId) },
    });
    await db.realtimeSequenceCursor.deleteMany({
      where: { channel: entitlementWorkspaceChannel(workspaceId) },
    });
    await db.entitlementGrant.deleteMany({ where: { subjectId: workspaceId } });
    await db.billingMembershipPlan.delete({ where: { planKey } });
    await db.ip.delete({ where: { id: ipId } });
    await db.workspace.delete({ where: { id: workspaceId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it('preserves deliberate repeated membership grants as distinct stacked sources', async () => {
    const first = await membership();
    const second = await membership();
    expect(second.id).not.toBe(first.id);
    expect(second.startsAt).toEqual(first.endsAt);
    expect(
      await db.entitlementGrant.count({ where: { subjectId: workspaceId } }),
    ).toBe(2);
  });

  it.each(['ip-delete', 'workspace-delete', 'workspace-suspend'] as const)(
    'rejects a grant after %s during the target wait',
    async (kind) => {
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const holder = db.$transaction(async (tx) => {
        if (kind === 'ip-delete')
          await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
        else
          await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${workspaceId}::uuid FOR UPDATE`;
        ready();
        await gate;
        if (kind === 'ip-delete')
          await tx.ip.update({
            where: { id: ipId },
            data: { deletedAt: new Date() },
          });
        else
          await tx.workspace.update({
            where: { id: workspaceId },
            data:
              kind === 'workspace-delete'
                ? { deletedAt: new Date() }
                : { status: 'suspended', suspendedAt: new Date() },
          });
      });
      await entered;
      const pending =
        kind === 'ip-delete'
          ? ips().grantAdminEntitlement(
              { userId: adminId },
              {
                userId: 'fixture-viewer',
                ipId,
                targetType: 'ip',
                reason: 'fixture',
              },
            )
          : membership();
      void pending.catch(() => undefined);
      try {
        const deadline = Date.now() + 5000;
        while (true) {
          const [row] = await db.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
          if (Number(row.count)) break;
          if (Date.now() > deadline)
            throw new Error('Expected grant target wait');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({
        status: kind === 'workspace-suspend' ? 409 : 404,
      });
      expect(
        await db.entitlementGrant.count({ where: { subjectId: workspaceId } }),
      ).toBe(0);
      expect(await db.ipContentEntitlement.count({ where: { ipId } })).toBe(0);
      expect(await db.ipCollectionItem.count({ where: { ipId } })).toBe(0);
    },
  );
  it.each(['expired', 'metadata', 'deleted'] as const)(
    're-reads a grant changed to %s during revocation admission',
    async (kind) => {
      const grant = await membership();
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM entitlement_grants WHERE id=${grant.id}::uuid FOR UPDATE`;
        ready();
        await gate;
        if (kind === 'deleted') {
          await tx.entitlementGrant.delete({ where: { id: grant.id } });
        } else {
          await tx.entitlementGrant.update({
            where: { id: grant.id },
            data:
              kind === 'expired'
                ? {
                    startsAt: new Date(Date.now() - 10000),
                    endsAt: new Date(Date.now() - 1000),
                  }
                : { metadata: { note: 'updated while waiting' } },
          });
        }
      });
      await entered;
      const pending = memberships().revoke(grant.id);
      void pending.catch(() => undefined);
      try {
        const deadline = Date.now() + 5000;
        while (true) {
          const [row] = await db.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
          if (Number(row.count)) break;
          if (Date.now() > deadline)
            throw new Error('Expected revocation admission wait');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
      }
      await holder;
      if (kind === 'metadata') {
        await expect(pending).resolves.toMatchObject({
          note: 'updated while waiting',
          effectiveStatus: 'revoked',
        });
      } else {
        await expect(pending).rejects.toMatchObject({
          status: kind === 'expired' ? 400 : 404,
        });
        const stored = await db.entitlementGrant.findUnique({
          where: { id: grant.id },
        });
        if (kind === 'expired') expect(stored?.revokedAt).toBeNull();
        else expect(stored).toBeNull();
      }
    },
  );
});

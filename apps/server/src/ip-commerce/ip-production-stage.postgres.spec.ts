import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { IpStageApplicationsService } from './ip-stage-applications';
import { IpCommerceService } from './ip-commerce.service';
import type { PrismaService } from '../infra/db/db.module';
import type { AdminActor } from '../admin-auth';
import {
  changeProductionStage,
  readProductionStage,
  ProductionStageChange,
} from './ip-production-stage';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.IP_FEEDBACK_POSTGRES_TEST === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
integration('administrator production stages (local PostgreSQL)', () => {
  let db: PrismaClient;
  let ipId: string;
  let actor: AdminActor;
  let roleId: string;
  let applications: IpStageApplicationsService;
  const change = {
    stage: 'story_testing' as const,
    expectedVersion: 0,
    reason: 'Reviewed initial production proposal.',
  };
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01')
      )
    )
      throw new Error('Explicitly allowed loopback test database required');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
    applications = new IpStageApplicationsService(
      db as PrismaService,
      new IpCommerceService(
        db as PrismaService,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    );
  });
  beforeEach(async () => {
    ipId = randomUUID();
    actor = {
      id: randomUUID(),
      sessionId: randomUUID(),
      siteScope: 'all',
    } as AdminActor;
    const permission = await db.adminPermission.upsert({
      where: { key: 'ip.publish' },
      create: { key: 'ip.publish', description: 'Publish' },
      update: {},
    });
    const role = await db.adminRole.create({
      data: {
        key: randomUUID(),
        name: 'Stage test',
        permissions: { create: { permissionId: permission.id } },
      },
    });
    roleId = role.id;
    const user = await db.adminUser.create({
      data: {
        email: `${randomUUID()}@example.test`,
        displayName: 'Stage test',
        id: actor.id,
        passwordHash: 'local-test-hash',
        status: 'active',
        roles: { create: { roleId } },
      },
    });
    const session = await db.adminSession.create({
      data: {
        id: actor.sessionId,
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date('2100-01-01T00:00:00Z'),
      },
    });
    actor = {
      id: user.id,
      sessionId: session.id,
      siteScope: 'all',
    } as AdminActor;
    ipId = (
      await db.ip.create({ data: { createdById: 'production-stage-test' } })
    ).id;
  });
  afterEach(async () => {
    await db.adminAuditLog.deleteMany({ where: { resourceId: ipId } });
    await db.ip.deleteMany({ where: { id: ipId } });
    await db.adminUser.deleteMany({ where: { id: actor.id } });
    await db.adminRole.delete({ where: { id: roleId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it('replays a creator application once and approves its stage atomically', async () => {
    const owner = { userId: 'production-stage-test' };
    const input = { id: randomUUID(), ...change };
    const item = await applications.submit(ipId, owner, input);
    expect((await applications.submit(ipId, owner, input)).id).toBe(item.id);
    await expect(
      applications.submit(ipId, owner, { ...input, id: randomUUID() }),
    ).rejects.toThrow('awaiting review');
    await applications.review(ipId, item.id, actor, {
      decision: 'approved',
      reason: 'Approved proposal.',
    });
    expect(await readProductionStage(db, ipId)).toEqual({
      stage: 'story_testing',
      version: 1,
    });
    expect((await applications.list(ipId, owner)).items[0].status).toBe(
      'approved',
    );
    await expect(
      applications.review(ipId, item.id, actor, {
        decision: 'rejected',
        reason: 'Late review',
      }),
    ).rejects.toThrow('already reviewed');
  });
  it('rejects unauthorized applications and stale approvals; permits explicit rejection and resubmission', async () => {
    const input = { id: randomUUID(), ...change };
    const owner = { userId: 'production-stage-test' };
    await expect(
      applications.submit(ipId, { userId: 'stranger' }, input),
    ).rejects.toThrow();
    await applications.submit(ipId, owner, input);
    await changeProductionStage(db as PrismaService, actor, ipId, {
      ...change,
      stage: 'production',
    });
    await expect(
      applications.review(ipId, input.id, actor, {
        decision: 'approved',
        reason: 'Stale approval',
      }),
    ).rejects.toThrow('Refresh');
    expect((await applications.list(ipId, owner)).items[0].status).toBe(
      'pending',
    );
    await applications.review(ipId, input.id, actor, {
      decision: 'rejected',
      reason: 'Stage changed; please revise.',
    });
    const next = await applications.submit(ipId, owner, {
      ...input,
      id: randomUUID(),
      stage: 'released',
      expectedVersion: 1,
    });
    expect(next.status).toBe('pending');
    expect((await applications.list(ipId, owner)).items).toHaveLength(2);
  });
  it('records evidence and corrections atomically without changing publication', async () => {
    expect(await readProductionStage(db, ipId)).toEqual({
      stage: 'testing',
      version: 0,
    });
    await changeProductionStage(db as PrismaService, actor, ipId, change);
    await changeProductionStage(db as PrismaService, actor, ipId, {
      stage: 'testing',
      expectedVersion: 1,
      reason: 'Correction after review.',
    });
    const audit = await db.adminAuditLog.findMany({
      where: { resourceId: ipId },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0].metadata).toMatchObject({
      evidence: { ipId, humanIpLikes: '0', episodes: [] },
    });
    expect(audit[1].before).toEqual({ stage: 'story_testing', version: 1 });
    expect(
      (await db.ip.findUniqueOrThrow({ where: { id: ipId } })).status,
    ).toBe('draft');
  });
  it('accepts exactly one concurrent decision and rejects response-loss replay', async () => {
    const results = await Promise.allSettled([
      changeProductionStage(db as PrismaService, actor, ipId, change),
      changeProductionStage(db as PrismaService, actor, ipId, change),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(
      changeProductionStage(db as PrismaService, actor, ipId, change),
    ).rejects.toThrow('Refresh');
    expect(await db.adminAuditLog.count({ where: { resourceId: ipId } })).toBe(
      1,
    );
  });
  it('rejects permission revoked during the IP lock wait without stage or audit writes', async () => {
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((r) => {
      locked = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
        locked();
        await hold;
      },
      { timeout: 10000 },
    );
    await ready;
    const pending = changeProductionStage(
      db as PrismaService,
      actor,
      ipId,
      change,
    ).catch((e: unknown) => e);
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await db.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%production-stage%'`;
        if (Number(rows[0].n) > 0) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
      await db.adminUserRole.deleteMany({ where: { userId: actor.id } });
    } finally {
      release();
      await blocker;
    }
    expect(await pending).toBeInstanceOf(ForbiddenException);
    expect(await readProductionStage(db, ipId)).toEqual({
      stage: 'testing',
      version: 0,
    });
    expect(await db.adminAuditLog.count({ where: { resourceId: ipId } })).toBe(
      0,
    );
  });
  it('rejects expired sessions and invalid stage inputs', async () => {
    await db.adminSession.update({
      where: { id: actor.sessionId },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      changeProductionStage(db as PrismaService, actor, ipId, change),
    ).rejects.toThrow('permission');
    expect(
      ProductionStageChange.safeParse({ ...change, reason: ' ' }).success,
    ).toBe(false);
    expect(
      ProductionStageChange.safeParse({ ...change, stage: 'published' })
        .success,
    ).toBe(false);
  });
});

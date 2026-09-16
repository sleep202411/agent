import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
integration('IP entitlement concurrency (owned PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: IpCommerceService;
  let ipId: string;
  let admin: AuthUser;
  const viewer = 'entitlement-test-viewer';
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01')
      )
    )
      throw new Error('Owned loopback fixture required');
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
      }),
      transactionOptions: { timeout: 15000 },
    });
    await prisma.$connect();
    service = new IpCommerceService(
      prisma as PrismaService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
  });
  beforeEach(async () => {
    admin = { userId: randomUUID(), userName: 'Fixture' };
    const ip = await prisma.ip.create({
      data: {
        createdById: admin.userId,
        status: 'published',
        listingVisibility: 'public',
      },
    });
    ipId = ip.id;
  });
  afterEach(async () => {
    await prisma.ip.delete({ where: { id: ipId } });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  const grant = () =>
    service.grantAdminEntitlement(admin, {
      userId: viewer,
      ipId,
      targetType: 'ip',
      reason: 'fixture grant',
    });

  it('reuses concurrent grants without duplicate entitlement or collection records', async () => {
    const results = await Promise.all([grant(), grant(), grant()]);
    expect(results.filter((result) => !result.alreadyGranted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.entitlement.id)).size).toBe(
      1,
    );
    expect(await prisma.ipContentEntitlement.count({ where: { ipId } })).toBe(
      1,
    );
    expect(await prisma.ipCollectionItem.count({ where: { ipId } })).toBe(1);
  });

  it('preserves the first revocation decision and removes its collection once', async () => {
    const original = await grant();
    const results = await Promise.all(
      ['first', 'second', 'third'].map((reason) =>
        service.revokeAdminEntitlement(admin, original.entitlement.id, {
          reason,
        }),
      ),
    );
    expect(results.filter((result) => !result.alreadyRevoked)).toHaveLength(1);
    const recorded = await prisma.ipContentEntitlement.findUniqueOrThrow({
      where: { id: original.entitlement.id },
    });
    expect(recorded.metadata).toMatchObject({ reason: 'fixture grant' });
    const repeated = await service.revokeAdminEntitlement(admin, recorded.id, {
      reason: 'replacement must not win',
    });
    expect(repeated.alreadyRevoked).toBe(true);
    expect(
      await prisma.ipContentEntitlement.findUnique({
        where: { id: recorded.id },
      }),
    ).toEqual(recorded);
    expect(
      await prisma.ipCollectionItem.count({ where: { ipId, removedAt: null } }),
    ).toBe(0);
  });

  it('rechecks status after a row-lock wait and preserves a competing revocation', async () => {
    const original = await grant();
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ip_content_entitlements WHERE id = ${original.entitlement.id}::uuid FOR UPDATE`;
      locked();
      await gate;
      await tx.ipContentEntitlement.update({
        where: { id: original.entitlement.id },
        data: { status: 'revoked', metadata: { authoritative: true } },
      });
    });
    await ready;
    const pending = service.revokeAdminEntitlement(
      admin,
      original.entitlement.id,
      { reason: 'stale' },
    );
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        const rows = await prisma.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ip_content_entitlements%'`;
        if (rows[0].count > 0n) break;
        if (Date.now() > deadline)
          throw new Error('Revocation did not reach its lock wait');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    await holder;
    expect((await pending).alreadyRevoked).toBe(true);
    expect(
      (
        await prisma.ipContentEntitlement.findUniqueOrThrow({
          where: { id: original.entitlement.id },
        })
      ).metadata,
    ).toEqual({ authoritative: true });
  });
  it('evaluates expiry after waiting for a competing entitlement decision', async () => {
    const original = await grant();
    await prisma.ipContentEntitlement.update({
      where: { id: original.entitlement.id },
      data: { startsAt: new Date(Date.now() - 60000) },
    });
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ip:entitlement:${viewer}:${ipId}`})::bigint)`;
      locked();
      await gate;
      await tx.ipContentEntitlement.update({
        where: { id: original.entitlement.id },
        data: { endsAt: new Date(Date.now() - 1) },
      });
    });
    await ready;
    const pending = grant();
    void pending.catch(() => undefined);
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        const rows = await prisma.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'`;
        if (rows[0].count > 0n) break;
        if (Date.now() > deadline)
          throw new Error('Grant did not reach its lock wait');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    await holder;
    const next = await pending;
    expect(next.alreadyGranted).toBe(false);
    expect(next.entitlement.id).not.toBe(original.entitlement.id);
    const collection = await prisma.ipCollectionItem.findFirstOrThrow({
      where: { ipId, removedAt: null },
    });
    expect(collection.entitlementId).toBe(next.entitlement.id);
  });
  it('revokes scheduled grants without creating an invalid time window', async () => {
    const startsAt = new Date(Date.now() + 60000);
    const endsAt = new Date(Date.now() + 120000);
    const original = await service.grantAdminEntitlement(admin, {
      userId: viewer,
      ipId,
      targetType: 'ip',
      reason: 'scheduled',
      startsAt,
      endsAt,
    });
    await service.revokeAdminEntitlement(admin, original.entitlement.id, {
      reason: 'cancel scheduled access',
    });
    const row = await prisma.ipContentEntitlement.findUniqueOrThrow({
      where: { id: original.entitlement.id },
    });
    expect(row.status).toBe('revoked');
    expect(row.startsAt).toEqual(startsAt);
    expect(row.endsAt).toEqual(endsAt);
    expect(
      await prisma.ipCollectionItem.count({ where: { ipId, removedAt: null } }),
    ).toBe(0);
  });
});

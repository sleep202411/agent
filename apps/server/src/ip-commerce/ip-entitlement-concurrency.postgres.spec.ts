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
const applicationName = `episode-grant-${randomUUID()}`;
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
        application_name: applicationName,
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
    await prisma.ipCollectionItem.deleteMany({ where: { ipId } });
    await prisma.ipContentEntitlement.deleteMany({ where: { ipId } });
    await prisma.ipPurchaseOrder.deleteMany({ where: { ipId } });
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

  it('rejects a deleted episode selected in a stale Admin grant dialog', async () => {
    const episode = await prisma.ipEpisode.create({
      data: {
        ipId,
        episodeNo: 1,
        createdById: admin.userId,
        deletedAt: new Date(),
        status: 'archived',
        localizations: {
          create: { locale: 'en-US', title: 'Deleted episode' },
        },
      },
    });
    await expect(
      service.grantAdminEntitlement(admin, {
        userId: viewer,
        ipId,
        episodeId: episode.id,
        targetType: 'episode',
        reason: 'fixture grant',
      }),
    ).rejects.toMatchObject({ response: { code: 'IP_EPISODE_NOT_FOUND' } });
    expect(await prisma.ipContentEntitlement.count({ where: { ipId } })).toBe(
      0,
    );
    expect(await prisma.ipCollectionItem.count({ where: { ipId } })).toBe(0);
  });

  it('still grants access to an existing episode', async () => {
    const episode = await prisma.ipEpisode.create({
      data: {
        ipId,
        episodeNo: 1,
        createdById: admin.userId,
        localizations: {
          create: { locale: 'en-US', title: 'Existing episode' },
        },
      },
    });
    const result = await service.grantAdminEntitlement(admin, {
      userId: viewer,
      ipId,
      episodeId: episode.id,
      targetType: 'episode',
      reason: 'fixture grant',
    });
    expect(result.alreadyGranted).toBe(false);
    expect(
      await prisma.ipContentEntitlement.count({
        where: { ipId, episodeId: episode.id },
      }),
    ).toBe(1);
  });

  it('preserves an episode when an overlapping grant commits', async () => {
    const episode = await prisma.ipEpisode.create({
      data: {
        ipId,
        episodeNo: 1,
        createdById: admin.userId,
      },
    });
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    // Hold the same parent share lock taken by grantAdminEntitlement, while
    // its new entitlement is not yet visible to the deletion preflight.
    const grant = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR SHARE`;
      await tx.ipContentEntitlement.create({
        data: {
          ipId,
          episodeId: episode.id,
          userId: viewer,
          targetType: 'episode',
          sourceType: 'admin_grant',
          sourceId: randomUUID(),
        },
      });
      ready();
      await gate;
    });
    await started;
    const deletion = service
      .deleteCreatorIpEpisode(admin, ipId, episode.id)
      .then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE application_name=${applicationName} AND wait_event_type='Lock'
        `;
        if (Number(row.count)) break;
        if (Date.now() > deadline)
          throw new Error('Deletion did not wait for grant');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
      await grant;
    }
    const outcome = await deletion;
    expect(outcome.error).toMatchObject({
      response: { code: 'IP_EPISODE_HAS_ORDERS' },
    });
    expect(
      (await prisma.ipEpisode.findUniqueOrThrow({ where: { id: episode.id } }))
        .deletedAt,
    ).toBeNull();
  });

  it.each([false, true])(
    'purchase availability with overlapping deletion=%s',
    async (deleting) => {
      await prisma.ipLocalization.create({
        data: {
          ipId,
          locale: 'en-US',
          title: 'Fixture',
          summary: 'Fixture summary',
          status: 'published',
        },
      });
      const episode = await prisma.ipEpisode.create({
        data: {
          ipId,
          episodeNo: 1,
          createdById: admin.userId,
          status: 'published',
          localizations: {
            create: {
              locale: 'en-US',
              title: 'Fixture episode',
              status: 'published',
            },
          },
        },
      });
      await prisma.ipPriceRule.create({
        data: {
          ipId,
          episodeId: episode.id,
          targetType: 'episode',
          amount: 0n,
          currency: 'community_point',
          status: 'active',
          createdById: admin.userId,
        },
      });
      const buyerService = new IpCommerceService(
        prisma as PrismaService,
        undefined as never,
        undefined as never,
        undefined as never,
        {
          isActiveCommunityMember: () => Promise.resolve({ member: false }),
        } as never,
        undefined as never,
        undefined as never,
      );
      if (!deleting) {
        const input = {
          ipId,
          episodeId: episode.id,
          targetType: 'episode' as const,
          idempotencyKey: randomUUID(),
        };
        const purchased = await buyerService.purchaseContent(
          { userId: viewer },
          input,
        );
        expect(purchased.alreadyProcessed).toBe(false);
        const repeated = await buyerService.purchaseContent(
          { userId: viewer },
          input,
        );
        expect(repeated.alreadyProcessed).toBe(true);
        expect(await prisma.ipPurchaseOrder.count({ where: { ipId } })).toBe(1);
        expect(
          await prisma.ipContentEntitlement.count({ where: { ipId } }),
        ).toBe(1);
        return;
      }
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const deletion = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
        await tx.ipEpisode.update({
          where: { id: episode.id },
          data: { deletedAt: new Date(), status: 'archived' },
        });
        ready();
        await gate;
      });
      await started;
      const purchase = buyerService
        .purchaseContent(
          { userId: viewer },
          {
            ipId,
            episodeId: episode.id,
            targetType: 'episode',
            idempotencyKey: randomUUID(),
          },
        )
        .then(
          (value) => ({ value, error: undefined }),
          (error: unknown) => ({ value: undefined, error }),
        );
      try {
        const deadline = Date.now() + 5000;
        while (true) {
          const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE application_name=${applicationName} AND wait_event_type='Lock'
        `;
          if (Number(row.count)) break;
          if (Date.now() > deadline)
            throw new Error('Purchase did not wait for deletion');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
        await deletion;
      }
      const outcome = await purchase;
      expect(outcome.error).toMatchObject({
        response: { code: 'IP_EPISODE_NOT_PURCHASABLE' },
      });
      expect(await prisma.ipPurchaseOrder.count({ where: { ipId } })).toBe(0);
      expect(await prisma.ipContentEntitlement.count({ where: { ipId } })).toBe(
        0,
      );
    },
  );

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
      // The service evaluates expiry with PostgreSQL's clock after acquiring
      // the lock. Use that same clock: the fixture may run in a separate VM.
      await tx.$executeRaw`
        UPDATE ip_content_entitlements
        SET ends_at = clock_timestamp() - interval '1 millisecond'
        WHERE id = ${original.entitlement.id}::uuid
      `;
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

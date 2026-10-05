import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { RevenueDistributionService } from './revenue-distribution.service';
import { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification/notification.service';
import { ADMIN_PERMISSION_KEYS, type AdminActor } from '../admin-auth';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { RevenueContractsService } from './revenue-contracts.service';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import { WithdrawalAdminService } from './withdrawal-admin.service';
import { RevenueAdminReadService } from './revenue-admin-read.service';
import { LegacyCreatorsService } from '../legacy-creators/legacy-creators.service';
import { CrewEarningsService } from '../crews/earnings/earnings.service';
import { CrewAuthorizationService } from '../crews/crew-authorization.service';

const url = process.env.WITHDRAWAL_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Confirmed revenue (local PostgreSQL)', () => {
  let db: PrismaClient;
  let service: RevenueDistributionService;
  let notifications: NotificationService;
  let actor: AdminActor;
  const crews: string[] = [];
  const users: string[] = [];
  const previousKey = process.env.CREATOR_PAYOUT_DETAILS_KEY;
  beforeAll(async () => {
    const target = postgresFixtureUrl(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '55441' ||
      !['/withdrawal_test', '/audit_migrations_20261005'].includes(
        target.pathname,
      )
    )
      throw new Error('Dedicated local withdrawal fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
      transactionOptions: { maxWait: 5000, timeout: 15000 },
    });
    process.env.CREATOR_PAYOUT_DETAILS_KEY = 'ab'.repeat(32);
    notifications = new NotificationService(db as PrismaService);
    service = new RevenueDistributionService(
      db as PrismaService,
      notifications,
    );
    const admin = await db.adminUser.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        displayName: 'Revenue fixture',
        passwordHash: 'local-fixture-not-a-login-hash',
        status: 'active',
      },
    });
    const session = await db.adminSession.create({
      data: {
        userId: admin.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    actor = {
      id: admin.id,
      sessionId: session.id,
      email: admin.email,
      displayName: admin.displayName,
      status: 'active',
      siteScope: 'all',
      roleKeys: [],
      requireMfa: false,
      permissions: [ADMIN_PERMISSION_KEYS.CreatorRevenueManage],
    };
  });
  afterAll(async () => {
    if (previousKey === undefined)
      delete process.env.CREATOR_PAYOUT_DETAILS_KEY;
    else process.env.CREATOR_PAYOUT_DETAILS_KEY = previousKey;
    if (!db) return;
    await db.$transaction(async (tx) => {
      // Cleanup only: allowlisted disposable local DB; guards stay enabled in tests.
      await tx.$executeRawUnsafe(
        'SET LOCAL session_replication_role = replica',
      );
      await tx.creatorWithdrawalEvent.deleteMany({
        where: { withdrawal: { userId: { in: users } } },
      });
      await tx.crewPayoutEvent.deleteMany({ where: { crewId: { in: crews } } });
      await tx.crewPayoutAllocation.deleteMany({
        where: { crewId: { in: crews } },
      });
      await tx.crewPayout.deleteMany({ where: { crewId: { in: crews } } });
      await tx.creatorWithdrawal.deleteMany({
        where: { userId: { in: users } },
      });
      await tx.creatorPayoutAccount.deleteMany({
        where: { userId: { in: users } },
      });
      await tx.notificationOutbox.deleteMany({
        where: { userId: { in: users } },
      });
      await tx.notification.deleteMany({ where: { userId: { in: users } } });
      await tx.crewEarningEvent.deleteMany({
        where: { crewId: { in: crews } },
      });
      await tx.crewEarningEntry.deleteMany({
        where: { crewId: { in: crews } },
      });
      await tx.crewRevenueDistribution.deleteMany({
        where: { contract: { crewId: { in: crews } } },
      });
      await tx.crewRevenueContract.deleteMany({
        where: { crewId: { in: crews } },
      });
      await tx.crew.deleteMany({ where: { id: { in: crews } } });
      if (actor) {
        await tx.adminAuditLog.deleteMany({ where: { actorUserId: actor.id } });
        await tx.adminUser.delete({ where: { id: actor.id } });
      }
    });
    await db.$disconnect();
  });
  async function seed(beneficiaryCount = 2) {
    const crewId = randomUUID();
    crews.push(crewId);
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Revenue fixture',
        description: '',
        logo: '',
        createdByUserId: 'fixture',
      },
    });
    const members = [] as { id: string; userId: string }[];
    for (let i = 0; i < beneficiaryCount; i++) {
      const userId = `revenue-${randomUUID()}`;
      users.push(userId);
      members.push(
        await db.crewMember.create({
          data: { id: randomUUID(), crewId, userId, joinedVia: 'creation' },
        }),
      );
    }
    const contract = await db.crewRevenueContract.create({
      data: {
        crewId,
        filename: 'contract.pdf',
        storageProvider: 's3_compatible',
        bucket: 'fixture-private',
        objectKey: `revenue/${randomUUID()}.pdf`,
        sizeBytes: 100n,
        checksumSha256: randomUUID().replaceAll('-', '').repeat(2),
        uploadedByAdminId: actor.id,
        verifiedAt: new Date(),
      },
    });
    const input = {
      requestId: randomUUID(),
      contractId: contract.id,
      revenueReference: 'CONFIRMED-2026-10',
      title: 'October distribution',
      allocation: {
        currency: 'USD' as const,
        amountMinor: '10001',
        participants: members.map((m) => ({
          crewMemberId: m.id,
          shareBps: 10000 / beneficiaryCount,
        })),
      },
    };
    return { crewId, members, contract, input };
  }
  (process.env.WITHDRAWAL_SCALE_TEST === '1' ? it : it.skip)(
    'posts and reverses the supported 1000-beneficiary allocation without partial receipts',
    async () => {
      const fixture = await seed(1000);
      const started = Date.now();
      const posted = await service.post(actor, fixture.input);
      const postedMs = Date.now() - started;
      expect(
        await db.crewEarningEntry.count({
          where: { revenueDistributionId: posted.id, status: 'posted' },
        }),
      ).toBe(1000);
      const sum = await db.crewEarningEntry.aggregate({
        where: { revenueDistributionId: posted.id },
        _sum: { amountMinor: true },
      });
      expect(sum._sum.amountMinor).toBe(10001n);
      expect(
        await db.notification.count({
          where: {
            userId: { in: fixture.members.map((m) => m.userId) },
            type: 'crew.earning.posted',
          },
        }),
      ).toBe(1000);
      expect((await service.post(actor, fixture.input)).id).toBe(posted.id);
      const reversing = Date.now();
      await service.reverse(actor, posted.id, { reason: 'Fixture correction' });
      expect(
        await db.crewEarningEntry.count({
          where: { revenueDistributionId: posted.id, status: 'reversed' },
        }),
      ).toBe(1000);
      expect(
        await db.notification.count({
          where: {
            userId: { in: fixture.members.map((m) => m.userId) },
            type: 'crew.earning.reversed',
          },
        }),
      ).toBe(1000);
      expect(
        await db.notificationOutbox.count({
          where: { userId: { in: fixture.members.map((m) => m.userId) } },
        }),
      ).toBe(2000);
      console.info(
        JSON.stringify({
          beneficiaries: 1000,
          postedMs,
          reversedMs: Date.now() - reversing,
        }),
      );
    },
    120_000,
  );
  function readFixture() {
    const publicCreatorBatch = jest.fn().mockResolvedValue([]);
    return {
      publicCreatorBatch,
      read: new RevenueAdminReadService(
        db as PrismaService,
        {
          publicCreatorBatch,
        } as unknown as LegacyCreatorsService,
      ),
    };
  }
  it('shows only the authenticated beneficiary share and contract provenance after Crew departure', async () => {
    const fixture = await seed();
    const receipt = await service.post(actor, fixture.input);
    const member = fixture.members[0];
    await db.crewMember.update({
      where: { id: member.id },
      data: { status: 'removed', removedAt: new Date() },
    });
    const earnings = new CrewEarningsService(
      db as PrismaService,
      {} as CrewAuthorizationService,
      notifications,
    );
    const result = await earnings.listMine(member.userId, {
      currency: 'USD',
      limit: 50,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      userId: member.userId,
      crew: { id: fixture.crewId, name: 'Revenue fixture' },
      revenueDistribution: {
        id: receipt.id,
        revenueReference: fixture.input.revenueReference,
        shareBps: 5000,
        contract: { id: fixture.contract.id, filename: 'contract.pdf' },
      },
    });
    const output = JSON.stringify(result);
    expect(output).not.toContain(fixture.members[1].userId);
    expect(output).not.toContain('allocations');
    expect(output).not.toContain(fixture.contract.objectKey);
    expect(output).not.toContain('fixture-private');
    expect(
      (
        await earnings.listMine('unrelated-creator', {
          currency: 'USD',
          limit: 50,
        })
      ).items,
    ).toEqual([]);
  });
  it('rejects new confirmed revenue in the wrong deployment currency before crediting beneficiaries', async () => {
    const fixture = await seed();
    await expect(
      service.post(actor, {
        ...fixture.input,
        allocation: { ...fixture.input.allocation, currency: 'CNY' },
      }),
    ).rejects.toMatchObject({ response: { code: 'CREW_CURRENCY_MISMATCH' } });
    expect(
      await db.crewRevenueDistribution.count({
        where: { contractId: fixture.contract.id },
      }),
    ).toBe(0);
    expect(
      await db.crewEarningEntry.count({ where: { crewId: fixture.crewId } }),
    ).toBe(0);
  });
  it('discovers archived Crew receipts globally with cash/date filters and reversal status', async () => {
    const fixture = await seed();
    const marker = `History-${randomUUID()}`;
    const posted = await service.post(actor, {
      ...fixture.input,
      title: marker,
    });
    const { read } = readFixture();
    const date = posted.postedAt.slice(0, 10);
    const query = {
      q: marker.toLowerCase(),
      currency: 'USD' as const,
      recordedFrom: date,
      recordedThrough: date,
    };
    const history = await read.history(actor, query);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      id: posted.id,
      status: 'posted',
      amountMinor: '10001',
      crew: { archived: false },
    });
    expect(JSON.stringify(history)).not.toMatch(/objectKey|bucket|allocations/);
    expect(
      (await read.history(actor, { ...query, currency: 'CNY' })).items,
    ).toEqual([]);
    expect(
      (await read.history(actor, { ...query, after: posted.id })).items,
    ).toEqual([]);
    const tomorrow = new Date(
      new Date(`${date}T00:00:00Z`).getTime() + 86400000,
    )
      .toISOString()
      .slice(0, 10);
    expect(
      (
        await read.history(actor, {
          ...query,
          recordedFrom: tomorrow,
          recordedThrough: tomorrow,
        })
      ).items,
    ).toEqual([]);
    await expect(
      read.history(actor, { ...query, recordedFrom: tomorrow }),
    ).rejects.toThrow('must not precede');
    await service.reverse(actor, posted.id, { reason: 'Fixture correction' });
    await db.crew.update({
      where: { id: fixture.crewId },
      data: { deletedAt: new Date() },
    });
    expect((await read.history(actor, query)).items[0]).toMatchObject({
      id: posted.id,
      status: 'reversed',
      crew: { archived: true },
    });
  });
  it('reads Crew-scoped contract evidence and posted history without exposing storage keys', async () => {
    const first = await seed();
    const other = await seed();
    const posted = await service.post(actor, first.input);
    await service.post(actor, other.input);
    const { read } = readFixture();
    const contracts = await read.contracts(actor, first.crewId, {});
    expect(contracts).toEqual({
      items: [
        {
          id: first.contract.id,
          filename: 'contract.pdf',
          sizeBytes: '100',
          verifiedAt: first.contract.verifiedAt.toISOString(),
        },
      ],
      nextCursor: null,
    });
    const history = await read.distributions(actor, first.crewId, {});
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      id: posted.id,
      amountMinor: '10001',
      currency: 'USD',
      postedByAdminId: actor.id,
    });
    expect(history.items[0]).not.toHaveProperty('allocations');
    const receipt = await read.distribution(actor, posted.id);
    expect(
      receipt.participants.map((row) => ({
        crewMemberId: row.crewMemberId,
        shareBps: row.shareBps,
        amountMinor: row.amountMinor,
      })),
    ).toEqual(
      (
        posted.participants as {
          crewMemberId: string;
          shareBps: number;
          amountMinor: string;
        }[]
      ).map(({ crewMemberId, shareBps, amountMinor }) => ({
        crewMemberId,
        shareBps,
        amountMinor,
      })),
    );
    expect(receipt.participants.every((row) => row.status === 'posted')).toBe(
      true,
    );
    expect(receipt.contract).toEqual({
      id: first.contract.id,
      filename: 'contract.pdf',
    });
    expect(JSON.stringify(receipt)).not.toContain('fixture-private');
    expect(JSON.stringify({ contracts, history })).not.toContain(
      'fixture-private',
    );
  });
  it('keeps immutable receipt detail available after archival without a directory dependency', async () => {
    const fixture = await seed();
    const posted = await service.post(actor, {
      ...fixture.input,
      allocation: { ...fixture.input.allocation, amountMinor: '1' },
    });
    await db.crew.update({
      where: { id: fixture.crewId },
      data: { deletedAt: new Date() },
    });
    const { read, publicCreatorBatch } = readFixture();
    publicCreatorBatch.mockRejectedValue(new Error('Directory offline'));
    const detail = await read.distribution(actor, posted.id);
    expect(
      detail.participants.filter((row) => row.status === 'zero_amount'),
    ).toHaveLength(1);
    expect(
      detail.participants.filter((row) => row.status === 'posted'),
    ).toHaveLength(1);
    expect(publicCreatorBatch).not.toHaveBeenCalled();
    await expect(
      read.distribution({ ...actor, permissions: [] }, posted.id),
    ).rejects.toThrow('permission');
    await expect(
      read.distribution({ ...actor, siteScope: 'cn' }, posted.id),
    ).rejects.toThrow('permission');
    await expect(read.distribution(actor, randomUUID())).rejects.toThrow(
      'Revenue receipt not found',
    );
  });
  it('paginates all beneficiaries including former members and preserves missing identity explicitly', async () => {
    const fixture = await seed();
    await db.crewMember.update({
      where: { id: fixture.members[0].id },
      data: { status: 'removed', removedAt: new Date() },
    });
    const additions = Array.from({ length: 50 }, () => ({
      id: randomUUID(),
      crewId: fixture.crewId,
      userId: `revenue-${randomUUID()}`,
      joinedVia: 'creation' as const,
    }));
    await db.crewMember.createMany({ data: additions });
    const { read, publicCreatorBatch } = readFixture();
    publicCreatorBatch.mockImplementation((ids: string[]) =>
      Promise.resolve(
        ids.includes(fixture.members[0].userId)
          ? [{ id: fixture.members[0].userId, nick_name: '  Named creator  ' }]
          : [],
      ),
    );
    const first = await read.members(actor, fixture.crewId, {});
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await read.members(actor, fixture.crewId, {
      after: first.nextCursor!,
    });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((row) => row.id)).size).toBe(52);
    expect(all.find((row) => row.id === fixture.members[0].id)).toMatchObject({
      name: 'Named creator',
      status: 'removed',
    });
    expect(
      all.find((row) => row.id === fixture.members[1].id)?.name,
    ).toBeNull();
    expect(
      publicCreatorBatch.mock.calls.every(
        ([ids]: [string[]]) => ids.length <= 50,
      ),
    ).toBe(true);
    expect(all.every((row) => !('userId' in row))).toBe(true);
  });
  it('gates finance reads and excludes deleted Crews from discovery and details', async () => {
    const fixture = await seed();
    const { read, publicCreatorBatch } = readFixture();
    for (const denied of [
      { ...actor, permissions: [] },
      { ...actor, siteScope: 'cn' as const },
    ]) {
      await expect(read.history(denied, {})).rejects.toThrow('permission');
      await expect(read.crews(denied, {})).rejects.toThrow('permission');
      await expect(read.members(denied, fixture.crewId, {})).rejects.toThrow(
        'permission',
      );
      await expect(read.contracts(denied, fixture.crewId, {})).rejects.toThrow(
        'permission',
      );
      await expect(
        read.distributions(denied, fixture.crewId, {}),
      ).rejects.toThrow('permission');
    }
    expect(publicCreatorBatch).not.toHaveBeenCalled();
    const name = `Read fixture ${randomUUID()}`;
    await db.crew.update({ where: { id: fixture.crewId }, data: { name } });
    expect((await read.crews(actor, { q: name.toUpperCase() })).items).toEqual([
      { id: fixture.crewId, name },
    ]);
    await db.crew.update({
      where: { id: fixture.crewId },
      data: { deletedAt: new Date() },
    });
    expect((await read.crews(actor, { q: name })).items).toEqual([]);
    await expect(read.contracts(actor, fixture.crewId, {})).rejects.toThrow(
      'Crew not found',
    );
    await expect(read.members(actor, fixture.crewId, {})).rejects.toThrow(
      'Crew not found',
    );
  });
  function uploadFixture() {
    const buffer = Buffer.from('%PDF-1.7\nfixture contract\n%%EOF');
    const storage = {
      createPrivateUploadUrl: jest.fn(
        ({ storageKey }: { storageKey: string }) =>
          Promise.resolve({
            url: 'https://private.invalid/secret-write',
            method: 'PUT',
            headers: {},
            storageKey,
            bucket: 'fixture-private',
            provider: 's3_compatible',
            region: null,
          }),
      ),
      headStoredObject: jest.fn().mockResolvedValue({
        exists: true,
        sizeBytes: buffer.length,
        contentType: 'application/pdf',
      }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://private.invalid/short-read',
        expiresAt: new Date().toISOString(),
      }),
    };
    const registry = {
      forProvider: () => storage,
    } as unknown as StorageProviderRegistry;
    return {
      storage,
      file: { buffer, originalname: 'contract.pdf' },
      contracts: new RevenueContractsService(db as PrismaService, registry),
    };
  }
  it('verifies private uploads, deduplicates files and audits protected download', async () => {
    const t = await seed();
    const fixture = uploadFixture();
    const put = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    try {
      const result = await fixture.contracts.upload(
        actor,
        t.crewId,
        fixture.file,
      );
      expect(JSON.stringify(result)).not.toContain('secret-write');
      const saved = await db.crewRevenueContract.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(saved.bucket).toBe('fixture-private');
      expect(saved.sizeBytes).toBe(BigInt(fixture.file.buffer.length));
      expect(saved.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(
        await fixture.contracts.upload(actor, t.crewId, fixture.file),
      ).toEqual(result);
      expect(put).toHaveBeenCalledTimes(1);
      expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
      expect(await fixture.contracts.download(actor, result.id)).toMatchObject({
        url: 'https://private.invalid/short-read',
      });
      expect(
        await db.adminAuditLog.count({ where: { resourceId: result.id } }),
      ).toBe(2);
      await expect(
        fixture.contracts.download(
          { ...actor, sessionId: randomUUID() },
          result.id,
        ),
      ).rejects.toThrow();
      await expect(
        fixture.contracts.download({ ...actor, permissions: [] }, result.id),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      put.mockRestore();
    }
  });
  it('rejects malformed documents and unauthorized uploads before storage access', async () => {
    const fixture = uploadFixture();
    await expect(
      fixture.contracts.upload(
        { ...actor, permissions: [] },
        'crew',
        fixture.file,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      fixture.contracts.upload(actor, 'crew', {
        buffer: Buffer.from('not a PDF'),
        originalname: 'fake.pdf',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fixture.storage.createPrivateUploadUrl).not.toHaveBeenCalled();
  });
  it.each(['upload', 'verify', 'audit'])(
    'does not retain a contract after %s failure',
    async (failure) => {
      const t = await seed();
      const fixture = uploadFixture();
      const put = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(null, { status: failure === 'upload' ? 503 : 200 }),
        );
      if (failure === 'verify')
        fixture.storage.headStoredObject.mockResolvedValue({
          exists: true,
          sizeBytes: 1,
          contentType: 'application/pdf',
        });
      try {
        await expect(
          fixture.contracts.upload(
            failure === 'audit' ? { ...actor, sessionId: randomUUID() } : actor,
            t.crewId,
            fixture.file,
          ),
        ).rejects.toThrow();
        expect(
          await db.crewRevenueContract.count({ where: { crewId: t.crewId } }),
        ).toBe(1); // seeded contract only
        expect(fixture.storage.deleteObject).toHaveBeenCalledTimes(1);
      } finally {
        put.mockRestore();
      }
    },
  );
  it('recovers a failed cleanup from the durable ledger after restart', async () => {
    const t = await seed();
    const fixture = uploadFixture();
    fixture.storage.deleteObject.mockRejectedValueOnce(
      new Error('Temporary object store failure'),
    );
    const put = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));
    try {
      await expect(
        fixture.contracts.upload(actor, t.crewId, fixture.file),
      ).rejects.toThrow('upload failed');
      const key =
        fixture.storage.createPrivateUploadUrl.mock.calls[0][0].storageKey;
      const [pending] = await db.$queryRaw<
        { status: string }[]
      >`SELECT status FROM crew_revenue_contract_uploads WHERE object_key=${key}`;
      expect(pending.status).toBe('retired');
      await db.$executeRaw`UPDATE crew_revenue_contract_uploads SET next_attempt_at=now()-interval '1 second' WHERE object_key=${key}`;
      const restarted = new RevenueContractsService(
        db as PrismaService,
        {
          forProvider: () => fixture.storage,
        } as unknown as StorageProviderRegistry,
      );
      await Promise.all([
        restarted.drainCleanup(),
        fixture.contracts.drainCleanup(),
      ]);
      expect(fixture.storage.deleteObject).toHaveBeenCalledTimes(2);
      expect(
        await db.$queryRaw`SELECT object_key FROM crew_revenue_contract_uploads WHERE object_key=${key}`,
      ).toEqual([]);
    } finally {
      put.mockRestore();
    }
  });
  it('preserves committed evidence when a cleanup record survives an uncertain reply', async () => {
    const t = await seed();
    const fixture = uploadFixture();
    const c = t.contract;
    await db.$executeRaw`INSERT INTO crew_revenue_contract_uploads(object_key,provider,bucket,region,next_attempt_at) VALUES(${c.objectKey},${c.storageProvider}::"MediaStorageProvider",${c.bucket},${c.region},now()-interval '1 second')`;
    await fixture.contracts.drainCleanup();
    expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
    expect(
      await db.crewRevenueContract.findUnique({ where: { id: c.id } }),
    ).not.toBeNull();
    expect(
      await db.$queryRaw`SELECT object_key FROM crew_revenue_contract_uploads WHERE object_key=${c.objectKey}`,
    ).toEqual([]);
  });
  it('cannot publish a contract after cleanup has retired its upload', async () => {
    const t = await seed();
    const fixture = uploadFixture();
    const put = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    fixture.storage.headStoredObject.mockImplementationOnce(async () => {
      const key =
        fixture.storage.createPrivateUploadUrl.mock.calls[0][0].storageKey;
      await fixture.contracts.cleanupObject(key, true);
      return {
        exists: true,
        sizeBytes: fixture.file.buffer.length,
        contentType: 'application/pdf',
      };
    });
    try {
      await expect(
        fixture.contracts.upload(actor, t.crewId, fixture.file),
      ).rejects.toThrow('expired');
      expect(
        await db.crewRevenueContract.count({ where: { crewId: t.crewId } }),
      ).toBe(1);
      expect(fixture.storage.deleteObject).toHaveBeenCalledTimes(1);
    } finally {
      put.mockRestore();
    }
  });
  it('posts all earnings, events, notifications and audit exactly once under concurrent replay', async () => {
    const t = await seed();
    const results = await Promise.all([
      service.post(actor, t.input),
      service.post(actor, { ...t.input, requestId: randomUUID() }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const earnings = await db.crewEarningEntry.findMany({
      where: { crewId: t.crewId },
    });
    expect(earnings).toHaveLength(2);
    expect(earnings.reduce((sum, e) => sum + e.amountMinor, 0n)).toBe(10001n);
    expect(
      earnings.every(
        (e) =>
          e.status === 'posted' &&
          e.sourceType === 'revenue_share' &&
          e.revenueDistributionId === results[0].id,
      ),
    ).toBe(true);
    expect(
      await db.crewEarningEvent.count({ where: { crewId: t.crewId } }),
    ).toBe(2);
    expect(
      await db.notification.count({
        where: { userId: { in: t.members.map((m) => m.userId) } },
      }),
    ).toBe(2);
    expect(
      await db.notificationOutbox.count({
        where: { userId: { in: t.members.map((m) => m.userId) } },
      }),
    ).toBe(2);
    expect(
      await db.adminAuditLog.count({ where: { resourceId: results[0].id } }),
    ).toBe(1);
    await expect(
      service.post(actor, {
        ...t.input,
        allocation: { ...t.input.allocation, amountMinor: '20000' },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('makes only platform-confirmed revenue withdrawable and settles it through the manual payout ledger', async () => {
    const t = await seed();
    const posted = await service.post(actor, t.input);
    const beneficiary = t.members[0];
    const earnings = await db.crewEarningEntry.findFirstOrThrow({
      where: { revenueDistributionId: posted.id, userId: beneficiary.userId },
    });
    await db.crewEarningEntry.create({
      data: {
        crewId: t.crewId,
        crewMemberId: beneficiary.id,
        userId: beneficiary.userId,
        currency: 'USD',
        amountMinor: 999999n,
        sourceType: 'revenue_share',
        status: 'posted',
        postedAt: new Date(),
        title: 'Unconfirmed manual revenue entry',
        approvedByUserId: beneficiary.userId,
        idempotencyKey: randomUUID(),
        createdByUserId: beneficiary.userId,
      },
    });
    const withdrawals = new CreatorWithdrawalsService(db as PrismaService);
    expect(await withdrawals.balances(beneficiary.userId)).toEqual([
      expect.objectContaining({
        currency: 'USD',
        confirmedAmountMinor: earnings.amountMinor.toString(),
        availableAmountMinor: earnings.amountMinor.toString(),
      }),
    ]);
    const request = await withdrawals.request(beneficiary.userId, {
      requestId: randomUUID(),
      currency: 'USD',
      percentageBps: 10000,
      expectedAvailableAmountMinor: earnings.amountMinor.toString(),
      recipient: {
        fullName: 'Fixture beneficiary',
        accountNumber: 'TEST-12345678',
        address: 'Fixture address',
        swift: 'DBSSSGSG',
        branchAddress: 'Fixture branch',
      },
    });
    const children = await db.crewPayoutAllocation.findMany({
      where: { payout: { platformWithdrawalId: request.id } },
    });
    await expect(
      service.reverse(actor, posted.id, { reason: 'Wrong amount' }),
    ).rejects.toThrow('reserved');
    expect(children).toHaveLength(1);
    expect(children[0].earningId).toBe(earnings.id);
    expect(await withdrawals.balances(beneficiary.userId)).toEqual([
      expect.objectContaining({
        availableAmountMinor: '0',
        reservedAmountMinor: earnings.amountMinor.toString(),
      }),
    ]);
    const finance = new WithdrawalAdminService(
      db as PrismaService,
      notifications,
    );
    const financeActor = {
      ...actor,
      permissions: [
        ...actor.permissions,
        ADMIN_PERMISSION_KEYS.CreatorWithdrawalsManage,
      ],
    };
    await finance.decide(financeActor, request.id, {
      action: 'process',
      expectedVersion: 1,
    });
    await finance.decide(financeActor, request.id, {
      action: 'pay',
      expectedVersion: 2,
      paymentReference: 'FIXTURE-EXTERNAL-TRANSFER',
    });
    await expect(
      service.reverse(actor, posted.id, { reason: 'Wrong amount' }),
    ).rejects.toThrow('payout');
    expect(await withdrawals.balances(beneficiary.userId)).toEqual([
      expect.objectContaining({
        availableAmountMinor: '0',
        paidAmountMinor: earnings.amountMinor.toString(),
        reservedAmountMinor: '0',
      }),
    ]);
    expect(
      await db.creatorWithdrawal.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).toMatchObject({ status: 'paid' });
  });
  it('reverses every beneficiary once, preserves the receipt and rejects resurrection by posting replay', async () => {
    const fixture = await seed();
    const posted = await service.post(actor, fixture.input);
    const results = await Promise.all([
      service.reverse(actor, posted.id, {
        reason: 'Incorrect confirmed amount',
      }),
      service.reverse(actor, posted.id, {
        reason: 'Incorrect confirmed amount',
      }),
    ]);
    expect(results).toEqual([
      { id: posted.id, status: 'reversed' },
      { id: posted.id, status: 'reversed' },
    ]);
    expect(
      await db.crewEarningEntry.count({
        where: { revenueDistributionId: posted.id, status: 'reversed' },
      }),
    ).toBe(2);
    expect(
      await db.crewEarningEvent.count({
        where: { crewId: fixture.crewId, action: 'earning.reversed' },
      }),
    ).toBe(2);
    expect(
      await db.notification.count({
        where: {
          userId: { in: fixture.members.map((row) => row.userId) },
          type: 'crew.earning.reversed',
        },
      }),
    ).toBe(2);
    expect(
      await db.adminAuditLog.count({
        where: { resourceId: posted.id, action: 'creator.revenue.reversed' },
      }),
    ).toBe(1);
    const original = await db.crewRevenueDistribution.findUniqueOrThrow({
      where: { id: posted.id },
    });
    expect(original.amountMinor).toBe(10001n);
    expect(original.allocations).toEqual(posted.participants);
    const withdrawals = new CreatorWithdrawalsService(db as PrismaService);
    expect(
      (await withdrawals.balances(fixture.members[0].userId)).every(
        (row) => row.availableAmountMinor === '0',
      ),
    ).toBe(true);
    await expect(service.post(actor, fixture.input)).rejects.toThrow(
      'was reversed',
    );
    await expect(
      service.reverse(actor, posted.id, { reason: 'A different reason' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.reverse({ ...actor, permissions: [] }, posted.id, {
        reason: 'Incorrect confirmed amount',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each(['notification', 'audit'])(
    'rolls back every reversal when the %s write fails',
    async (failure) => {
      const fixture = await seed();
      const posted = await service.post(actor, fixture.input);
      const brokenNotifications = {
        send: jest
          .fn()
          .mockRejectedValue(new Error('Notification unavailable')),
      } as unknown as NotificationService;
      const reversing =
        failure === 'notification'
          ? new RevenueDistributionService(
              db as PrismaService,
              brokenNotifications,
            )
          : service;
      const operator =
        failure === 'audit' ? { ...actor, sessionId: randomUUID() } : actor;
      await expect(
        reversing.reverse(operator, posted.id, { reason: 'Correction' }),
      ).rejects.toThrow();
      expect(
        await db.crewEarningEntry.count({
          where: { revenueDistributionId: posted.id, status: 'posted' },
        }),
      ).toBe(2);
      expect(
        await db.crewEarningEvent.count({
          where: { crewId: fixture.crewId, action: 'earning.reversed' },
        }),
      ).toBe(0);
      expect(
        await db.notification.count({
          where: {
            userId: { in: fixture.members.map((row) => row.userId) },
            type: 'crew.earning.reversed',
          },
        }),
      ).toBe(0);
    },
  );
  it('serializes reversal against a simultaneous withdrawal without partial beneficiary reversal', async () => {
    const fixture = await seed();
    const posted = await service.post(actor, fixture.input);
    const withdrawals = new CreatorWithdrawalsService(db as PrismaService);
    const member = fixture.members[0];
    const earning = await db.crewEarningEntry.findFirstOrThrow({
      where: { revenueDistributionId: posted.id, userId: member.userId },
    });
    const results = await Promise.allSettled([
      service.reverse(actor, posted.id, { reason: 'Correction' }),
      withdrawals.request(member.userId, {
        requestId: randomUUID(),
        currency: 'USD',
        percentageBps: 10000,
        expectedAvailableAmountMinor: earning.amountMinor.toString(),
        recipient: {
          fullName: 'Fixture',
          accountNumber: 'TEST-12345678',
          address: 'Fixture address',
          swift: 'DBSSSGSG',
          branchAddress: 'Fixture branch',
        },
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rows = await db.crewEarningEntry.findMany({
      where: { revenueDistributionId: posted.id },
    });
    expect(new Set(rows.map((row) => row.status)).size).toBe(1);
    expect(rows[0].status).toBe(
      results[0].status === 'fulfilled' ? 'reversed' : 'posted',
    );
  });
  it('rolls back the entire distribution after a late notification failure', async () => {
    const t = await seed();
    const realNotifications = new NotificationService(db as PrismaService);
    const original: NotificationService['send'] = (...args) =>
      realNotifications.send(...args);
    const failure = jest
      .spyOn(notifications, 'send')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Outbox unavailable'));
    try {
      await expect(service.post(actor, t.input)).rejects.toThrow(
        'Outbox unavailable',
      );
    } finally {
      failure.mockRestore();
    }
    expect(
      await db.crewRevenueDistribution.count({
        where: { contractId: t.contract.id },
      }),
    ).toBe(0);
    expect(
      await db.crewEarningEntry.count({ where: { crewId: t.crewId } }),
    ).toBe(0);
    expect(
      await db.notification.count({
        where: { userId: { in: t.members.map((m) => m.userId) } },
      }),
    ).toBe(0);
    await expect(service.post(actor, t.input)).resolves.toMatchObject({
      amountMinor: '10001',
    });
  });
  it('rolls back earnings when the admin audit cannot be recorded', async () => {
    const t = await seed();
    await expect(
      service.post({ ...actor, sessionId: randomUUID() }, t.input),
    ).rejects.toThrow();
    expect(
      await db.crewEarningEntry.count({ where: { crewId: t.crewId } }),
    ).toBe(0);
    expect(
      await db.crewRevenueDistribution.count({
        where: { contractId: t.contract.id },
      }),
    ).toBe(0);
  });
  it('rejects missing permission, wrong site, and a beneficiary from another Crew', async () => {
    const t = await seed();
    await expect(
      service.post({ ...actor, permissions: [] }, t.input),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.post({ ...actor, siteScope: 'cn' }, t.input),
    ).rejects.toMatchObject({ status: 403 });
    const other = await seed();
    await expect(
      service.post(actor, {
        ...t.input,
        allocation: {
          ...t.input.allocation,
          participants: [
            { crewMemberId: other.members[0].id, shareBps: 10000 },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.crewEarningEntry.count({ where: { crewId: t.crewId } }),
    ).toBe(0);
  });
  it('keeps the posted receipt immutable and rejects mismatched direct ledger writes', async () => {
    const t = await seed();
    const receipt = await service.post(actor, t.input);
    await expect(
      db.crewRevenueDistribution.update({
        where: { id: receipt.id },
        data: { amountMinor: 1n },
      }),
    ).rejects.toThrow();
    const earning = await db.crewEarningEntry.findFirstOrThrow({
      where: { revenueDistributionId: receipt.id },
    });
    await expect(
      db.crewEarningEntry.update({
        where: { id: earning.id },
        data: { amountMinor: 1n },
      }),
    ).rejects.toThrow();
    await expect(
      db.crewEarningEntry.update({
        where: { id: earning.id },
        data: { revenueDistributionId: null },
      }),
    ).rejects.toThrow();
    await expect(
      db.$transaction(async (tx) => {
        await tx.crewEarningEvent.deleteMany({
          where: { earningId: earning.id },
        });
        await tx.crewEarningEntry.delete({ where: { id: earning.id } });
      }),
    ).rejects.toThrow(/Revenue allocation|append-only/);
  });
});

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { CrewsService } from './crews.service';
import { CrewAuthorizationService } from './crew-authorization.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `crew-settings-${randomUUID()}`;
jest.setTimeout(30000);
integration('Crew settings permission after waits (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let service: CrewsService;
  let crewId: string;
  let memberId: string;
  let userId: string;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01')
      )
    )
      throw new Error('Owned loopback fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
    service = new CrewsService(
      db as PrismaService,
      {} as ConstructorParameters<typeof CrewsService>[1],
      new CrewAuthorizationService(db as PrismaService),
      {} as ConstructorParameters<typeof CrewsService>[3],
    );
  });
  beforeEach(async () => {
    crewId = randomUUID();
    memberId = randomUUID();
    userId = randomUUID();
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Original',
        description: '',
        logo: 'fixture.png',
        createdByUserId: 'fixture-owner',
      },
    });
    const ownerMember = await db.crewMember.create({
      data: {
        id: randomUUID(),
        crewId,
        userId: 'fixture-owner',
        joinedVia: 'creation',
      },
    });
    await db.crewOwnership.create({
      data: { crewId, memberId: ownerMember.id },
    });
    await db.crewMember.create({
      data: { id: memberId, crewId, userId, joinedVia: 'invitation' },
    });
    await db.crewMemberPermissionOverride.create({
      data: {
        memberId,
        permissionKey: 'crew.settings.manage',
        effect: 'allow',
        changedByUserId: 'fixture-owner',
      },
    });
  });
  afterEach(async () => {
    await db.crew.delete({ where: { id: crewId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const perform = (kind: 'profile' | 'listing', version?: number) =>
    kind === 'profile'
      ? service.update(crewId, userId, {
          name: 'Changed',
          expectedVersion: version,
        })
      : service.updateListing(crewId, userId, {
          listingStatus: 'listed',
          expectedVersion: version,
        });
  it.each(['profile', 'listing'] as const)(
    'preserves %s version conflicts and permits valid updates',
    async (kind) => {
      const before = await db.crew.findUniqueOrThrow({ where: { id: crewId } });
      await perform(kind, before.version);
      expect(
        (await db.crew.findUniqueOrThrow({ where: { id: crewId } })).version,
      ).toBe(before.version + 1);
      await expect(perform(kind, before.version)).rejects.toMatchObject({
        status: 409,
      });
      expect(
        (await db.crew.findUniqueOrThrow({ where: { id: crewId } })).version,
      ).toBe(before.version + 1);
    },
  );
  it.each([
    ['profile', 'permission'],
    ['listing', 'permission'],
    ['profile', 'membership'],
    ['listing', 'membership'],
  ] as const)(
    'rejects %s after %s is withdrawn during the Crew row wait',
    async (kind, change) => {
      const before = await db.crew.findUniqueOrThrow({ where: { id: crewId } });
      let expected = before;
      let release!: () => void;
      let admitted!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const ready = new Promise<void>((r) => {
        admitted = r;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR UPDATE`;
        admitted();
        await gate;
        if (change === 'permission')
          await tx.crewMemberPermissionOverride.deleteMany({
            where: { memberId },
          });
        else
          await tx.crewMember.update({
            where: { id: memberId },
            data: { status: 'removed', removedAt: new Date() },
          });
        expected = await tx.crew.findUniqueOrThrow({ where: { id: crewId } });
      });
      await ready;
      const pending = perform(kind);
      void pending.catch(() => undefined);
      try {
        const deadline = Date.now() + 5000;
        while (true) {
          const [row] = await db.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
          if (Number(row.count) > 0) break;
          if (Date.now() > deadline)
            throw new Error('Expected settings row wait');
          await new Promise((r) => setTimeout(r, 10));
        }
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({ status: 403 });
      expect(
        await db.crew.findUniqueOrThrow({ where: { id: crewId } }),
      ).toEqual(expected);
    },
  );
});

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { CreatorLocationsService } from './creator-locations';

const databaseUrl = process.env.CONTENT_GPS_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  'creator city declarations (isolated PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: CreatorLocationsService;
    const owner = { userId: 'studio-owner' };
    const profile = {
      basedIn: { countryCode: 'SG', city: 'Singapore' },
      serves: [{ countryCode: 'MY', city: 'Johor Bahru' }],
      remote: true,
      showOnMap: true,
    };
    const input = (expectedVersion = 0) => ({
      requestId: randomUUID(),
      expectedVersion,
      profile,
    });
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '55441' ||
        url.pathname !== '/gps_test'
      )
        throw new Error('Dedicated loopback GPS database required.');
      db = buildPrisma(databaseUrl);
      const migration = readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20261001190000_creator_location_profiles/migration.sql',
        ),
        'utf8',
      );
      for (const statement of migration
        .split(';')
        .filter((part) => part.trim()))
        await db.$executeRawUnsafe(statement);
      service = new CreatorLocationsService(db as PrismaService);
    });
    afterEach(async () => {
      await db.$executeRaw`DELETE FROM creator_location_revisions`;
    });
    afterAll(async () => {
      if (db) {
        await db.$executeRawUnsafe(
          'DROP TABLE IF EXISTS creator_location_revisions',
        );
        await db.$disconnect();
      }
    });
    it('starts without a declaration and records explicit opt-in, separate cities and remote work', async () => {
      expect(await service.read(owner)).toMatchObject({
        version: 0,
        profile: null,
      });
      const saved = await service.save(owner, input());
      expect(saved).toMatchObject({ version: 1, profile });
      expect(Number.isFinite(Date.parse(saved.updatedAt!))).toBe(true);
    });
    it('allows remote-only services without a studio pin', async () => {
      const remote = {
        basedIn: null,
        serves: [],
        remote: true,
        showOnMap: false,
      };
      expect(
        await service.save(owner, { ...input(), profile: remote }),
      ).toMatchObject({ profile: remote });
    });
    it('serializes first saves without losing an edit', async () => {
      const results = await Promise.allSettled([
        service.save(owner, input()),
        service.save(owner, input()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { status: 409 },
      });
      expect((await service.read(owner)).version).toBe(1);
    });
    it('replays a lost reply without undoing a later map opt-out', async () => {
      const request = input();
      const [first, replay] = await Promise.all([
        service.save(owner, request),
        service.save(owner, request),
      ]);
      expect(first).toEqual(replay);
      await service.save(owner, {
        ...input(1),
        profile: { ...profile, showOnMap: false },
      });
      expect(await service.save(owner, request)).toEqual(first);
      expect(await service.read(owner)).toMatchObject({
        version: 2,
        profile: { showOnMap: false },
      });
      const [count] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM creator_location_revisions`;
      expect(count.count).toBe(2n);
    });
    it('isolates owners even when the same request ID is reused by another account', async () => {
      const request = input();
      await service.save(owner, request);
      const other = { userId: 'other-studio' };
      expect(await service.read(other)).toMatchObject({
        version: 0,
        profile: null,
      });
      await service.save(other, {
        ...request,
        profile: { ...profile, showOnMap: false },
      });
      expect(await service.read(owner)).toMatchObject({
        version: 1,
        profile: { showOnMap: true },
      });
      expect(await service.read(other)).toMatchObject({
        version: 1,
        profile: { showOnMap: false },
      });
    });
    it('rejects reuse with a changed body or expected revision', async () => {
      const request = input();
      await service.save(owner, request);
      await expect(
        service.save(owner, {
          ...request,
          profile: { ...profile, remote: false },
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.save(owner, { ...request, expectedVersion: 1 }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('rejects missing auth before touching stored data', async () => {
      await expect(service.read({ userId: '' })).rejects.toMatchObject({
        status: 401,
      });
      await expect(service.save({ userId: '' }, input())).rejects.toMatchObject(
        { status: 401 },
      );
    });
    it('rejects missing city opt-in, coordinates, impersonation and duplicate city declarations', async () => {
      for (const bad of [
        { ...input(), profile: { ...profile, basedIn: null } },
        { ...input(), creatorId: 'another-owner' },
        {
          ...input(),
          profile: { ...profile, basedIn: { ...profile.basedIn, latitude: 1 } },
        },
        {
          ...input(),
          profile: {
            ...profile,
            serves: [
              { countryCode: 'SG', city: 'Singapore' },
              { countryCode: 'SG', city: 'singapore' },
            ],
          },
        },
      ]) {
        await expect(
          service.save(owner, bad as ReturnType<typeof input>),
        ).rejects.toMatchObject({ status: 400 });
      }
      expect((await service.read(owner)).version).toBe(0);
    });
  },
);

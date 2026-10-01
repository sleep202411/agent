import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { ContentGpsLocationsService } from './content-gps-locations';

const databaseUrl = process.env.CONTENT_GPS_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  'owner GPS locations (isolated PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: ContentGpsLocationsService;
    let ipId: string;
    const owner = { userId: 'gps-owner' };
    const location = {
      id: randomUUID(),
      kind: 'story_setting' as const,
      label: 'Singapore',
      status: 'resolved' as const,
      point: {
        latitude: 1.3,
        longitude: 103.8,
        coordinateSystem: 'WGS84' as const,
        precision: 'city' as const,
      },
    };
    const input = (expectedVersion = 0) => ({
      requestId: randomUUID(),
      expectedVersion,
      locations: [location],
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
      await db.$executeRawUnsafe(
        'CREATE TABLE ips (id uuid PRIMARY KEY, created_by_id varchar(64) NOT NULL, deleted_at timestamptz)',
      );
      const migration = readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20261001173000_content_gps_owner_locations/migration.sql',
        ),
        'utf8',
      );
      for (const statement of migration
        .split(';')
        .filter((part) => part.trim()))
        await db.$executeRawUnsafe(statement);
      service = new ContentGpsLocationsService(db as PrismaService);
    });
    beforeEach(async () => {
      ipId = randomUUID();
      await db.$executeRaw`INSERT INTO ips (id, created_by_id) VALUES (${ipId}::uuid, ${owner.userId})`;
    });
    afterEach(async () => {
      await db.$executeRaw`DELETE FROM ips WHERE id = ${ipId}::uuid`;
    });
    afterAll(async () => {
      if (db) {
        await db.$executeRawUnsafe(
          'DROP TABLE IF EXISTS ip_content_gps_location_revisions',
        );
        await db.$executeRawUnsafe('DROP TABLE IF EXISTS ips');
        await db.$disconnect();
      }
    });
    it('distinguishes no correction from an explicit empty override and records actor/time', async () => {
      expect(await service.read(ipId, owner)).toMatchObject({
        version: 0,
        locations: null,
      });
      const saved = await service.save(ipId, owner, input());
      expect(saved).toMatchObject({
        version: 1,
        locations: [location],
        updatedById: owner.userId,
      });
      expect(Number.isFinite(Date.parse(saved.updatedAt!))).toBe(true);
      await service.save(ipId, owner, { ...input(1), locations: [] });
      expect(await service.read(ipId, owner)).toMatchObject({
        version: 2,
        locations: [],
      });
      const rows = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM ip_content_gps_location_revisions WHERE ip_id = ${ipId}::uuid`;
      expect(rows[0].count).toBe(2n);
    });
    it('serializes simultaneous saves without losing an edit', async () => {
      const results = await Promise.allSettled([
        service.save(ipId, owner, input()),
        service.save(ipId, owner, input()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { status: 409 },
      });
      expect((await service.read(ipId, owner)).version).toBe(1);
    });
    it('replays concurrent and late retries without duplicating or reverting newer edits', async () => {
      const request = input();
      const [one, two] = await Promise.all([
        service.save(ipId, owner, request),
        service.save(ipId, owner, request),
      ]);
      expect(two).toEqual(one);
      await service.save(ipId, owner, { ...input(1), locations: [] });
      expect(await service.save(ipId, owner, request)).toEqual(one);
      expect(await service.read(ipId, owner)).toMatchObject({
        version: 2,
        locations: [],
      });
    });
    it('rejects reused request IDs with changed payload or expected revision', async () => {
      const request = input();
      await service.save(ipId, owner, request);
      await expect(
        service.save(ipId, owner, { ...request, locations: [] }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.save(ipId, owner, { ...request, expectedVersion: 1 }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('denies non-owners and rechecks ownership even for a saved request', async () => {
      const request = input();
      await expect(
        service.read(ipId, { userId: 'editor' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.save(ipId, { userId: 'admin' }, request),
      ).rejects.toMatchObject({ status: 404 });
      await service.save(ipId, owner, request);
      await db.$executeRaw`UPDATE ips SET created_by_id = 'new-owner' WHERE id = ${ipId}::uuid`;
      await expect(service.save(ipId, owner, request)).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.read(ipId, owner)).rejects.toMatchObject({
        status: 404,
      });
      expect((await service.read(ipId, { userId: 'new-owner' })).version).toBe(
        1,
      );
    });
    it('does not expose deleted or missing IPs', async () => {
      await service.save(ipId, owner, input());
      await db.$executeRaw`UPDATE ips SET deleted_at = now() WHERE id = ${ipId}::uuid`;
      await expect(service.read(ipId, owner)).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.save(ipId, owner, input(1))).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.read(randomUUID(), owner)).rejects.toMatchObject({
        status: 404,
      });
    });
    it('rejects malformed input before creating a revision', async () => {
      await expect(
        service.save(ipId, owner, {
          ...input(),
          locations: [
            { ...location, point: { ...location.point, latitude: 91 } },
          ],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await service.read(ipId, owner)).version).toBe(0);
    });
  },
);

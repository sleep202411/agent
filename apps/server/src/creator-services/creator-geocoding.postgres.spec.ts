import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { CreatorLocationsService } from './creator-locations';
import { CreatorGeocodingService } from './creator-geocoding';
const url = process.env.CONTENT_GPS_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'creator city geocoding (isolated PostgreSQL)',
  () => {
    let db: PrismaClient,
      locations: CreatorLocationsService,
      service: CreatorGeocodingService;
    let transport: jest.SpyInstance<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >;
    const owner = { userId: 'studio-owner' };
    const profile = {
      basedIn: { countryCode: 'SG', city: 'Singapore' },
      serves: [],
      remote: true,
      showOnMap: true,
    };
    const keys = [
      'ENABLED',
      'REGION',
      'KEY',
      'RETENTION_SECONDS',
      'DAILY_LIMIT',
      'MAX_IN_FLIGHT',
    ].map((k) => `CREATOR_GPS_GEOCODING_${k}`);
    const saved = new Map(keys.map((k) => [k, process.env[k]]));
    const google = () => ({
      status: 'OK',
      results: [
        {
          formatted_address: 'Singapore',
          place_id: 'sg',
          types: ['locality'],
          address_components: [{ short_name: 'SG', types: ['country'] }],
          geometry: {
            location: { lat: 1.3, lng: 103.8 },
            location_type: 'APPROXIMATE',
          },
        },
      ],
    });
    const resolve = (expectedVersion = 1) =>
      service.resolve(
        owner,
        { expectedVersion, locale: 'en-US' },
        new AbortController().signal,
      );
    beforeAll(async () => {
      const parsed = postgresFixtureUrl(url!);
      if (
        parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55441' ||
        parsed.pathname !== '/gps_test'
      )
        throw new Error('Dedicated GPS fixture required.');
      db = buildPrisma(url);
      for (const migration of [
        '20261001190000_creator_location_profiles',
        '20261001213000_creator_geocodes',
      ]) {
        const sql = readFileSync(
          join(
            __dirname,
            '../../prisma/migrations',
            migration,
            'migration.sql',
          ),
          'utf8',
        );
        for (const statement of sql.split(';').filter((s) => s.trim()))
          await db.$executeRawUnsafe(statement);
      }
      locations = new CreatorLocationsService(db as PrismaService);
      service = new CreatorGeocodingService(db as PrismaService);
    });
    beforeEach(async () => {
      for (const [i, value] of [
        'true',
        'global',
        'fixture-key',
        '3600',
        '10',
        '2',
      ].entries())
        process.env[keys[i]] = value;
      await locations.save(owner, {
        requestId: randomUUID(),
        expectedVersion: 0,
        profile,
      });
      transport = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(Response.json(google())));
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await db.$executeRaw`DELETE FROM creator_location_revisions`;
    });
    afterAll(async () => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (db) {
        await db.$executeRawUnsafe(
          'DROP TABLE IF EXISTS creator_location_geocodes',
        );
        await db.$executeRawUnsafe(
          'DROP TABLE IF EXISTS creator_location_revisions',
        );
        await db.$disconnect();
      }
    });
    it('resolves only the declared city/country, reads without spend, and reuses the completed attempt', async () => {
      expect(await service.read(owner)).toMatchObject({
        version: 1,
        state: 'missing',
        point: null,
      });
      expect(transport).not.toHaveBeenCalled();
      const first = await resolve();
      expect(first).toMatchObject({
        version: 1,
        state: 'resolved',
        point: { precision: 'city', latitude: 1.3 },
      });
      expect(await resolve()).toEqual(first);
      expect(await service.read(owner)).toEqual(first);
      expect(transport).toHaveBeenCalledTimes(1);
      const target = transport.mock.calls[0][0] as URL;
      expect(target.searchParams.get('components')).toBe('country:SG');
    });
    it('does not geocode without saved map consent or with stale version', async () => {
      await locations.save(owner, {
        requestId: randomUUID(),
        expectedVersion: 1,
        profile: { ...profile, showOnMap: false },
      });
      await expect(resolve()).rejects.toMatchObject({ status: 409 });
      await expect(resolve(2)).rejects.toMatchObject({ status: 409 });
      expect(await service.read(owner)).toMatchObject({
        version: 2,
        state: 'ineligible',
        point: null,
      });
      expect(transport).not.toHaveBeenCalled();
    });
    it('revokes old coordinates immediately on opt-out or city revision', async () => {
      await resolve();
      await locations.save(owner, {
        requestId: randomUUID(),
        expectedVersion: 1,
        profile: { ...profile, showOnMap: false },
      });
      expect((await service.read(owner)).point).toBeNull();
      await locations.save(owner, {
        requestId: randomUUID(),
        expectedVersion: 2,
        profile: {
          ...profile,
          basedIn: { countryCode: 'MY', city: 'Johor Bahru' },
        },
      });
      expect(await service.read(owner)).toMatchObject({
        version: 3,
        state: 'missing',
        point: null,
      });
    });
    it('rejects provider completion after consent changes in flight', async () => {
      transport.mockImplementation(async () => {
        await locations.save(owner, {
          requestId: randomUUID(),
          expectedVersion: 1,
          profile: { ...profile, showOnMap: false },
        });
        return Response.json(google());
      });
      await expect(resolve()).rejects.toMatchObject({ status: 409 });
      const [row] = await db.$queryRaw<
        { status: string; result: unknown }[]
      >`SELECT status,result FROM creator_location_geocodes`;
      expect(row).toEqual({ status: 'uncertain', result: null });
      expect((await service.read(owner)).point).toBeNull();
    });
    it('never accepts street-level or wrong-country coordinates', async () => {
      const wrong = google();
      wrong.results[0].address_components[0].short_name = 'US';
      transport.mockResolvedValueOnce(Response.json(wrong));
      expect(await resolve()).toMatchObject({
        state: 'unresolved',
        point: null,
      });
      await locations.save(owner, {
        requestId: randomUUID(),
        expectedVersion: 1,
        profile,
      });
      const street = google();
      street.results[0].types = ['street_address'];
      transport.mockResolvedValueOnce(Response.json(street));
      expect(await resolve(2)).toMatchObject({
        state: 'unresolved',
        point: null,
      });
    });
    it('recovers uncertain provider outcomes without repeating calls and isolates accounts', async () => {
      transport.mockRejectedValue(new Error('lost secret URL'));
      await expect(resolve()).rejects.toThrow('Geocoding request failed');
      expect(await service.read(owner)).toMatchObject({
        state: 'uncertain',
        point: null,
      });
      await expect(resolve()).rejects.toMatchObject({ status: 409 });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(await service.read({ userId: 'other' })).toMatchObject({
        version: 0,
        state: 'ineligible',
        attemptId: null,
      });
    });
    it('expires points and purges payloads while retaining quota receipts', async () => {
      await resolve();
      await db.$executeRaw`UPDATE creator_location_geocodes SET expires_at=now()-interval '1 second'`;
      expect(await service.read(owner)).toMatchObject({
        state: 'expired',
        point: null,
      });
      await service.purgeExpired();
      const [row] = await db.$queryRaw<
        { result: unknown }[]
      >`SELECT result FROM creator_location_geocodes`;
      expect(row.result).toBeNull();
      process.env.CREATOR_GPS_GEOCODING_DAILY_LIMIT = '1';
      await expect(resolve()).rejects.toMatchObject({ status: 503 });
      expect(transport).toHaveBeenCalledTimes(1);
    });
    it('deduplicates concurrent requests before spending provider quota', async () => {
      const results = await Promise.allSettled([resolve(), resolve()]);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      expect(transport).toHaveBeenCalledTimes(1);
    });
    it('fails disabled or incomplete configuration before provider invocation', async () => {
      process.env.CREATOR_GPS_GEOCODING_ENABLED = 'false';
      await expect(resolve()).rejects.toMatchObject({ status: 503 });
      process.env.CREATOR_GPS_GEOCODING_ENABLED = 'true';
      delete process.env.CREATOR_GPS_GEOCODING_RETENTION_SECONDS;
      await expect(resolve()).rejects.toMatchObject({ status: 503 });
      expect(transport).not.toHaveBeenCalled();
    });
  },
);

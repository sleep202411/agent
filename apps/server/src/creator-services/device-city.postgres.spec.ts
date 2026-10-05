import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { DeviceCityService } from './device-city';
import { CreatorLocationsService } from './creator-locations';
const url = process.env.CONTENT_GPS_TEST_DATABASE_URL;
(url ? describe : describe.skip)('device city (isolated PostgreSQL)', () => {
  let db: PrismaClient, service: DeviceCityService;
  let transport: jest.SpyInstance;
  const owner = { userId: `device-city-${randomUUID()}` };
  const other = { userId: `device-city-${randomUUID()}` };
  const keys = [
    'CREATOR_DEVICE_CITY_ENABLED',
    'CREATOR_DEVICE_CITY_DAILY_LIMIT',
    'CREATOR_DEVICE_CITY_MAX_IN_FLIGHT',
    'CREATOR_GPS_GEOCODING_REGION',
    'CREATOR_GPS_GEOCODING_KEY',
  ];
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  const input = () => ({
    requestId: randomUUID(),
    latitude: 1.3521,
    longitude: 103.8198,
    locale: 'en-US' as const,
    consent: true as const,
  });
  const google = () =>
    new Response(
      JSON.stringify({
        status: 'OK',
        results: [
          {
            address_components: [
              {
                long_name: 'Singapore',
                short_name: 'Singapore',
                types: ['locality'],
              },
              { long_name: 'Singapore', short_name: 'SG', types: ['country'] },
            ],
          },
        ],
      }),
    );
  beforeAll(() => {
    const parsed = postgresFixtureUrl(url!);
    if (
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '55441' ||
      parsed.pathname !== '/audit_migrations_20261005'
    )
      throw new Error('Dedicated audit fixture required.');
    db = buildPrisma(url);
    service = new DeviceCityService(db as PrismaService);
  });
  beforeEach(() => {
    ['true', '100000', '100', 'global', 'fixture-key'].forEach(
      (v, i) => (process.env[keys[i]] = v),
    );
    transport = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(google()));
  });
  afterEach(async () => {
    transport.mockRestore();
    await db.$executeRaw`DELETE FROM creator_location_revisions WHERE creator_id IN (${owner.userId},${other.userId})`;
    await db.$executeRaw`DELETE FROM creator_device_city_attempts WHERE creator_id IN (${owner.userId},${other.userId})`;
  });
  afterAll(async () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db?.$disconnect();
  });
  it('requires identity and explicit consent before any provider request', async () => {
    await expect(service.suggest({ userId: '' }, input())).rejects.toThrow(
      'Sign in',
    );
    await expect(
      service.suggest(owner, { ...input(), consent: false as never }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('returns only city, persists no coordinates, and does not change profile or consent', async () => {
    const request = input();
    expect(await service.suggest(owner, request)).toEqual({
      state: 'completed',
      city: { city: 'Singapore', countryCode: 'SG' },
    });
    const rows = await db.$queryRaw<
      unknown[]
    >`SELECT * FROM creator_device_city_attempts WHERE creator_id=${owner.userId}`;
    expect(JSON.stringify(rows)).not.toMatch(
      /latitude|longitude|1\.3521|103\.8198|fixture-key/,
    );
    const profiles = await db.$queryRaw<
      unknown[]
    >`SELECT * FROM creator_location_revisions WHERE creator_id=${owner.userId}`;
    expect(profiles).toEqual([]);
    expect(await service.read(other, request.requestId)).toEqual({
      state: 'missing',
      city: null,
    });
    await service.suggest(owner, request);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('persists only the confirmed city through the existing owner save without map opt-in', async () => {
    const suggestion = await service.suggest(owner, input());
    const locations = new CreatorLocationsService(db as PrismaService);
    await locations.save(owner, {
      requestId: randomUUID(),
      expectedVersion: 0,
      profile: {
        basedIn: suggestion.city,
        serves: [],
        remote: false,
        showOnMap: false,
      },
    });
    const [row] = await db.$queryRaw<
      { profile: unknown }[]
    >`SELECT profile FROM creator_location_revisions WHERE creator_id=${owner.userId}`;
    expect(row.profile).toEqual({
      basedIn: { city: 'Singapore', countryCode: 'SG' },
      serves: [],
      remote: false,
      showOnMap: false,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('concurrent replays claim one provider request and allow read-only recovery', async () => {
    const request = input();
    await Promise.all([
      service.suggest(owner, request),
      service.suggest(owner, request),
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await service.read(owner, request.requestId)).state).toBe(
      'completed',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('sanitizes provider failure and does not repeat an uncertain attempt', async () => {
    transport.mockRejectedValue(
      new Error('secret fixture-key coordinates 1.3521'),
    );
    const request = input();
    await expect(service.suggest(owner, request)).rejects.toThrow(
      'City lookup failed. Check the result',
    );
    expect(await service.suggest(owner, request)).toEqual({
      state: 'uncertain',
      city: null,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('expires city evidence and never re-dispatches an expired request ID', async () => {
    const request = input();
    await service.suggest(owner, request);
    await db.$executeRaw`UPDATE creator_device_city_attempts SET expires_at=now()-interval '1 second' WHERE creator_id=${owner.userId}`;
    await service.purge();
    expect(await service.suggest(owner, request)).toEqual({
      state: 'expired',
      city: null,
    });
    const [row] = await db.$queryRaw<
      { city: unknown }[]
    >`SELECT city FROM creator_device_city_attempts WHERE creator_id=${owner.userId}`;
    expect(row.city).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('enforces a durable per-account hourly limit', async () => {
    for (let i = 0; i < 5; i++) await service.suggest(owner, input());
    await expect(service.suggest(owner, input())).rejects.toThrow(
      'limit reached',
    );
    expect(transport).toHaveBeenCalledTimes(5);
  });
  it('reserves two CN calls before dispatch and rejects insufficient daily budget', async () => {
    process.env.CREATOR_GPS_GEOCODING_REGION = 'cn';
    process.env.CREATOR_DEVICE_CITY_DAILY_LIMIT = '1';
    await expect(service.suggest(owner, input())).rejects.toThrow(
      'limit reached',
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it('fails closed when disabled or configuration is absent', async () => {
    process.env.CREATOR_DEVICE_CITY_ENABLED = 'false';
    await expect(service.suggest(owner, input())).rejects.toThrow(
      'not enabled',
    );
    process.env.CREATOR_DEVICE_CITY_ENABLED = 'true';
    delete process.env.CREATOR_DEVICE_CITY_DAILY_LIMIT;
    expect(() => service.onModuleInit()).toThrow('explicit quotas');
    expect(transport).not.toHaveBeenCalled();
  });
});

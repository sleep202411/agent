import { ContentGpsGeocodingService } from './content-gps-geocoding';
import { ContentGpsDispatchService } from './content-gps-dispatch';
import type { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentGpsSourceSnapshotSql } from './content-gps-source-sql';
import { Prisma, PrismaClient } from '@prisma/client';
import { ContentGpsMetadataSchema } from '@repo/shared/content-gps';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import {
  ContentGpsSourcesService,
  gpsSnapshotFingerprint,
} from './content-gps-sources';
import { ContentGpsAnalysisService } from './content-gps-analysis';
import { ContentGpsLocationsService } from './content-gps-locations';

const databaseUrl = process.env.CONTENT_GPS_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  'GPS analysis lifecycle (isolated PostgreSQL)',
  () => {
    let db: PrismaClient;
    let sources: ContentGpsSourcesService;
    let service: ContentGpsAnalysisService;
    let owner: ContentGpsLocationsService;
    const dispatchEnv = [
      'CONTENT_GPS_GEOCODING_ENABLED',
      'CONTENT_GPS_GEOCODING_REGION',
      'CONTENT_GPS_GEOCODING_KEY',
      'CONTENT_GPS_GEOCODING_RETENTION_SECONDS',
      'CONTENT_GPS_GEOCODING_DAILY_LIMIT',
      'CONTENT_GPS_GEOCODING_MAX_IN_FLIGHT',
      'CONTENT_GPS_ANALYSIS_ENABLED',
      'CONTENT_GPS_ANALYSIS_VERSION',
      'CONTENT_GPS_ANALYSIS_DAILY_LIMIT',
      'CONTENT_GPS_ANALYSIS_MAX_IN_FLIGHT',
    ] as const;
    const savedEnv = Object.fromEntries(
      dispatchEnv.map((key) => [key, process.env[key]]),
    );
    let ipId: string;
    let textId: string;
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '55441' ||
        url.pathname !== '/gps_test'
      )
        throw new Error('Dedicated loopback GPS database required.');
      db = buildPrisma(databaseUrl);
      const schema = `
      CREATE TYPE "IpPublicationStatus" AS ENUM ('published','draft');
      CREATE TYPE "IpListingVisibility" AS ENUM ('public','private');
      CREATE TYPE "IpLocalizationStatus" AS ENUM ('published','draft');
      CREATE TABLE ips (id uuid PRIMARY KEY, created_by_id varchar(64) NOT NULL, deleted_at timestamptz,
        status "IpPublicationStatus" NOT NULL DEFAULT 'published', listing_visibility "IpListingVisibility" NOT NULL DEFAULT 'public');
      CREATE TABLE ip_localizations (id uuid PRIMARY KEY, ip_id uuid REFERENCES ips(id) ON DELETE CASCADE,
        locale varchar(16), status "IpLocalizationStatus" DEFAULT 'published', archived_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(), summary text, description text);
      CREATE TABLE ip_episodes (id uuid PRIMARY KEY, ip_id uuid REFERENCES ips(id) ON DELETE CASCADE,
        status "IpPublicationStatus" DEFAULT 'published', deleted_at timestamptz);
      CREATE TABLE ip_episode_localizations (id uuid PRIMARY KEY, episode_id uuid REFERENCES ip_episodes(id) ON DELETE CASCADE,
        locale varchar(16), status "IpLocalizationStatus" DEFAULT 'published', archived_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(), summary text, description text);
    `;
      for (const statement of schema.split(';').filter((s) => s.trim()))
        await db.$executeRawUnsafe(statement);
      for (const name of [
        '20261001173000_content_gps_owner_locations',
        '20261001174500_content_gps_analysis',
        '20261001183000_content_gps_dispatch',
        '20261001193000_content_gps_source_snapshot',
        '20261001210000_content_gps_geocodes',
      ]) {
        const sql = readFileSync(
          join(__dirname, '../../prisma/migrations', name, 'migration.sql'),
          'utf8',
        );
        for (const statement of sql.split(';').filter((s) => s.trim()))
          await db.$executeRawUnsafe(statement);
      }
      sources = new ContentGpsSourcesService(db as PrismaService);
      service = new ContentGpsAnalysisService(db as PrismaService, sources);
      owner = new ContentGpsLocationsService(db as PrismaService);
    });
    beforeEach(async () => {
      process.env.CONTENT_GPS_GEOCODING_ENABLED = 'false';
      process.env.CONTENT_GPS_ANALYSIS_ENABLED = 'true';
      process.env.CONTENT_GPS_ANALYSIS_VERSION = 'v1';
      process.env.CONTENT_GPS_ANALYSIS_DAILY_LIMIT = '10';
      process.env.CONTENT_GPS_ANALYSIS_MAX_IN_FLIGHT = '2';
      ipId = randomUUID();
      textId = randomUUID();
      await db.$executeRaw`INSERT INTO ips (id, created_by_id) VALUES (${ipId}::uuid, 'owner')`;
      await db.$executeRaw`INSERT INTO ip_localizations (id, ip_id, locale, summary) VALUES (${textId}::uuid, ${ipId}::uuid, 'en-US', 'Singapore')`;
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await db.$executeRaw`DELETE FROM ips WHERE id = ${ipId}::uuid`;
    });
    afterAll(async () => {
      for (const key of dispatchEnv) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      if (!db) return;
      for (const name of [
        'ip_content_gps_analysis_requests',
        'ip_content_gps_dispatches',
        'ip_content_gps_geocodes',
        'ip_content_gps_analyses',
        'ip_content_gps_location_revisions',
        'ip_episode_localizations',
        'ip_episodes',
        'ip_localizations',
        'ips',
      ])
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${name}`);
      for (const name of [
        'IpPublicationStatus',
        'IpListingVisibility',
        'IpLocalizationStatus',
      ])
        await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "${name}"`);
      await db.$disconnect();
    });
    async function candidate(version = 'v1') {
      const snapshot = await sources.snapshot(ipId, 'en-US', version);
      const source = snapshot.sources[0];
      const metadata = ContentGpsMetadataSchema.parse({
        schemaVersion: 1,
        ipId,
        sourceFingerprint: gpsSnapshotFingerprint(snapshot),
        analysisVersion: version,
        analyzedAt: snapshot.analyzedAt,
        locationCoverage: 'identified',
        locations: [
          {
            id: 'location:0',
            kind: 'story_setting',
            label: 'Singapore',
            status: 'unresolved',
            point: null,
            evidenceIds: ['e1'],
          },
        ],
        eras: [],
        evidence: [
          {
            id: 'e1',
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            sourceVersion: source.sourceVersion,
            locator: `${source.id}:utf16:0:9`,
            visibilityAtAnalysis: 'public',
          },
        ],
        review: { status: 'unreviewed' },
      });
      return { snapshot, metadata };
    }
    it('projects owner-only current suggestions with host-derived public quotes and preserves corrections', async () => {
      const { snapshot, metadata } = await candidate();
      await service.save(snapshot, metadata);
      await owner.save(
        ipId,
        { userId: 'owner' },
        { requestId: randomUUID(), expectedVersion: 0, locations: [] },
      );
      const result = await service.suggestions(ipId, 'en-US', {
        userId: 'owner',
      });
      expect(result).toMatchObject({
        state: 'ready',
        ownerVersion: 1,
        locations: [
          {
            label: 'Singapore',
            point: null,
            evidence: [
              {
                sourceType: 'ip_localization',
                field: 'summary',
                quote: 'Singapore',
              },
            ],
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain('sourceFingerprint');
      expect((await owner.read(ipId, { userId: 'owner' })).locations).toEqual(
        [],
      );
      await expect(
        service.suggestions(ipId, 'en-US', { userId: 'other' }),
      ).rejects.toMatchObject({ status: 404 });
    });
    it('hides stale and withdrawn source suggestions without falling back to another locale', async () => {
      const { snapshot, metadata } = await candidate();
      await service.save(snapshot, metadata);
      expect(
        (await service.suggestions(ipId, 'zh-CN', { userId: 'owner' })).state,
      ).toBe('ineligible');
      await db.$executeRaw`UPDATE ip_localizations SET summary = 'Changed story', updated_at = now() WHERE id = ${textId}::uuid`;
      expect(
        await service.suggestions(ipId, 'en-US', { userId: 'owner' }),
      ).toMatchObject({ state: 'missing', locations: [] });
      await db.$executeRaw`UPDATE ips SET listing_visibility = 'private' WHERE id = ${ipId}::uuid`;
      expect(
        await service.suggestions(ipId, 'en-US', { userId: 'owner' }),
      ).toMatchObject({ state: 'ineligible', locations: [] });
    });
    it('reports disabled configuration without making analysis calls and still checks ownership', async () => {
      delete process.env.CONTENT_GPS_ANALYSIS_VERSION;
      expect(
        (await service.suggestions(ipId, 'en-US', { userId: 'owner' })).state,
      ).toBe('unconfigured');
      await expect(
        service.suggestions(ipId, 'en-US', { userId: 'other' }),
      ).rejects.toMatchObject({ status: 404 });
    });
    async function sqlSnapshot() {
      const [row] = await db.$queryRaw<{ sources: unknown }[]>(Prisma.sql`
        SELECT ${contentGpsSourceSnapshotSql('en-US')} AS sources FROM ips ip WHERE ip.id = ${ipId}::uuid`);
      return row.sources;
    }
    it('matches the host snapshot exactly across Unicode whitespace, field order and episode sources', async () => {
      const episode = randomUUID();
      await db.$executeRaw`UPDATE ip_localizations SET summary = ${'  Singapore 😀\n'}, description = ${'\t\ufeff\u00a0'}, updated_at = '2026-10-01T01:02:03.123456Z' WHERE id = ${textId}::uuid`;
      await db.$executeRaw`INSERT INTO ip_episodes(id, ip_id) VALUES (${episode}::uuid, ${ipId}::uuid)`;
      await db.$executeRaw`INSERT INTO ip_episode_localizations(id, episode_id, locale, summary, description) VALUES (${randomUUID()}::uuid, ${episode}::uuid, 'en-US', 'An episode', '1980–2000')`;
      const snapshot = await sources.snapshot(ipId, 'en-US', 'v1');
      expect(await sqlSnapshot()).toEqual(snapshot.sources);
      expect(snapshot.sources).toHaveLength(3);
    });
    it('invalidates SQL freshness on added, changed or withdrawn public episode text', async () => {
      const { snapshot, metadata } = await candidate();
      await service.save(snapshot, metadata);
      const fresh = async () => {
        const [row] = await db.$queryRaw<{ fresh: boolean }[]>(Prisma.sql`
          SELECT a.source_snapshot = ${contentGpsSourceSnapshotSql('en-US')} AS fresh
          FROM ips ip JOIN ip_content_gps_analyses a ON a.ip_id = ip.id WHERE ip.id = ${ipId}::uuid`);
        return row.fresh;
      };
      expect(await fresh()).toBe(true);
      const episode = randomUUID(),
        localization = randomUUID();
      await db.$executeRaw`INSERT INTO ip_episodes(id, ip_id) VALUES (${episode}::uuid, ${ipId}::uuid)`;
      await db.$executeRaw`INSERT INTO ip_episode_localizations(id, episode_id, locale, summary, status) VALUES (${localization}::uuid, ${episode}::uuid, 'en-US', 'Different place', 'draft')`;
      expect(await fresh()).toBe(true);
      await db.$executeRaw`UPDATE ip_episode_localizations SET status = 'published' WHERE id = ${localization}::uuid`;
      expect(await fresh()).toBe(false);
      await db.$executeRaw`UPDATE ip_episodes SET deleted_at = now() WHERE id = ${episode}::uuid`;
      expect(await fresh()).toBe(true);
      await db.$executeRaw`UPDATE ip_localizations SET description = 'Additional source' WHERE id = ${textId}::uuid`;
      expect(await fresh()).toBe(false);
    });
    it('stores source-addressed suggestions and returns the first result on replay', async () => {
      const { snapshot, metadata } = await candidate();
      expect(await service.save(snapshot, metadata)).toEqual(metadata);
      const another = {
        ...metadata,
        locations: metadata.locations.map((l) => ({
          ...l,
          label: 'Singapore city',
        })),
      };
      expect(await service.save(snapshot, another)).toEqual(metadata);
      expect((await service.current(ipId, 'en-US', 'v1')).analysis).toEqual(
        metadata,
      );
      expect((await service.current(ipId, 'en-US', 'v2')).analysis).toBeNull();
    });
    it('converges concurrent receipts without duplicate records or a second model call', async () => {
      const { snapshot, metadata } = await candidate();
      const receipts = await Promise.all(
        Array.from({ length: 5 }, () => service.save(snapshot, metadata)),
      );
      expect(
        receipts.every(
          (receipt) => JSON.stringify(receipt) === JSON.stringify(metadata),
        ),
      ).toBe(true);
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM ip_content_gps_analyses WHERE ip_id = ${ipId}::uuid`;
      expect(row.count).toBe(1n);
    });
    it('rejects obsolete output and never serves prior-source analysis after a text edit', async () => {
      const { snapshot, metadata } = await candidate();
      await service.save(snapshot, metadata);
      await db.$executeRaw`UPDATE ip_localizations SET summary = 'A new story' WHERE id = ${textId}::uuid`;
      await expect(service.save(snapshot, metadata)).rejects.toMatchObject({
        status: 409,
      });
      expect((await service.current(ipId, 'en-US', 'v1')).analysis).toBeNull();
    });
    it.each([
      'private',
      'draft',
      'deleted',
      'archived',
      'unpublished translation',
    ])('rechecks %s source withdrawal on save and read', async (mode) => {
      const { snapshot, metadata } = await candidate();
      await service.save(snapshot, metadata);
      if (mode === 'private')
        await db.$executeRaw`UPDATE ips SET listing_visibility = 'private' WHERE id = ${ipId}::uuid`;
      if (mode === 'draft')
        await db.$executeRaw`UPDATE ips SET status = 'draft' WHERE id = ${ipId}::uuid`;
      if (mode === 'deleted')
        await db.$executeRaw`UPDATE ips SET deleted_at = now() WHERE id = ${ipId}::uuid`;
      if (mode === 'archived')
        await db.$executeRaw`UPDATE ip_localizations SET archived_at = now() WHERE id = ${textId}::uuid`;
      if (mode === 'unpublished translation')
        await db.$executeRaw`UPDATE ip_localizations SET status = 'draft' WHERE id = ${textId}::uuid`;
      await expect(service.save(snapshot, metadata)).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.current(ipId, 'en-US', 'v1')).rejects.toMatchObject({
        status: 404,
      });
    });
    it('preserves owner corrections including explicit clearing across reanalysis', async () => {
      const { snapshot, metadata } = await candidate();
      await service.save(snapshot, metadata);
      await owner.save(
        ipId,
        { userId: 'owner' },
        { requestId: randomUUID(), expectedVersion: 0, locations: [] },
      );
      const next = await candidate('v2');
      await service.save(next.snapshot, next.metadata);
      expect(await service.current(ipId, 'en-US', 'v2')).toMatchObject({
        analysis: next.metadata,
        locations: [],
        locationSource: 'owner',
        ownerVersion: 1,
      });
    });
    it('rejects invented host identity and invalid or restricted evidence', async () => {
      const { snapshot, metadata } = await candidate();
      for (const changed of [
        { ...metadata, ipId: randomUUID() },
        { ...metadata, sourceFingerprint: '0'.repeat(64) },
        {
          ...metadata,
          evidence: metadata.evidence.map((e) => ({
            ...e,
            locator: 'invented:utf16:0:9',
          })),
        },
        {
          ...metadata,
          evidence: metadata.evidence.map((e) => ({
            ...e,
            visibilityAtAnalysis: 'restricted' as const,
          })),
        },
      ])
        await expect(service.save(snapshot, changed)).rejects.toMatchObject({
          status: 400,
        });
      expect((await service.current(ipId, 'en-US', 'v1')).analysis).toBeNull();
    });
    function dispatcher(invoke: jest.Mock) {
      return new ContentGpsDispatchService(
        db as PrismaService,
        sources,
        service,
        owner,
        { get: () => ({ extractContentGps: invoke }) } as unknown as ModuleRef,
        new ContentGpsGeocodingService(db as PrismaService, sources),
      );
    }
    it('dispatches once and recovers stored analysis on an identical retry', async () => {
      const sample = await candidate();
      const invoke = jest
        .fn()
        .mockImplementation((snapshot: typeof sample.snapshot) =>
          Promise.resolve({
            ...sample.metadata,
            analyzedAt: snapshot.analyzedAt,
          }),
        );
      const dispatch = dispatcher(invoke);
      const input = { requestId: randomUUID(), locale: 'en-US' as const };
      const result = await dispatch.run(
        ipId,
        { userId: 'owner' },
        input,
        new AbortController().signal,
      );
      expect(result.analysis?.locations[0].label).toBe('Singapore');
      await dispatch.run(
        ipId,
        { userId: 'owner' },
        input,
        new AbortController().signal,
      );
      expect(invoke).toHaveBeenCalledTimes(1);
      process.env.CONTENT_GPS_ANALYSIS_ENABLED = 'false';
      expect(
        await dispatch.receipt(ipId, { userId: 'owner' }, input.requestId),
      ).toMatchObject({ status: 'succeeded' });
      await expect(
        dispatch.receipt(ipId, { userId: 'outsider' }, input.requestId),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        dispatch.receipt(ipId, { userId: 'owner' }, randomUUID()),
      ).rejects.toMatchObject({ status: 404 });
      const [row] = await db.$queryRaw<
        { status: string }[]
      >`SELECT status FROM ip_content_gps_dispatches WHERE ip_id = ${ipId}::uuid`;
      expect(row.status).toBe('succeeded');
    });
    it('fences concurrent requests for the same snapshot and never resends uncertain work', async () => {
      let rejectCall!: (error: Error) => void;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const invoke = jest.fn(
        () =>
          new Promise<never>((_, reject) => {
            rejectCall = reject;
            started();
          }),
      );
      const dispatch = dispatcher(invoke);
      const firstInput = { requestId: randomUUID(), locale: 'en-US' as const };
      const first = dispatch.run(
        ipId,
        { userId: 'owner' },
        firstInput,
        new AbortController().signal,
      );
      const failure = expect(first).rejects.toThrow('lost reply');
      await ready;
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          { ...firstInput, requestId: randomUUID() },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 409 });
      rejectCall(new Error('lost reply'));
      await failure;
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          firstInput,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(invoke).toHaveBeenCalledTimes(1);
    });
    it('enforces ownership, explicit enablement and budget before any model call', async () => {
      const invoke = jest.fn();
      const dispatch = dispatcher(invoke);
      const input = { requestId: randomUUID(), locale: 'en-US' as const };
      await expect(
        dispatch.run(
          ipId,
          { userId: 'outsider' },
          input,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 404 });
      process.env.CONTENT_GPS_ANALYSIS_ENABLED = 'false';
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          input,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 503 });
      process.env.CONTENT_GPS_GEOCODING_ENABLED = 'false';
      process.env.CONTENT_GPS_ANALYSIS_ENABLED = 'true';
      delete process.env.CONTENT_GPS_ANALYSIS_DAILY_LIMIT;
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          input,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(invoke).not.toHaveBeenCalled();
    });
    it('does not turn a changed-source retry into another paid request', async () => {
      const invoke = jest.fn().mockRejectedValue(new Error('lost reply'));
      const dispatch = dispatcher(invoke);
      const input = { requestId: randomUUID(), locale: 'en-US' as const };
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          input,
          new AbortController().signal,
        ),
      ).rejects.toThrow('lost reply');
      await db.$executeRaw`UPDATE ip_localizations SET summary = 'Changed public story' WHERE id = ${textId}::uuid`;
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          input,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(invoke).toHaveBeenCalledTimes(1);
    });
    it('enforces the daily quota before reserving a changed-source request', async () => {
      process.env.CONTENT_GPS_ANALYSIS_DAILY_LIMIT = '1';
      const invoke = jest.fn().mockRejectedValue(new Error('lost reply'));
      const dispatch = dispatcher(invoke);
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          { requestId: randomUUID(), locale: 'en-US' },
          new AbortController().signal,
        ),
      ).rejects.toThrow('lost reply');
      await db.$executeRaw`UPDATE ip_localizations SET summary = 'Changed source' WHERE id = ${textId}::uuid`;
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          { requestId: randomUUID(), locale: 'en-US' },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(invoke).toHaveBeenCalledTimes(1);
    });
    it('counts an in-flight request against other source dispatches', async () => {
      process.env.CONTENT_GPS_ANALYSIS_MAX_IN_FLIGHT = '1';
      let started!: () => void;
      let rejectCall!: (error: Error) => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const invoke = jest.fn(
        () =>
          new Promise<never>((_, reject) => {
            rejectCall = reject;
            started();
          }),
      );
      const dispatch = dispatcher(invoke);
      const first = dispatch.run(
        ipId,
        { userId: 'owner' },
        { requestId: randomUUID(), locale: 'en-US' },
        new AbortController().signal,
      );
      const failed = expect(first).rejects.toThrow('lost reply');
      await ready;
      await db.$executeRaw`UPDATE ip_localizations SET summary = 'Changed source' WHERE id = ${textId}::uuid`;
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          { requestId: randomUUID(), locale: 'en-US' },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 503 });
      rejectCall(new Error('lost reply'));
      await failed;
      expect(invoke).toHaveBeenCalledTimes(1);
    });
    it('rejects a cancelled request before reservation', async () => {
      const invoke = jest.fn();
      const controller = new AbortController();
      controller.abort();
      await expect(
        dispatcher(invoke).run(
          ipId,
          { userId: 'owner' },
          { requestId: randomUUID(), locale: 'en-US' },
          controller.signal,
        ),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM ip_content_gps_dispatches WHERE ip_id = ${ipId}::uuid`;
      expect(row.count).toBe(0n);
    });
    it('binds cached requests so a later source edit cannot turn their retry into a paid call', async () => {
      const { snapshot, metadata } = await candidate();
      await service.save(snapshot, metadata);
      const invoke = jest.fn();
      const dispatch = dispatcher(invoke);
      const input = { requestId: randomUUID(), locale: 'en-US' as const };
      await dispatch.run(
        ipId,
        { userId: 'owner' },
        input,
        new AbortController().signal,
      );
      expect(
        await dispatch.receipt(ipId, { userId: 'owner' }, input.requestId),
      ).toMatchObject({ status: 'cached' });
      await db.$executeRaw`UPDATE ip_localizations SET summary = 'Edited after cache hit' WHERE id = ${textId}::uuid`;
      await expect(
        dispatch.run(
          ipId,
          { userId: 'owner' },
          input,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(invoke).not.toHaveBeenCalled();
    });

    describe('persisted provider enrichment', () => {
      let geocoding: ContentGpsGeocodingService;
      let transport: jest.SpyInstance<
        ReturnType<typeof fetch>,
        Parameters<typeof fetch>
      >;
      const google = () => ({
        status: 'OK',
        results: [
          {
            formatted_address: 'Singapore',
            place_id: 'sg',
            types: ['locality'],
            geometry: {
              location: { lat: 1.3, lng: 103.8 },
              location_type: 'APPROXIMATE',
            },
          },
        ],
      });
      const enrich = () =>
        geocoding.enrich(
          ipId,
          'en-US',
          'v1',
          { userId: 'owner' },
          new AbortController().signal,
        );
      beforeEach(async () => {
        process.env.CONTENT_GPS_GEOCODING_ENABLED = 'true';
        process.env.CONTENT_GPS_GEOCODING_REGION = 'global';
        process.env.CONTENT_GPS_GEOCODING_KEY = 'fixture-key';
        process.env.CONTENT_GPS_GEOCODING_RETENTION_SECONDS = '3600';
        process.env.CONTENT_GPS_GEOCODING_DAILY_LIMIT = '10';
        process.env.CONTENT_GPS_GEOCODING_MAX_IN_FLIGHT = '2';
        geocoding = new ContentGpsGeocodingService(
          db as PrismaService,
          sources,
        );
        const { snapshot, metadata } = await candidate();
        await service.save(snapshot, metadata);
        transport = jest
          .spyOn(globalThis, 'fetch')
          .mockImplementation(() => Promise.resolve(Response.json(google())));
      });
      it('persists verified points, reuses fresh results and leaves immutable model metadata untouched', async () => {
        await enrich();
        await enrich();
        expect(transport).toHaveBeenCalledTimes(1);
        expect(
          (await service.current(ipId, 'en-US', 'v1')).locations[0],
        ).toMatchObject({
          status: 'resolved',
          point: {
            latitude: 1.3,
            coordinateSystem: 'WGS84',
            provider: 'google',
          },
        });
        expect(
          (await service.suggestions(ipId, 'en-US', { userId: 'owner' }))
            .locations[0].point?.longitude,
        ).toBe(103.8);
        const [raw] = await db.$queryRaw<
          { metadata: { locations: { point: unknown }[] } }[]
        >`SELECT metadata FROM ip_content_gps_analyses WHERE ip_id=${ipId}::uuid`;
        expect(raw.metadata.locations[0].point).toBeNull();
      });
      it('keeps explicit owner clearing authoritative over geocoded suggestions', async () => {
        await owner.save(
          ipId,
          { userId: 'owner' },
          { requestId: randomUUID(), expectedVersion: 0, locations: [] },
        );
        await enrich();
        expect((await service.current(ipId, 'en-US', 'v1')).locations).toEqual(
          [],
        );
        expect(
          (await service.suggestions(ipId, 'en-US', { userId: 'owner' }))
            .locations[0].status,
        ).toBe('resolved');
      });
      it('never chooses one of multiple candidates or pins a partial match', async () => {
        const raw = google();
        raw.results.push({ ...raw.results[0], place_id: 'other' });
        transport.mockResolvedValue(Response.json(raw));
        await enrich();
        expect(
          (await service.current(ipId, 'en-US', 'v1')).locations[0],
        ).toMatchObject({ status: 'ambiguous', point: null });
      });
      it('expires read projections and removes provider payloads while retaining the attempt receipt', async () => {
        await enrich();
        await db.$executeRaw`UPDATE ip_content_gps_geocodes SET expires_at=now()-interval '1 second' WHERE ip_id=${ipId}::uuid`;
        expect(
          (await service.current(ipId, 'en-US', 'v1')).locations[0].point,
        ).toBeNull();
        await geocoding.purgeExpired();
        const rows = await db.$queryRaw<
          { result: unknown; status: string }[]
        >`SELECT result,status FROM ip_content_gps_geocodes WHERE ip_id=${ipId}::uuid`;
        expect(rows).toEqual([{ result: null, status: 'completed' }]);
        await enrich();
        expect(transport).toHaveBeenCalledTimes(2);
      });
      it('records uncertain provider failure without automatic retry or duplicate spend', async () => {
        transport.mockRejectedValue(new Error('network containing secret'));
        await expect(enrich()).rejects.toThrow('Geocoding request failed');
        await expect(enrich()).rejects.toMatchObject({ status: 409 });
        expect(transport).toHaveBeenCalledTimes(1);
        const [row] = await db.$queryRaw<
          { status: string; result: unknown }[]
        >`SELECT status,result FROM ip_content_gps_geocodes WHERE ip_id=${ipId}::uuid`;
        expect(row).toEqual({ status: 'uncertain', result: null });
      });
      it('rejects changed public sources before persisting a provider result', async () => {
        transport.mockImplementation(async () => {
          await db.$executeRaw`UPDATE ip_localizations SET summary='Changed source' WHERE id=${textId}::uuid`;
          return Response.json(google());
        });
        await expect(enrich()).rejects.toMatchObject({ status: 409 });
        expect(
          (await service.current(ipId, 'en-US', 'v1')).analysis,
        ).toBeNull();
        const [row] = await db.$queryRaw<
          { result: unknown }[]
        >`SELECT result FROM ip_content_gps_geocodes WHERE ip_id=${ipId}::uuid`;
        expect(row.result).toBeNull();
      });
      it('enforces quota before expired-result refresh and validates explicit configuration', async () => {
        process.env.CONTENT_GPS_GEOCODING_DAILY_LIMIT = '1';
        await enrich();
        await db.$executeRaw`UPDATE ip_content_gps_geocodes SET expires_at=now()-interval '1 second' WHERE ip_id=${ipId}::uuid`;
        await expect(enrich()).rejects.toMatchObject({ status: 503 });
        expect(transport).toHaveBeenCalledTimes(1);
        delete process.env.CONTENT_GPS_GEOCODING_RETENTION_SECONDS;
        await expect(enrich()).rejects.toMatchObject({ status: 503 });
        expect(transport).toHaveBeenCalledTimes(1);
      });
      it('does not make provider requests when disabled or called by a non-owner', async () => {
        process.env.CONTENT_GPS_GEOCODING_ENABLED = 'false';
        await enrich();
        process.env.CONTENT_GPS_GEOCODING_ENABLED = 'true';
        await expect(
          geocoding.enrich(
            ipId,
            'en-US',
            'v1',
            { userId: 'other' },
            new AbortController().signal,
          ),
        ).rejects.toMatchObject({ status: 404 });
        expect(transport).not.toHaveBeenCalled();
      });
      it('deduplicates concurrent callers before provider invocation', async () => {
        const results = await Promise.allSettled([enrich(), enrich()]);
        expect(results.some((row) => row.status === 'fulfilled')).toBe(true);
        expect(transport).toHaveBeenCalledTimes(1);
      });

      it('keeps model-declared ambiguous and fictional locations unpinned without provider spend', async () => {
        await db.$executeRaw`UPDATE ip_content_gps_analyses SET metadata=jsonb_set(metadata,'{locations,0,status}','"ambiguous"'::jsonb) WHERE ip_id=${ipId}::uuid`;
        await enrich();
        expect(transport).not.toHaveBeenCalled();
        expect(
          (await service.current(ipId, 'en-US', 'v1')).locations[0].status,
        ).toBe('ambiguous');
        await db.$executeRaw`UPDATE ip_content_gps_analyses SET metadata=jsonb_set(metadata,'{locations,0,status}','"fictional"'::jsonb) WHERE ip_id=${ipId}::uuid`;
        await enrich();
        expect(transport).not.toHaveBeenCalled();
      });
      it('preserves Gaode GCJ02 coordinates on the CN path', async () => {
        process.env.CONTENT_GPS_GEOCODING_REGION = 'cn';
        transport.mockResolvedValue(
          Response.json({
            status: '1',
            count: '1',
            geocodes: [
              {
                formatted_address: '上海市',
                location: '121.47,31.23',
                level: '市',
              },
            ],
          }),
        );
        await enrich();
        const target = transport.mock.calls[0][0];
        expect(target).toBeInstanceOf(URL);
        expect((target as URL).hostname).toBe('restapi.amap.com');
        expect(
          (await service.current(ipId, 'en-US', 'v1')).locations[0],
        ).toMatchObject({
          status: 'resolved',
          point: {
            coordinateSystem: 'GCJ02',
            latitude: 31.23,
            longitude: 121.47,
          },
        });
      });
      it('connects explicit analysis dispatch to provider enrichment without invoking the model for cached analysis', async () => {
        const invoke = jest.fn();
        await dispatcher(invoke).run(
          ipId,
          { userId: 'owner' },
          { requestId: randomUUID(), locale: 'en-US' },
          new AbortController().signal,
        );
        expect(invoke).not.toHaveBeenCalled();
        expect(transport).toHaveBeenCalledTimes(1);
        expect(
          (await service.current(ipId, 'en-US', 'v1')).locations[0].status,
        ).toBe('resolved');
      });
    });
  },
);

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ContentGpsSearchRequestSchema } from '@repo/shared/content-gps';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { IpCommerceService } from './ip-commerce.service';
import { ContentGpsSearchService } from './content-gps-search';
import { ContentGpsLocationsService } from './content-gps-locations';
import {
  ContentGpsSourcesService,
  gpsSnapshotFingerprint,
} from './content-gps-sources';
import { ContentGpsAnalysisService } from './content-gps-analysis';

const url = process.env.CONTENT_GPS_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'GPS catalogue search (isolated PostgreSQL)',
  () => {
    let db: PrismaClient;
    let search: ContentGpsSearchService;
    let owner: ContentGpsLocationsService;
    let sources: ContentGpsSourcesService;
    let analysis: ContentGpsAnalysisService;
    const previousVersion = process.env.CONTENT_GPS_ANALYSIS_VERSION;
    const schema = `
    CREATE TYPE "IpPublicationStatus" AS ENUM ('published','draft');
    CREATE TYPE "IpLocalizationStatus" AS ENUM ('published','draft');
    CREATE TYPE "IpListingVisibility" AS ENUM ('public','private');
    CREATE TYPE "IpUserBlockTargetType" AS ENUM ('ip','creator');
    CREATE TABLE media_assets (id uuid PRIMARY KEY, storage_provider text, bucket text, region text, object_key text,
      external_url text, status text DEFAULT 'ready', moderation_status text DEFAULT 'approved', deleted_at timestamptz);
    CREATE TABLE ips (id uuid PRIMARY KEY, created_by_id text NOT NULL, deleted_at timestamptz,
      room_number varchar(19) DEFAULT '10001', cover_asset_id uuid,
      channel_type text DEFAULT 'ip', status "IpPublicationStatus" DEFAULT 'published', listing_visibility "IpListingVisibility" DEFAULT 'public');
    CREATE TABLE ip_localizations (id uuid PRIMARY KEY, ip_id uuid REFERENCES ips(id) ON DELETE CASCADE, locale text,
      title text, summary text, description text, cover_asset_id uuid, updated_at timestamptz DEFAULT now(), status "IpLocalizationStatus" DEFAULT 'published', archived_at timestamptz);
    CREATE TABLE ip_episodes (id uuid PRIMARY KEY, ip_id uuid REFERENCES ips(id) ON DELETE CASCADE, duration_seconds int,
      status "IpPublicationStatus" DEFAULT 'published', deleted_at timestamptz);
    CREATE TABLE ip_episode_localizations (id uuid PRIMARY KEY, episode_id uuid REFERENCES ip_episodes(id) ON DELETE CASCADE, locale text,
      summary text, description text, updated_at timestamptz DEFAULT now(), status "IpLocalizationStatus" DEFAULT 'published', archived_at timestamptz);
    CREATE TABLE ip_user_content_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, target_type "IpUserBlockTargetType", target_id text, unblocked_at timestamptz);
    CREATE TABLE ip_taxonomy_terms (id uuid PRIMARY KEY, type text, code text, status text DEFAULT 'active', archived_at timestamptz);
    CREATE TABLE ip_taxonomy_assignments (ip_id uuid REFERENCES ips(id) ON DELETE CASCADE, term_id uuid REFERENCES ip_taxonomy_terms(id));
  `;
    beforeAll(async () => {
      const parsed = postgresFixtureUrl(url!);
      if (
        !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
        parsed.port !== '55441' ||
        parsed.pathname !== '/gps_test'
      )
        throw new Error('Dedicated GPS fixture required.');
      db = buildPrisma(url);
      for (const sql of schema.split(';').filter((s) => s.trim()))
        await db.$executeRawUnsafe(sql);
      for (const migration of [
        '20261001173000_content_gps_owner_locations',
        '20261001174500_content_gps_analysis',
        '20261001193000_content_gps_source_snapshot',
        '20261001210000_content_gps_geocodes',
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
      const catalogue = Object.assign(
        Object.create(IpCommerceService.prototype),
        { prisma: db },
      ) as IpCommerceService;
      search = new ContentGpsSearchService(db as PrismaService, catalogue);
      owner = new ContentGpsLocationsService(db as PrismaService);
      sources = new ContentGpsSourcesService(db as PrismaService);
      analysis = new ContentGpsAnalysisService(db as PrismaService, sources);
    });
    beforeEach(() => {
      process.env.CONTENT_GPS_ANALYSIS_VERSION = 'v1';
    });
    afterEach(async () => {
      await db.$executeRaw`DELETE FROM ips`;
      await db.$executeRaw`DELETE FROM media_assets`;
      await db.$executeRaw`DELETE FROM ip_taxonomy_terms`;
      await db.$executeRaw`DELETE FROM ip_user_content_blocks`;
    });
    afterAll(async () => {
      if (previousVersion === undefined)
        delete process.env.CONTENT_GPS_ANALYSIS_VERSION;
      else process.env.CONTENT_GPS_ANALYSIS_VERSION = previousVersion;
      if (!db) return;
      for (const table of [
        'ip_content_gps_geocodes',
        'ip_content_gps_analyses',
        'ip_content_gps_location_revisions',
        'ip_taxonomy_assignments',
        'ip_taxonomy_terms',
        'ip_user_content_blocks',
        'ip_episode_localizations',
        'ip_episodes',
        'ip_localizations',
        'ips',
        'media_assets',
      ])
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table}`);
      for (const type of [
        'IpPublicationStatus',
        'IpLocalizationStatus',
        'IpListingVisibility',
        'IpUserBlockTargetType',
      ])
        await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "${type}"`);
      await db.$disconnect();
    });
    const input = () =>
      ContentGpsSearchRequestSchema.parse({
        requestId: randomUUID(),
        query: {
          schemaVersion: 1,
          locale: 'en-US',
          location: null,
          era: null,
          duration: null,
          genreCodes: [],
          moodPreferences: [],
        },
        map: {
          coordinateSystem: 'WGS84',
          west: -180,
          east: 180,
          south: -90,
          north: 90,
        },
      });
    type Result = {
      items: { id: string; locations: unknown[]; eras: unknown[] }[];
      matchedCount: number;
      accessibleCount: number;
      nextCursor: { afterId: string; queryId: string } | null;
      clusters: {
        ipCount: number;
        matched: boolean;
        longitude: number;
        ipId: string | null;
      }[];
      places: { id: string }[];
      queryId: string;
    };
    const run = async (request = input(), user?: { userId: string }) =>
      (await search.search(request, user)) as unknown as Result;
    async function add(
      duration: number | null = 900,
      label = 'Singapore',
      longitude = 103.8,
    ) {
      const id = randomUUID(),
        text = randomUUID(),
        episode = randomUUID();
      await db.$executeRaw`INSERT INTO ips(id,created_by_id) VALUES (${id}::uuid, ${id})`;
      await db.$executeRaw`INSERT INTO ip_localizations(id,ip_id,locale,title,summary) VALUES (${text}::uuid,${id}::uuid,'en-US','Public title',${label})`;
      await db.$executeRaw`INSERT INTO ip_episodes(id,ip_id,duration_seconds) VALUES (${episode}::uuid,${id}::uuid,${duration})`;
      await db.$executeRaw`INSERT INTO ip_episode_localizations(id,episode_id,locale,summary) VALUES (${randomUUID()}::uuid,${episode}::uuid,'en-US','Public episode')`;
      await owner.save(
        id,
        { userId: id },
        {
          requestId: randomUUID(),
          expectedVersion: 0,
          locations: [
            {
              id: randomUUID(),
              label,
              kind: 'story_setting',
              status: 'resolved',
              point: {
                latitude: 1.3,
                longitude,
                coordinateSystem: 'WGS84',
                precision: 'city',
              },
            },
          ],
        },
      );
      return { id, text, episode };
    }
    it('hydrates canonical room links and only moderation-cleared public locale posters', async () => {
      const ip = await add();
      const asset = randomUUID(),
        draftAsset = randomUUID();
      await db.$executeRaw`INSERT INTO media_assets(id,storage_provider,external_url) VALUES (${asset}::uuid,'external_url','https://example.test/public.jpg'),(${draftAsset}::uuid,'external_url','https://example.test/draft.jpg')`;
      await db.$executeRaw`UPDATE ips SET room_number='12345678',cover_asset_id=${asset}::uuid WHERE id=${ip.id}::uuid`;
      await db.$executeRaw`INSERT INTO ip_localizations(id,ip_id,locale,title,summary,status,cover_asset_id) VALUES (${randomUUID()}::uuid,${ip.id}::uuid,'zh-CN','Private title','Private text','draft',${draftAsset}::uuid)`;
      const first = await search.search(input());
      expect(first.items[0]).toMatchObject({
        roomNumber: '12345678',
        summary: 'Singapore',
        coverUrl: 'https://example.test/public.jpg',
      });
      expect(JSON.stringify(first)).not.toContain('draft.jpg');
      expect(JSON.stringify(first)).not.toContain('objectKey');
      await db.$executeRaw`UPDATE media_assets SET moderation_status='blocked' WHERE id=${asset}::uuid`;
      expect((await search.search(input())).items[0].coverUrl).toBeNull();
      await db.$executeRaw`UPDATE media_assets SET moderation_status='approved',deleted_at=now() WHERE id=${asset}::uuid`;
      expect((await search.search(input())).items[0].coverUrl).toBeNull();
    });
    it('matches before pagination and clusters beyond the current card page', async () => {
      const a = await add(),
        b = await add(),
        c = await add();
      const request = { ...input(), limit: 1 };
      const result = await run(request);
      expect(result.matchedCount).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.clusters.reduce((n, c) => n + c.ipCount, 0)).toBe(3);
      expect(result.nextCursor?.afterId).toBe(result.items[0].id);
      const pages = [result.items[0].id];
      let cursor = result.nextCursor;
      for (let n = 0; n < 2; n++) {
        const next = await run({ ...request, cursor });
        cursor = next.nextCursor;
        pages.push(next.items[0].id);
        expect(next.queryId).toBe(result.queryId);
      }
      expect(new Set(pages)).toEqual(new Set([a.id, b.id, c.id]));
    });
    it('includes 900 seconds, excludes 901 and unknown duration, and mutes other accessible markers', async () => {
      const good = await add(900);
      await add(901);
      await add(null);
      const request = input();
      request.query.duration = {
        unit: 'episode',
        maxSeconds: 900,
        unknown: 'exclude',
      };
      const result = await run(request);
      expect(result.items.map((i) => i.id)).toEqual([good.id]);
      expect(result.accessibleCount).toBe(3);
      expect(result.clusters.find((c) => !c.matched)?.ipCount).toBe(2);
    });
    it('uses explicit declared-place facets and respects owner clearing', async () => {
      const a = await add(),
        b = await add(900, 'Tokyo');
      const request = input();
      request.query.location = {
        kind: 'story_setting',
        placeIds: ['label:singapore'],
        relation: 'any',
      };
      expect((await run(request)).items.map((i) => i.id)).toEqual([a.id]);
      await owner.save(
        a.id,
        { userId: a.id },
        { requestId: randomUUID(), expectedVersion: 1, locations: [] },
      );
      const result = await run(request);
      expect(result.matchedCount).toBe(0);
      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0].ipId).toBe(b.id);
      expect(result.places.map((p) => p.id)).not.toContain('label:singapore');
    });
    it('removes private IPs and viewer-blocked creators from cards, clusters, facets and counts', async () => {
      const a = await add(),
        b = await add(900, 'Tokyo'),
        c = await add(900, 'Paris');
      await db.$executeRaw`UPDATE ips SET listing_visibility='private' WHERE id=${b.id}::uuid`;
      await db.$executeRaw`INSERT INTO ip_user_content_blocks(user_id,target_type,target_id) VALUES ('viewer','creator',${c.id})`;
      const result = await run(input(), { userId: 'viewer' });
      expect(result.items.map((i) => i.id)).toEqual([a.id]);
      expect(result.accessibleCount).toBe(1);
      expect(result.clusters).toHaveLength(1);
      expect(result.places.map((p) => p.id)).toEqual(['label:singapore']);
    });
    it('excludes inactive genre terms and never treats a tag as a genre', async () => {
      const a = await add();
      const term = randomUUID();
      await db.$executeRaw`INSERT INTO ip_taxonomy_terms(id,type,code) VALUES (${term}::uuid,'genre','romance')`;
      await db.$executeRaw`INSERT INTO ip_taxonomy_assignments(ip_id,term_id) VALUES (${a.id}::uuid,${term}::uuid)`;
      const request = input();
      request.query.genreCodes = ['romance'];
      expect((await run(request)).matchedCount).toBe(1);
      await db.$executeRaw`UPDATE ip_taxonomy_terms SET status='inactive' WHERE id=${term}::uuid`;
      expect((await run(request)).matchedCount).toBe(0);
      await db.$executeRaw`UPDATE ip_taxonomy_terms SET status='active',type='tag' WHERE id=${term}::uuid`;
      expect((await run(request)).matchedCount).toBe(0);
    });
    it('rejects stale era evidence immediately after public source changes and strips internal evidence', async () => {
      const a = await add();
      const snapshot = await sources.snapshot(a.id, 'en-US', 'v1');
      const source = snapshot.sources.find((s) => s.sourceId === a.text)!;
      await analysis.save(snapshot, {
        schemaVersion: 1,
        ipId: a.id,
        sourceFingerprint: gpsSnapshotFingerprint(snapshot),
        analysisVersion: 'v1',
        analyzedAt: snapshot.analyzedAt,
        locationCoverage: 'unknown',
        locations: [],
        eras: [
          {
            calendar: 'proleptic_gregorian_astronomical',
            startYear: 1980,
            endYear: 2000,
            evidenceIds: ['e1'],
          },
        ],
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
      const request = input();
      request.query.era = {
        calendar: 'proleptic_gregorian_astronomical',
        startYear: 2000,
        endYear: 2020,
        relation: 'overlaps',
      };
      const result = await run(request);
      expect(result.matchedCount).toBe(1);
      expect(JSON.stringify(result)).not.toContain('sourceVersion');
      expect(JSON.stringify(result)).not.toContain('evidenceIds');
      delete process.env.CONTENT_GPS_ANALYSIS_VERSION;
      expect((await run(request)).matchedCount).toBe(0);
      expect((await run()).items[0].locations).toHaveLength(1);
      process.env.CONTENT_GPS_ANALYSIS_VERSION = 'v1';
      await db.$executeRaw`UPDATE ip_localizations SET summary='Different public text' WHERE id=${a.text}::uuid`;
      expect((await run(request)).matchedCount).toBe(0);
      expect((await run()).items[0].locations).toHaveLength(1);
    });

    it('projects fresh provider coordinates into cards and clusters while preserving owner clearing and source gates', async () => {
      const a = await add();
      await db.$executeRaw`DELETE FROM ip_content_gps_location_revisions WHERE ip_id=${a.id}::uuid`;
      const snapshot = await sources.snapshot(a.id, 'en-US', 'v1');
      const source = snapshot.sources.find((s) => s.sourceId === a.text)!;
      const fingerprint = gpsSnapshotFingerprint(snapshot);
      await analysis.save(snapshot, {
        schemaVersion: 1,
        ipId: a.id,
        sourceFingerprint: fingerprint,
        analysisVersion: 'v1',
        analyzedAt: snapshot.analyzedAt,
        locationCoverage: 'identified',
        locations: [
          {
            id: 'sg',
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
      const point = {
        latitude: 1.3,
        longitude: 103.8,
        coordinateSystem: 'WGS84',
        precision: 'city',
        provider: 'google',
        providerPlaceId: 'sg',
      };
      await db.$executeRaw`INSERT INTO ip_content_gps_geocodes(id,ip_id,locale,source_fingerprint,analysis_version,location_id,provider,status,result,expires_at)
        VALUES(${randomUUID()}::uuid,${a.id}::uuid,'en-US',${fingerprint},'v1','sg','google','completed',${JSON.stringify({ status: 'resolved', point })}::jsonb, now()+interval '1 hour')`;
      const found = await run();
      expect(found.items[0].locations[0]).toMatchObject({
        status: 'resolved',
        point,
      });
      expect(found.clusters).toHaveLength(1);
      expect(found.clusters[0].ipId).toBe(a.id);
      expect(JSON.stringify(found)).not.toContain('evidenceIds');
      await db.$executeRaw`UPDATE ip_content_gps_geocodes SET expires_at=now()-interval '1 second' WHERE ip_id=${a.id}::uuid`;
      expect((await run()).clusters).toHaveLength(0);
      await db.$executeRaw`UPDATE ip_content_gps_geocodes SET expires_at=now()+interval '1 hour' WHERE ip_id=${a.id}::uuid`;
      await owner.save(
        a.id,
        { userId: a.id },
        { requestId: randomUUID(), expectedVersion: 0, locations: [] },
      );
      expect((await run()).items[0].locations).toEqual([]);
      expect((await run()).clusters).toHaveLength(0);
      await db.$executeRaw`DELETE FROM ip_content_gps_location_revisions WHERE ip_id=${a.id}::uuid`;
      await db.$executeRaw`UPDATE ip_localizations SET summary='Changed source' WHERE id=${a.text}::uuid`;
      expect((await run()).clusters).toHaveLength(0);
      await db.$executeRaw`UPDATE ips SET listing_visibility='private' WHERE id=${a.id}::uuid`;
      expect((await run()).items).toHaveLength(0);
    });
    it('keeps map bounds separate from search and handles the antimeridian', async () => {
      await add(900, 'East', 179);
      await add(900, 'West', -179);
      await add(900, 'Outside', 100);
      const request = input();
      request.map = {
        coordinateSystem: 'WGS84',
        west: 170,
        east: -170,
        south: -10,
        north: 10,
      };
      const result = await run(request);
      expect(result.matchedCount).toBe(3);
      expect(result.clusters.reduce((n, c) => n + c.ipCount, 0)).toBe(2);
      expect(result.clusters.every((c) => Math.abs(c.longitude) >= 170)).toBe(
        true,
      );
      request.map.coordinateSystem = 'GCJ02';
      expect((await run(request)).clusters).toEqual([]);
    });
    it('selects an accessible muted IP independently of the result page and clears it after withdrawal', async () => {
      const a = await add(901, 'Tokyo');
      await add(900);
      const request = input();
      request.selectedIpId = a.id;
      request.query.duration = {
        unit: 'episode',
        maxSeconds: 900,
        unknown: 'exclude',
      };
      const result = await search.search(request);
      expect(result.selected).toMatchObject({
        id: a.id,
        matched: false,
        episode: null,
      });
      expect(result.mapIpCount).toBe(2);
      expect(result.mapMatchedIpCount).toBe(1);
      await db.$executeRaw`UPDATE ips SET deleted_at=now() WHERE id=${a.id}::uuid`;
      expect((await search.search(request)).selected).toBeNull();
    });
    it('binds a cursor to criteria/account, and pages correctly when the boundary IP disappears', async () => {
      await add();
      await add();
      await add();
      const request = { ...input(), limit: 1 };
      const first = await search.search(request);
      const cursor = first.nextCursor!;
      const next = await search.search({ ...request, cursor });
      await db.$executeRaw`UPDATE ips SET deleted_at=now() WHERE id=${first.items[0].id}::uuid`;
      expect((await search.search({ ...request, cursor })).items[0].id).toBe(
        next.items[0].id,
      );
      await expect(
        search.search({ ...request, cursor }, { userId: 'other' }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        search.search({
          ...request,
          cursor,
          query: { ...request.query, genreCodes: ['romance'] },
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
    it('filters place options without changing matching criteria and labels unresolved geography without a pin', async () => {
      const a = await add();
      await add(900, 'Tokyo');
      await owner.save(
        a.id,
        { userId: a.id },
        {
          requestId: randomUUID(),
          expectedVersion: 1,
          locations: [
            {
              id: randomUUID(),
              kind: 'story_setting',
              label: 'Fictional Singapore',
              status: 'fictional',
              point: null,
            },
          ],
        },
      );
      const result = await search.search({
        ...input(),
        placeSearch: 'fictional',
      });
      expect(result.matchedCount).toBe(2);
      expect(result.places).toHaveLength(1);
      expect(result.placesTruncated).toBe(false);
      expect(result.mapIpCount).toBe(1);
      expect(
        result.items.find((i) => i.id === a.id)?.locations[0].point,
      ).toBeNull();
    });
    it('searches owner locations without an AI version and excludes unversioned AI metadata', async () => {
      const { id } = await add();
      delete process.env.CONTENT_GPS_ANALYSIS_VERSION;
      const result = await run();
      expect(result.items.map((item) => item.id)).toContain(id);
      expect(
        result.items.find((item) => item.id === id)?.locations,
      ).not.toHaveLength(0);
      expect(result.items.find((item) => item.id === id)?.eras).toEqual([]);
      const request = input();
      request.query.location = {
        kind: 'story_setting',
        placeIds: ['label:singapore'],
        relation: 'any',
      };
      expect((await run(request)).items.map((item) => item.id)).toContain(id);
    });

    it('fails explicitly for unsupported semantics or invalid configuration', async () => {
      const request = input();
      request.query.duration = {
        unit: 'film',
        maxSeconds: 900,
        unknown: 'exclude',
      };
      await expect(run(request)).rejects.toMatchObject({ status: 400 });
      process.env.CONTENT_GPS_ANALYSIS_VERSION = 'x'.repeat(201);
      await expect(run()).rejects.toMatchObject({ status: 503 });
    });
  },
);

import { IpStudiosService } from '../ip-commerce/ip-studios';
import { IpCommerceService } from '../ip-commerce/ip-commerce.service';
import { IpStudioRequestSchema } from '@repo/shared/creator-location';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import {
  type CreatorLocationProfile,
  CreatorDiscoveryRequestSchema,
} from '@repo/shared/creator-location';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { LegacyCreatorsService } from '../legacy-creators/legacy-creators.service';
import type { LegacyMysqlService } from '../infra/legacy-mysql/legacy-mysql.service';
import { CreatorLocationsService } from './creator-locations';
import { CreatorDiscoveryService } from './creator-discovery';

const url = process.env.CONTENT_GPS_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'creator discovery (PostgreSQL with directory fixture)',
  () => {
    let db: PrismaClient;
    let search: CreatorDiscoveryService;
    let locations: CreatorLocationsService;
    let relationships: IpStudiosService;
    const ipId = randomUUID();
    const identities = new Map<
      string,
      { id: string; nick_name: string; avatar: string; jobseeking: number }
    >();
    const legacy = {
      query: jest.fn((_sql: string, ids: string[]) =>
        Promise.resolve(
          (_sql.includes('LIMIT 500')
            ? [...identities.keys()]
                .sort()
                .filter((id) => !ids[0] || id > ids[0])
                .slice(0, 500)
            : ids
          ).flatMap((id) => {
            const row = identities.get(id);
            return row?.nick_name.trim() ? [row] : [];
          }),
        ),
      ),
    };
    const profile = {
      basedIn: { countryCode: 'SG', city: 'Singapore' },
      serves: [{ countryCode: 'MY', city: 'Johor Bahru' }],
      remote: false,
      showOnMap: true,
    };
    const input = () =>
      CreatorDiscoveryRequestSchema.parse({
        requestId: randomUUID(),
        query: {
          basedIn: null,
          serves: null,
          remoteOnly: false,
          availableForWork: false,
          category: null,
          text: '',
        },
      });
    beforeAll(async () => {
      const parsed = postgresFixtureUrl(url!);
      if (
        !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
        parsed.port !== '55441' ||
        parsed.pathname !== '/gps_test'
      )
        throw new Error('Dedicated loopback GPS fixture required.');
      db = buildPrisma(url);
      await db.$executeRawUnsafe(
        `CREATE TABLE creator_services(id text PRIMARY KEY, creator_id text, status text DEFAULT 'listed', deleted_at timestamptz, title text DEFAULT 'Advertising video', category text DEFAULT 'video_production', tags text[] DEFAULT '{}')`,
      );
      await db.$executeRawUnsafe(
        `CREATE TABLE ip_user_content_blocks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text,target_id text,target_type text,unblocked_at timestamptz)`,
      );
      const migration = readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20261001190000_creator_location_profiles/migration.sql',
        ),
        'utf8',
      );
      for (const sql of migration.split(';').filter((s) => s.trim()))
        await db.$executeRawUnsafe(sql);
      const geocodes = readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20261001213000_creator_geocodes/migration.sql',
        ),
        'utf8',
      );
      for (const sql of geocodes.split(';').filter((s) => s.trim()))
        await db.$executeRawUnsafe(sql);
      await db.$executeRawUnsafe(
        `CREATE TABLE ips(id uuid PRIMARY KEY, created_by_id text, deleted_at timestamptz, status text DEFAULT 'published', listing_visibility text DEFAULT 'public', channel_type text DEFAULT 'ip')`,
      );
      await db.$executeRawUnsafe(
        `CREATE TABLE ip_localizations(ip_id uuid, status text DEFAULT 'published', archived_at timestamptz)`,
      );
      await db.$executeRawUnsafe(
        `CREATE TABLE ip_contributors(ip_id uuid,user_id text,role text,custom_role text,is_public boolean DEFAULT true,removed_at timestamptz)`,
      );
      locations = new CreatorLocationsService(db as PrismaService);
      search = new CreatorDiscoveryService(
        db as PrismaService,
        new LegacyCreatorsService(legacy as unknown as LegacyMysqlService),
      );
      const catalogue = Object.assign(
        Object.create(IpCommerceService.prototype) as IpCommerceService,
        { prisma: db },
      );
      relationships = new IpStudiosService(
        db as PrismaService,
        catalogue,
        search,
      );
    });
    afterEach(async () => {
      await db.$executeRaw`DELETE FROM ip_contributors`;
      await db.$executeRaw`DELETE FROM ip_localizations`;
      await db.$executeRaw`DELETE FROM ips`;
      await db.$executeRaw`DELETE FROM creator_location_revisions`;
      await db.$executeRaw`DELETE FROM creator_services`;
      await db.$executeRaw`DELETE FROM ip_user_content_blocks`;
      identities.clear();
      legacy.query.mockClear();
    });
    afterAll(async () => {
      if (!db) return;
      for (const name of [
        'ip_contributors',
        'ip_localizations',
        'ips',
        'creator_location_geocodes',
        'creator_location_revisions',
        'creator_services',
        'ip_user_content_blocks',
      ])
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${name}`);
      await db.$disconnect();
    });
    async function add(
      id: string,
      declaration: CreatorLocationProfile = profile,
    ) {
      identities.set(id, {
        id,
        nick_name: `Studio ${id}`,
        avatar: 'https://example.test/avatar.png',
        jobseeking: 1,
      });
      await db.$executeRaw`INSERT INTO creator_services(id,creator_id) VALUES (${randomUUID()},${id})`;
      await locations.save(
        { userId: id },
        { requestId: randomUUID(), expectedVersion: 0, profile: declaration },
      );
    }

    const relationshipInput = () =>
      IpStudioRequestSchema.parse({
        requestId: randomUUID(),
        ipId,
        locale: 'en-US',
        limit: 1,
      });
    async function credit(id: string | null, role = 'writer', isPublic = true) {
      await db.$executeRaw`INSERT INTO ip_contributors(ip_id,user_id,role,is_public) VALUES (${ipId}::uuid,${id},${role},${isPublic})`;
    }
    async function publicIp() {
      await db.$executeRaw`INSERT INTO ips(id,created_by_id) VALUES (${ipId}::uuid,'owner')`;
      await db.$executeRaw`INSERT INTO ip_localizations(ip_id) VALUES (${ipId}::uuid)`;
    }
    it('groups public contributor roles and pages across studios independently of catalogue pages', async () => {
      await publicIp();
      await add('1');
      await add('2', { ...profile, showOnMap: false, remote: true });
      await credit('1');
      await credit('1', 'director');
      await credit('1', 'writer');
      await credit('2');
      await add('owner'); // ownership alone never establishes contribution
      await credit(null);
      await credit('unlinked');
      const first = await relationships.search(relationshipInput(), {
        userId: 'viewer',
      });
      expect(first.items).toHaveLength(1);
      expect(first.items[0].roles.map((r) => r.role)).toEqual([
        'director',
        'writer',
      ]);
      const second = await relationships.search(
        { ...relationshipInput(), cursor: first.nextCursor },
        { userId: 'viewer' },
      );
      expect(second.items.map((i) => i.studio.id)).toEqual(['2']);
      expect(second.items[0].studio).toMatchObject({
        basedIn: null,
        point: null,
        showOnMap: false,
        remote: true,
      });
      expect(second.nextCursor).toBeNull();
      await expect(
        relationships.search(
          { ...relationshipInput(), cursor: first.nextCursor },
          { userId: 'another' },
        ),
      ).rejects.toThrow('new studio relationship query');
      await expect(
        relationships.search(
          { ...relationshipInput(), locale: 'zh-CN', cursor: first.nextCursor },
          { userId: 'viewer' },
        ),
      ).rejects.toThrow('new studio relationship query');
    });
    it('removes revoked credits, unlisted services, blocked identities and private IPs on the next request', async () => {
      await publicIp();
      for (const id of ['1', '2', '3', '4']) {
        await add(id);
        await credit(id);
      }
      await credit('4', 'director', false);
      await db.$executeRaw`UPDATE ip_contributors SET removed_at=now() WHERE user_id='1'`;
      await db.$executeRaw`UPDATE creator_services SET status='draft' WHERE creator_id='2'`;
      await db.$executeRaw`INSERT INTO ip_user_content_blocks(user_id,target_type,target_id) VALUES ('viewer','creator','3')`;
      const visible = await relationships.search(
        { ...relationshipInput(), limit: 50 },
        { userId: 'viewer' },
      );
      expect(visible.items.map((i) => i.studio.id)).toEqual(['4']);
      expect(visible.items[0].roles).toEqual([
        { role: 'writer', customRole: null },
      ]);
      identities.delete('4');
      expect(
        (await relationships.search(relationshipInput(), { userId: 'viewer' }))
          .items,
      ).toEqual([]);
      await db.$executeRaw`UPDATE ips SET listing_visibility='private'`;
      await expect(relationships.search(relationshipInput())).rejects.toThrow(
        'IP not found',
      );
      await db.$executeRaw`UPDATE ips SET listing_visibility='public', status='draft'`;
      await expect(relationships.search(relationshipInput())).rejects.toThrow(
        'IP not found',
      );
    });
    it('scans beyond a full batch of undiscoverable credits and rechecks the IP block', async () => {
      await publicIp();
      await add('z-studio');
      await credit('z-studio');
      await db.$executeRaw`INSERT INTO ip_contributors(ip_id,user_id,role) SELECT ${ipId}::uuid, 'a-' || n::text, 'writer' FROM generate_series(1,505) n`;
      expect(
        (
          await relationships.search(relationshipInput(), { userId: 'viewer' })
        ).items.map((i) => i.studio.id),
      ).toEqual(['z-studio']);
      await db.$executeRaw`INSERT INTO ip_user_content_blocks(user_id,target_type,target_id) VALUES ('viewer','ip',${ipId})`;
      await expect(
        relationships.search(relationshipInput(), { userId: 'viewer' }),
      ).rejects.toThrow('IP not found');
    });
    it('counts creators once across multiple matching services, before pagination', async () => {
      await add('1');
      await add('2');
      await db.$executeRaw`INSERT INTO creator_services(id,creator_id) VALUES (${randomUUID()},'1')`;
      const result = await search.search({ ...input(), limit: 1 });
      expect(result.matchedCount).toBe(2);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: '1',
        serviceCount: 2,
        matchingServiceCount: 2,
      });
      expect(
        (
          await search.search({
            ...input(),
            limit: 1,
            cursor: result.nextCursor,
          })
        ).items[0].id,
      ).toBe('2');
      expect(result.countScope).toBe(
        'public_platform_creators_with_listed_services',
      );
    });
    it('keeps private base cities out of payloads and Based in matching while public service areas remain discoverable', async () => {
      await add('1', { ...profile, showOnMap: false });
      const all = await search.search(input());
      expect(all.items[0].basedIn).toBeNull();
      expect(JSON.stringify(all)).not.toContain('Singapore');
      const request = input();
      request.query.basedIn = profile.basedIn;
      expect((await search.search(request)).matchedCount).toBe(0);
      request.query.basedIn = null;
      request.query.serves = profile.serves[0];
      expect((await search.search(request)).items[0].id).toBe('1');
    });
    it('supports remote-only services without a base and does not confuse Serves with Based in', async () => {
      await add('1', {
        ...profile,
        basedIn: null,
        showOnMap: false,
        remote: true,
      });
      await add('2');
      const request = input();
      request.query.remoteOnly = true;
      expect((await search.search(request)).items.map((i) => i.id)).toEqual([
        '1',
      ]);
      request.query.remoteOnly = false;
      request.query.serves = profile.basedIn;
      expect((await search.search(request)).matchedCount).toBe(0);
      request.query.serves = null;
      request.query.basedIn = { countryCode: 'SG', city: 'singapore' };
      expect((await search.search(request)).items.map((i) => i.id)).toEqual([
        '2',
      ]);
    });
    it('removes paused/deleted services, non-public identities and blocked creators from every public projection', async () => {
      for (const id of ['1', '2', '3', '4', '5']) await add(id);
      await db.$executeRaw`UPDATE creator_services SET status='paused' WHERE creator_id='2'`;
      await db.$executeRaw`UPDATE creator_services SET deleted_at=now() WHERE creator_id='3'`;
      identities.get('4')!.nick_name = '';
      await db.$executeRaw`INSERT INTO ip_user_content_blocks(user_id,target_id,target_type) VALUES ('viewer','5','creator')`;
      const result = await search.search(
        { ...input(), selectedCreatorId: '5' },
        { userId: 'viewer' },
      );
      expect(result.items.map((i) => i.id)).toEqual(['1']);
      expect(result.accessibleCount).toBe(1);
      expect(result.selected).toBeNull();
    });
    it('withdraws map consent immediately even when a late request replays an earlier opt-in', async () => {
      await add('1');
      const request = { requestId: randomUUID(), expectedVersion: 1, profile };
      await locations.save({ userId: '1' }, request);
      await locations.save(
        { userId: '1' },
        {
          requestId: randomUUID(),
          expectedVersion: 2,
          profile: { ...profile, showOnMap: false },
        },
      );
      await locations.save({ userId: '1' }, request);
      expect((await search.search(input())).items[0]).toMatchObject({
        basedIn: null,
        showOnMap: false,
      });
    });
    it('treats search text literally and matches only listed service categories', async () => {
      await add('1');
      await add('2');
      await db.$executeRaw`UPDATE creator_services SET title='100% ad',category='animation' WHERE creator_id='1'`;
      const request = input();
      request.query.text = '%';
      expect((await search.search(request)).items.map((i) => i.id)).toEqual([
        '1',
      ]);
      request.query.category = 'video_production';
      expect((await search.search(request)).matchedCount).toBe(0);
    });
    async function bulk(n: number) {
      await db.$executeRaw`INSERT INTO creator_services(id,creator_id) SELECT ('service-'||n), (100000+n)::text FROM generate_series(1,${n}::int) n`;
      for (let n1 = 1; n1 <= n; n1++) {
        const id = String(100000 + n1);
        identities.set(id, {
          id,
          nick_name: `Studio ${id}`,
          avatar: 'https://example.test/avatar.png',
          jobseeking: n1 === n ? 1 : 0,
        });
      }
    }
    it('checks more than one identity batch and filters availability before page/count selection', async () => {
      await bulk(505);
      const request = input();
      request.query.availableForWork = true;
      const result = await search.search(request, { userId: 'viewer' });
      expect(result.accessibleCount).toBe(505);
      expect(result.matchedCount).toBe(1);
      expect(result.items[0].id).toBe('100505');
      expect(legacy.query.mock.calls.map((c) => c[1])).toEqual([
        [],
        ['100500'],
      ]);
      expect(
        legacy.query.mock.calls.every((c) =>
          c[0].includes("TRIM(nick_name) <> ''"),
        ),
      ).toBe(true);
    });
    it('enforces the first 50 matching guest creators even for forged boundaries or explicit selection', async () => {
      await bulk(55);
      const request = { ...input(), limit: 50, selectedCreatorId: '100055' };
      const first = await search.search(request);
      expect(first.items).toHaveLength(50);
      expect(first.matchedCount).toBe(55);
      expect(first.requiresLogin).toBe(true);
      expect(first.nextCursor).toBeNull();
      expect(first.selected).toBeNull();
      const forged = await search.search({
        ...request,
        cursor: { afterId: '100050', queryId: first.queryId },
      });
      expect(forged.items).toEqual([]);
      expect(forged.selected).toBeNull();
      const signed = await search.search(request, { userId: 'viewer' });
      expect(signed.selected?.id).toBe('100055');
      expect(signed.nextCursor).not.toBeNull();
    });
    it('does not substitute partial counts if the identity service fails', async () => {
      await bulk(505);
      legacy.query.mockRejectedValueOnce(new Error('Directory unavailable'));
      await expect(search.search(input())).rejects.toThrow(
        'Directory unavailable',
      );
    });
    it('reads a single public studio directly with the same identity/visibility and private-base rules', async () => {
      await add('1', { ...profile, showOnMap: false });
      await add('2');
      expect(await search.profile('1')).toMatchObject({
        id: '1',
        basedIn: null,
        showOnMap: false,
      });
      expect(legacy.query.mock.calls.at(-1)![1]).toEqual(['1']);
      await db.$executeRaw`UPDATE creator_services SET status='paused' WHERE creator_id='1'`;
      await expect(search.profile('1')).rejects.toMatchObject({ status: 404 });
      identities.delete('2');
      await expect(search.profile('2')).rejects.toMatchObject({ status: 404 });
    });
    it('rejects cursors from another account or query', async () => {
      await add('1');
      await add('2');
      const request = { ...input(), limit: 1 };
      const first = await search.search(request);
      await expect(
        search.search(
          { ...request, cursor: first.nextCursor },
          { userId: 'viewer' },
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        search.search({
          ...request,
          cursor: first.nextCursor,
          query: { ...request.query, remoteOnly: true },
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    const world = {
      coordinateSystem: 'WGS84' as const,
      west: -180,
      east: 180,
      south: -90,
      north: 90,
    };
    async function pin(
      id: string,
      longitude = 103.8,
      coordinateSystem = 'WGS84',
      precision = 'city',
    ) {
      const result = {
        status: 'resolved',
        point: {
          latitude: 1.3,
          longitude,
          coordinateSystem,
          precision,
          provider: coordinateSystem === 'WGS84' ? 'google' : 'amap',
          providerPlaceId: null,
        },
      };
      await db.$executeRaw`INSERT INTO creator_location_geocodes(id,creator_id,version,provider,status,result,expires_at)
        VALUES(${randomUUID()}::uuid,${id},1,${coordinateSystem === 'WGS84' ? 'google' : 'amap'},'completed',${JSON.stringify(result)}::jsonb,now()+interval '1 hour')`;
    }
    it('counts and pages the virtual island without manufacturing coordinates', async () => {
      await add('1');
      await pin('1');
      await add('2', { ...profile, showOnMap: false });
      await add('3', {
        basedIn: null,
        serves: [],
        remote: false,
        showOnMap: false,
      });
      await add('4'); // Public city, but not yet geocoded.
      const request = {
        ...input(),
        limit: 1,
        map: world,
        query: { ...input().query, islandOnly: true },
      };
      const first = await search.search(request, { userId: 'viewer' });
      expect(first.island).toEqual({ creatorCount: 3, matchedCreatorCount: 3 });
      expect(first.matchedCount).toBe(3);
      expect(first.items.map((item) => item.id)).toEqual(['2']);
      expect(first.items[0].point).toBeNull();
      expect(first.items[0].basedIn).toBeNull();
      expect(first.map?.clusters).toEqual([
        expect.objectContaining({ creatorId: '1', matched: false }),
      ]);
      const second = await search.search(
        { ...request, cursor: first.nextCursor },
        { userId: 'viewer' },
      );
      expect(second.items.map((item) => item.id)).toEqual(['3']);
      const third = await search.search(
        { ...request, cursor: second.nextCursor },
        { userId: 'viewer' },
      );
      expect(third.items.map((item) => item.id)).toEqual(['4']);
      expect(third.nextCursor).toBeNull();
      expect(third.island).toEqual(first.island);
    });
    it('moves a creator out of the island only when a public city point resolves', async () => {
      await add('1');
      const request = {
        ...input(),
        query: { ...input().query, islandOnly: true },
      };
      expect(
        (await search.search(request, { userId: 'viewer' })).matchedCount,
      ).toBe(1);
      await pin('1');
      const located = await search.search(request, { userId: 'viewer' });
      expect(located.island.creatorCount).toBe(0);
      expect(located.items).toEqual([]);
    });
    it('aggregates consented cities across all pages and resolves a selected creator outside the page', async () => {
      await add('1');
      await add('2');
      await pin('1');
      await pin('2');
      const result = await search.search(
        { ...input(), limit: 1, map: world, selectedCreatorId: '2' },
        { userId: 'viewer' },
      );
      expect(result.items).toHaveLength(1);
      expect(result.selected?.id).toBe('2');
      expect(result.map).toMatchObject({
        creatorCount: 2,
        matchedCreatorCount: 2,
        clusters: [{ count: 2, creatorId: null, matched: true }],
      });
      expect(result.items[0].point).toMatchObject({
        precision: 'city',
        latitude: 1.3,
      });
    });
    it('keeps matched and muted city clusters separate without changing search bounds', async () => {
      await add('1');
      await add('2');
      await pin('1');
      await pin('2');
      await db.$executeRaw`UPDATE creator_services SET title='Other service' WHERE creator_id='2'`;
      const request = input();
      request.query.text = 'Advertising';
      const result = await search.search(
        { ...request, map: world, selectedCreatorId: '2' },
        { userId: 'viewer' },
      );
      expect(result.matchedCount).toBe(1);
      expect(result.selected?.matched).toBe(false);
      expect(result.map?.clusters.map((c) => c.matched).sort()).toEqual([
        false,
        true,
      ]);
      const moved = await search.search(
        { ...request, map: { ...world, west: -10, east: 10 } },
        { userId: 'viewer' },
      );
      expect(moved.matchedCount).toBe(1);
      expect(moved.map?.creatorCount).toBe(0);
    });
    it('removes public points after consent, profile revision or provider expiry changes', async () => {
      await add('1');
      await pin('1');
      expect((await search.profile('1')).point).not.toBeNull();
      await locations.save(
        { userId: '1' },
        {
          requestId: randomUUID(),
          expectedVersion: 1,
          profile: { ...profile, showOnMap: false },
        },
      );
      expect((await search.profile('1')).point).toBeNull();
      expect(
        (await search.search({ ...input(), map: world })).map?.creatorCount,
      ).toBe(0);
      await locations.save(
        { userId: '1' },
        { requestId: randomUUID(), expectedVersion: 2, profile },
      );
      expect((await search.profile('1')).point).toBeNull();
      await add('2');
      await pin('2');
      await db.$executeRaw`UPDATE creator_location_geocodes SET expires_at=now()-interval '1 second' WHERE creator_id='2'`;
      expect((await search.profile('2')).point).toBeNull();
    });
    it('never publishes points for blocked, unlisted or missing identities', async () => {
      for (const id of ['1', '2', '3']) {
        await add(id);
        await pin(id);
      }
      await db.$executeRaw`INSERT INTO ip_user_content_blocks(user_id,target_type,target_id) VALUES('viewer','creator','1')`;
      await db.$executeRaw`UPDATE creator_services SET status='draft' WHERE creator_id='2'`;
      identities.delete('3');
      const result = await search.search(
        { ...input(), map: world },
        { userId: 'viewer' },
      );
      expect(result.items).toEqual([]);
      expect(result.map?.creatorCount).toBe(0);
    });
    it('uses the same guest cap for pins and card selection while reporting full matching counts', async () => {
      for (let i = 0; i < 52; i++) {
        const id = String(i).padStart(3, '0');
        await add(id);
        await pin(id);
      }
      const result = await search.search({
        ...input(),
        map: world,
        selectedCreatorId: '051',
      });
      expect(result.matchedCount).toBe(52);
      expect(result.map?.creatorCount).toBe(50);
      expect(result.selected).toBeNull();
    });
    it('caps service-free island guests and denies selection beyond their visible page range', async () => {
      await bulk(55);
      await db.$executeRaw`DELETE FROM creator_services`;
      const request = input();
      request.query.islandOnly = true;
      const result = await search.search({
        ...request,
        limit: 50,
        selectedCreatorId: '100055',
      });
      expect(result.matchedCount).toBe(55);
      expect(result.items).toHaveLength(50);
      expect(result.requiresLogin).toBe(true);
      expect(result.nextCursor).toBeNull();
      expect(result.selected).toBeNull();
      expect(result.island.matchedCreatorCount).toBe(50);
    });
    it('includes service-free public creators on the island without publishing draft services', async () => {
      await add('1');
      await db.$executeRaw`UPDATE creator_services SET status='draft' WHERE creator_id='1'`;
      identities.set('2', {
        id: '2',
        nick_name: 'New creator',
        avatar: 'https://example.test/avatar.png',
        jobseeking: 1,
      });
      identities.set('3', {
        id: '3',
        nick_name: 'Blocked creator',
        avatar: '',
        jobseeking: 1,
      });
      await db.$executeRaw`INSERT INTO ip_user_content_blocks(user_id,target_type,target_id) VALUES('viewer','creator','3')`;
      const request = input();
      const normal = await search.search(request, { userId: 'viewer' });
      expect(normal.items).toEqual([]);
      expect(normal.island.matchedCreatorCount).toBe(2);
      const island = await search.search(
        { ...request, query: { ...request.query, islandOnly: true }, limit: 1 },
        { userId: 'viewer' },
      );
      expect(island.countScope).toBe('public_platform_creators');
      expect(island.matchedCount).toBe(2);
      expect(island.items[0]).toMatchObject({
        id: '1',
        serviceCount: 0,
        matchingServiceCount: 0,
        point: null,
      });
      const next = await search.search(
        {
          ...request,
          query: island.query,
          limit: 1,
          cursor: island.nextCursor,
        },
        { userId: 'viewer' },
      );
      expect(next.items.map((item) => item.id)).toEqual(['2']);
      const filtered = await search.search(
        {
          ...request,
          query: { ...island.query, category: 'video_production' },
        },
        { userId: 'viewer' },
      );
      expect(filtered.items).toEqual([]);
    });
    it('handles antimeridian bounds, separates coordinate systems and refuses street precision', async () => {
      for (const id of ['east', 'west', 'cn', 'street']) await add(id);
      await pin('east', 179);
      await pin('west', -179);
      await pin('cn', 179, 'GCJ02');
      await pin('street', 179, 'WGS84', 'place');
      const result = await search.search(
        { ...input(), map: { ...world, west: 170, east: -170 } },
        { userId: 'viewer' },
      );
      expect(result.map?.creatorCount).toBe(2);
      expect(
        result.map?.clusters.every((c) => Math.abs(c.longitude) >= 170),
      ).toBe(true);
      expect((await search.profile('street')).point).toBeNull();
    });
  },
);

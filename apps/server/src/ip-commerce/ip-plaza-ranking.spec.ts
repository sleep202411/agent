import type { PGlite as PGliteDatabase } from '@electric-sql/pglite';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ListIpsQuerySchema } from './dto';
import { IpCommerceService } from './ip-commerce.service';
import {
  encodePublicIpRankCursor,
  publicIpRankQuery,
  type PublicIpRankRow,
} from './ip-plaza-ranking';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const released = '2026-09-09T12:00:00.000000Z';
// PGlite dynamically loads its WASM assets; use Node's loader, not Jest's VM.
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');

// Execute the production SQL against isolated PostgreSQL, never DATABASE_URL.
describe('IP plaza ranking', () => {
  let db: PGliteDatabase;
  let service: IpCommerceService;
  const blocks = jest.fn().mockResolvedValue([]);
  const query = async (sql: Prisma.Sql) =>
    (await db.query<PublicIpRankRow>(sql.text, sql.values)).rows;
  const page = (params: Record<string, unknown> = {}, signedIn = false) =>
    service['rankedPublicIpIds'](
      ListIpsQuerySchema.parse(params),
      signedIn ? { userId: 'viewer' } : undefined,
    );

  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE TABLE ips (
        id uuid PRIMARY KEY, published_at timestamptz(6), created_at timestamptz(6) NOT NULL,
        deleted_at timestamptz, status text DEFAULT 'published',
        listing_visibility text DEFAULT 'public', region text DEFAULT 'GLOBAL',
        created_by_id text DEFAULT 'creator', copyright_owner text
      );
      CREATE TABLE ip_engagement_aggregates (
        ip_id uuid PRIMARY KEY, total_view_count bigint, total_like_count bigint
      );
      CREATE TABLE ip_collection_items (
        ip_id uuid, target_type text DEFAULT 'ip', status text DEFAULT 'active', removed_at timestamptz
      );
      CREATE TABLE ip_localizations (
        ip_id uuid, title text, summary text DEFAULT '', subtitle text, description text, slug text,
        status text DEFAULT 'published', archived_at timestamptz
      );
      CREATE TABLE ip_taxonomy_terms (
        id uuid PRIMARY KEY, type text, code text, status text DEFAULT 'active', archived_at timestamptz
      );
      CREATE TABLE ip_taxonomy_assignments (ip_id uuid, term_id uuid);
      CREATE TABLE ip_taxonomy_term_localizations (term_id uuid, label text);
    `);
    service = Object.create(IpCommerceService.prototype) as IpCommerceService;
    Object.defineProperty(service, 'prisma', {
      value: { $queryRaw: query, ipUserContentBlock: { findMany: blocks } },
    });
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    blocks.mockResolvedValue([]);
    await db.exec(`TRUNCATE ips, ip_engagement_aggregates, ip_collection_items,
      ip_localizations, ip_taxonomy_terms, ip_taxonomy_assignments,
      ip_taxonomy_term_localizations;`);
  });

  async function addIp(
    n: number,
    options: {
      ageDays?: number;
      views?: number;
      likes?: number;
      published?: string | null;
      created?: string;
    } = {},
  ) {
    const publication =
      options.published === undefined ? released : options.published;
    await db.query(
      `INSERT INTO ips(id, published_at, created_at)
       VALUES ($1, $2::timestamptz - $3 * INTERVAL '1 day', $4);
      `,
      [id(n), publication, options.ageDays ?? 0, options.created ?? released],
    );
    await db.query(
      'INSERT INTO ip_localizations(ip_id, title) VALUES ($1, $2)',
      [id(n), `IP ${n}`],
    );
    if (options.views !== undefined || options.likes !== undefined) {
      await db.query(
        `INSERT INTO ip_engagement_aggregates(ip_id, total_view_count, total_like_count)
         VALUES ($1, $2, $3)`,
        [id(n), options.views ?? 0, options.likes ?? 0],
      );
    }
  }

  it('lets a fresh zero-engagement IP outrank a month-old IP with 100 views', async () => {
    await addIp(1);
    await addIp(2, { ageDays: 30, views: 100 });
    expect((await page()).pageIds).toEqual([id(1), id(2)]);
  });

  it('still rewards a popular recent IP instead of sorting only by date', async () => {
    await addIp(1);
    await addIp(2, { ageDays: 1, views: 100 });
    expect((await page()).pageIds).toEqual([id(2), id(1)]);
  });

  it('halves the effective score every seven days and breaks a tie by publication', async () => {
    await addIp(1);
    await addIp(2, { ageDays: 7, views: 10 });
    const rows = await query(publicIpRankQuery(Prisma.sql`TRUE`, 20));
    expect(rows.map((row) => row.id)).toEqual([id(1), id(2)]);
    expect(rows[0].score).toBe(rows[1].score);
  });

  it('orders zero-engagement content by publication, not creation or edit time', async () => {
    await addIp(1, { created: '2020-01-01T00:00:00Z' });
    await addIp(2, { ageDays: 1, created: '2027-01-01T00:00:00Z' });
    await addIp(3, { published: null, views: 1_000_000 });
    expect((await page()).pageIds).toEqual([id(1), id(2), id(3)]);
  });

  it('preserves the relative weights of views, likes and active IP collections', async () => {
    await addIp(1, { views: 4 });
    await addIp(2, { likes: 1 });
    await addIp(3);
    await addIp(4);
    await db.query(`INSERT INTO ip_collection_items(ip_id) VALUES ($1)`, [
      id(3),
    ]);
    await db.query(
      `INSERT INTO ip_collection_items(ip_id, target_type, status, removed_at) VALUES
       ($1, 'ip', 'removed', NULL), ($1, 'episode', 'active', NULL),
       ($1, 'ip', 'active', now())`,
      [id(4)],
    );
    expect((await page()).pageIds).toEqual([id(3), id(2), id(1), id(4)]);
  });

  it('retains visibility, localization and viewer-block gates', async () => {
    for (let n = 1; n <= 9; n++) await addIp(n);
    await db.query(`UPDATE ips SET status = 'draft' WHERE id = $1`, [id(2)]);
    await db.query(
      `UPDATE ips SET listing_visibility = 'private' WHERE id = $1`,
      [id(3)],
    );
    await db.query(`UPDATE ips SET deleted_at = now() WHERE id = $1`, [id(4)]);
    await db.query(
      `UPDATE ip_localizations SET status = 'draft' WHERE ip_id = $1`,
      [id(5)],
    );
    await db.query(
      `UPDATE ips SET created_by_id = 'blocked-creator' WHERE id = $1`,
      [id(7)],
    );
    await db.query(
      `UPDATE ip_localizations SET archived_at = now() WHERE ip_id = $1`,
      [id(8)],
    );
    await db.query(`UPDATE ips SET status = 'scheduled' WHERE id = $1`, [
      id(9),
    ]);
    blocks.mockResolvedValue([
      { targetType: 'ip', targetId: id(6) },
      { targetType: 'creator', targetId: 'blocked-creator' },
    ]);
    expect((await page({}, true)).pageIds).toEqual([id(9), id(1)]);
  });

  it('keeps category, tag, region and literal search filtering in ranked pagination', async () => {
    for (let n = 1; n <= 4; n++) await addIp(n);
    await db.query(
      `INSERT INTO ip_taxonomy_terms(id, type, code) VALUES
      ($1, 'genre', 'drama'), ($2, 'tag', 'space')`,
      [id(101), id(102)],
    );
    await db.query(
      `INSERT INTO ip_taxonomy_assignments(ip_id, term_id) VALUES
      ($1, $4), ($1, $5), ($2, $4), ($2, $5), ($3, $4)`,
      [id(1), id(2), id(3), id(101), id(102)],
    );
    await db.query(`UPDATE ips SET region = 'CN' WHERE id IN ($1, $2)`, [
      id(1),
      id(3),
    ]);
    await db.query(
      `UPDATE ip_localizations SET title = '100% Space' WHERE ip_id = $1`,
      [id(1)],
    );
    expect(
      (await page({ genreCodes: 'drama', tagCodes: 'space' })).pageIds,
    ).toEqual([id(2), id(1)]);
    expect(
      (
        await page({
          genreCodes: 'drama',
          tagCodes: 'space',
          regions: 'CN',
          q: '100%',
        })
      ).pageIds,
    ).toEqual([id(1)]);
    expect((await page({ q: "' OR TRUE --" })).pageIds).toEqual([]);
  });

  it.each([1, 7, 20, 50])(
    'paginates 137 mixed-score IPs without gaps or duplicates (limit %i)',
    async (limit) => {
      await db.exec(`
      INSERT INTO ips(id, published_at, created_at)
      SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
        '${released}'::timestamptz - (n % 17) * INTERVAL '1 day',
        '${released}'::timestamptz + (n % 3) * INTERVAL '1 microsecond'
      FROM generate_series(1,137) n;
      INSERT INTO ip_localizations(ip_id, title) SELECT id, 'IP' FROM ips;
      INSERT INTO ip_engagement_aggregates(ip_id, total_view_count, total_like_count)
      SELECT id, (row_number() OVER (ORDER BY id) % 11), 0 FROM ips;
    `);
      const expected = (
        await query(publicIpRankQuery(Prisma.sql`TRUE`, 200))
      ).map((row) => row.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const result = await page({ limit, ...(cursor ? { cursor } : {}) });
        seen.push(...result.pageIds);
        expect(seen.length).toBeLessThanOrEqual(137);
        cursor = result.nextCursor;
      } while (cursor);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(137);
    },
  );

  it('preserves publication microseconds in the ranking boundary', async () => {
    await addIp(1, { published: '2026-09-09T12:00:00.000003Z' });
    await addIp(2, { published: '2026-09-09T12:00:00.000002Z' });
    await addIp(3, { published: '2026-09-09T12:00:00.000001Z' });
    const first = await page({ limit: 1 });
    const second = await page({ limit: 1, cursor: first.nextCursor });
    const third = await page({ limit: 1, cursor: second.nextCursor });
    expect([...first.pageIds, ...second.pageIds, ...third.pageIds]).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it.each(['deleted', 'more-popular', 'less-popular'])(
    'keeps the shown boundary when the last IP is %s',
    async (change) => {
      for (let n = 1; n <= 4; n++) await addIp(n, { views: 10 * n });
      const first = await page({ limit: 2 });
      expect(first.pageIds).toEqual([id(4), id(3)]);
      if (change === 'deleted') {
        await db.query(`DELETE FROM ips WHERE id = $1`, [id(3)]);
      } else {
        await db.query(
          `UPDATE ip_engagement_aggregates SET total_view_count = $2 WHERE ip_id = $1`,
          [id(3), change === 'more-popular' ? 100 : 0],
        );
      }
      const next = await page({ limit: 2, cursor: first.nextCursor });
      expect(next.pageIds).toEqual([id(2), id(1)]);
      expect(next.nextCursor).toBeNull();
    },
  );

  it('handles an empty list', async () => {
    expect(await page()).toEqual({ pageIds: [], nextCursor: null });
  });

  it.each([
    'not-a-cursor',
    id(1),
    'a'.repeat(513),
    Buffer.from('{"version":1}').toString('base64url'),
    encodePublicIpRankCursor({
      id: id(1),
      score: '9223372036854775808',
      published: '0',
      created: '0',
    }),
    encodePublicIpRankCursor({
      id: id(1),
      score: '1.5',
      published: '0',
      created: '0',
    }),
  ])('rejects invalid cursors rather than restarting: %s', (cursor) => {
    expect(() => publicIpRankQuery(Prisma.sql`TRUE`, 20, cursor)).toThrow(
      BadRequestException,
    );
  });
});

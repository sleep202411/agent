import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { IpPublishersService } from './ip-publishers.service';
import { publisherTestClient } from './ip-publishers.test-adapter';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';

const url = process.env.FD_TEMPLATE_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Concurrent publisher replacement (PostgreSQL)',
  () => {
    let pool: Pool;
    let service: IpPublishersService;
    const schema = `publishers_${randomUUID().replaceAll('-', '')}`;
    const ipId = randomUUID(),
      first = randomUUID(),
      second = randomUUID();
    const pids = new Set<number>();
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/fd_audit'
      )
        throw new Error('Dedicated loopback fixture required');
      pool = new Pool({ connectionString: url, max: 4 });
      await pool.query(`CREATE SCHEMA "${schema}"`);
      await pool.query(`CREATE TABLE "${schema}".ips (id uuid PRIMARY KEY, deleted_at timestamp);
      CREATE TABLE "${schema}".ip_publishers (id uuid PRIMARY KEY, status text NOT NULL);
      CREATE TABLE "${schema}".assignments (ip_id uuid REFERENCES "${schema}".ips(id), publisher_id uuid REFERENCES "${schema}".ip_publishers(id), display_order integer, created_by_id text, UNIQUE(ip_id,publisher_id))`);
      await pool.query(`INSERT INTO "${schema}".ips VALUES ($1, NULL)`, [ipId]);
      await pool.query(
        `INSERT INTO "${schema}".ip_publishers VALUES ($1,'active'),($2,'active')`,
        [first, second],
      );
      service = new IpPublishersService({
        $transaction: async (
          work: (
            tx: ReturnType<typeof publisherTestClient>,
          ) => Promise<unknown>,
        ) => {
          const sql = await pool.connect();
          try {
            pids.add(
              (
                await sql.query<{ pid: number }>(
                  'SELECT pg_backend_pid() AS pid',
                )
              ).rows[0].pid,
            );
            await sql.query('BEGIN');
            await sql.query(`SET LOCAL search_path TO "${schema}"`);
            const result = await work(publisherTestClient(sql));
            await sql.query('COMMIT');
            return result;
          } catch (error) {
            await sql.query('ROLLBACK');
            throw error;
          } finally {
            sql.release();
          }
        },
      } as never);
    });
    afterAll(async () => {
      if (pool) {
        try {
          await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await pool.end();
        }
      }
    });
    it('returns each overlapping replacement snapshot and retains one complete list', async () => {
      const lists = [[first], [], [second, first]];
      const results = await Promise.all(
        lists.map((publisherIds) =>
          service.setForIp({ userId: ipId } as never, ipId, { publisherIds }),
        ),
      );
      expect(
        results.map((result) => result.publishers.map((p) => p.id)),
      ).toEqual(lists);
      expect(pids.size).toBeGreaterThan(1);
      const rows = (
        await pool.query<{ publisher_id: string }>(
          `SELECT publisher_id FROM "${schema}".assignments ORDER BY display_order`,
        )
      ).rows.map((r) => r.publisher_id);
      expect(lists).toContainEqual(rows);
    });
  },
);

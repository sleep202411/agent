import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { CrewProductionKind } from '@prisma/client';
import { ProjectTaskTemplateService } from './project-task-template.service';
import { DEFAULT_SERIES_TASK_TEMPLATE } from './project-task-template.types';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';

const url = process.env.FD_TEMPLATE_TEST_DATABASE_URL;
// Dedicated disposable loopback database; never load application DATABASE_URL.
(url ? describe : describe.skip)(
  'Concurrent template publication (PostgreSQL)',
  () => {
    let pool: Pool;
    const schema = `templates_${randomUUID().replaceAll('-', '')}`;
    let service: ProjectTaskTemplateService;
    const pids = new Set<number>();
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/fd_audit'
      )
        throw new Error('Dedicated loopback template fixture required');
      pool = new Pool({ connectionString: url, max: 4 });
      await pool.query(`CREATE SCHEMA "${schema}"`);
      await pool.query(
        `CREATE TABLE "${schema}".templates (id serial PRIMARY KEY, project_type text NOT NULL, name text NOT NULL, version integer NOT NULL, active boolean NOT NULL, definition jsonb NOT NULL, UNIQUE(project_type, version))`,
      );
      service = new ProjectTaskTemplateService({
        $transaction: async (
          work: (tx: ReturnType<typeof adapter>) => Promise<unknown>,
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
            const result = await work(adapter(sql));
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
    it('serializes simultaneous first and replacement publications without losing a version', async () => {
      const save = (name: string) =>
        service.saveAdmin({
          projectType: CrewProductionKind.series,
          name,
          definition: DEFAULT_SERIES_TASK_TEMPLATE,
        });
      const first = await Promise.all([save('first-a'), save('first-b')]);
      expect(first.map((row) => row.version).sort()).toEqual([1, 2]);
      const next = await Promise.all([save('next-a'), save('next-b')]);
      expect(next.map((row) => row.version).sort()).toEqual([3, 4]);
      expect(pids.size).toBeGreaterThan(1);
      const rows = (
        await pool.query(
          `SELECT version, active FROM "${schema}".templates ORDER BY version`,
        )
      ).rows;
      expect(rows).toEqual([
        { version: 1, active: false },
        { version: 2, active: false },
        { version: 3, active: false },
        { version: 4, active: true },
      ]);
    });
  },
);

function adapter(sql: PoolClient) {
  return {
    $executeRaw: (parts: TemplateStringsArray, ...values: unknown[]) =>
      sql.query(
        parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''),
        values,
      ),
    projectTaskTemplate: {
      findFirst: async ({ where }: { where: { projectType: string } }) =>
        (
          await sql.query<{ version: number }>(
            'SELECT version FROM templates WHERE project_type=$1 ORDER BY version DESC LIMIT 1',
            [where.projectType],
          )
        ).rows[0],
      updateMany: ({ where }: { where: { projectType: string } }) =>
        sql.query(
          'UPDATE templates SET active=false WHERE project_type=$1 AND active',
          [where.projectType],
        ),
      create: async ({
        data,
      }: {
        data: {
          projectType: string;
          name: string;
          version: number;
          active: boolean;
          definition: unknown;
        };
      }) =>
        (
          await sql.query<Record<string, unknown>>(
            'INSERT INTO templates (project_type,name,version,active,definition) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [
              data.projectType,
              data.name,
              data.version,
              data.active,
              JSON.stringify(data.definition),
            ],
          )
        ).rows[0],
    },
  };
}

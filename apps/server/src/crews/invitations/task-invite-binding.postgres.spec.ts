import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';

const url = process.env.TASK01_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Task invitation binding migration (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let sql: Client;
    let crewId: string;
    let taskId: string;
    let otherCrewId: string;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw new Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      sql = new Client({ connectionString: url });
      await sql.connect();
      crewId = `task-invite-${randomUUID()}`;
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Task invite fixture',
          description: '',
          logo: 'https://assets.invalid/logo.png',
          createdByUserId: 'fixture',
        },
      });
      otherCrewId = `task-invite-${randomUUID()}`;
      await db.crew.create({
        data: {
          id: otherCrewId,
          name: 'Other Crew',
          description: '',
          logo: 'https://assets.invalid/logo.png',
          createdByUserId: 'fixture',
        },
      });
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Open',
          color: '#888888',
          semantic: 'open',
          systemKey: 'open',
          position: 0,
          createdByUserId: 'fixture',
        },
      });
      taskId = (
        await db.crewTask.create({
          data: {
            crewId,
            title: 'Claimable task',
            number: 1,
            workflowStateId: state.id,
            createdByUserId: 'fixture',
          },
        })
      ).id;
      await sql.query('BEGIN');
      const installed = await sql.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'crew_invite_links' AND column_name = 'task_id'",
      );
      if (!installed.rowCount)
        await sql.query(
          readFileSync(
            resolve(
              __dirname,
              '../../../prisma/migrations/20261005030000_crew_task_invite_links/migration.sql',
            ),
            'utf8',
          ),
        );
    });
    afterAll(async () => {
      await sql?.query('ROLLBACK');
      await sql?.end();
      if (crewId) await db.crew.delete({ where: { id: crewId } });
      if (otherCrewId) await db.crew.delete({ where: { id: otherCrewId } });
      await db?.$disconnect();
    });

    async function insert(
      task: string | null,
      version: number | null,
      kind = 'member',
      maxUses: number | null = 1,
      targetCrewId = crewId,
    ) {
      return sql.query(
        `INSERT INTO crew_invite_links
      (id, crew_id, token_hash, created_by_user_id, updated_at, kind, max_uses, task_id, task_version)
      VALUES ($1, $2, $3, 'fixture', NOW(), $4, $5, $6, $7)`,
        [
          randomUUID(),
          targetCrewId,
          randomBytes(32).toString('hex'),
          kind,
          maxUses,
          task,
          version,
        ],
      );
    }

    it('keeps ordinary unlimited links valid and permits a single-use task binding', async () => {
      await expect(insert(null, null, 'member', null)).resolves.toMatchObject({
        rowCount: 1,
      });
      await expect(
        insert(null, null, 'community', null),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(insert(taskId, 1)).resolves.toMatchObject({ rowCount: 1 });
    });

    it('rejects binding a valid task from a different Crew', async () => {
      await sql.query('SAVEPOINT cross_crew');
      try {
        await expect(
          insert(taskId, 1, 'member', 1, otherCrewId),
        ).rejects.toMatchObject({
          code: '23503',
          constraint: 'crew_invite_links_task_crew_fk',
        });
      } finally {
        await sql.query('ROLLBACK TO SAVEPOINT cross_crew');
      }
    });

    it.each([
      'missing-version',
      'orphan-version',
      'zero-version',
      'community',
      'unlimited',
      'multiple',
      'missing-task',
    ])(
      'rejects %s task invitation bindings at the database boundary',
      async (kind) => {
        await sql.query('SAVEPOINT invalid_binding');
        try {
          await expect(
            insert(
              kind === 'orphan-version'
                ? null
                : kind === 'missing-task'
                  ? randomUUID()
                  : taskId,
              kind === 'missing-version'
                ? null
                : kind === 'zero-version'
                  ? 0
                  : 1,
              kind === 'community' ? 'community' : 'member',
              kind === 'unlimited' ? null : kind === 'multiple' ? 2 : 1,
            ),
          ).rejects.toMatchObject({
            code: kind === 'missing-task' ? '23503' : '23514',
          });
        } finally {
          await sql.query('ROLLBACK TO SAVEPOINT invalid_binding');
        }
      },
    );
  },
);

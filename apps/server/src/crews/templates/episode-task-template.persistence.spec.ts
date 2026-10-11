import {
  deliveryFolderAdapter,
  deliveryFolderSql,
} from '../tasks/testing/delivery-folder-sql';
import { Prisma } from '@prisma/client';
import { EpisodeTaskTemplateService } from './episode-task-template';
import { ProjectTaskTemplateService } from './project-task-template.service';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
type Sql = Pick<import('@electric-sql/pglite').PGlite, 'query'>;
const episode1 = '01990000-0000-7000-8000-000000000011';
const episode2 = '01990000-0000-7000-8000-000000000012';
const fieldId = '01990000-0000-7000-8000-000000000013';
let requiredFields = false;
// Isolated SQL persistence adapter. No application DATABASE_URL or remote database.
function adapter(sql: Sql) {
  return {
    ...deliveryFolderAdapter(sql),
    crew: {
      findUniqueOrThrow: () => Promise.resolve({ productionKind: 'series' }),
    },
    crewEpisode: {
      findFirst: async ({ where }: { where: { id: string; crewId: string } }) =>
        (
          await sql.query(
            'SELECT id, version, status FROM crew_episodes WHERE id=$1 AND crew_id=$2',
            [where.id, where.crewId],
          )
        ).rows[0] ?? null,
    },
    projectTaskTemplate: { findFirst: () => Promise.resolve(null) },
    crewTaskFieldDefinition: {
      findMany: () =>
        Promise.resolve(
          requiredFields
            ? [
                {
                  id: fieldId,
                  name: 'Brief',
                  type: 'text',
                  required: true,
                  options: [],
                },
              ]
            : [],
        ),
    },
    crewTaskWorkflowState: { findFirst: () => Promise.resolve({ id: 'open' }) },
    crewTask: {
      findMany: async ({
        where,
      }: {
        where: {
          crewId: string;
          episodeId: string;
          metadata: { equals?: string };
        };
      }) =>
        (
          await sql.query(
            "SELECT id, metadata FROM tasks WHERE crew_id=$1 AND episode_id=$2 AND metadata->>'templateId' IS NOT NULL AND ($3::text IS NULL OR metadata->>'templateId'=$3) ORDER BY number",
            [where.crewId, where.episodeId, where.metadata.equals ?? null],
          )
        ).rows,
      findFirst: async () => {
        const row = (
          await sql.query<{ number: number; rank: string }>(
            'SELECT number,rank FROM tasks ORDER BY number DESC LIMIT 1',
          )
        ).rows[0];
        return row ? { ...row, rank: new Prisma.Decimal(row.rank) } : null;
      },
      create: async ({
        data,
      }: {
        data: {
          id: string;
          crewId: string;
          episodeId: string;
          number: number;
          rank: Prisma.Decimal;
          metadata: unknown;
          customFieldValues?: {
            create: Array<{
              fieldId: string;
              value: unknown;
              updatedByUserId: string;
            }>;
          };
        };
      }) => {
        await sql.query('INSERT INTO tasks VALUES ($1,$2,$3,$4,$5,$6)', [
          data.id,
          data.crewId,
          data.episodeId,
          data.number,
          data.rank.toString(),
          JSON.stringify(data.metadata),
        ]);
        for (const field of data.customFieldValues?.create ?? []) {
          await sql.query('INSERT INTO field_values VALUES ($1,$2,$3,$4)', [
            data.id,
            field.fieldId,
            JSON.stringify(field.value),
            field.updatedByUserId,
          ]);
        }
        return data;
      },
    },
    crewTaskDependency: {
      create: ({
        data,
      }: {
        data: { blockingTaskId: string; blockedTaskId: string };
      }) =>
        sql.query('INSERT INTO dependencies VALUES($1,$2)', [
          data.blockingTaskId,
          data.blockedTaskId,
        ]),
    },
    crewProductionActivity: {
      findFirst: async ({
        where,
      }: {
        where: { crewId: string; payload: { equals: string } };
      }) =>
        (
          await sql.query(
            "SELECT payload FROM receipts WHERE crew_id=$1 AND payload->>'templateApplication'=$2",
            [where.crewId, where.payload.equals],
          )
        ).rows[0] ?? null,
      create: ({ data }: { data: { crewId: string; payload: unknown } }) =>
        sql.query('INSERT INTO receipts VALUES($1,$2)', [
          data.crewId,
          JSON.stringify(data.payload),
        ]),
    },
  };
}
describe('Episode template SQL persistence', () => {
  let db: import('@electric-sql/pglite').PGlite;
  let service: EpisodeTaskTemplateService;
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(deliveryFolderSql);
    // Episode creation resolves the current delivery catalogue, even when no
    // custom delivery categories have been configured for this fixture.
    await db.exec(`CREATE TABLE crew_delivery_catalog_revisions(
      category_id uuid NOT NULL, version integer NOT NULL, definition jsonb NOT NULL,
      PRIMARY KEY(category_id, version)
    );`);
    await db.exec(`CREATE TABLE crew_episodes(id uuid PRIMARY KEY,crew_id text,version integer,status text);
  CREATE TABLE tasks(id uuid PRIMARY KEY,crew_id text,episode_id uuid,number integer UNIQUE,rank numeric,metadata jsonb);
  CREATE TABLE dependencies(blocking_id uuid REFERENCES tasks(id),blocked_id uuid REFERENCES tasks(id),PRIMARY KEY(blocking_id,blocked_id));
  CREATE TABLE receipts(crew_id text,payload jsonb);
  CREATE TABLE field_values(task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,field_id uuid,value jsonb NOT NULL,updated_by text NOT NULL,PRIMARY KEY(task_id,field_id));`);
    const prisma = {
      $transaction: (
        run: (tx: ReturnType<typeof adapter>) => Promise<unknown>,
      ) => db.transaction((tx) => run(adapter(tx))),
    };
    service = new EpisodeTaskTemplateService(
      prisma as never,
      { require: () => Promise.resolve({}) } as never,
      new ProjectTaskTemplateService({} as never),
      {
        broadcastCrewTaskProjectChange: () => Promise.resolve(),
        broadcastCrewTaskChange: () => Promise.resolve(),
      } as never,
    );
  }, 30000);
  beforeEach(async () => {
    requiredFields = false;
    await db.exec('TRUNCATE fixture_asset_nodes, crew_task_delivery_folders');
    await db.exec(
      'DELETE FROM dependencies;DELETE FROM tasks;DELETE FROM receipts;DELETE FROM crew_episodes;',
    );
    await db.query(
      "INSERT INTO crew_episodes VALUES ($1,'crew',1,'planned'),($2,'crew',1,'planned')",
      [episode1, episode2],
    );
  });
  afterAll(async () => {
    await db.close();
  });
  it('creates one complete group per episode and replays without duplicate tasks or dependencies', async () => {
    const plan = await service.preview('crew', episode1, 'user');
    const first = await service.apply('crew', episode1, 'user', plan);
    const retry = await service.apply('crew', episode1, 'user', plan);
    const second = await service.apply(
      'crew',
      episode2,
      'user',
      await service.preview('crew', episode2, 'user'),
    );
    expect(first.taskIds).toHaveLength(12);
    expect(retry).toEqual({ ...first, replayed: true });
    expect(second.taskIds).toHaveLength(12);
    expect(
      (await db.query('SELECT * FROM crew_task_delivery_folders')).rows,
    ).toHaveLength(24);
    expect(
      (
        await db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM tasks',
        )
      ).rows[0].count,
    ).toBe(24);
    expect(
      (
        await db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM receipts',
        )
      ).rows[0].count,
    ).toBe(2);
    expect(
      (
        await db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM dependencies',
        )
      ).rows[0].count,
    ).toBeGreaterThan(0);
  });
  it('rolls back every task and the receipt when a dependency insert fails', async () => {
    await db.exec(
      'ALTER TABLE dependencies ADD CONSTRAINT fail_link CHECK(false) NOT VALID',
    );
    try {
      await expect(
        service.apply(
          'crew',
          episode1,
          'user',
          await service.preview('crew', episode1, 'user'),
        ),
      ).rejects.toThrow();
      expect(
        (
          await db.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM tasks',
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await db.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM receipts',
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (await db.query('SELECT * FROM crew_task_delivery_folders')).rows,
      ).toHaveLength(0);
      expect(
        (await db.query('SELECT * FROM fixture_asset_nodes')).rows,
      ).toHaveLength(0);
    } finally {
      await db.exec('ALTER TABLE dependencies DROP CONSTRAINT fail_link');
    }
  });
  it('does not recreate removed tasks on a lost-response retry', async () => {
    const plan = await service.preview('crew', episode1, 'user');
    const first = await service.apply('crew', episode1, 'user', plan);
    await db.exec('DELETE FROM dependencies;DELETE FROM tasks;');
    expect(await service.apply('crew', episode1, 'user', plan)).toEqual({
      ...first,
      replayed: true,
    });
    expect(
      (
        await db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM tasks',
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it('persists each reviewed custom field and actor atomically with the episode receipt', async () => {
    requiredFields = true;
    const plan = await service.preview('crew', episode1, 'user');
    const taskFields = plan.items.map((item) => ({
      templateKey: item.templateKey,
      values: [{ fieldId, value: `Brief ${item.templateKey}` }],
    }));
    const command = { ...plan, taskFields };
    await service.apply('crew', episode1, 'reviewer', command);
    const rows = (
      await db.query<{ value: string; updated_by: string }>(
        'SELECT value,updated_by FROM field_values',
      )
    ).rows;
    expect(rows).toHaveLength(plan.items.length);
    expect(rows.every((row) => row.updated_by === 'reviewer')).toBe(true);
    expect(rows.map((row) => row.value).sort()).toEqual(
      taskFields.map((row) => row.values[0].value).sort(),
    );
    expect(
      (await service.apply('crew', episode1, 'reviewer', command)).replayed,
    ).toBe(true);
    expect((await db.query('SELECT * FROM field_values')).rows).toHaveLength(
      plan.items.length,
    );
  });
  it('rolls back tasks, custom fields and receipts together on field persistence failure', async () => {
    requiredFields = true;
    const plan = await service.preview('crew', episode1, 'user');
    await db.exec(
      'ALTER TABLE field_values ADD CONSTRAINT fail_field CHECK(false) NOT VALID',
    );
    try {
      await expect(
        service.apply('crew', episode1, 'reviewer', {
          ...plan,
          taskFields: plan.items.map((item) => ({
            templateKey: item.templateKey,
            values: [{ fieldId, value: 'Brief' }],
          })),
        }),
      ).rejects.toThrow();
      for (const table of ['tasks', 'field_values', 'receipts'])
        expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
    } finally {
      await db.exec('ALTER TABLE field_values DROP CONSTRAINT fail_field');
    }
  });
});

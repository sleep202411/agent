import {
  deliveryFolderAdapter,
  deliveryFolderSql,
} from '../tasks/testing/delivery-folder-sql';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CrewCanvasTaskImportService } from './canvas-task-import';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
type Sql = Pick<import('@electric-sql/pglite').PGlite, 'query'>;
const projectId = '01990000-0000-7000-8000-000000000001';
const input = { sourceRevision: 3, sourceHash: 'a'.repeat(64) };
let failSecondWrite = false;
function adapter(sql: Sql) {
  return {
    ...deliveryFolderAdapter(sql),
    crew: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        (
          await sql.query(
            'SELECT id, workspace AS "studioWorkspaceId", kind AS "productionKind" FROM crews WHERE id=$1',
            [where.id],
          )
        ).rows[0],
    },
    storyProject: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (
          await sql.query(
            'SELECT workspace AS "workspaceId", status FROM story_projects WHERE id=$1',
            [where.id],
          )
        ).rows[0],
    },
    storyDraft: {
      findUnique: async ({ where }: { where: { storyProjectId: string } }) =>
        (
          await sql.query(
            'SELECT revision, hash AS "contentHash" FROM story_drafts WHERE story_project_id=$1',
            [where.storyProjectId],
          )
        ).rows[0],
    },
    crewProductionActivity: {
      findFirst: async ({
        where,
      }: {
        where: { crewId: string; payload: { equals: string; path: string[] } };
      }) =>
        (
          await sql.query(
            'SELECT payload FROM activity WHERE crew=$1 AND payload->>$3=$2',
            [where.crewId, where.payload.equals, where.payload.path[0]],
          )
        ).rows[0],
      create: ({ data }: { data: { crewId: string; payload: unknown } }) =>
        sql.query('INSERT INTO activity(crew,payload) VALUES ($1,$2)', [
          data.crewId,
          JSON.stringify(data.payload),
        ]),
    },
    crewTaskFieldDefinition: { count: () => Promise.resolve(0) },
    crewTaskWorkflowState: { findFirst: () => Promise.resolve({ id: 'open' }) },
    crewTask: {
      findMany: async ({
        where,
      }: {
        where: { crewId: string; metadata: { equals: string } };
      }) =>
        (
          await sql.query(
            "SELECT id,metadata FROM tasks WHERE crew=$1 AND metadata->>'canvasTaskImport'=$2",
            [where.crewId, where.metadata.equals],
          )
        ).rows,
      findFirst: async ({ where }: { where: { crewId: string } }) => {
        const row = (
          await sql.query<{ number: number; rank: string }>(
            'SELECT number, rank FROM tasks WHERE crew=$1 ORDER BY number DESC LIMIT 1',
            [where.crewId],
          )
        ).rows[0];
        return row
          ? { number: row.number, rank: new Prisma.Decimal(row.rank) }
          : null;
      },
      create: async ({
        data,
      }: {
        data: {
          crewId: string;
          number: number;
          rank: Prisma.Decimal;
          title: string;
          metadata: unknown;
        };
      }) => {
        if (failSecondWrite && data.number === 2)
          throw new Error('Second task failed');
        const id = randomUUID();
        await sql.query(
          'INSERT INTO tasks(id,crew,number,rank,title,metadata) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            id,
            data.crewId,
            data.number,
            data.rank.toString(),
            data.title,
            JSON.stringify(data.metadata),
          ],
        );
        return { id, ...data };
      },
    },
  };
}
describe('Canvas import isolated SQL persistence', () => {
  let db: import('@electric-sql/pglite').PGlite;
  let service: CrewCanvasTaskImportService;
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(deliveryFolderSql);
    await db.exec(`CREATE TABLE crews(id text PRIMARY KEY, workspace text, kind text);
      CREATE TABLE story_projects(id uuid PRIMARY KEY, workspace text, status text);
      CREATE TABLE story_drafts(id uuid PRIMARY KEY, story_project_id uuid UNIQUE, revision int, hash text);
      CREATE TABLE tasks(id uuid PRIMARY KEY, crew text, number int, rank numeric, title varchar(180), metadata jsonb, UNIQUE(crew,number));
      CREATE TABLE activity(id serial PRIMARY KEY, crew text, payload jsonb);`);
    await db.query('INSERT INTO crews VALUES ($1,$2,$3)', [
      'crew',
      'workspace',
      'interactive_film',
    ]);
    await db.query('INSERT INTO story_projects VALUES ($1,$2,$3)', [
      projectId,
      'workspace',
      'active',
    ]);
    await db.query('INSERT INTO story_drafts VALUES ($1,$2,$3,$4)', [
      randomUUID(),
      projectId,
      3,
      input.sourceHash,
    ]);
    service = new CrewCanvasTaskImportService(
      {
        $transaction: (
          work: (tx: ReturnType<typeof adapter>) => Promise<unknown>,
        ) => db.transaction((tx) => work(adapter(tx))),
      } as never,
      { require: () => Promise.resolve(undefined) } as never,
      {
        requireProjectInTransaction: () => Promise.resolve(undefined),
        requireProject: () =>
          Promise.resolve({ project: { workspaceId: 'workspace' } }),
      } as never,
      { broadcastCrewTaskChange: () => Promise.resolve(undefined) } as never,
    );
    jest.spyOn(service, 'preview').mockResolvedValue({
      crewId: 'crew',
      projectId,
      title: 'Story',
      importKey: '01990000-0000-7000-8000-000000000009',
      existingSourceNodeIds: [],
      ...input,
      plotTree: {
        title: 'Story',
        startNodeId: 'one',
        nodes: ['one', 'two'].map((id) => ({
          id,
          type: 'scene',
          content: { title: id, description: '' },
          transitions: [],
        })),
      },
    });
  }, 30000);
  beforeEach(async () => {
    failSecondWrite = false;
    await db.exec(
      'TRUNCATE tasks, activity, fixture_asset_nodes, crew_task_delivery_folders',
    );
  });
  afterAll(async () => {
    await db.close();
  });
  it('persists one task set for simultaneous identical imports', async () => {
    const results = await Promise.all([
      service.apply('crew', projectId, 'user', input),
      service.apply('crew', projectId, 'user', input),
    ]);
    expect(results[0].taskIds).toEqual(results[1].taskIds);
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(2);
    expect(
      (await db.query('SELECT * FROM crew_task_delivery_folders')).rows,
    ).toHaveLength(2);
    expect((await db.query('SELECT * FROM activity')).rows).toHaveLength(1);
  });
  it('rolls back every task when a later task write fails', async () => {
    failSecondWrite = true;
    await expect(
      service.apply('crew', projectId, 'user', input),
    ).rejects.toThrow('Second task failed');
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(0);
    expect(
      (await db.query('SELECT * FROM crew_task_delivery_folders')).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT * FROM fixture_asset_nodes')).rows,
    ).toHaveLength(0);
    expect((await db.query('SELECT * FROM activity')).rows).toHaveLength(0);
    failSecondWrite = false;
    await expect(
      service.apply('crew', projectId, 'user', input),
    ).resolves.toMatchObject({ replayed: false });
  });
  it('reimports missing tasks explicitly while replaying the original command without resurrection', async () => {
    const first = { ...input, importKey: randomUUID() };
    const original = await service.apply('crew', projectId, 'user', first);
    await db.query('DELETE FROM tasks WHERE id=$1', [original.taskIds[0]]);
    await expect(
      service.apply('crew', projectId, 'user', first),
    ).resolves.toMatchObject({ replayed: true, taskIds: original.taskIds });
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(1);
    const next = { ...input, importKey: randomUUID() };
    const replacement = await service.apply('crew', projectId, 'user', next);
    expect(replacement.taskIds).toHaveLength(1);
    expect(replacement.taskIds[0]).not.toBe(original.taskIds[0]);
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(2);
    await expect(
      service.apply('crew', projectId, 'user', next),
    ).resolves.toMatchObject({ replayed: true, taskIds: replacement.taskIds });
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(2);
  });
});

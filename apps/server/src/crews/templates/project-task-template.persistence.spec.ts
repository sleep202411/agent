import { CrewProductionKind, type Prisma } from '@prisma/client';
import { ProjectTaskTemplateService } from './project-task-template.service';

const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');

type SqlClient = Pick<import('@electric-sql/pglite').PGlite, 'query'>;

// Execute the service's transaction boundary against an isolated SQL engine.
// No application environment or external database connection is used.
function client(sql: SqlClient) {
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
            'SELECT version FROM templates WHERE project_type = $1 ORDER BY version DESC LIMIT 1',
            [where.projectType],
          )
        ).rows[0] ?? null,
      updateMany: ({ where }: { where: { projectType: string } }) =>
        sql.query(
          'UPDATE templates SET active = false WHERE project_type = $1 AND active',
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
          definition: Prisma.InputJsonValue;
        };
      }) =>
        (
          await sql.query(
            'INSERT INTO templates (project_type, name, version, active, definition) VALUES ($1,$2,$3,$4,$5) RETURNING *',
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

describe('Project task template publication persistence', () => {
  let db: import('@electric-sql/pglite').PGlite;
  let service: ProjectTaskTemplateService;
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(
      'CREATE TABLE templates (id serial PRIMARY KEY, project_type text NOT NULL, name varchar(120) NOT NULL, version integer NOT NULL, active boolean NOT NULL, definition jsonb NOT NULL, UNIQUE(project_type, version))',
    );
    service = new ProjectTaskTemplateService({
      ...client(db),
      $transaction: (
        work: (tx: ReturnType<typeof client>) => Promise<unknown>,
      ) => db.transaction((tx) => work(client(tx))),
    } as never);
  }, 30000);
  beforeEach(async () => {
    await db.exec('DELETE FROM templates');
  });
  afterAll(async () => {
    await db.close();
  });

  const save = (
    name: string,
    projectType: CrewProductionKind = CrewProductionKind.series,
  ) => service.saveAdmin({ projectType, name, definition: { items: [] } });

  it('keeps the previous active version when its replacement cannot be inserted', async () => {
    await save('original');
    await expect(save('x'.repeat(121))).rejects.toThrow();
    expect(
      (await db.query('SELECT name, version, active FROM templates')).rows,
    ).toEqual([{ name: 'original', version: 1, active: true }]);
  });

  it('publishes distinct sequential versions and retains exactly one active template', async () => {
    await Promise.all([save('first'), save('second')]);
    expect(
      (await db.query('SELECT version, active FROM templates ORDER BY version'))
        .rows,
    ).toEqual([
      { version: 1, active: false },
      { version: 2, active: true },
    ]);
  });

  it('uses the same version sequence for plot imports and admin saves, without changing other project types', async () => {
    await save('series');
    await save('film', CrewProductionKind.interactive_film);
    await service.importPlotTree({
      title: 'Imported story',
      description: '',
      startNodeId: 'ending',
      nodes: [
        {
          id: 'ending',
          type: 'ending',
          content: { title: 'End' },
          transitions: [],
        },
      ],
    });
    expect(
      (
        await db.query(
          'SELECT project_type, version, active FROM templates ORDER BY project_type, version',
        )
      ).rows,
    ).toEqual([
      { project_type: 'interactive_film', version: 1, active: false },
      { project_type: 'interactive_film', version: 2, active: true },
      { project_type: 'series', version: 1, active: true },
    ]);
  });
});

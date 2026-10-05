jest.mock('../tasks/task-delivery-folder', () => ({
  provisionTaskDeliveryFolderTx: jest.fn().mockResolvedValue('folder'),
}));
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryboardChildrenService } from './storyboard-children.service';

const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
type SqlClient = Pick<import('@electric-sql/pglite').PGlite, 'query'>;
type Task = {
  id: string;
  crewId: string;
  parentId: string | null;
  number: number;
  rank: string;
  title: string;
  metadata: Record<string, unknown>;
  workflowStateId: string;
  version: number;
};
type Where = {
  taskKind?: string;
  id?: string;
  crewId?: string;
  parentId?: string;
  metadata?: { path?: string[]; equals: string };
  AND?: Array<{ metadata: { path: string[]; equals: string } }>;
  OR?: unknown;
};
const tree = {
  nodes: [{ id: 'node', type: 'ending', content: { title: 'Ending' } }],
};

function client(sql: SqlClient) {
  const find = async ({
    where,
    orderBy,
  }: {
    where: Where;
    orderBy?: unknown;
  }) => {
    const params: unknown[] = [];
    const filters: string[] = [];
    for (const column of ['id', 'crewId', 'parentId', 'taskKind'] as const) {
      if (where[column] !== undefined) {
        params.push(where[column]);
        filters.push(`"${column}" = $${params.length}`);
      }
    }
    if (where.metadata) {
      params.push(where.metadata.equals);
      const key =
        where.metadata.path?.[0] === 'canvasTaskImport'
          ? 'canvasTaskImport'
          : 'plotTreeNodeId';
      filters.push(`metadata->>'${key}' = $${params.length}`);
    }
    for (const condition of where.AND ?? []) {
      params.push(condition.metadata.path[0], condition.metadata.equals);
      filters.push(`metadata->>$${params.length - 1} = $${params.length}`);
    }
    if (where.OR) filters.push("metadata->>'templateKey' = 'storyboard'");
    return (
      await sql.query<Task>(
        `SELECT * FROM tasks WHERE ${filters.join(' AND ') || 'true'} ${orderBy ? 'ORDER BY number DESC' : ''}`,
        params,
      )
    ).rows.map((row) => ({
      ...row,
      rank: new Prisma.Decimal(row.rank),
      workflowState: { semantic: row.workflowStateId },
    }));
  };
  return {
    $executeRaw: (parts: TemplateStringsArray, ...values: unknown[]) =>
      sql.query(
        parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''),
        values,
      ),
    projectTaskTemplate: {
      findFirst: () => Promise.resolve({ definition: { plotTree: tree } }),
    },
    crewTaskWorkflowState: { findFirst: () => Promise.resolve({ id: 'open' }) },
    crewTask: {
      findFirst: async (input: Parameters<typeof find>[0]) =>
        (await find(input))[0] ?? null,
      findMany: find,
      create: async ({
        data,
      }: {
        data: Omit<Task, 'rank' | 'version'> & { rank: Prisma.Decimal };
      }) =>
        (
          await sql.query<Task>(
            'INSERT INTO tasks (id,"crewId","parentId",number,rank,title,metadata,"workflowStateId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            [
              data.id,
              data.crewId,
              data.parentId,
              data.number,
              data.rank.toString(),
              data.title,
              JSON.stringify(data.metadata),
              data.workflowStateId,
            ],
          )
        ).rows[0],
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { parentId: string; metadata: unknown };
      }) =>
        sql.query(
          'UPDATE tasks SET "parentId"=$1, metadata=$2, version=version+1 WHERE id=$3',
          [data.parentId, JSON.stringify(data.metadata), where.id],
        ),
    },
  };
}

describe('Storyboard task writes', () => {
  let db: import('@electric-sql/pglite').PGlite;
  let service: StoryboardChildrenService;
  const requirePermission = jest.fn();
  const projectPermission = jest.fn();
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(
      'CREATE TABLE tasks (id text PRIMARY KEY, "crewId" text NOT NULL, "parentId" text, number integer NOT NULL, rank numeric NOT NULL, title text NOT NULL, metadata jsonb NOT NULL, "workflowStateId" text NOT NULL, version integer NOT NULL DEFAULT 0, "taskKind" text NOT NULL DEFAULT \'storyboard\', UNIQUE("crewId", number))',
    );
    service = new StoryboardChildrenService(
      {
        ...client(db),
        platformProject: {
          findUnique: () => Promise.resolve({ studioCrew: { id: 'crew' } }),
        },
        $transaction: (
          work: (tx: ReturnType<typeof client>) => Promise<unknown>,
        ) => db.transaction((tx) => work(client(tx))),
      } as never,
      {} as never,
      { requireProjectRole: projectPermission } as never,
      { require: requirePermission } as never,
    );
  }, 30000);
  beforeEach(async () => {
    requirePermission.mockReset().mockResolvedValue(undefined);
    projectPermission.mockReset().mockResolvedValue(undefined);
    await db.exec(
      `DELETE FROM tasks; INSERT INTO tasks (id,"crewId","parentId",number,rank,title,metadata,"workflowStateId",version) VALUES ('parent','crew',NULL,1,1024,'Parent','{"templateKey":"storyboard"}','completed',0)`,
    );
  });
  afterAll(async () => {
    await db.close();
  });
  const create = (title?: string) =>
    service.create('project', 'node', 'user', { title });

  it('returns one open child for repeated concurrent creation without overwriting its title', async () => {
    const results = await Promise.all([
      create('Original'),
      create('Replacement'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      (
        await db.query(
          'SELECT title, "workflowStateId", number FROM tasks WHERE "parentId" = $1',
          ['parent'],
        )
      ).rows,
    ).toEqual([{ title: 'Original', workflowStateId: 'open', number: 2 }]);
  });

  it.each(['create', 'link'] as const)(
    'does not let project viewing permission authorize a %s mutation',
    async (action) => {
      requirePermission.mockRejectedValue(new ForbiddenException());
      const operation =
        action === 'create'
          ? create()
          : service.link('project', 'node', 'user', { taskId: 'parent' });
      await expect(operation).rejects.toThrow(ForbiddenException);
      expect(requirePermission).toHaveBeenCalledWith(
        'crew',
        'user',
        'tasks.manage',
        expect.anything(),
      );
      expect(
        (await db.query('SELECT count(*)::int AS count FROM tasks')).rows,
      ).toEqual([{ count: 1 }]);
    },
  );

  it('rolls back a created task if task-management permission is lost during the write', async () => {
    requirePermission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(create()).rejects.toThrow(ForbiddenException);
    expect(
      (await db.query('SELECT count(*)::int AS count FROM tasks')).rows,
    ).toEqual([{ count: 1 }]);
  });

  it('refuses to link the storyboard parent underneath itself', async () => {
    await expect(
      service.link('project', 'node', 'user', { taskId: 'parent' }),
    ).rejects.toThrow('Linking this task would create a task hierarchy cycle.');
    expect(
      (await db.query('SELECT "parentId" FROM tasks WHERE id=$1', ['parent']))
        .rows[0],
    ).toEqual({ parentId: null });
  });

  it('refuses to link an ancestor underneath its descendant', async () => {
    await db.exec(
      `INSERT INTO tasks (id,"crewId","parentId",number,rank,title,metadata,"workflowStateId",version) VALUES ('ancestor','crew',NULL,2,2048,'Ancestor','{}','open',0); UPDATE tasks SET "parentId"='ancestor' WHERE id='parent'`,
    );
    await expect(
      service.link('project', 'node', 'user', { taskId: 'ancestor' }),
    ).rejects.toThrow('Linking this task would create a task hierarchy cycle.');
  });

  it('preserves the first link and existing metadata across repeated link/create requests', async () => {
    await db.exec(
      `INSERT INTO tasks (id,"crewId","parentId",number,rank,title,metadata,"workflowStateId",version) VALUES ('existing','crew',NULL,2,2048,'Existing','{"preserved":true}','open',0)`,
    );
    const result = await service.link('project', 'node', 'user', {
      taskId: 'existing',
    });
    expect(await create('Do not overwrite')).toEqual(result);
    expect(
      await service.link('project', 'node', 'user', { taskId: 'parent' }),
    ).toEqual(result);
    expect(
      (
        await db.query(
          'SELECT title, metadata, version FROM tasks WHERE id=$1',
          ['existing'],
        )
      ).rows[0],
    ).toEqual({
      title: 'Existing',
      metadata: { preserved: true, plotTreeNodeId: 'node' },
      version: 1,
    });
  });

  it('shows canvas imports with live status only in their source project', async () => {
    await db.query(
      'INSERT INTO tasks (id,"crewId",number,rank,title,metadata,"workflowStateId") VALUES ($1,$2,2,2048,$3,$4,$5)',
      [
        'import-task',
        'crew',
        'Canvas Scene',
        JSON.stringify({
          canvasTaskImport: 'project',
          sourceNodeId: 'scene-1',
        }),
        'open',
      ],
    );
    expect(await service.list('project', 'user')).toEqual([
      {
        nodeId: 'scene-1',
        nodeType: 'scene',
        title: 'Canvas Scene',
        taskId: 'import-task',
        status: 'open',
      },
    ]);
    await db.exec(
      `UPDATE tasks SET "workflowStateId"='completed' WHERE id='import-task'`,
    );
    expect(await service.list('project', 'user')).toEqual([
      expect.objectContaining({ taskId: 'import-task', status: 'completed' }),
    ]);
    expect(await service.list('other-project', 'user')).toEqual([
      expect.objectContaining({ nodeId: 'node', taskId: null }),
    ]);
    await expect(
      service.create('project', 'scene-1', 'user', {}),
    ).resolves.toEqual({ taskId: 'import-task' });
    await expect(
      service.link('project', 'scene-1', 'user', { taskId: 'parent' }),
    ).resolves.toEqual({ taskId: 'import-task' });
    await expect(
      service.link('other-project', 'node', 'user', { taskId: 'import-task' }),
    ).rejects.toThrow('already linked to an imported canvas node');
  });

  it('uses the imported crew graph instead of the current global template', async () => {
    const snapshot = {
      title: 'Crew story',
      startNodeId: 'imported',
      nodes: [
        {
          id: 'imported',
          type: 'ending',
          content: { title: 'Imported ending' },
          transitions: [],
        },
      ],
    };
    await db.query(
      'INSERT INTO tasks (id,"crewId",number,rank,title,metadata,"workflowStateId","taskKind") VALUES ($1,$2,2,2048,$3,$4,$5,$6)',
      [
        'plot',
        'crew',
        'Plot',
        JSON.stringify({ plotTree: snapshot }),
        'open',
        'plot_tree',
      ],
    );
    expect(await service.list('project', 'user')).toEqual([
      {
        nodeId: 'imported',
        nodeType: 'ending',
        title: 'Imported ending',
        taskId: null,
        status: null,
      },
    ]);
    await expect(create()).rejects.toThrow('Plot tree node node not found');
    const created = await service.create('project', 'imported', 'user', {});
    expect(
      (await db.query('SELECT title FROM tasks WHERE id=$1', [created.taskId]))
        .rows,
    ).toEqual([{ title: 'Imported ending' }]);
  });

  it('does not replace a malformed imported graph with unrelated global nodes', async () => {
    await db.exec(
      `INSERT INTO tasks (id,"crewId",number,rank,title,metadata,"workflowStateId","taskKind") VALUES ('plot','crew',2,2048,'Plot','{"plotTree":{}}','open','plot_tree')`,
    );
    await expect(create()).rejects.toThrow(
      'The imported crew plot tree is invalid.',
    );
  });
});

jest.mock('../tasks/task-delivery-folder', () => ({
  provisionTaskDeliveryFolderTx: jest.fn().mockResolvedValue('folder'),
}));
import {
  EpisodeTaskTemplateService,
  ApplyEpisodeTemplateSchema,
} from './episode-task-template';
import { ProjectTaskTemplateService } from './project-task-template.service';
import { DEFAULT_SERIES_TASK_TEMPLATE } from './project-task-template.types';

const input = {
  templateId: '01990000-0000-7000-8000-000000000001',
  templateVersion: 1,
  episodeVersion: 1,
};
function setup() {
  const template = {
    id: input.templateId,
    version: 1,
    name: 'Standard',
    definition: DEFAULT_SERIES_TASK_TEMPLATE,
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
    crew: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ productionKind: 'series' }),
    },
    crewEpisode: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'episode', status: 'planned', version: 1 }),
    },
    crewTask: { findMany: jest.fn().mockResolvedValue([]) },
    crewTaskFieldDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    crewTaskWorkflowState: {
      findFirst: jest.fn().mockResolvedValue({ id: 'open' }),
    },
    crewProductionActivity: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: jest.fn((run: (db: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const auth = { require: jest.fn().mockResolvedValue({}) };
  const templates = {
    resolveActiveTemplate: jest.fn().mockResolvedValue(template),
    instantiateTasks: jest.fn().mockResolvedValue([{ id: 'task' }]),
  };
  const service = new EpisodeTaskTemplateService(
    prisma as never,
    auth as never,
    templates as never,
    {
      broadcastCrewTaskProjectChange: jest.fn().mockResolvedValue(undefined),
      broadcastCrewTaskChange: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
  return { service, tx, auth, templates, template };
}
describe('Episode task templates', () => {
  it('previews the server template without creating tasks', async () => {
    const { service, templates, auth } = setup();
    const result = await service.preview('crew', 'episode', 'user');
    expect(result.items).toHaveLength(12);
    expect(result).toMatchObject(input);
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
    expect(auth.require).toHaveBeenCalledTimes(2);
  });
  it('applies an episode-scoped batch under task/episode/template locks and stores a durable receipt', async () => {
    const { service, templates, tx, auth } = setup();
    expect(await service.apply('crew', 'episode', 'user', input)).toEqual({
      taskIds: ['task'],
      replayed: false,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(
      (templates.instantiateTasks.mock.calls as unknown[][])[0][3],
    ).toMatchObject({
      episodeId: 'episode',
      episodeScoped: true,
      userId: 'user',
      workflowStateId: 'open',
    });
    expect(
      (
        tx.crewProductionActivity.create.mock.calls as {
          data: { payload: unknown };
        }[][]
      )[0][0].data.payload,
    ).toMatchObject({ templateApplication: 'episode', taskIds: ['task'] });
    expect(auth.require).toHaveBeenCalledTimes(2);
  });
  it('replays a receipt even after tasks move or the published template changes', async () => {
    const { service, templates, tx } = setup();
    tx.crewProductionActivity.findFirst.mockResolvedValue({
      payload: { ...input, taskIds: ['original'] },
    });
    expect(await service.apply('crew', 'episode', 'user', input)).toEqual({
      taskIds: ['original'],
      replayed: true,
    });
    expect(templates.resolveActiveTemplate).not.toHaveBeenCalled();
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it('recognizes template tasks created during Crew initialization', async () => {
    const { service, templates, tx } = setup();
    tx.crewTask.findMany.mockResolvedValue([{ id: 'seed', metadata: input }]);
    expect(await service.apply('crew', 'episode', 'user', input)).toEqual({
      taskIds: ['seed'],
      replayed: true,
    });
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
    expect(
      (
        tx.crewTask.findMany.mock.calls as {
          where: { episodeId: string; crewId: string };
        }[][]
      )[0][0].where,
    ).toMatchObject({
      crewId: 'crew',
      episodeId: 'episode',
    });
  });
  it.each(['episodeVersion', 'templateVersion'] as const)(
    'rejects a stale %s',
    async (field) => {
      const { service, templates } = setup();
      await expect(
        service.apply('crew', 'episode', 'user', { ...input, [field]: 2 }),
      ).rejects.toThrow('Refresh the preview');
      expect(templates.instantiateTasks).not.toHaveBeenCalled();
    },
  );
  it.each(['completed', 'cancelled', 'in_review'])(
    'rejects a %s episode',
    async (status) => {
      const { service, tx, templates } = setup();
      tx.crewEpisode.findFirst.mockResolvedValue({
        id: 'episode',
        version: 1,
        status,
      });
      await expect(
        service.apply('crew', 'episode', 'user', input),
      ).rejects.toThrow('cannot accept');
      expect(templates.instantiateTasks).not.toHaveBeenCalled();
    },
  );
  it('does not permit an episode from another Crew', async () => {
    const { service, tx, templates } = setup();
    tx.crewEpisode.findFirst.mockResolvedValue(null);
    await expect(
      service.apply('crew', 'missing', 'user', input),
    ).rejects.toThrow('Episode not found');
    expect(
      (tx.crewEpisode.findFirst.mock.calls as { where: unknown }[][])[0][0]
        .where,
    ).toEqual({
      id: 'missing',
      crewId: 'crew',
    });
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it('rejects overwriting tasks from a different template', async () => {
    const { service, tx, templates } = setup();
    tx.crewTask.findMany.mockResolvedValue([
      { id: 'existing', metadata: { templateId: 'other', templateVersion: 1 } },
    ]);
    await expect(
      service.apply('crew', 'episode', 'user', input),
    ).rejects.toThrow('will not be replaced');
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it('does not bypass required custom fields', async () => {
    const { service, tx, templates } = setup();
    tx.crewTaskFieldDefinition.findMany.mockResolvedValue([
      {
        id: 'field',
        name: 'Required',
        type: 'text',
        required: true,
        options: [],
      },
    ]);
    await expect(
      service.apply('crew', 'episode', 'user', input),
    ).rejects.toThrow('required custom field');
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it('does not use an archived/missing open workflow', async () => {
    const { service, tx, templates } = setup();
    tx.crewTaskWorkflowState.findFirst.mockResolvedValue(null);
    await expect(
      service.apply('crew', 'episode', 'user', input),
    ).rejects.toThrow('active open workflow');
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it('rejects templates needing canvas data', async () => {
    const { service, template, templates } = setup();
    templates.resolveActiveTemplate.mockResolvedValue({
      ...template,
      definition: {
        ...DEFAULT_SERIES_TASK_TEMPLATE,
        items: DEFAULT_SERIES_TASK_TEMPLATE.items.map((item) => ({
          ...item,
          requiresPlotTree: true,
        })),
      },
    });
    await expect(service.preview('crew', 'episode', 'user')).rejects.toThrow(
      'canvas import',
    );
  });
  it('propagates a dependency failure to roll back the transaction', async () => {
    const { service, templates, tx } = setup();
    templates.instantiateTasks.mockRejectedValue(
      new Error('dependency failed'),
    );
    await expect(
      service.apply('crew', 'episode', 'user', input),
    ).rejects.toThrow('dependency failed');
    expect(tx.crewProductionActivity.create).not.toHaveBeenCalled();
  });
  it('rechecks permission before commit', async () => {
    const { service, auth } = setup();
    auth.require
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('revoked'));
    await expect(
      service.apply('crew', 'episode', 'user', input),
    ).rejects.toThrow('revoked');
  });
  it('rejects client-supplied task definitions and invalid snapshots', () => {
    expect(
      ApplyEpisodeTemplateSchema.safeParse({ ...input, items: [] }).success,
    ).toBe(false);
    expect(
      ApplyEpisodeTemplateSchema.safeParse({ ...input, episodeVersion: 0 })
        .success,
    ).toBe(false);
  });
  it('scopes template reuse to the selected episode and propagates real dependency failures', async () => {
    const service = new ProjectTaskTemplateService({} as never);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn(),
      crewTask: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: unknown }) => Promise.resolve(data)),
      },
      crewTaskDependency: {
        create: jest.fn().mockRejectedValue(new Error('link failed')),
      },
    };
    const template = {
      ...setup().template,
      projectType: 'series',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await expect(
      service.instantiateTasks(tx as never, 'crew', template as never, {
        episodeId: 'second',
        episodeScoped: true,
        workflowStateId: 'open',
        userId: 'user',
        taskFields: { script: [{ fieldId: 'field', value: 'Reviewed brief' }] },
      }),
    ).rejects.toThrow('link failed');
    expect(
      (
        tx.crewTask.findMany.mock.calls as {
          where: { episodeId: string; crewId: string };
        }[][]
      )[0][0].where.episodeId,
    ).toBe('second');
    expect(tx.crewTask.create).toHaveBeenCalledTimes(12);
    expect(tx.crewTask.create.mock.calls[0][0].data).toMatchObject({
      customFieldValues: {
        create: [
          {
            fieldId: 'field',
            value: 'Reviewed brief',
            updatedByUserId: 'user',
          },
        ],
      },
    });
  });
});

describe('Episode template custom fields', () => {
  const field = {
    id: '01990000-0000-7000-8000-000000000099',
    name: 'Brief',
    type: 'text',
    required: true,
    options: [],
  };
  const rows = () =>
    DEFAULT_SERIES_TASK_TEMPLATE.items.map((item) => ({
      templateKey: item.templateKey,
      values: [{ fieldId: field.id, value: `${item.title} brief` }],
    }));
  it('validates all tasks before writing and persists values in the receipt', async () => {
    const { service, tx, templates } = setup();
    tx.crewTaskFieldDefinition.findMany.mockResolvedValue([field]);
    await service.apply('crew', 'episode', 'user', {
      ...input,
      taskFields: rows(),
    });
    expect(
      (templates.instantiateTasks.mock.calls as unknown[][])[0][3],
    ).toMatchObject({
      taskFields: {
        script: [
          {
            fieldId: '01990000-0000-7000-8000-000000000099',
            value: '剧本 brief',
          },
        ],
      },
    });
    expect(
      (
        tx.crewProductionActivity.create.mock.calls as {
          data: { payload: { taskFields: unknown[] } };
        }[][]
      )[0][0].data.payload.taskFields,
    ).toHaveLength(12);
  });
  it('rejects an incomplete last task without creating the first task', async () => {
    const { service, tx, templates } = setup();
    tx.crewTaskFieldDefinition.findMany.mockResolvedValue([field]);
    await expect(
      service.apply('crew', 'episode', 'user', {
        ...input,
        taskFields: rows().slice(0, -1),
      }),
    ).rejects.toThrow('required custom field');
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
    expect(tx.crewProductionActivity.create).not.toHaveBeenCalled();
  });
  it('rejects duplicate and foreign template keys', async () => {
    const { service, templates } = setup();
    for (const taskFields of [
      [rows()[0], rows()[0]],
      [{ ...rows()[0], templateKey: 'foreign' }],
    ]) {
      await expect(
        service.apply('crew', 'episode', 'user', { ...input, taskFields }),
      ).rejects.toThrow();
    }
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it('replays reordered identical fields and rejects altered values', async () => {
    const { service, tx, templates } = setup();
    tx.crewProductionActivity.findFirst.mockResolvedValue({
      payload: { ...input, taskIds: ['original'], taskFields: rows() },
    });
    await expect(
      service.apply('crew', 'episode', 'user', {
        ...input,
        taskFields: rows().reverse(),
      }),
    ).resolves.toEqual({ taskIds: ['original'], replayed: true });
    await expect(
      service.apply('crew', 'episode', 'user', {
        ...input,
        taskFields: rows().map((row) => ({
          ...row,
          values: [{ fieldId: field.id, value: 'changed' }],
        })),
      }),
    ).rejects.toThrow('will not be replaced');
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
});

describe('Episode template task custom fields', () => {
  const fieldId = '01990000-0000-7000-8000-000000000099';
  const allFields = DEFAULT_SERIES_TASK_TEMPLATE.items.map((item) => ({
    templateKey: item.templateKey,
    values: [{ fieldId, value: item.title }],
  }));
  it('validates every task before instantiation and records the reviewed values', async () => {
    const { service, tx, templates } = setup();
    tx.crewTaskFieldDefinition.findMany.mockResolvedValue([
      { id: fieldId, name: 'Brief', type: 'text', required: true, options: [] },
    ]);
    await service.apply('crew', 'episode', 'user', {
      ...input,
      taskFields: allFields,
    });
    const calls = templates.instantiateTasks.mock.calls as unknown as Array<
      [unknown, string, unknown, { taskFields: Record<string, unknown> }]
    >;
    expect(calls[0][3].taskFields.script).toEqual([{ fieldId, value: '剧本' }]);
    const receipts = tx.crewProductionActivity.create.mock
      .calls as unknown as Array<
      [{ data: { payload: { taskFields: unknown[] } } }]
    >;
    expect(receipts[0][0].data.payload.taskFields).toEqual(
      expect.arrayContaining(allFields),
    );
  });
  it('rejects a missing required value in any item before creating any task', async () => {
    const { service, tx, templates } = setup();
    tx.crewTaskFieldDefinition.findMany.mockResolvedValue([
      { id: fieldId, name: 'Brief', type: 'text', required: true, options: [] },
    ]);
    await expect(
      service.apply('crew', 'episode', 'user', {
        ...input,
        taskFields: allFields.slice(1),
      }),
    ).rejects.toThrow('required');
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it.each([
    {
      name: 'foreign tasks',
      taskFields: [{ templateKey: 'foreign', values: [] }],
      error: 'Custom fields must reference tasks in the reviewed template.',
    },
    {
      name: 'repeated tasks',
      taskFields: [
        { templateKey: 'script', values: [] },
        { templateKey: 'script', values: [] },
      ],
      error: 'Each template task can have only one custom-field entry.',
    },
    {
      name: 'foreign crew fields',
      taskFields: [
        { templateKey: 'script', values: [{ fieldId, value: 'x' }] },
      ],
      error: 'Every custom field must belong to this crew.',
    },
  ])('rejects $name', async ({ taskFields, error }) => {
    const { service, templates } = setup();
    await expect(
      service.apply('crew', 'episode', 'user', { ...input, taskFields }),
    ).rejects.toThrow(error);
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it('replays an identical field command but refuses changed values', async () => {
    const { service, tx, templates } = setup();
    tx.crewProductionActivity.findFirst.mockResolvedValue({
      payload: { ...input, taskIds: ['task'], taskFields: allFields },
    });
    await expect(
      service.apply('crew', 'episode', 'user', {
        ...input,
        taskFields: [...allFields].reverse(),
      }),
    ).resolves.toEqual({ taskIds: ['task'], replayed: true });
    await expect(
      service.apply('crew', 'episode', 'user', {
        ...input,
        taskFields: allFields.map((row) => ({
          ...row,
          values: [{ fieldId, value: 'changed' }],
        })),
      }),
    ).rejects.toThrow('will not be replaced');
    expect(templates.instantiateTasks).not.toHaveBeenCalled();
  });
  it('persists per-task fields in the same task creation statement', async () => {
    const { template } = setup();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn(),
      crewTask: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: unknown }) => Promise.resolve(data)),
      },
      crewTaskDependency: { create: jest.fn().mockResolvedValue({}) },
    };
    await new ProjectTaskTemplateService({} as never).instantiateTasks(
      tx as never,
      'crew',
      template as never,
      {
        workflowStateId: 'open',
        episodeScoped: true,
        episodeId: 'episode',
        userId: 'reviewer',
        taskFields: { script: [{ fieldId, value: 'Script only' }] },
      },
    );
    const rows = tx.crewTask.create.mock.calls.map(
      ([call]) => call.data,
    ) as Array<{
      metadata: { templateKey: string };
      customFieldValues?: unknown;
    }>;
    expect(
      rows.find((row) => row.metadata.templateKey === 'script')
        ?.customFieldValues,
    ).toEqual({
      create: [{ fieldId, value: 'Script only', updatedByUserId: 'reviewer' }],
    });
    expect(
      rows
        .filter((row) => row.metadata.templateKey !== 'script')
        .every((row) => row.customFieldValues === undefined),
    ).toBe(true);
  });
});

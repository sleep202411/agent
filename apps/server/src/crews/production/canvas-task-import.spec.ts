jest.mock('../tasks/task-delivery-folder', () => ({
  provisionTaskDeliveryFolderTx: jest.fn().mockResolvedValue('folder'),
}));
import { CrewCanvasTaskImportService } from './canvas-task-import';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
} from '../../story-studio/interactive-film.schema';
import { exportPlotTreeFromDraft } from '../../story-studio/story-plot-tree-export';
function fixture() {
  const db = {
    crewTask: { findMany: jest.fn().mockResolvedValue([]) },
    crew: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'crew',
        studioWorkspaceId: 'workspace',
        productionKind: 'interactive_film',
      }),
    },
    storyDraft: {
      findUnique: jest.fn().mockResolvedValue({
        schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
        content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
        revision: 3,
        contentHash: 'hash',
      }),
    },
  };
  const auth = { require: jest.fn().mockResolvedValue(undefined) };
  const stories = {
    requireProjectInTransaction: jest.fn().mockResolvedValue(undefined),
    requireProject: jest.fn().mockResolvedValue({
      project: { id: 'project', workspaceId: 'workspace', title: 'Story' },
    }),
  };
  const conversations = {
    broadcastCrewTaskChange: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CrewCanvasTaskImportService(
    db as never,
    auth as never,
    stories as never,
    conversations as never,
  );
  return { db, auth, stories, conversations, service };
}
beforeEach(() => jest.clearAllMocks());
it('returns the source revision and validated plot without writes', async () => {
  const { service, auth, stories } = fixture();
  await expect(
    service.preview('crew', 'project', 'user'),
  ).resolves.toMatchObject({
    crewId: 'crew',
    projectId: 'project',
    sourceRevision: 3,
    sourceHash: 'hash',
  });
  expect(auth.require).toHaveBeenCalledTimes(2);
  expect(stories.requireProject).toHaveBeenCalledWith(
    'user',
    'project',
    'story.read',
  );
});
it('denies unauthorized users before reading a project', async () => {
  const { service, auth, stories } = fixture();
  auth.require.mockRejectedValue(new Error('denied'));
  await expect(service.preview('crew', 'project', 'user')).rejects.toThrow(
    'denied',
  );
  expect(stories.requireProject).not.toHaveBeenCalled();
});
it('rejects another workspace before reading its draft', async () => {
  const { service, db, stories } = fixture();
  stories.requireProject.mockResolvedValue({
    project: { id: 'project', workspaceId: 'other', title: 'Other' },
  });
  await expect(service.preview('crew', 'project', 'user')).rejects.toThrow(
    'not in the crew workspace',
  );
  expect(db.storyDraft.findUnique).not.toHaveBeenCalled();
});
it('rejects unsupported draft versions', async () => {
  const { service, db } = fixture();
  db.storyDraft.findUnique.mockResolvedValue({
    schemaVersion: 'future',
    content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
    revision: 3,
    contentHash: 'hash',
  });
  await expect(service.preview('crew', 'project', 'user')).rejects.toThrow(
    'Unsupported',
  );
});
it('does not return private content after permissions are revoked', async () => {
  const { service, auth } = fixture();
  auth.require
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('revoked'));
  await expect(service.preview('crew', 'project', 'user')).rejects.toThrow(
    'revoked',
  );
});
it('rejects a workspace change during preview', async () => {
  const { service, db } = fixture();
  db.crew.findFirst
    .mockResolvedValueOnce({
      id: 'crew',
      studioWorkspaceId: 'workspace',
      productionKind: 'interactive_film',
    })
    .mockResolvedValueOnce(null);
  await expect(service.preview('crew', 'project', 'user')).rejects.toThrow(
    'workspace has changed',
  );
});
it('rejects a canvas moved during preview', async () => {
  const { service, stories } = fixture();
  stories.requireProject
    .mockResolvedValueOnce({
      project: { id: 'project', workspaceId: 'workspace', title: 'Story' },
    })
    .mockResolvedValueOnce({
      project: { id: 'project', workspaceId: 'other', title: 'Story' },
    });
  await expect(service.preview('crew', 'project', 'user')).rejects.toThrow(
    'canvas workspace has changed',
  );
});

function applyFixture() {
  const base = fixture();
  const hash = 'a'.repeat(64);
  const previewSpy = jest.spyOn(base.service, 'preview').mockResolvedValue({
    crewId: 'crew',
    projectId: 'project',
    title: 'Story',
    importKey: '01990000-0000-7000-8000-000000000009',
    existingSourceNodeIds: [],
    sourceRevision: 3,
    sourceHash: hash,
    plotTree: {
      title: 'Story',
      startNodeId: 'scene',
      nodes: [
        {
          id: 'scene',
          type: 'scene',
          content: { title: 'Scene One', description: '' },
          transitions: [],
        },
      ],
    },
  });
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    crew: base.db.crew,
    storyProject: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ workspaceId: 'workspace', status: 'active' }),
    },
    storyDraft: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ revision: 3, contentHash: hash }),
    },
    crewProductionActivity: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    crewTaskFieldDefinition: { count: jest.fn().mockResolvedValue(0) },
    crewTaskWorkflowState: {
      findFirst: jest.fn().mockResolvedValue({ id: 'open' }),
    },
    crewTask: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'task' }),
    },
  };
  Object.assign(base.db, {
    $transaction: (run: (tx: unknown) => unknown) => run(tx),
  });
  return {
    ...base,
    previewSpy,
    tx,
    input: { sourceRevision: 3, sourceHash: hash },
  };
}
it('creates scene tasks and saves a durable import receipt', async () => {
  const { service, tx, input, stories } = applyFixture();
  await expect(
    service.apply('crew', 'project', 'user', input),
  ).resolves.toEqual({ taskIds: ['task'], replayed: false });
  expect(tx.crewTask.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        crewId: 'crew',
        title: 'Scene One',
        taskKind: 'storyboard',
        metadata: expect.objectContaining({ sourceNodeId: 'scene' }) as unknown,
      }) as unknown,
    }),
  );
  expect(tx.crewProductionActivity.create).toHaveBeenCalledTimes(1);
  expect(stories.requireProjectInTransaction).toHaveBeenCalledWith(
    tx,
    'user',
    'project',
    'story.read',
  );
  expect(
    stories.requireProjectInTransaction.mock.invocationCallOrder[0],
  ).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
});
it('rejects an import when Studio access disappears before its transaction', async () => {
  const { service, tx, input, stories } = applyFixture();
  stories.requireProjectInTransaction.mockRejectedValue(
    new Error('Story project not found'),
  );
  await expect(service.apply('crew', 'project', 'user', input)).rejects.toThrow(
    'Story project not found',
  );
  expect(tx.crewTask.create).not.toHaveBeenCalled();
  expect(tx.crewProductionActivity.create).not.toHaveBeenCalled();
});
it('replays an identical receipt without creating another task', async () => {
  const { service, tx, input } = applyFixture();
  tx.crewProductionActivity.findFirst.mockResolvedValue({
    payload: { ...input, taskIds: ['old'] },
  });
  await expect(
    service.apply('crew', 'project', 'user', input),
  ).resolves.toEqual({ taskIds: ['old'], replayed: true });
  expect(tx.crewTask.create).not.toHaveBeenCalled();
});
it('rejects an outdated preview before any task writes', async () => {
  const { service, tx, input } = applyFixture();
  tx.storyDraft.findUnique.mockResolvedValue({
    revision: 4,
    contentHash: input.sourceHash,
  });
  await expect(service.apply('crew', 'project', 'user', input)).rejects.toThrow(
    'canvas changed',
  );
  expect(tx.crewTask.create).not.toHaveBeenCalled();
});
it('does not bypass required custom fields', async () => {
  const { service, tx, input } = applyFixture();
  tx.crewTaskFieldDefinition.count.mockResolvedValue(1);
  await expect(service.apply('crew', 'project', 'user', input)).rejects.toThrow(
    'required custom fields',
  );
  expect(tx.crewTask.create).not.toHaveBeenCalled();
});

it('recovers a committed import even if the current draft can no longer be exported', async () => {
  const { service, tx, input, previewSpy } = applyFixture();
  previewSpy.mockRejectedValue(new Error('Draft is now invalid'));
  tx.crewProductionActivity.findFirst.mockResolvedValue({
    payload: { ...input, taskIds: ['committed'] },
  });
  await expect(
    service.apply('crew', 'project', 'user', input),
  ).resolves.toEqual({ taskIds: ['committed'], replayed: true });
  expect(previewSpy).not.toHaveBeenCalled();
  expect(tx.crewTask.create).not.toHaveBeenCalled();
});
it('rejects a different previously imported revision without writes', async () => {
  const { service, tx, input } = applyFixture();
  tx.crewProductionActivity.findFirst.mockResolvedValue({
    payload: { ...input, sourceRevision: 2, taskIds: ['old'] },
  });
  await expect(service.apply('crew', 'project', 'user', input)).rejects.toThrow(
    'already been imported',
  );
  expect(tx.crewTask.create).not.toHaveBeenCalled();
});

it('broadcasts committed tasks without reporting notification failures as failed imports', async () => {
  const { service, conversations, input } = applyFixture();
  conversations.broadcastCrewTaskChange.mockRejectedValue(
    new Error('Realtime unavailable'),
  );
  await expect(
    service.apply('crew', 'project', 'user', input),
  ).resolves.toEqual({ taskIds: ['task'], replayed: false });
  expect(conversations.broadcastCrewTaskChange).toHaveBeenCalledWith(
    'crew',
    'task',
    'updated',
    'user',
  );
});

it('allows a linked canvas for a short-drama crew while rechecking permissions', async () => {
  const { service, db, auth } = fixture();
  db.crew.findFirst.mockResolvedValue({
    id: 'crew',
    studioWorkspaceId: 'workspace',
    productionKind: 'short_drama',
  });
  await expect(
    service.preview('crew', 'project', 'user'),
  ).resolves.toMatchObject({ projectId: 'project' });
  expect(auth.require).toHaveBeenCalledTimes(2);
});

it('explicit re-import creates only missing scenes and leaves existing work unchanged', async () => {
  const { service, tx, input, previewSpy } = applyFixture();
  const preview = await service.preview('crew', 'project', 'user');
  previewSpy.mockResolvedValue({
    ...preview,
    plotTree: {
      ...preview.plotTree,
      nodes: [
        ...preview.plotTree.nodes,
        { ...preview.plotTree.nodes[0], id: 'new-scene' },
      ],
    },
  });
  tx.crewTask.findMany.mockResolvedValue([
    { id: 'existing', metadata: { sourceNodeId: 'scene' } },
  ]);
  await service.apply('crew', 'project', 'user', {
    ...input,
    importKey: '01990000-0000-7000-8000-000000000009',
  });
  expect(
    (
      tx.crewTask.findMany.mock.calls as { where: { deletedAt: unknown } }[][]
    )[0][0].where.deletedAt,
  ).toBeNull();
  expect(tx.crewTask.create).toHaveBeenCalledTimes(1);
  expect(
    (
      tx.crewTask.create.mock.calls as {
        data: { metadata: { sourceNodeId: string } };
      }[][]
    )[0][0].data.metadata.sourceNodeId,
  ).toBe('new-scene');
});

function unfinishedDraft() {
  return InteractiveStoryDraftContentSchema.parse({
    ...EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
    graph: {
      entryNodeId: 'scene_01_night_call',
      nodes: [
        'scene_01_night_call',
        'scene_01b_question',
        'clip:scene-52',
        'ending_lone_palace_a',
        'scene_post_credits',
      ].map((nodeId, index) => ({
        kind: 'clip',
        nodeId,
        clipKey: `SCENE_${index}`,
        name: `Scene ${index}`,
        description: `Production brief ${index}`,
        exit: { kind: 'auto', routes: [{ target: null }] },
      })),
    },
  });
}

it('imports unfinished, ending-named and unreachable clips through real preview and apply', async () => {
  const { service, db, tx, input, previewSpy } = applyFixture();
  previewSpy.mockRestore();
  const content = unfinishedDraft();
  const before = JSON.stringify(content);
  // Reproduces Pax's failure at the old boundary, without mocking the exporter.
  expect(() => exportPlotTreeFromDraft('project', 'Story', content)).toThrow();
  db.storyDraft.findUnique.mockResolvedValue({
    schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
    content,
    revision: input.sourceRevision,
    contentHash: input.sourceHash,
  });
  const preview = await service.preview('crew', 'project', 'user');
  expect(preview.plotTree.nodes.map((node) => node.id)).toEqual(
    content.graph.nodes.map((node) => node.nodeId),
  );
  await service.apply('crew', 'project', 'user', {
    ...input,
    importKey: preview.importKey,
  });
  expect(tx.crewTask.create).toHaveBeenCalledTimes(5);
  expect(
    (tx.crewTask.create.mock.calls as Array<[{ data: { title: string } }]>).map(
      ([command]) => command.data.title,
    ),
  ).toEqual(['Scene 0', 'Scene 1', 'Scene 2', 'Scene 3', 'Scene 4']);
  expect(
    (
      tx.crewTask.create.mock.calls as Array<
        [{ data: { metadata: { sourceNodeId: string } } }]
      >
    )[2][0].data.metadata.sourceNodeId,
  ).toBe('clip:scene-52');
  expect(JSON.stringify(content)).toBe(before);
});

it('rejects duplicate source IDs instead of creating ambiguous tasks', async () => {
  const { service, db } = fixture();
  const content = unfinishedDraft();
  content.graph.nodes.push(content.graph.nodes[0]);
  db.storyDraft.findUnique.mockResolvedValue({
    schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
    content,
    revision: 3,
    contentHash: 'hash',
  });
  await expect(service.preview('crew', 'project', 'user')).rejects.toThrow(
    'unique IDs',
  );
});

it('plans clips before an entry or choices are authored, excluding decision nodes', async () => {
  const { service, db } = fixture();
  const content = unfinishedDraft();
  content.graph.entryNodeId = null;
  content.graph.nodes.push({
    kind: 'decision',
    nodeId: 'unwritten-choice',
    exit: { kind: 'auto', routes: [{ target: null }] },
  });
  db.storyDraft.findUnique.mockResolvedValue({
    schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
    content,
    revision: 3,
    contentHash: 'hash',
  });
  const preview = await service.preview('crew', 'project', 'user');
  expect(preview.plotTree.startNodeId).toBeNull();
  expect(preview.plotTree.nodes).toHaveLength(5);
  expect(
    preview.plotTree.nodes.some((node) => node.id === 'unwritten-choice'),
  ).toBe(false);
});

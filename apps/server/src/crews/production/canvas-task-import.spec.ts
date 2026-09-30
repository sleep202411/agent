import { CrewCanvasTaskImportService } from './canvas-task-import';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
} from '../../story-studio/interactive-film.schema';
import { exportPlotTreeFromDraft } from '../../story-studio/story-plot-tree-export';
jest.mock('../../story-studio/story-plot-tree-export', () => ({
  exportPlotTreeFromDraft: jest.fn(() => ({
    plotTree: { nodes: [{ id: 'scene' }] },
  })),
}));
function fixture() {
  const db = {
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
  expect(exportPlotTreeFromDraft).toHaveBeenCalledTimes(1);
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
  expect(exportPlotTreeFromDraft).not.toHaveBeenCalled();
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
    sourceRevision: 3,
    sourceHash: hash,
    plotTree: {
      title: 'Story',
      startNodeId: 'scene',
      nodes: [
        {
          id: 'scene',
          type: 'scene',
          content: { title: 'Scene One' },
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

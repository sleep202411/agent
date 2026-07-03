import { StoryProjectsService } from './story-projects.service';
import { STORY_TITLE_MAX } from './dto';

const OWNER = { userId: 'user-1' };

function projectRow(over: Record<string, unknown> = {}) {
  return {
    id: 'proj-1',
    ownerUserId: 'user-1',
    workspaceId: null,
    title: 'Untitled Story',
    summary: null,
    coverAssetId: null,
    locale: 'zh-CN',
    visibility: 'private',
    tags: [],
    status: 'active',
    sourceIpId: null,
    publishState: 'unpublished',
    liveReleaseId: null,
    publishedVersion: null,
    publishedAt: null,
    version: 0,
    createdAt: new Date('2026-07-03T00:00:00Z'),
    updatedAt: new Date('2026-07-03T00:00:00Z'),
    deletedAt: null,
    ...over,
  };
}

function draftRow(over: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    storyProjectId: 'proj-1',
    schemaVersion: 'story-studio-canvas-v1',
    content: { title: 'Untitled Story', canvas: { nodes: [], edges: [] } },
    revision: 3,
    updatedBySessionId: 'tab-a',
    updatedByUserId: 'user-1',
    createdAt: new Date('2026-07-03T00:00:00Z'),
    updatedAt: new Date('2026-07-03T01:00:00Z'),
    ...over,
  };
}

function makeService(
  opts: {
    project?: Record<string, unknown> | null;
    draftUpdateCount?: number;
    currentDraft?: Record<string, unknown> | null;
    storedSchemaVersion?: string;
  } = {},
) {
  const tx = {
    storyDraft: {
      findUnique: jest.fn(async () => ({
        schemaVersion: opts.storedSchemaVersion ?? 'story-studio-canvas-v1',
      })),
      updateMany: jest.fn(async () => ({ count: opts.draftUpdateCount ?? 1 })),
    },
    storyProject: {
      update: jest.fn(async () => ({
        updatedAt: new Date('2026-07-03T02:00:00Z'),
      })),
    },
  };
  const prisma = {
    storyProject: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        projectRow({
          title: data.title,
          summary: data.summary ?? null,
          draft: draftRow({
            content: (data.draft as any)?.create?.content ?? {},
            revision: 0,
          }),
        }),
      ),
      findFirst: jest.fn(async () =>
        opts.project === undefined
          ? projectRow({ draft: draftRow() })
          : opts.project,
      ),
      findMany: jest.fn(async () => [projectRow()]),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        projectRow(data),
      ),
    },
    storyDraft: {
      findUnique: jest.fn(async () =>
        opts.currentDraft === undefined
          ? draftRow({ revision: 7 })
          : opts.currentDraft,
      ),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new StoryProjectsService(prisma as never);
  return { service, prisma, tx };
}

describe('StoryProjectsService.create', () => {
  it('creates the project with a seeded draft in one call', async () => {
    const { service, prisma } = makeService();
    const dto = await service.create(OWNER as never, {});
    expect(dto.draft.revision).toBe(0);
    const arg = (prisma.storyProject.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.ownerUserId).toBe('user-1');
    expect(arg.data.draft.create.schemaVersion).toBe('story-studio-canvas-v1');
  });

  it('extracts display metadata from a provided snapshot (lazy-create)', async () => {
    const { service, prisma } = makeService();
    await service.create(OWNER as never, {
      content: {
        title: '  雙城香港  ',
        summary: 'a story',
        canvas: { nodes: [], edges: [] },
      },
    });
    const arg = (prisma.storyProject.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.title).toBe('雙城香港');
    expect(arg.data.summary).toBe('a story');
  });
});

describe('StoryProjectsService.putDraft (R1/R2/R5)', () => {
  it('CAS-saves, writes display meta through, and returns revision+1', async () => {
    const { service, tx } = makeService({ draftUpdateCount: 1 });
    const longTitle = 'x'.repeat(400);
    const res = await service.putDraft(OWNER as never, 'proj-1', {
      schemaVersion: 'story-studio-canvas-v1',
      content: { title: longTitle, summary: 's', canvas: {} },
      revision: 3,
      sessionId: 'tab-a',
    });
    expect(res.revision).toBe(4);
    // CAS predicate carries the client's revision.
    expect(tx.storyDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storyProjectId: 'proj-1', revision: 3 },
      }),
    );
    // R1: title clamped to the column cap before write-through.
    const meta = (tx.storyProject.update as jest.Mock).mock.calls[0][0].data;
    expect(meta.title).toHaveLength(STORY_TITLE_MAX);
  });

  it('returns 409 with the CURRENT snapshot on a stale revision (R5)', async () => {
    const { service } = makeService({ draftUpdateCount: 0 });
    await expect(
      service.putDraft(OWNER as never, 'proj-1', {
        schemaVersion: 'story-studio-canvas-v1',
        content: {},
        revision: 2,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DRAFT_REVISION_CONFLICT',
        currentRevision: 7,
        updatedBySessionId: 'tab-a',
      }),
    });
  });

  it('rejects a schema DOWNGRADE write (v1 client onto a v2 draft)', async () => {
    const { service, tx } = makeService({
      storedSchemaVersion: 'story-studio-canvas-v2',
    });
    await expect(
      service.putDraft(OWNER as never, 'proj-1', {
        schemaVersion: 'story-studio-canvas-v1',
        content: {},
        revision: 3,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DRAFT_SCHEMA_DOWNGRADE' }),
    });
    expect(tx.storyDraft.updateMany).not.toHaveBeenCalled();
  });

  it('allows a schema UPGRADE write (v2 client onto a v1 draft)', async () => {
    const { service } = makeService({
      storedSchemaVersion: 'story-studio-canvas-v1',
    });
    const res = await service.putDraft(OWNER as never, 'proj-1', {
      schemaVersion: 'story-studio-canvas-v2',
      content: { title: 't', canvas: {} },
      revision: 3,
    });
    expect(res.revision).toBe(4);
  });
});

describe('StoryProjectsService access + lifecycle', () => {
  it('404s a project the caller does not own', async () => {
    const { service } = makeService({ project: null });
    await expect(service.get(OWNER as never, 'proj-x')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PROJECT_NOT_FOUND' }),
    });
  });

  it('blocks archiving a published project (unpublish first)', async () => {
    const { service } = makeService({
      project: projectRow({ publishState: 'published' }),
    });
    await expect(
      service.archive(OWNER as never, 'proj-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLISHED' }),
    });
  });

  it('archives an unpublished project as a soft delete', async () => {
    const { service, prisma } = makeService();
    await service.archive(OWNER as never, 'proj-1');
    const arg = (prisma.storyProject.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.status).toBe('archived');
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });
});

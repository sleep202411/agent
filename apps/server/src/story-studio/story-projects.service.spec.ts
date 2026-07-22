import { ConflictException, HttpException } from '@nestjs/common';
import {
  StoryFormat,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryRevisionSource,
  WorkspaceMemberRole,
} from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  StoryProjectListQuerySchema,
  type InteractiveStoryDraftContent,
} from './dto';
import { StoryProjectsService } from './story-projects.service';
import { storyVideoSnapshotHash } from './story-video-production.schema';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const DRAFT_ID = '0197f4a2-0800-7000-8000-000000000003';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000004';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-000000000005';
const SECOND_CHAPTER_ID = '0197f4a2-0800-7000-8000-000000000006';
const NOW = new Date('2026-07-12T12:00:00.000Z');

function lockableDraft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: 'At night, a sealed gate asks who owns the truth.',
      synopsis: "A visitor must choose whether to reveal the villa's secret.",
      worldview: 'One night inside a mythic villa.',
      characters: [
        {
          id: 'hero',
          name: { 'zh-CN': '来客' },
          summary: 'A visitor searching for the truth.',
          images: [],
          voice: null,
        },
      ],
      endings: [
        {
          id: 'ending.truth',
          title: { 'zh-CN': '真相' },
          summary: { 'zh-CN': '门打开了。' },
        },
      ],
    },
    graph: {
      entryNodeId: 'node.opening',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'node.opening',
          clipKey: 'S00',
          exit: { kind: 'ending', endingId: 'ending.truth' },
        },
      ],
    },
    productionNotes: [],
  };
}

function multiChapterDraft(): InteractiveStoryDraftContent {
  const first = lockableDraft();
  return {
    ...first,
    graph: {
      entryNodeId: 'node.opening',
      nodes: [
        ...first.graph.nodes,
        {
          kind: 'clip',
          nodeId: 'node.chapter-two',
          clipKey: 'S10',
          exit: { kind: 'ending', endingId: 'ending.truth' },
        },
      ],
    },
  };
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    format: StoryFormat.interactive_film,
    frameProfile: StoryFrameProfile.landscape_16_9,
    status: StoryProjectStatus.active,
    visibility: 'private',
    title: 'Branching Film Test',
    summary: null,
    defaultLocale: 'zh-CN',
    coverAssetId: null,
    tags: [],
    sourceIpId: null,
    nextBuildNumber: 1,
    version: 0,
    createdByUserId: USER.userId,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function draftRow(overrides: Record<string, unknown> = {}) {
  const content =
    (overrides.content as InteractiveStoryDraftContent | undefined) ??
    lockableDraft();
  return {
    id: DRAFT_ID,
    storyProjectId: PROJECT_ID,
    schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
    content,
    contentHash: canonicalJsonHash(content),
    revision: 3,
    updatedByUserId: USER.userId,
    updatedBySessionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function canvasLayoutRow(overrides: Record<string, unknown> = {}) {
  return {
    storyChapterId: CHAPTER_ID,
    storyProjectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
    nodePositions: { __story_root__: { x: -500, y: 120 } },
    storyWorldNodePresent: true,
    revision: 2,
    updatedByUserId: USER.userId,
    updatedBySessionId: 'canvas-session',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function chapterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CHAPTER_ID,
    storyProjectId: PROJECT_ID,
    title: 'Chapter 1',
    rank: 0,
    nodeIds: ['node.opening'],
    entryNodeId: 'node.opening',
    createdByUserId: USER.userId,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function summaryProject(overrides: Record<string, unknown> = {}) {
  const content = lockableDraft();
  return projectRow({
    cover: null,
    draft: draftRow({ content }),
    revisions: [],
    members: [{ userId: USER.userId, role: StoryProjectMemberRole.owner }],
    referenceSlots: [],
    videoSelections: [],
    builds: [],
    ...overrides,
  });
}

function revisionRow(overrides: Record<string, unknown> = {}) {
  const content = lockableDraft();
  return {
    id: REVISION_ID,
    storyProjectId: PROJECT_ID,
    number: 1,
    sourceDraftRevision: 3,
    schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
    content,
    contentHash: canonicalJsonHash(content),
    label: null,
    source: StoryRevisionSource.creator,
    createdByUserId: USER.userId,
    createdAt: NOW,
    ...overrides,
  };
}

function serviceWith(prisma: Record<string, unknown>) {
  const access = {
    project: projectRow(),
    role: StoryProjectMemberRole.owner,
    capabilities: ['story.read', 'story.edit', 'story.build'],
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue(access),
    capabilities: jest.fn().mockReturnValue(access.capabilities),
  };
  const workspacePermissions = {
    requireWorkspaceRole: jest
      .fn()
      .mockResolvedValue({ role: WorkspaceMemberRole.owner }),
  };
  const writeGuard = {
    assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new StoryProjectsService(
      prisma as never,
      permissions as never,
      workspacePermissions as never,
      writeGuard as never,
    ),
    permissions,
    workspacePermissions,
    writeGuard,
  };
}

function transactionMock<TClient>(client: TClient) {
  return jest.fn((callback: (tx: TClient) => Promise<unknown>) =>
    callback(client),
  );
}

async function apiError(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (error instanceof ConflictException) {
      return error.getResponse() as Record<string, unknown>;
    }
    throw error;
  }
  throw new Error('Expected operation to reject.');
}

describe('StoryProjectsService unified-story authoring boundary', () => {
  it('keeps retired project formats out of the target project-list contract', async () => {
    expect(
      StoryProjectListQuerySchema.safeParse({
        format: 'narrative_rpg',
      }).success,
    ).toBe(false);

    const findMany = jest.fn((input: { where: { format: unknown } }) => {
      void input;
      return Promise.resolve([]);
    });
    const { service } = serviceWith({ storyProject: { findMany } });

    await expect(
      service.list(USER as never, WORKSPACE_ID, {
        status: 'active',
        limit: 20,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0].where.format).toEqual({
      in: [StoryFormat.interactive_film, StoryFormat.text_adventure],
    });
  });

  it('creates a text-adventure profile with no frame profile on the unified schema', async () => {
    const project = summaryProject({
      format: StoryFormat.text_adventure,
      frameProfile: null,
      draft: draftRow({
        revision: 0,
        content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      }),
    });
    const create = jest.fn(
      (input: {
        data: {
          format: StoryFormat;
          frameProfile: unknown;
          draft: { create: { schemaVersion: string; content: unknown } };
        };
      }) => {
        expect(input.data).toMatchObject({
          format: StoryFormat.text_adventure,
          draft: {
            create: {
              schemaVersion: 'interactive-story-draft-v1',
              content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
            },
          },
        });
        // A text-first project persists no frame contract.
        expect(input.data.frameProfile).toBeNull();
        return Promise.resolve(project);
      },
    );
    const tx = {
      storyProject: {
        create,
        findUnique: jest.fn().mockResolvedValue(project),
      },
      storyChapter: {
        create: jest
          .fn()
          .mockResolvedValue(chapterRow({ nodeIds: [], entryNodeId: null })),
      },
      storyCanvasLayout: {
        create: jest.fn().mockResolvedValue(canvasLayoutRow()),
      },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.create(USER as never, WORKSPACE_ID, {
        format: 'text_adventure',
        title: 'A Text Story',
        defaultLocale: 'en-US',
        visibility: 'private',
      }),
    ).resolves.toMatchObject({
      project: { format: 'text_adventure', frameProfile: null },
      draft: { format: 'text_adventure' },
    });
  });

  it('creates a unified story draft and a non-null empty video workbench', async () => {
    const project = summaryProject({
      draft: draftRow({
        revision: 0,
        content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      }),
    });
    const create = jest.fn(
      (input: {
        data: {
          draft: { create: { schemaVersion: string; content: unknown } };
          writeState: { create: Record<string, never> };
        };
      }) => {
        expect(input.data.draft.create).toMatchObject({
          schemaVersion: 'interactive-story-draft-v1',
          content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
        });
        expect(input.data.writeState).toEqual({ create: {} });
        return Promise.resolve(project);
      },
    );
    const chapter = chapterRow({ nodeIds: [], entryNodeId: null });
    const tx = {
      storyProject: {
        create,
        findUnique: jest.fn().mockResolvedValue(project),
      },
      storyChapter: { create: jest.fn().mockResolvedValue(chapter) },
      storyCanvasLayout: {
        create: jest.fn().mockResolvedValue(canvasLayoutRow()),
      },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const { service, workspacePermissions } = serviceWith(prisma);

    const result = await service.create(USER as never, WORKSPACE_ID, {
      format: 'interactive_film',
      frameProfile: 'landscape_16_9',
      title: 'Branching Film Test',
      defaultLocale: 'zh-CN',
      visibility: 'private',
    });

    expect(workspacePermissions.requireWorkspaceRole).toHaveBeenCalledWith(
      USER.userId,
      WORKSPACE_ID,
      WorkspaceMemberRole.editor,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(tx.storyChapter.create).toHaveBeenCalledWith({
      data: {
        storyProjectId: PROJECT_ID,
        title: '第 1 章',
        rank: 0,
        nodeIds: [],
        entryNodeId: null,
        createdByUserId: USER.userId,
      },
    });
    expect(tx.storyCanvasLayout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyChapterId: CHAPTER_ID,
        storyProjectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions: {},
        storyWorldNodePresent: false,
      }) as unknown,
    });
    expect(result).toMatchObject({
      video: {
        snapshotHash: storyVideoSnapshotHash([]),
        clips: [],
        trailer: {
          selectionVersion: 0,
          currentVideo: null,
          generation: null,
        },
      },
      references: [],
      latestBuild: null,
    });
    expect(Object.keys(result).sort()).toEqual([
      'chapter',
      'chapters',
      'draft',
      'latestBuild',
      'project',
      'references',
      'video',
    ]);
  });

  it('creates a real chapter together with its own empty canvas layout', async () => {
    const created = chapterRow({
      id: SECOND_CHAPTER_ID,
      title: 'The Return',
      rank: 1,
      nodeIds: [],
      entryNodeId: null,
    });
    const tx = {
      storyChapter: {
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _max: { rank: 0 } }),
        create: jest.fn().mockResolvedValue(created),
      },
      storyCanvasLayout: { create: jest.fn().mockResolvedValue({}) },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.createChapter(USER as never, WORKSPACE_ID, PROJECT_ID, {
        title: 'The Return',
      }),
    ).resolves.toMatchObject({
      id: SECOND_CHAPTER_ID,
      title: 'The Return',
      rank: 1,
      nodeCount: 0,
    });
    expect(tx.storyChapter.create).toHaveBeenCalledWith({
      data: {
        storyProjectId: PROJECT_ID,
        title: 'The Return',
        rank: 1,
        nodeIds: [],
        entryNodeId: null,
        createdByUserId: USER.userId,
      },
    });
    expect(tx.storyCanvasLayout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyChapterId: SECOND_CHAPTER_ID,
        storyProjectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        storyWorldNodePresent: false,
      }) as unknown,
    });
    expect(tx.storyProject.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: expect.objectContaining({ version: { increment: 1 } }) as unknown,
    });
  });

  it('renames the latest chapter row without a chapter-version claim', async () => {
    const current = chapterRow();
    const renamed = chapterRow({ title: 'A New Name' });
    const tx = {
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue(renamed),
      },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.patchChapter(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        CHAPTER_ID,
        { title: 'A New Name' },
      ),
    ).resolves.toMatchObject({ id: CHAPTER_ID, title: 'A New Name' });
    expect(tx.storyChapter.update).toHaveBeenCalledWith({
      where: { id: CHAPTER_ID },
      data: { title: 'A New Name' },
    });
  });

  it('merges one chapter save into the project graph without replacing another chapter', async () => {
    const current = draftRow({ content: multiChapterDraft() });
    const chapters = [
      chapterRow(),
      chapterRow({
        id: SECOND_CHAPTER_ID,
        title: 'Chapter 2',
        rank: 1,
        nodeIds: ['node.chapter-two'],
        entryNodeId: 'node.chapter-two',
      }),
    ];
    let persistedContent: unknown = null;
    const storyDraft = {
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve(
          persistedContent
            ? draftRow({
                content:
                  InteractiveStoryDraftContentSchema.parse(persistedContent),
                revision: 4,
              })
            : current,
        ),
      ),
      updateMany: jest
        .fn()
        .mockImplementation(({ data }: { data: { content: unknown } }) => {
          persistedContent = data.content as InteractiveStoryDraftContent;
          return Promise.resolve({ count: 1 });
        }),
    };
    const tx = {
      storyDraft,
      storyChapter: {
        findMany: jest.fn().mockResolvedValue(chapters),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(chapterRow()),
      },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });
    const editedChapter = lockableDraft();
    editedChapter.graph.nodes = editedChapter.graph.nodes.map((node) =>
      node.kind === 'clip' && node.nodeId === 'node.opening'
        ? { ...node, clipKey: 'S01' }
        : node,
    );

    const result = await service.putDraft(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      {
        expectedRevision: 3,
        schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
        content: editedChapter,
        sessionId: 'chapter-save',
      },
      CHAPTER_ID,
    );

    const savedContent =
      InteractiveStoryDraftContentSchema.parse(persistedContent);
    expect(savedContent.graph.nodes.map((node) => node.nodeId)).toEqual([
      'node.chapter-two',
      'node.opening',
    ]);
    expect(
      savedContent.graph.nodes.find(
        (node) => node.nodeId === 'node.chapter-two',
      ),
    ).toEqual(multiChapterDraft().graph.nodes[1]);
    expect(result.chapterId).toBe(CHAPTER_ID);
    expect(result.content.graph.nodes).toHaveLength(1);
    expect(result.content.graph.nodes[0]).toMatchObject({ clipKey: 'S01' });
  });

  it('rejects a chapter save that tries to claim another chapter scene id', async () => {
    const chapters = [
      chapterRow(),
      chapterRow({
        id: SECOND_CHAPTER_ID,
        rank: 1,
        nodeIds: ['node.chapter-two'],
        entryNodeId: 'node.chapter-two',
      }),
    ];
    const tx = {
      storyDraft: {
        findUnique: jest
          .fn()
          .mockResolvedValue(draftRow({ content: multiChapterDraft() })),
        updateMany: jest.fn(),
      },
      storyChapter: { findMany: jest.fn().mockResolvedValue(chapters) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });
    const conflicting = lockableDraft();
    conflicting.graph = {
      entryNodeId: 'node.chapter-two',
      nodes: [multiChapterDraft().graph.nodes[1]],
    };

    await expect(
      service.putDraft(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        {
          expectedRevision: 3,
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: conflicting,
          sessionId: 'chapter-save',
        },
        CHAPTER_ID,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.storyDraft.updateMany).not.toHaveBeenCalled();
  });

  it('moves the project entry to the next chapter when the empty first chapter is archived', async () => {
    const secondNode = multiChapterDraft().graph.nodes[1];
    const content: InteractiveStoryDraftContent = {
      ...lockableDraft(),
      graph: { entryNodeId: null, nodes: [secondNode] },
    };
    const first = chapterRow({ nodeIds: [], entryNodeId: null });
    const second = chapterRow({
      id: SECOND_CHAPTER_ID,
      title: 'Chapter 2',
      rank: 1,
      nodeIds: ['node.chapter-two'],
      entryNodeId: 'node.chapter-two',
    });
    const tx = {
      storyChapter: {
        findMany: jest.fn().mockResolvedValue([first, second]),
        update: jest.fn().mockResolvedValue({
          ...first,
          archivedAt: NOW,
        }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue(draftRow({ content })),
        update: jest.fn().mockResolvedValue({}),
      },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.archiveChapter(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        CHAPTER_ID,
      ),
    ).resolves.toMatchObject({ id: CHAPTER_ID });
    expect(tx.storyDraft.update).toHaveBeenCalledWith({
      where: { storyProjectId: PROJECT_ID },
      data: expect.objectContaining({
        content: expect.objectContaining({
          graph: expect.objectContaining({
            entryNodeId: 'node.chapter-two',
          }) as unknown,
        }) as unknown,
        revision: { increment: 1 },
      }) as unknown,
    });
  });

  it('returns the persisted story-world projection state with the canvas layout', async () => {
    const row = canvasLayoutRow({
      nodePositions: {},
      storyWorldNodePresent: false,
    });
    const findUnique = jest.fn().mockResolvedValue(row);
    const prisma = {
      storyChapter: { findFirst: jest.fn().mockResolvedValue(chapterRow()) },
      storyCanvasLayout: { findUnique },
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.getCanvasLayout(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        CHAPTER_ID,
      ),
    ).resolves.toMatchObject({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: row.nodePositions,
      storyWorldNodePresent: false,
      revision: 2,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { storyChapterId: CHAPTER_ID },
    });
  });

  it('persists story-world projection deletion in the same canvas-layout CAS write', async () => {
    const saved = canvasLayoutRow({
      nodePositions: {},
      storyWorldNodePresent: false,
      revision: 3,
    });
    const tx = {
      storyCanvasLayout: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(saved),
      },
    };
    const prisma = {
      storyChapter: { findFirst: jest.fn().mockResolvedValue(chapterRow()) },
      $transaction: transactionMock(tx),
    };
    const { service } = serviceWith(prisma);

    const result = await service.putCanvasLayout(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      {
        expectedRevision: 2,
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions: {},
        storyWorldNodePresent: false,
        sessionId: 'canvas-session',
      },
      CHAPTER_ID,
    );

    expect(tx.storyCanvasLayout.updateMany).toHaveBeenCalledWith({
      where: {
        storyChapterId: CHAPTER_ID,
        storyProjectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        revision: 2,
      },
      data: {
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions: {},
        storyWorldNodePresent: false,
        revision: { increment: 1 },
        updatedByUserId: USER.userId,
        updatedBySessionId: 'canvas-session',
      },
    });
    expect(result.storyWorldNodePresent).toBe(false);
    expect(result.revision).toBe(3);
  });

  it('rejects inside the write transaction before mutating canvas layout', async () => {
    const tx = {
      storyCanvasLayout: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const prisma = {
      storyChapter: { findFirst: jest.fn().mockResolvedValue(chapterRow()) },
      $transaction: transactionMock(tx),
    };
    const { service, writeGuard } = serviceWith(prisma);
    writeGuard.assertHumanWriteAllowed.mockRejectedValueOnce(
      new HttpException(
        {
          code: 'STORY_AGENT_APPLYING',
          message: 'The Story Agent is applying a project change.',
        },
        423,
      ),
    );

    await expect(
      service.putCanvasLayout(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        {
          expectedRevision: 2,
          schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
          nodePositions: {},
          storyWorldNodePresent: false,
          sessionId: 'canvas-session',
        },
        CHAPTER_ID,
      ),
    ).rejects.toMatchObject({ status: 423 });

    expect(writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    expect(tx.storyCanvasLayout.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a retired workbench before parsing its removed fields', async () => {
    const draft = draftRow({
      schemaVersion: 'interactive-film-draft-v2',
      content: lockableDraft(),
    });
    const tx = {
      storyProject: {
        findUnique: jest.fn().mockResolvedValue(summaryProject({ draft })),
      },
      storyChapter: { findMany: jest.fn().mockResolvedValue([chapterRow()]) },
      storyVideoSelection: { findMany: jest.fn().mockResolvedValue([]) },
      storyReferenceSlot: { findMany: jest.fn().mockResolvedValue([]) },
      storyBuild: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const { service } = serviceWith(prisma);

    await expect(
      apiError(service.workbench(USER as never, WORKSPACE_ID, PROJECT_ID, {})),
    ).resolves.toMatchObject({
      code: 'STORY_DRAFT_SCHEMA_UNSUPPORTED',
      actualSchemaVersion: 'interactive-film-draft-v2',
      expectedSchemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
    });
  });

  it('locks only the immutable story revision without creating a production plane', async () => {
    const draft = draftRow();
    const tx = {
      storyDraft: { findUnique: jest.fn().mockResolvedValue(draft) },
      storyChapter: {
        findMany: jest.fn().mockResolvedValue([chapterRow()]),
      },
      storyRevision: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { number: 0 } }),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve(revisionRow(data)),
          ),
      },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const { service } = serviceWith(prisma);

    const result = await service.lockRevision(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      { expectedDraftRevision: 3, source: 'creator' },
    );

    expect(result).toMatchObject({
      id: REVISION_ID,
      sourceDraftRevision: 3,
      content: lockableDraft(),
    });
    expect(tx.storyRevision.create).toHaveBeenCalledTimes(1);
    expect(Object.keys(tx).sort()).toEqual([
      'storyChapter',
      'storyDraft',
      'storyRevision',
    ]);
  });

  it('projects every graph clip into an empty CAS summary without inventing video data', async () => {
    const project = summaryProject();
    const tx = {
      storyProject: { findUnique: jest.fn().mockResolvedValue(project) },
      storyChapter: { findMany: jest.fn().mockResolvedValue([chapterRow()]) },
      storyVideoSelection: { findMany: jest.fn().mockResolvedValue([]) },
      storyReferenceSlot: { findMany: jest.fn().mockResolvedValue([]) },
      storyBuild: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const { service } = serviceWith(prisma);
    const expectedSnapshot = [
      {
        graphNodeId: 'node.opening',
        selectionVersion: 0,
        sourceGenerationAttemptId: null,
        assetId: null,
        variantId: null,
        checksumSha256: null,
        contentType: null,
        durationMs: null,
        width: null,
        height: null,
        browserSafeMp4: null,
      },
    ];

    const result = await service.workbench(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      {},
    );

    expect(result.video).toEqual({
      snapshotHash: storyVideoSnapshotHash(expectedSnapshot),
      clips: [
        {
          graphNodeId: 'node.opening',
          selectionVersion: 0,
          currentVideo: null,
          generation: null,
        },
      ],
      trailer: {
        selectionVersion: 0,
        currentVideo: null,
        generation: null,
      },
    });
    expect(result.references).toEqual([]);
    expect(result.latestBuild).toBeNull();
  });

  it('counts graph clips instead of removed prompt records', async () => {
    const project = summaryProject();
    const prisma = {
      storyProject: {
        findUnique: jest.fn().mockResolvedValue(project),
      },
    };
    const { service } = serviceWith(prisma);

    const result = await service.get(USER as never, WORKSPACE_ID, PROJECT_ID);

    expect(result.production).toMatchObject({
      clipCount: 1,
      currentVideoCount: 0,
      generatingClipCount: 0,
    });
  });
});

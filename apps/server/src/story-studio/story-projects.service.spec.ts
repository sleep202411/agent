import { ConflictException, HttpException } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  StudioDocumentType,
  StoryDurationPreset,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryRevisionSource,
} from '@prisma/client';
import { storyVisualStyleSkillBySlug } from '@repo/shared';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
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
const MEDIA_ASSET_ID = '0197f4a2-0800-7000-8000-000000000007';
const MEDIA_VARIANT_ID = '0197f4a2-0800-7000-8000-000000000008';
const SCRIPT_DOCUMENT_ID = '0197f4a2-0800-7000-8000-000000000010';
const NOW = new Date('2026-07-12T12:00:00.000Z');
const CINEMATIC_REALISM_SKILL =
  storyVisualStyleSkillBySlug('cinematic-realism')!;

function lockableDraft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: 'At night, a sealed gate asks who owns the truth.',
      synopsis: "A visitor must choose whether to reveal the villa's secret.",
      characters: [
        {
          id: 'hero',
          name: { 'zh-CN': '来客' },
          summary: 'A visitor searching for the truth.',
          images: [],
          voice: null,
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
          interactions: [],
          exit: { kind: 'auto', routes: [{ target: null }] },
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
          interactions: [],
          exit: { kind: 'auto', routes: [{ target: null }] },
        },
      ],
    },
  };
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    frameProfile: StoryFrameProfile.landscape_16_9,
    durationPreset: null,
    visualStyle: null,
    visualStyleSkillId: null,
    visualStyleSkillVersionId: null,
    creativeProfileConfirmedAt: null,
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
    nodePositions: { 'clip:scene-1': { x: -500, y: 120 } },
    revision: 2,
    updatedByUserId: USER.userId,
    updatedBySessionId: 'canvas-session',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function candidateAssetRow(overrides: Record<string, unknown> = {}) {
  return {
    storyProjectId: PROJECT_ID,
    mediaAssetId: MEDIA_ASSET_ID,
    addedByUserId: USER.userId,
    addedAt: NOW,
    asset: {
      id: MEDIA_ASSET_ID,
      kind: MediaAssetKind.video,
      storageProvider: 'external_url',
      workspaceId: WORKSPACE_ID,
      bucket: null,
      region: null,
      objectKey: null,
      externalUrl: 'https://media.example/candidate.mp4',
      contentType: 'video/mp4',
      sizeBytes: BigInt(1024),
      width: 1920,
      height: 1080,
      durationSeconds: 12,
      checksumSha256: 'asset-checksum',
      visibility: 'public',
      status: MediaAssetStatus.ready,
      source: 'generated',
      moderationStatus: MediaAssetModerationStatus.approved,
      moderationReason: null,
      moderatedByAdminId: null,
      moderatedAt: null,
      metadata: {},
      createdByUserId: USER.userId,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      placements: [],
      variants: [
        {
          id: MEDIA_VARIANT_ID,
          assetId: MEDIA_ASSET_ID,
          variantKey: 'original',
          kind: 'original',
          status: MediaAssetVariantStatus.ready,
          contentType: 'video/mp4',
          sizeBytes: BigInt(1024),
          width: 1920,
          height: 1080,
          durationSeconds: 12,
          durationMs: 12_000,
          checksumSha256: 'a'.repeat(64),
          metadata: {},
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
          placements: [],
        },
      ],
    },
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
    workspace: { members: [] },
    members: [{ userId: USER.userId, role: StoryProjectMemberRole.owner }],
    referenceSlots: [],
    storyboardSequences: [],
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
    requireProjectInTransaction: jest.fn().mockResolvedValue(access),
    capabilities: jest.fn().mockReturnValue(access.capabilities),
    effectiveAccess: jest.fn().mockReturnValue(access),
  };
  const workspaces = {
    requireWorkspaceRole: jest
      .fn()
      .mockResolvedValue({ role: 'owner', accessScope: 'workspace' }),
    requireWorkspacePresence: jest
      .fn()
      .mockResolvedValue({ role: 'owner', accessScope: 'workspace' }),
  };
  const writeGuard = {
    assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
    tryAcquireDeferredWriteFence: jest.fn().mockResolvedValue(true),
  };
  return {
    service: new StoryProjectsService(
      prisma as never,
      permissions as never,
      workspaces as never,
      writeGuard as never,
      { requireUseAccessById: jest.fn().mockResolvedValue(undefined) } as never,
    ),
    permissions,
    workspaces,
    writeGuard,
  };
}

function transactionMock<TClient extends object>(client: TClient) {
  return jest.fn((callback: (tx: TClient) => Promise<unknown>) =>
    callback(
      'mediaAsset' in client
        ? Object.assign(client, { $executeRaw: jest.fn() })
        : client,
    ),
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
  /**
   * A cover must be a STILL: the player paints it behind the title screen from an
   * image asset, the catalogue tile renders it through next/image, and it is the
   * play page's og:image. A video cover could only ever have shown on the
   * studio's own library card, so accepting one let a creator set a cover that no
   * player and no catalogue would show.
   */
  it('accepts only a ready image from the project workspace as the cover', async () => {
    const project = summaryProject({
      cover: { ...candidateAssetRow().asset, kind: MediaAssetKind.image },
      coverAssetId: MEDIA_ASSET_ID,
      version: 1,
    });
    const tx = {
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue({ id: MEDIA_ASSET_ID }),
      },
      storyProject: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, writeGuard } = serviceWith({
      $transaction: transactionMock(tx),
      storyProject: {
        findUnique: jest.fn().mockResolvedValue(project),
      },
    });

    await expect(
      service.patch(USER as never, PROJECT_ID, {
        expectedProjectVersion: 0,
        coverAssetId: MEDIA_ASSET_ID,
      }),
    ).resolves.toMatchObject({
      cover: {
        id: MEDIA_ASSET_ID,
        kind: 'image',
      },
      projectVersion: 1,
    });
    expect(writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    expect(tx.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: {
        id: MEDIA_ASSET_ID,
        status: MediaAssetStatus.ready,
        moderationStatus: {
          not: MediaAssetModerationStatus.blocked,
        },
        deletedAt: null,
        kind: MediaAssetKind.image,
      },
      select: { id: true },
    });
    expect(tx.storyProject.updateMany).toHaveBeenCalledWith({
      where: {
        id: PROJECT_ID,
        status: StoryProjectStatus.active,
        version: 0,
      },
      data: {
        coverAssetId: MEDIA_ASSET_ID,
        version: { increment: 1 },
      },
    });
  });

  it('rejects an invalid project cover before updating the project', async () => {
    const tx = {
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      storyProject: {
        updateMany: jest.fn(),
      },
    };
    const { service } = serviceWith({
      $transaction: transactionMock(tx),
    });

    let rejection: unknown;
    try {
      await service.patch(USER as never, PROJECT_ID, {
        expectedProjectVersion: 0,
        coverAssetId: MEDIA_ASSET_ID,
      });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(HttpException);
    if (!(rejection instanceof HttpException)) {
      throw new Error('Expected an HTTP exception.');
    }
    expect(rejection.getResponse()).toMatchObject({
      code: 'STORY_PROJECT_COVER_INVALID',
    });
    expect(tx.storyProject.updateMany).not.toHaveBeenCalled();
  });

  it('clears a project cover without looking up a media asset', async () => {
    const project = summaryProject({
      cover: null,
      coverAssetId: null,
      version: 1,
    });
    const tx = {
      mediaAsset: {
        findFirst: jest.fn(),
      },
      storyProject: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service } = serviceWith({
      $transaction: transactionMock(tx),
      storyProject: {
        findUnique: jest.fn().mockResolvedValue(project),
      },
    });

    await expect(
      service.patch(USER as never, PROJECT_ID, {
        expectedProjectVersion: 0,
        coverAssetId: null,
      }),
    ).resolves.toMatchObject({ cover: null, projectVersion: 1 });
    expect(tx.mediaAsset.findFirst).not.toHaveBeenCalled();
  });

  it('changes the frame profile during setup before video or build production begins', async () => {
    const current = summaryProject();
    const saved = summaryProject({
      frameProfile: StoryFrameProfile.portrait_9_16,
      durationPreset: StoryDurationPreset.short_5_15,
      visualStyle: 'cinematic-realism',
      creativeProfileConfirmedAt: NOW,
      version: 1,
    });
    const tx = {
      skillCatalogItem: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: CINEMATIC_REALISM_SKILL.skillId }),
      },
      storyProject: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service } = serviceWith({
      $transaction: transactionMock(tx),
      storyProject: { findUnique: jest.fn().mockResolvedValue(saved) },
    });

    await expect(
      service.patch(USER as never, PROJECT_ID, {
        expectedProjectVersion: 0,
        frameProfile: 'portrait_9_16',
        durationPreset: 'short_5_15',
        visualStyle: 'cinematic-realism',
        confirmCreativeProfile: true,
      }),
    ).resolves.toMatchObject({
      frameProfile: 'portrait_9_16',
      frameProfileMutable: true,
    });
    expect(tx.storyProject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          frameProfile: 'portrait_9_16',
          durationPreset: 'short_5_15',
          visualStyle: 'cinematic-realism',
        }) as unknown,
      }),
    );
  });

  it('locks the frame profile after a current video has been selected', async () => {
    const current = summaryProject({
      storyboardSequences: [
        {
          plotNodeId: 'node.opening',
          clips: [{ selectedMediaVersionId: MEDIA_ASSET_ID }],
        },
      ],
    });
    const tx = {
      skillCatalogItem: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: CINEMATIC_REALISM_SKILL.skillId }),
      },
      storyProject: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn(),
      },
    };
    const { service } = serviceWith({
      $transaction: transactionMock(tx),
    });

    await expect(
      apiError(
        service.patch(USER as never, PROJECT_ID, {
          expectedProjectVersion: 0,
          frameProfile: 'portrait_9_16',
          durationPreset: 'short_5_15',
          visualStyle: 'cinematic-realism',
          confirmCreativeProfile: true,
        }),
      ),
    ).resolves.toMatchObject({
      code: 'STORY_FRAME_PROFILE_LOCKED',
    });
    expect(tx.storyProject.updateMany).not.toHaveBeenCalled();
  });

  it('lists only the selected workspace without requiring direct project membership', async () => {
    const findMany = jest.fn((input: { where: Record<string, unknown> }) => {
      void input;
      return Promise.resolve([
        summaryProject({ id: PROJECT_ID, workspaceId: WORKSPACE_ID }),
        summaryProject({
          id: REVISION_ID,
          workspaceId: WORKSPACE_ID,
          members: [
            { userId: USER.userId, role: StoryProjectMemberRole.editor },
          ],
        }),
      ]);
    });
    const { service } = serviceWith({ storyProject: { findMany } });

    await expect(
      service.list(USER as never, {
        workspaceId: WORKSPACE_ID,
        status: 'active',
        limit: 20,
      }),
    ).resolves.toMatchObject({
      items: [
        { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
        { id: REVISION_ID, workspaceId: WORKSPACE_ID },
      ],
      nextCursor: null,
    });

    const where = findMany.mock.calls[0]?.[0].where ?? {};
    expect(where).toHaveProperty('workspaceId', WORKSPACE_ID);
    expect(where).not.toHaveProperty('members');
  });

  it('limits project-only guests to their direct memberships in the selected workspace', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service, workspaces } = serviceWith({ storyProject: { findMany } });
    workspaces.requireWorkspacePresence.mockResolvedValue({
      role: 'viewer',
      accessScope: 'project_only',
    });

    await service.list(USER as never, {
      workspaceId: WORKSPACE_ID,
      status: 'active',
      limit: 20,
    });

    expect(workspaces.requireWorkspacePresence).toHaveBeenCalledWith(
      USER.userId,
      WORKSPACE_ID,
    );
    const calls = findMany.mock.calls as unknown[][];
    expect(calls[0]?.[0]).toMatchObject({
      where: {
        workspaceId: WORKSPACE_ID,
        members: {
          some: { userId: USER.userId, status: 'active', removedAt: null },
        },
      },
    });
  });

  it('intersects linked confirmed games with workspace and project-only permissions', async () => {
    const findMany = jest
      .fn<Promise<unknown[]>, [{ where: unknown }]>()
      .mockResolvedValue([]);
    const query = jest.fn().mockResolvedValue([{ id: PROJECT_ID }]);
    const { service, workspaces } = serviceWith({
      storyProject: { findMany },
      $queryRaw: query,
    });
    workspaces.requireWorkspacePresence.mockResolvedValue({
      role: 'viewer',
      accessScope: 'project_only',
    });
    await service.list(USER as never, {
      workspaceId: WORKSPACE_ID,
      linkedIpId: REVISION_ID,
      status: 'active',
      limit: 20,
    });
    const first = findMany.mock.calls[0]?.[0] as { where: unknown };
    expect(first.where).toMatchObject({
      id: { in: [PROJECT_ID] },
      workspaceId: WORKSPACE_ID,
      members: {
        some: { userId: USER.userId, status: 'active', removedAt: null },
      },
    });
    query.mockResolvedValueOnce([]);
    await service.list(USER as never, {
      workspaceId: WORKSPACE_ID,
      linkedIpId: REVISION_ID,
      status: 'active',
      limit: 20,
    });
    const second = findMany.mock.calls[1]?.[0] as { where: unknown };
    expect(second.where).toMatchObject({ id: { in: [] } });
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
    const canvasDocument = {
      id: '0197f4a2-0800-7000-8000-000000000099',
      schemaVersion: '2026-05-27',
      title: project.title,
      contentSnapshot: {},
      crdtState: Buffer.from([]),
    };
    const scriptDocument = {
      ...canvasDocument,
      id: SCRIPT_DOCUMENT_ID,
      storyProjectId: PROJECT_ID,
      storyChapterId: CHAPTER_ID,
      workspaceId: WORKSPACE_ID,
      title: chapter.title,
      type: StudioDocumentType.script,
      currentSequence: 0,
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyProject: {
        create,
        findUnique: jest.fn().mockResolvedValue(project),
      },
      storyChapter: {
        create: jest.fn().mockResolvedValue(chapter),
        findFirst: jest.fn().mockResolvedValue({ title: chapter.title }),
      },
      storyCanvasLayout: {
        create: jest.fn().mockResolvedValue(canvasLayoutRow()),
      },
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValueOnce(canvasDocument)
          .mockResolvedValueOnce(scriptDocument),
        update: jest
          .fn()
          .mockResolvedValueOnce(canvasDocument)
          .mockResolvedValueOnce(scriptDocument),
      },
      studioDocumentVersion: {
        create: jest
          .fn()
          .mockResolvedValueOnce({
            id: '0197f4a2-0800-7000-8000-000000000098',
          })
          .mockResolvedValueOnce({
            id: '0197f4a2-0800-7000-8000-000000000097',
          }),
      },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const { service, workspaces } = serviceWith(prisma);

    const result = await service.create(USER as never, {
      workspaceId: WORKSPACE_ID,
      title: 'Branching Film Test',
      defaultLocale: 'zh-CN',
      visibility: 'private',
    });

    expect(workspaces.requireWorkspaceRole).toHaveBeenCalledWith(
      USER.userId,
      WORKSPACE_ID,
      'editor',
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        frameProfile: StoryFrameProfile.landscape_16_9,
      }) as unknown,
    });
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
      }) as unknown,
    });
    expect(result).toMatchObject({
      script: {
        documentId: SCRIPT_DOCUMENT_ID,
        currentSequence: 0,
        sourceVersionId: null,
        sourceSequence: null,
        status: 'missing',
      },
      video: {
        snapshotHash: storyVideoSnapshotHash([]),
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
      'script',
      'video',
    ]);
  });

  it('curates durable workspace media independently from canvas layout', async () => {
    const candidate = candidateAssetRow();
    const listFindMany = jest.fn().mockResolvedValue([candidate]);
    const listHarness = serviceWith({
      storyCandidateAsset: { findMany: listFindMany },
    });

    const listed = await listHarness.service.listCandidateAssets(
      USER as never,
      PROJECT_ID,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.asset).toMatchObject({
      id: MEDIA_ASSET_ID,
      kind: 'video',
      previewUrl: 'https://media.example/candidate.mp4',
    });
    expect(listed[0]?.videoVariant).toMatchObject({
      id: MEDIA_VARIANT_ID,
      variantKey: 'original',
      checksumSha256: 'a'.repeat(64),
    });
    expect(listFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storyProjectId: PROJECT_ID,
          asset: {
            is: {
              status: MediaAssetStatus.ready,
              moderationStatus: {
                not: MediaAssetModerationStatus.blocked,
              },
              deletedAt: null,
              kind: {
                in: [
                  MediaAssetKind.image,
                  MediaAssetKind.video,
                  MediaAssetKind.audio,
                ],
              },
            },
          },
        },
      }),
    );

    const tx = {
      mediaAsset: {
        findUnique: jest.fn().mockResolvedValue({
          ...candidate.asset,
          deletedAt: null,
          moderationStatus: MediaAssetModerationStatus.unreviewed,
        }),
      },
      storyCandidateAsset: {
        upsert: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue(candidate),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storyProject: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const mutationHarness = serviceWith({
      $transaction: transactionMock(tx),
    });

    await expect(
      mutationHarness.service.addCandidateAsset(
        USER as never,
        PROJECT_ID,
        MEDIA_ASSET_ID,
      ),
    ).resolves.toMatchObject({ asset: { id: MEDIA_ASSET_ID } });
    await expect(
      mutationHarness.service.removeCandidateAsset(
        USER as never,
        PROJECT_ID,
        MEDIA_ASSET_ID,
      ),
    ).resolves.toEqual({ mediaAssetId: MEDIA_ASSET_ID });
    expect(tx.storyCandidateAsset.upsert).toHaveBeenCalledWith({
      where: {
        storyProjectId_mediaAssetId: {
          storyProjectId: PROJECT_ID,
          mediaAssetId: MEDIA_ASSET_ID,
        },
      },
      create: {
        storyProjectId: PROJECT_ID,
        mediaAssetId: MEDIA_ASSET_ID,
        addedByUserId: USER.userId,
      },
      update: {},
    });
    expect(tx.storyCandidateAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        storyProjectId: PROJECT_ID,
        mediaAssetId: MEDIA_ASSET_ID,
      },
    });
  });

  /**
   * These six conditions used to be one `findFirst` whose miss always said the
   * media "must be a ready image, video, or audio asset in this project
   * workspace" — so a creator whose upload was merely still transcoding, and a
   * creator whose file was blocked by moderation, were told the same thing and
   * both concluded they should wait. Each rejection now names its own cause.
   */
  it('names the specific reason a candidate is rejected', async () => {
    const attempt = async (asset: unknown) => {
      const harness = serviceWith({
        $transaction: transactionMock({
          mediaAsset: { findUnique: jest.fn().mockResolvedValue(asset) },
        }),
      });
      return harness.service
        .addCandidateAsset(USER as never, PROJECT_ID, MEDIA_ASSET_ID)
        .then(() => 'resolved')
        .catch((error: unknown) => {
          if (error instanceof HttpException) {
            const response = error.getResponse();
            if (
              typeof response === 'object' &&
              response !== null &&
              'message' in response &&
              typeof response.message === 'string'
            ) {
              return response.message;
            }
          }
          return error instanceof Error ? error.message : 'Unknown error';
        });
    };
    const base = {
      id: MEDIA_ASSET_ID,
      kind: MediaAssetKind.video,
      status: MediaAssetStatus.ready,
      moderationStatus: MediaAssetModerationStatus.unreviewed,
      deletedAt: null,
    };

    expect(await attempt(null)).toContain('no longer exists');
    expect(await attempt({ ...base, deletedAt: new Date() })).toContain(
      'no longer exists',
    );
    expect(await attempt({ ...base, kind: MediaAssetKind.other })).toContain(
      'image, video, or audio',
    );
    expect(
      await attempt({ ...base, status: MediaAssetStatus.uploading }),
    ).toContain('still uploading');
    expect(
      await attempt({
        ...base,
        moderationStatus: MediaAssetModerationStatus.blocked,
      }),
    ).toContain('blocked by moderation');
  });

  it('exposes a ready video variant even when advisory metadata is absent', async () => {
    const candidate = candidateAssetRow();
    const variant = candidate.asset.variants[0] as unknown as Omit<
      (typeof candidate.asset.variants)[number],
      'checksumSha256' | 'durationMs' | 'durationSeconds' | 'width' | 'height'
    > & {
      checksumSha256: string | null;
      durationMs: number | null;
      durationSeconds: number | null;
      width: number | null;
      height: number | null;
    };
    variant.checksumSha256 = null;
    variant.durationMs = null;
    variant.durationSeconds = null;
    variant.width = null;
    variant.height = null;
    const { service } = serviceWith({
      storyCandidateAsset: {
        findMany: jest.fn().mockResolvedValue([candidate]),
      },
    });

    const result = await service.listCandidateAssets(USER as never, PROJECT_ID);

    expect(result).toHaveLength(1);
    expect(result[0]?.asset.id).toBe(MEDIA_ASSET_ID);
    expect(result[0]?.videoVariant).toMatchObject({
      id: MEDIA_VARIANT_ID,
      checksumSha256: null,
      durationSeconds: null,
      width: null,
      height: null,
    });
  });

  it('derives candidate display seconds from exact millisecond metadata', async () => {
    const source = candidateAssetRow();
    const candidate = {
      ...source,
      asset: {
        ...source.asset,
        variants: source.asset.variants.map((variant) => ({
          ...variant,
          durationSeconds: null,
        })),
      },
    };
    const { service } = serviceWith({
      storyCandidateAsset: {
        findMany: jest.fn().mockResolvedValue([candidate]),
      },
    });

    const result = await service.listCandidateAssets(USER as never, PROJECT_ID);

    expect(result[0]?.videoVariant?.durationSeconds).toBe(12);
  });

  it('creates a real chapter together with its own empty canvas layout', async () => {
    const created = chapterRow({
      id: SECOND_CHAPTER_ID,
      title: 'The Return',
      rank: 1,
      nodeIds: [],
      entryNodeId: null,
    });
    const scriptDocument = {
      id: SCRIPT_DOCUMENT_ID,
      storyProjectId: PROJECT_ID,
      storyChapterId: SECOND_CHAPTER_ID,
      workspaceId: WORKSPACE_ID,
      title: created.title,
      type: StudioDocumentType.script,
      schemaVersion: '2026-05-27',
      currentSequence: 0,
      contentSnapshot: {},
      crdtState: Buffer.from([]),
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      storyChapter: {
        findMany: jest.fn().mockResolvedValue([chapterRow()]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _max: { rank: 0 } }),
        create: jest.fn().mockResolvedValue(created),
        findFirst: jest.fn().mockResolvedValue({ title: created.title }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue(draftRow()),
      },
      storyStoryboardSequence: { findMany: jest.fn().mockResolvedValue([]) },
      storyCanvasLayout: { create: jest.fn().mockResolvedValue({}) },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(scriptDocument),
        update: jest.fn().mockResolvedValue(scriptDocument),
      },
      studioDocumentVersion: {
        create: jest.fn().mockResolvedValue({
          id: '0197f4a2-0800-7000-8000-000000000097',
        }),
      },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.createChapter(USER as never, PROJECT_ID, {
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
      }) as unknown,
    });
    expect(tx.studioDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyProjectId: PROJECT_ID,
        storyChapterId: SECOND_CHAPTER_ID,
        workspaceId: WORKSPACE_ID,
        type: StudioDocumentType.script,
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
        findMany: jest.fn().mockResolvedValue([current]),
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue(renamed),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue(draftRow()),
      },
      storyStoryboardSequence: { findMany: jest.fn().mockResolvedValue([]) },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.patchChapter(USER as never, PROJECT_ID, CHAPTER_ID, {
        title: 'A New Name',
      }),
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
      storyStoryboardSequence: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sequence-opening',
            storyChapterId: CHAPTER_ID,
            plotNodeId: 'node.opening',
            status: 'current',
          },
        ]),
      },
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

  it('updates chapter membership before creating a new Plot node timeline', async () => {
    const current = draftRow();
    const next = lockableDraft();
    next.graph.nodes.push({
      kind: 'clip',
      nodeId: 'node.second',
      clipKey: 'S01',
      interactions: [],
      exit: { kind: 'auto', routes: [{ target: null }] },
    });
    const savedChapter = chapterRow({
      nodeIds: ['node.opening', 'node.second'],
    });
    const writeOrder: string[] = [];
    const tx = {
      storyDraft: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(draftRow({ content: next, revision: 4 })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storyStoryboardSequence: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sequence-opening',
            storyChapterId: CHAPTER_ID,
            plotNodeId: 'node.opening',
            status: 'current',
          },
        ]),
        create: jest.fn().mockImplementation(() => {
          writeOrder.push('sequence');
          return Promise.resolve({});
        }),
      },
      storyChapter: {
        findMany: jest.fn().mockResolvedValue([chapterRow()]),
        update: jest.fn().mockImplementation(() => {
          writeOrder.push('chapter');
          return Promise.resolve(savedChapter);
        }),
        findUnique: jest.fn().mockResolvedValue(savedChapter),
      },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.putDraft(
        USER as never,
        PROJECT_ID,
        {
          expectedRevision: 3,
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: next,
          sessionId: 'chapter-save',
        },
        CHAPTER_ID,
      ),
    ).resolves.toMatchObject({ revision: 4 });

    expect(writeOrder).toEqual(['chapter', 'sequence']);
    expect(tx.storyStoryboardSequence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyProjectId: PROJECT_ID,
        storyChapterId: CHAPTER_ID,
        plotNodeId: 'node.second',
        durationMs: 0,
      }) as unknown,
    });
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
      storyStoryboardSequence: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
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

  it('imports assets and storyboard clips in the same draft transaction', async () => {
    const current = draftRow();
    const createdSequences: Array<{ id: string; plotNodeId: string }> = [];
    let persistedContent = current.content;
    const savedChapter = chapterRow({
      nodeIds: ['node.opening'],
    });
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      storyDraft: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve(
            draftRow({
              content: persistedContent,
              revision: persistedContent === current.content ? 3 : 4,
            }),
          ),
        ),
        updateMany: jest
          .fn()
          .mockImplementation(({ data }: { data: { content: unknown } }) => {
            persistedContent = data.content as InteractiveStoryDraftContent;
            return Promise.resolve({ count: 1 });
          }),
      },
      storyStoryboardSequence: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: { plotNodeId?: { in?: string[] } } }) => {
              const ids = where.plotNodeId?.in;
              if (!ids) {
                return Promise.resolve([
                  {
                    id: 'sequence-opening',
                    storyChapterId: CHAPTER_ID,
                    plotNodeId: 'node.opening',
                    status: 'current',
                  },
                ]);
              }
              return Promise.resolve(
                createdSequences.filter((row) => ids.includes(row.plotNodeId)),
              );
            },
          ),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: { plotNodeId: string } }) => {
            const row = {
              id: `sequence-${createdSequences.length}`,
              plotNodeId: data.plotNodeId,
            };
            createdSequences.push(row);
            return Promise.resolve(row);
          }),
        update: jest.fn().mockResolvedValue({}),
      },
      storyStoryboardClip: {
        create: jest.fn().mockResolvedValue({ id: 'clip-1' }),
      },
      storyAssetSpec: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'asset-1' }),
      },
      storyChapter: {
        findMany: jest.fn().mockResolvedValue([chapterRow()]),
        update: jest.fn().mockResolvedValue(savedChapter),
        findUnique: jest.fn().mockResolvedValue(savedChapter),
      },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });
    const plot = {
      entryNodeId: 'opening',
      assets: [
        {
          id: 'hero',
          kind: 'character',
          name: 'Mira',
          imagePrompt: 'Cinematic portrait of Mira at dawn.',
        },
      ],
      stateVariables: [
        {
          key: 'courage',
          name: 'Courage',
          valueType: 'number',
          initialValue: 0,
        },
      ],
      nodes: [
        {
          id: 'opening',
          type: 'scene',
          title: 'Opening',
          onEnterEffects: [{ kind: 'add', key: 'courage', amount: 1 }],
          next: null,
          storyboard: {
            clips: [
              {
                id: 'letter',
                kind: 'image',
                title: 'Letter',
                durationMs: 2000,
                prompt: 'A sealed letter on worn floorboards.',
              },
            ],
          },
        },
      ],
    };

    const result = await service.importPlot(
      USER as never,
      PROJECT_ID,
      {
        expectedRevision: 3,
        schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
        content: lockableDraft(),
        sessionId: 'import-save',
        locale: 'en-US',
        mode: 'append',
        plot,
      },
      CHAPTER_ID,
    );

    expect(result.importedNodeIds).toHaveLength(1);
    expect(result.draft.content.storyBible.stateVariables).toEqual([
      expect.objectContaining({ key: 'courage', valueType: 'number' }),
    ]);
    expect(
      persistedContent.graph.nodes.find(
        (node) => node.nodeId === result.importedNodeIds[0],
      ),
    ).toMatchObject({
      onEnterEffects: [{ kind: 'add', key: 'courage', amount: 1 }],
    });
    expect(tx.storyAssetSpec.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Mira',
        imagePrompt: 'Cinematic portrait of Mira at dawn.',
        userModifiedByUserId: USER.userId,
      }) as unknown,
    });
    expect(tx.storyStoryboardClip.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stableKey: 'letter',
        title: 'Letter',
        startMs: 0,
        durationMs: 2000,
        imagePrompt: 'A sealed letter on worn floorboards.',
        videoPrompt: null,
        userModifiedByUserId: USER.userId,
      }) as unknown,
    });
    expect(tx.storyStoryboardSequence.update).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^sequence-\d+$/) as unknown },
      data: expect.objectContaining({ durationMs: 2000 }) as unknown,
    });
  });

  it('rejects an invalid plot before opening a draft transaction', async () => {
    const prisma = { $transaction: jest.fn() };
    const { service } = serviceWith(prisma);

    await expect(
      service.importPlot(
        USER as never,
        PROJECT_ID,
        {
          expectedRevision: 3,
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: lockableDraft(),
          sessionId: 'import-save',
          locale: 'en-US',
          mode: 'append',
          plot: { version: 1, entryNodeId: 'opening', nodes: [] },
        },
        CHAPTER_ID,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
      storyStoryboardSequence: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue(draftRow({ content })),
        update: jest.fn().mockResolvedValue({}),
      },
      storyProject: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.archiveChapter(USER as never, PROJECT_ID, CHAPTER_ID),
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

  it('returns the stored canvas layout for a chapter', async () => {
    const row = canvasLayoutRow({ nodePositions: {} });
    const findUnique = jest.fn().mockResolvedValue(row);
    const prisma = {
      storyChapter: { findFirst: jest.fn().mockResolvedValue(chapterRow()) },
      storyCanvasLayout: { findUnique },
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.getCanvasLayout(USER as never, PROJECT_ID, CHAPTER_ID),
    ).resolves.toMatchObject({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: row.nodePositions,
      revision: 2,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { storyChapterId: CHAPTER_ID },
    });
  });

  it('writes the canvas layout under compare-and-set on the revision', async () => {
    const saved = canvasLayoutRow({ nodePositions: {}, revision: 3 });
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
      PROJECT_ID,
      {
        expectedRevision: 2,
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions: {},
        sessionId: 'canvas-session',
      },
      CHAPTER_ID,
    );

    expect(tx.storyCanvasLayout.updateMany).toHaveBeenCalledWith({
      where: {
        storyChapterId: CHAPTER_ID,
        storyProjectId: PROJECT_ID,
        revision: 2,
      },
      data: {
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions: {},
        revision: { increment: 1 },
        updatedByUserId: USER.userId,
        updatedBySessionId: 'canvas-session',
      },
    });
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
        PROJECT_ID,
        {
          expectedRevision: 2,
          schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
          nodePositions: {},
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
      storyStoryboardSequence: { findMany: jest.fn().mockResolvedValue([]) },
      storyReferenceSlot: { findMany: jest.fn().mockResolvedValue([]) },
      storyBuild: { findFirst: jest.fn().mockResolvedValue(null) },
      studioDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const { service } = serviceWith(prisma);

    await expect(
      apiError(service.workbench(USER as never, PROJECT_ID, {})),
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

    const result = await service.lockRevision(USER as never, PROJECT_ID, {
      expectedDraftRevision: 3,
      source: 'creator',
    });

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

  it('hashes an empty storyboard snapshot when no sequences exist', async () => {
    const project = summaryProject();
    const tx = {
      storyProject: { findUnique: jest.fn().mockResolvedValue(project) },
      storyChapter: { findMany: jest.fn().mockResolvedValue([chapterRow()]) },
      storyStoryboardSequence: { findMany: jest.fn().mockResolvedValue([]) },
      storyReferenceSlot: { findMany: jest.fn().mockResolvedValue([]) },
      storyBuild: { findFirst: jest.fn().mockResolvedValue(null) },
      studioDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: transactionMock(tx) };
    const { service } = serviceWith(prisma);

    const result = await service.workbench(USER as never, PROJECT_ID, {});

    // A scene without a storyboard sequence contributes nothing: the hash is
    // exactly the empty-snapshot hash Build and Preview would compute.
    expect(result.video).toEqual({
      snapshotHash: storyVideoSnapshotHash([]),
    });
  });

  it('repairs a legacy chapter projection transactionally on workbench read', async () => {
    const content = lockableDraft();
    const invalidChapter = chapterRow({ nodeIds: [], entryNodeId: null });
    const persistedDraft = draftRow({ content, revision: 4 });
    const tx = {
      storyProject: {
        findUnique: jest
          .fn()
          .mockResolvedValue(summaryProject({ draft: draftRow({ content }) })),
      },
      storyChapter: {
        findMany: jest.fn().mockResolvedValue([invalidChapter]),
        update: jest.fn().mockResolvedValue({}),
      },
      storyDraft: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(persistedDraft),
      },
      storyChapterGraphRepair: { upsert: jest.fn().mockResolvedValue({}) },
      storyStoryboardSequence: { findMany: jest.fn().mockResolvedValue([]) },
      storyReferenceSlot: { findMany: jest.fn().mockResolvedValue([]) },
      storyBuild: { findFirst: jest.fn().mockResolvedValue(null) },
      studioDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    const result = await service.workbench(USER as never, PROJECT_ID, {});

    expect(result.draft).toMatchObject({ revision: 4, chapterId: CHAPTER_ID });
    expect(result.chapter).toMatchObject({
      id: CHAPTER_ID,
      nodeCount: 1,
      entryNodeId: 'node.opening',
    });
    expect(tx.storyChapter.update).toHaveBeenCalledWith({
      where: { id: CHAPTER_ID },
      data: { nodeIds: ['node.opening'], entryNodeId: 'node.opening' },
    });
    expect(tx.storyChapterGraphRepair.upsert).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy content editable when a rollout-era repair CAS loses', async () => {
    const content = lockableDraft();
    const invalidChapter = chapterRow({ nodeIds: [], entryNodeId: null });
    const tx = {
      storyProject: {
        findUnique: jest
          .fn()
          .mockResolvedValue(summaryProject({ draft: draftRow({ content }) })),
      },
      storyChapter: { findMany: jest.fn().mockResolvedValue([invalidChapter]) },
      storyDraft: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storyStoryboardSequence: { findMany: jest.fn().mockResolvedValue([]) },
      storyReferenceSlot: { findMany: jest.fn().mockResolvedValue([]) },
      storyBuild: { findFirst: jest.fn().mockResolvedValue(null) },
      studioDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const { service } = serviceWith({ $transaction: transactionMock(tx) });

    await expect(
      service.workbench(USER as never, PROJECT_ID, {}),
    ).resolves.toMatchObject({
      chapter: { id: CHAPTER_ID, nodeCount: 1 },
      draft: { revision: 3, chapterId: CHAPTER_ID },
    });
  });

  it('counts graph clips instead of removed prompt records', async () => {
    const project = summaryProject();
    const prisma = {
      storyProject: {
        findUnique: jest.fn().mockResolvedValue(project),
      },
    };
    const { service } = serviceWith(prisma);

    const result = await service.get(USER as never, PROJECT_ID);

    expect(result.production).toMatchObject({
      clipCount: 1,
      currentVideoCount: 0,
    });
  });
});

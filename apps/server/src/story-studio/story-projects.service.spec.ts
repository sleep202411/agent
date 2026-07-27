import { ConflictException, HttpException } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  StoryFormat,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryRevisionSource,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from '@prisma/client';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  STORY_PRODUCTION_CANVAS_SCHEMA_VERSION,
  StoryProjectListQuerySchema,
  type InteractiveStoryDraftContent,
} from './dto';
import { StoryPermissionService } from './story-permission.service';
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
/** Someone else's tenant: where a shared project lives, never the invitee's. */
const OWNER_WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000009';
const NOW = new Date('2026-07-12T12:00:00.000Z');
const PROJECT_NOT_FOUND_BODY = {
  code: 'STORY_PROJECT_NOT_FOUND',
  message: 'Story project not found.',
};

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
    nodePositions: { 'clip:scene-1': { x: -500, y: 120 } },
    revision: 2,
    updatedByUserId: USER.userId,
    updatedBySessionId: 'canvas-session',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function productionCanvasRow(overrides: Record<string, unknown> = {}) {
  return {
    storyProjectId: PROJECT_ID,
    schemaVersion: STORY_PRODUCTION_CANVAS_SCHEMA_VERSION,
    content: { nodes: [], edges: [], assets: [], groups: [] },
    updatedByUserId: USER.userId,
    updatedBySessionId: null,
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

/**
 * Keeps the status alongside the body so a denial test fails loudly on a 403
 * instead of quietly accepting any rejection.
 */
async function httpError(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        status: error.getStatus(),
        body: error.getResponse() as Record<string, unknown>,
      };
    }
    throw error;
  }
  throw new Error('Expected operation to reject.');
}

type StoryProjectAccessQuery = {
  where: {
    id: string;
    status?: StoryProjectStatus;
    members?: { some: { userId: string } };
  };
};

/**
 * A resolver over the REAL permission services, with a prisma double that
 * applies only the filters the caller actually sends — an absent filter is a
 * filter Prisma does not apply, so an unscoped lookup finds the project the way
 * it really would. That is what makes the denial cases below meaningful:
 * mocking `requireProject` the way {@link serviceWith} does, or hard-coding the
 * membership scope here, would make them pass by construction.
 */
function resolverWith(seats: {
  storyRole: StoryProjectMemberRole | null;
  workspaceRole: WorkspaceMemberRole | null;
  status?: StoryProjectStatus;
}) {
  const status = seats.status ?? StoryProjectStatus.active;
  const prisma = {
    storyProject: {
      findFirst: jest.fn(({ where }: StoryProjectAccessQuery) => {
        if (where.id !== PROJECT_ID) return Promise.resolve(null);
        if (where.status !== undefined && where.status !== status) {
          return Promise.resolve(null);
        }
        if (
          where.members !== undefined &&
          (where.members.some.userId !== USER.userId ||
            seats.storyRole === null)
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          ...projectRow({ workspaceId: OWNER_WORKSPACE_ID, status }),
          members: seats.storyRole === null ? [] : [{ role: seats.storyRole }],
        });
      }),
    },
    workspaceMember: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          seats.workspaceRole === null
            ? null
            : {
                workspaceId: OWNER_WORKSPACE_ID,
                userId: USER.userId,
                role: seats.workspaceRole,
              },
        ),
      ),
    },
  };
  const writeGuard = {
    assertHumanWriteAllowedEarly: jest.fn().mockResolvedValue(undefined),
  };
  const workspacePermissions = new WorkspacePermissionService(prisma as never);
  return new StoryProjectsService(
    prisma as never,
    new StoryPermissionService(
      prisma as never,
      workspacePermissions,
      writeGuard as never,
    ),
    workspacePermissions,
    writeGuard as never,
  );
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
      service.patch(USER as never, WORKSPACE_ID, PROJECT_ID, {
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
        workspaceId: WORKSPACE_ID,
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
        workspaceId: WORKSPACE_ID,
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
      await service.patch(USER as never, WORKSPACE_ID, PROJECT_ID, {
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
      service.patch(USER as never, WORKSPACE_ID, PROJECT_ID, {
        expectedProjectVersion: 0,
        coverAssetId: null,
      }),
    ).resolves.toMatchObject({ cover: null, projectVersion: 1 });
    expect(tx.mediaAsset.findFirst).not.toHaveBeenCalled();
  });

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

  it('lists joined projects across tenants, excluding the ones you own', async () => {
    // The three properties that make "Shared with me" both useful and safe. A
    // workspace id in this predicate would defeat the point; dropping the role
    // filter would restate everything `list` already shows; dropping the
    // workspace-membership filter would advertise projects whose tenant seat is
    // gone, which `requireProject` refuses to open.
    const findMany = jest.fn((input: { where: Record<string, unknown> }) => {
      void input;
      return Promise.resolve([]);
    });
    const { service } = serviceWith({ storyProject: { findMany } });

    await expect(
      service.listJoined(USER as never, { status: 'active', limit: 20 }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    const where = findMany.mock.calls[0]?.[0].where ?? {};
    expect(where).not.toHaveProperty('workspaceId');
    expect(where.members).toEqual({
      some: {
        userId: USER.userId,
        status: 'active',
        removedAt: null,
        role: { not: StoryProjectMemberRole.owner },
      },
    });
    expect(where.workspace).toEqual({
      members: {
        some: {
          userId: USER.userId,
          status: WorkspaceMemberStatus.active,
        },
      },
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
          productionCanvas: {
            create: { schemaVersion: string; content: unknown };
          };
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
          productionCanvas: {
            create: {
              schemaVersion: STORY_PRODUCTION_CANVAS_SCHEMA_VERSION,
              content: { nodes: [], edges: [], assets: [], groups: [] },
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
          productionCanvas: {
            create: { schemaVersion: string; content: unknown };
          };
          writeState: { create: Record<string, never> };
        };
      }) => {
        expect(input.data.draft.create).toMatchObject({
          schemaVersion: 'interactive-story-draft-v1',
          content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
        });
        expect(input.data.productionCanvas.create).toMatchObject({
          schemaVersion: STORY_PRODUCTION_CANVAS_SCHEMA_VERSION,
          content: { nodes: [], edges: [], assets: [], groups: [] },
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
      }) as unknown,
    });
    expect(result).toMatchObject({
      video: {
        snapshotHash: storyVideoSnapshotHash([]),
        clips: [],
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

  it('loads the one project-owned production canvas with read permission', async () => {
    const row = productionCanvasRow();
    const findUnique = jest.fn().mockResolvedValue(row);
    const { service, permissions } = serviceWith({
      storyProductionCanvas: { findUnique },
    });

    await expect(
      service.getProductionCanvas(USER as never, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toEqual({
      projectId: PROJECT_ID,
      schemaVersion: STORY_PRODUCTION_CANVAS_SCHEMA_VERSION,
      content: { nodes: [], edges: [], assets: [], groups: [] },
      updatedByUserId: USER.userId,
      updatedBySessionId: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(permissions.requireProject).toHaveBeenCalledWith(
      USER.userId,
      PROJECT_ID,
      'story.read',
      { allowArchived: true },
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { storyProjectId: PROJECT_ID },
    });
  });

  it('persists production canvas content with last-write-wins semantics', async () => {
    const content = {
      nodes: [
        {
          id: 'note-1',
          type: 'note' as const,
          position: { x: 10, y: 20 },
          data: { text: 'continuity notes' },
        },
        {
          id: 'note-2',
          type: 'note' as const,
          position: { x: 360, y: 20 },
          data: { text: 'camera notes' },
        },
      ],
      edges: [],
      assets: [],
      groups: [
        {
          id: 'group-1',
          nodeIds: ['note-1', 'note-2'],
          color: 'blue' as const,
        },
      ],
    };
    const updated = productionCanvasRow({
      content,
      updatedBySessionId: 'canvas-session',
    });
    const tx = {
      storyProductionCanvas: {
        update: jest.fn().mockResolvedValue(updated),
      },
      storyProject: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const { service, writeGuard } = serviceWith({
      $transaction: transactionMock(tx),
    });

    await expect(
      service.putProductionCanvas(USER as never, WORKSPACE_ID, PROJECT_ID, {
        schemaVersion: STORY_PRODUCTION_CANVAS_SCHEMA_VERSION,
        content,
        sessionId: 'canvas-session',
      }),
    ).resolves.toMatchObject({ projectId: PROJECT_ID, content });
    expect(writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    expect(tx.storyProductionCanvas.update).toHaveBeenCalledWith({
      where: { storyProjectId: PROJECT_ID },
      data: {
        schemaVersion: STORY_PRODUCTION_CANVAS_SCHEMA_VERSION,
        content,
        updatedByUserId: USER.userId,
        updatedBySessionId: 'canvas-session',
      },
    });
  });

  it('curates durable workspace media independently from canvas layout', async () => {
    const candidate = candidateAssetRow();
    const listFindMany = jest.fn().mockResolvedValue([candidate]);
    const listHarness = serviceWith({
      storyCandidateAsset: { findMany: listFindMany },
    });

    const listed = await listHarness.service.listCandidateAssets(
      USER as never,
      WORKSPACE_ID,
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
        findFirst: jest.fn().mockResolvedValue(candidate.asset),
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
        WORKSPACE_ID,
        PROJECT_ID,
        MEDIA_ASSET_ID,
      ),
    ).resolves.toMatchObject({ asset: { id: MEDIA_ASSET_ID } });
    await expect(
      mutationHarness.service.removeCandidateAsset(
        USER as never,
        WORKSPACE_ID,
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

    const result = await service.listCandidateAssets(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

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

    const result = await service.listCandidateAssets(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

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

  it('returns the stored canvas layout for a chapter', async () => {
    const row = canvasLayoutRow({ nodePositions: {} });
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
      WORKSPACE_ID,
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
        workspaceId: WORKSPACE_ID,
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
        WORKSPACE_ID,
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
        },
      ],
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
    });
  });
});

describe('StoryProjectsService shared-link workspace resolve', () => {
  /**
   * The whole reason this read exists: a first-time invitee has no stored
   * selection, so the studio scopes every request to their own personal
   * workspace and the project's real tenant never gets asked. A workspace
   * viewer seat plus an active story membership is precisely what the canvas
   * needs, so it is precisely what resolves.
   */
  it('resolves the owning workspace for an invited member whose active tenant is elsewhere', async () => {
    const service = resolverWith({
      storyRole: StoryProjectMemberRole.editor,
      workspaceRole: WorkspaceMemberRole.viewer,
    });

    await expect(
      service.resolveWorkspace(USER as never, PROJECT_ID),
    ).resolves.toEqual({ workspaceId: OWNER_WORKSPACE_ID });
  });

  /**
   * `workbench` reads with `allowArchived`, so an archived project still opens
   * read-only. Refusing to resolve one would strand a shared link on a 404 that
   * switching workspaces would have cleared.
   */
  it('resolves an archived project because the canvas still opens it read-only', async () => {
    const service = resolverWith({
      storyRole: StoryProjectMemberRole.viewer,
      workspaceRole: WorkspaceMemberRole.viewer,
      status: StoryProjectStatus.archived,
    });

    await expect(
      service.resolveWorkspace(USER as never, PROJECT_ID),
    ).resolves.toEqual({ workspaceId: OWNER_WORKSPACE_ID });
  });

  /**
   * Story membership is the grant; the workspace seat only ever narrows it.
   * A workspace owner who was never added to the project cannot open the canvas
   * — `requireProject` matches only projects the caller is an active member of
   * — so resolving for them would hand out a tenant id for a project they still
   * could not open, which is exactly the widening this route may not do. Their
   * answer is byte-identical to the stranger's below.
   */
  it('tells a workspace member with no story membership nothing, exactly as the canvas would', async () => {
    const service = resolverWith({
      storyRole: null,
      workspaceRole: WorkspaceMemberRole.owner,
    });

    const failure = await httpError(
      service.resolveWorkspace(USER as never, PROJECT_ID),
    );

    expect(failure.status).toBe(404);
    expect(failure.body).toEqual(PROJECT_NOT_FOUND_BODY);
  });

  /**
   * A story member who lost their seat in the owning tenant trips the workspace
   * re-check, which raises 403. A 403 on an id-shaped route is itself the leak
   * — it confirms the project exists — so this route flattens it to the 404.
   */
  it('flattens the lost-workspace-seat denial into the same 404', async () => {
    const service = resolverWith({
      storyRole: StoryProjectMemberRole.editor,
      workspaceRole: null,
    });

    const failure = await httpError(
      service.resolveWorkspace(USER as never, PROJECT_ID),
    );

    expect(failure.status).toBe(404);
    expect(failure.body).toEqual(PROJECT_NOT_FOUND_BODY);
    expect(JSON.stringify(failure.body)).not.toContain(OWNER_WORKSPACE_ID);
  });

  it('answers a stranger with a 404 that carries no workspace id', async () => {
    const service = resolverWith({ storyRole: null, workspaceRole: null });

    const failure = await httpError(
      service.resolveWorkspace(USER as never, PROJECT_ID),
    );

    expect(failure.status).toBe(404);
    expect(failure.body).toEqual(PROJECT_NOT_FOUND_BODY);
    expect(JSON.stringify(failure.body)).not.toContain(OWNER_WORKSPACE_ID);
  });
});

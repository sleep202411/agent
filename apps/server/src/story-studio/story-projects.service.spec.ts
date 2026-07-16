import { NotFoundException } from '@nestjs/common';
import {
  Prisma,
  StoryFormat,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryRevisionSource,
  WorkspaceMemberRole,
} from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
  INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  type InteractiveFilmDraftContent,
  type StoryProjectSummaryDto,
} from './dto';
import { projectStoryFilmRevision } from './story-film-revision-projector';
import { StoryProjectsService } from './story-projects.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const DRAFT_ID = '0197f4a2-0800-7000-8000-000000000003';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000004';
const MODEL_ID = '0197f4a2-0800-7000-8000-000000000005';
const VIDEO_ASSET_ID = '0197f4a2-0800-7000-8000-000000000006';
const MODEL_SLUG = 'story-video-model';
const NOW = new Date('2026-07-12T12:00:00.000Z');

process.env.STORY_STUDIO_DEFAULT_VIDEO_MODEL_SLUG = MODEL_SLUG;

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    format: StoryFormat.interactive_film,
    frameProfile: StoryFrameProfile.landscape_16_9,
    status: StoryProjectStatus.active,
    visibility: 'private',
    title: 'Tiger Balm Villa: Nightfall at Dragon Gate',
    summary: null,
    defaultLocale: 'zh-CN',
    coverAssetId: null,
    tags: [],
    sourceIpId: null,
    nextBuildNumber: 1,
    version: 3,
    createdByUserId: USER.userId,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function summaryProject(overrides: Record<string, unknown> = {}) {
  const content = EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT;
  return projectRow({
    cover: null,
    draft: {
      revision: 0,
      content,
      contentHash: canonicalJsonHash(content),
    },
    revisions: [],
    members: [{ userId: USER.userId, role: StoryProjectMemberRole.owner }],
    filmReferenceSlots: [],
    filmClipHeads: [],
    builds: [],
    ...overrides,
  });
}

function draftRow(overrides: Record<string, unknown> = {}) {
  const content =
    (overrides.content as InteractiveFilmDraftContent | undefined) ??
    EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT;
  return {
    id: DRAFT_ID,
    storyProjectId: PROJECT_ID,
    schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
    content,
    contentHash: canonicalJsonHash(content),
    revision: 3,
    updatedByUserId: USER.userId,
    updatedBySessionId: 'session-a',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function canvasLayoutRow(overrides: Record<string, unknown> = {}) {
  return {
    storyProjectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
    nodePositions: {},
    revision: 0,
    updatedByUserId: USER.userId,
    updatedBySessionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function revisionRow(overrides: Record<string, unknown> = {}) {
  const content =
    (overrides.content as InteractiveFilmDraftContent | undefined) ??
    lockableDraft();
  return {
    id: REVISION_ID,
    storyProjectId: PROJECT_ID,
    number: 1,
    sourceDraftRevision: 3,
    schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
    content,
    contentHash: canonicalJsonHash(content),
    label: null,
    source: StoryRevisionSource.creator,
    createdByUserId: USER.userId,
    createdAt: NOW,
    ...overrides,
  };
}

function lockableDraft(): InteractiveFilmDraftContent {
  return {
    storyBible: {
      logline: 'At night, a sealed gate asks who owns the truth.',
      synopsis: "A visitor must choose whether to reveal the villa's secret.",
      worldview: 'One night inside a mythic villa.',
      storyRules: [],
      characters: [
        {
          id: 'hero',
          name: { 'zh-CN': '来客' },
          role: 'protagonist',
          summary: 'A visitor searching for the truth.',
          playable: true,
          continuityRules: [],
        },
      ],
      locations: [],
      props: [],
      stateVariables: [],
      endings: [
        {
          id: 'ending.truth',
          title: { 'zh-CN': '真相' },
          summary: { 'zh-CN': '门打开了。' },
          kind: 'truth',
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
    clipPrompts: [
      {
        graphNodeId: 'node.opening',
        clipKey: 'S00',
        title: 'The sealed gate',
        description: 'A visitor faces the gate.',
        targetDurationMs: 15_000,
        generationControl: {
          mode: 'frame_lock',
          frameMode: 'first_frame',
        },
        masterDirection: 'Hold on the visitor as the gate begins to glow.',
        referenceRoleNotes: [],
        emotionalArc: 'Uncertainty settles into resolve.',
        beats: [
          {
            id: 'beat:1',
            startMs: 0,
            endMs: 15_000,
            visual: 'The sealed gate fills the background.',
            camera: 'Slow push-in from a medium shot.',
            action: 'The visitor raises one hand toward the gate.',
            performance: '',
            emotion: '',
            dialogue: '',
            audio: '',
            endState: '',
            continuity: '',
          },
        ],
        negativeConstraints: [],
        continuityNotes: [],
      },
    ],
    trailerPrompt: null,
    productionNotes: [],
  };
}

function makeHarness(
  options: {
    permissionError?: Error;
    projectUpdateCount?: number;
    currentProjectVersion?: number;
    draftUpdateCount?: number;
    currentDraft?: ReturnType<typeof draftRow> | null;
    transactionDraft?: ReturnType<typeof draftRow> | null;
    existingRevision?: ReturnType<typeof revisionRow> | null;
    existingFilmSpec?: Record<string, unknown> | null;
    existingFilmClips?: Array<Record<string, unknown>>;
    priorFilmClips?: Array<Record<string, unknown>>;
    existingFilmTrailer?: Record<string, unknown> | null;
    priorFilmTrailer?: Record<string, unknown> | null;
    modelGenerationModes?: string[];
    workbenchRevision?: ReturnType<typeof revisionRow> | null;
    workbenchFilmSpec?: Record<string, unknown> | null;
    workbenchFilmClips?: Array<Record<string, unknown>>;
    workbenchFilmTrailer?: Record<string, unknown> | null;
    canvasLayoutUpdateCount?: number;
    currentCanvasLayout?: ReturnType<typeof canvasLayoutRow> | null;
    transactionCanvasLayout?: ReturnType<typeof canvasLayoutRow> | null;
  } = {},
) {
  const access = {
    project: projectRow(),
    role: StoryProjectMemberRole.owner,
    capabilities: [
      'story.read',
      'story.edit',
      'story.generate',
      'story.review',
      'story.build',
      'story.release',
      'story.admin',
    ],
  };
  const permissions = {
    requireProject: jest.fn(() =>
      options.permissionError
        ? Promise.reject(options.permissionError)
        : Promise.resolve(access),
    ),
    capabilities: jest.fn(() => access.capabilities),
  };
  const workspacePermissions = {
    requireWorkspaceRole: jest.fn(() => ({
      role: WorkspaceMemberRole.owner,
    })),
  };

  const tx = {
    storyDraft: {
      findUnique: jest.fn(() =>
        options.transactionDraft === undefined
          ? draftRow({ content: lockableDraft() })
          : options.transactionDraft,
      ),
      updateMany: jest.fn(() => ({
        count: options.draftUpdateCount ?? 1,
      })),
    },
    storyProject: {
      update: jest.fn(() => projectRow()),
      findUnique: jest.fn(() => summaryProject()),
    },
    storyRevision: {
      findUnique: jest.fn(() => options.existingRevision ?? null),
      findFirst: jest.fn(() => options.workbenchRevision ?? null),
      aggregate: jest.fn(() => ({ _max: { number: 0 } })),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        revisionRow(data),
      ),
    },
    storyFilmSpec: {
      findUnique: jest.fn(
        () => options.workbenchFilmSpec ?? options.existingFilmSpec ?? null,
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => data),
    },
    storyFilmClip: {
      findMany: jest.fn(
        (args?: { where?: { revisionId?: string | { not?: string } } }) =>
          typeof args?.where?.revisionId === 'object'
            ? (options.priorFilmClips ?? [])
            : (options.workbenchFilmClips ?? options.existingFilmClips ?? []),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => data),
    },
    storyFilmClipHead: {
      findMany: jest.fn(() =>
        (options.workbenchFilmClips ?? []).map((clip) => ({ clip })),
      ),
    },
    storyFilmTrailer: {
      findUnique: jest.fn(
        () =>
          options.workbenchFilmTrailer ?? options.existingFilmTrailer ?? null,
      ),
      findFirst: jest.fn(() => options.priorFilmTrailer ?? null),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => data),
    },
    storyFilmTrailerHead: {
      findUnique: jest.fn(() => {
        const trailer =
          options.workbenchFilmTrailer ?? options.existingFilmTrailer ?? null;
        return trailer ? { trailer } : null;
      }),
    },
    storyFilmReferenceSlot: {
      findMany: jest.fn(() => []),
    },
    storyBuild: {
      findFirst: jest.fn(() => null),
    },
    aiCanonicalModel: {
      findUnique: jest.fn(() => ({
        id: MODEL_ID,
        slug: MODEL_SLUG,
        modality: 'video',
        status: 'active',
        archivedAt: null,
        generationModes: options.modelGenerationModes ?? [
          'image_to_video',
          'first_last_frame_to_video',
          'multimodal_to_video',
        ],
      })),
    },
    storyCanvasLayout: {
      updateMany: jest.fn(() => ({
        count: options.canvasLayoutUpdateCount ?? 1,
      })),
      findUnique: jest.fn(() =>
        options.transactionCanvasLayout === undefined
          ? options.currentCanvasLayout === undefined
            ? canvasLayoutRow({ revision: 1 })
            : options.currentCanvasLayout
          : options.transactionCanvasLayout,
      ),
    },
  };

  const prisma = {
    storyProject: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const draftCreate = (data.draft as { create: Record<string, unknown> })
          .create;
        return summaryProject({
          workspaceId: data.workspaceId,
          format: data.format,
          frameProfile: data.frameProfile,
          status: data.status,
          visibility: data.visibility,
          title: data.title,
          summary: data.summary ?? null,
          defaultLocale: data.defaultLocale,
          sourceIpId: data.sourceIpId ?? null,
          createdByUserId: data.createdByUserId,
          draft: draftRow({ ...draftCreate, revision: 0 }),
        });
      }),
      updateMany: jest.fn(() => ({
        count: options.projectUpdateCount ?? 1,
      })),
      findUnique: jest.fn((args: { select?: unknown }) =>
        args.select
          ? {
              workspaceId: WORKSPACE_ID,
              status: StoryProjectStatus.active,
              version: options.currentProjectVersion ?? 8,
            }
          : summaryProject(),
      ),
      update: jest.fn(() => projectRow()),
    },
    storyDraft: {
      findUnique: jest.fn(() =>
        options.currentDraft === undefined
          ? draftRow({ revision: 7 })
          : options.currentDraft,
      ),
    },
    storyCanvasLayout: {
      updateMany: jest.fn(() => ({
        count: options.canvasLayoutUpdateCount ?? 1,
      })),
      findUnique: jest.fn(() =>
        options.currentCanvasLayout === undefined
          ? canvasLayoutRow({ revision: 1 })
          : options.currentCanvasLayout,
      ),
    },
    storyRevision: {
      findUnique: jest.fn(() => options.existingRevision ?? null),
      findFirst: jest.fn(() => options.workbenchRevision ?? null),
      findMany: jest.fn(() => []),
    },
    storyFilmSpec: {
      findUnique: jest.fn(() => options.workbenchFilmSpec ?? null),
    },
    storyFilmClip: {
      findMany: jest.fn(() => options.workbenchFilmClips ?? []),
    },
    storyFilmClipHead: {
      findMany: jest.fn(() =>
        (options.workbenchFilmClips ?? []).map((clip) => ({ clip })),
      ),
    },
    storyFilmTrailer: {
      findUnique: jest.fn(() => options.workbenchFilmTrailer ?? null),
    },
    storyFilmTrailerHead: {
      findUnique: jest.fn(() => {
        const trailer = options.workbenchFilmTrailer ?? null;
        return trailer ? { trailer } : null;
      }),
    },
    storyFilmReferenceSlot: {
      findMany: jest.fn(() => []),
    },
    storyBuild: {
      findFirst: jest.fn(() => null),
    },
    $transaction: jest.fn(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    ),
  };

  return {
    service: new StoryProjectsService(
      prisma as never,
      permissions as never,
      workspacePermissions as never,
    ),
    prisma,
    permissions,
    workspacePermissions,
    tx,
  };
}

async function expectApiError(
  operation: Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    await operation;
  } catch (error) {
    const response = (error as { response?: unknown }).response;
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw error;
    }
    return response as Record<string, unknown>;
  }
  throw new Error('Expected the operation to reject.');
}

describe('StoryProjectsService.create', () => {
  it('creates the tenant-scoped project, owner membership and blank draft atomically', async () => {
    const { service, prisma, workspacePermissions } = makeHarness();

    const result = await service.create(USER as never, WORKSPACE_ID, {
      format: 'interactive_film',
      frameProfile: 'portrait_9_16',
      title: 'Branching Film Test',
      defaultLocale: 'zh-CN',
      visibility: 'private',
    });

    expect(workspacePermissions.requireWorkspaceRole).toHaveBeenCalledWith(
      USER.userId,
      WORKSPACE_ID,
      WorkspaceMemberRole.editor,
    );
    const create = prisma.storyProject.create.mock.calls[0][0].data as {
      workspaceId: string;
      frameProfile: StoryFrameProfile;
      members: { create: Record<string, unknown> };
      draft: { create: Record<string, unknown> };
      canvasLayout: { create: Record<string, unknown> };
    };
    expect(create.workspaceId).toBe(WORKSPACE_ID);
    expect(create.frameProfile).toBe(StoryFrameProfile.portrait_9_16);
    expect(create.members.create).toMatchObject({
      userId: USER.userId,
      role: StoryProjectMemberRole.owner,
    });
    expect(create.draft.create).toMatchObject({
      schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
      content: EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
      contentHash: canonicalJsonHash(EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT),
    });
    expect(create.canvasLayout.create).toEqual({
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: {},
      updatedByUserId: USER.userId,
    });
    expect(result.draft.revision).toBe(0);
    expect(result.project.frameProfile).toBe('portrait_9_16');
  });
});

describe('StoryProjectsService current-draft production readiness', () => {
  function projectSummary(
    service: StoryProjectsService,
    row: ReturnType<typeof summaryProject>,
  ) {
    return (
      service as unknown as {
        toProjectSummary(
          value: ReturnType<typeof summaryProject>,
          userId: string,
        ): StoryProjectSummaryDto;
      }
    ).toProjectSummary(row, USER.userId);
  }

  it('preserves a project current video across draft revisions', () => {
    const { service } = makeHarness();
    const draft = lockableDraft();
    const row = summaryProject({
      draft: {
        revision: 9,
        content: draft,
        contentHash: canonicalJsonHash(draft),
      },
      revisions: [
        revisionRow({
          sourceDraftRevision: 8,
          contentHash: 'a'.repeat(64),
        }),
      ],
      filmReferenceSlots: [
        {
          revisionId: REVISION_ID,
          required: true,
          approvedVersionId: MODEL_ID,
        },
      ],
      filmClipHeads: [
        {
          clip: {
            graphNodeId: 'node.opening',
            revisionId: REVISION_ID,
            currentVideoAssetId: VIDEO_ASSET_ID,
            latestGenerationAttempt: null,
          },
        },
      ],
    });

    expect(projectSummary(service, row).production).toMatchObject({
      clipCount: 1,
      currentVideoCount: 1,
      generatingClipCount: 0,
      referenceSlotCount: 0,
    });
  });

  it('reports neutral current-video and active-generation counts', () => {
    const { service } = makeHarness();
    const draft = lockableDraft();
    const contentHash = canonicalJsonHash(draft);
    const row = summaryProject({
      draft: { revision: 9, content: draft, contentHash },
      revisions: [
        revisionRow({ sourceDraftRevision: 9, contentHash, content: draft }),
      ],
      filmClipHeads: [
        {
          clip: {
            graphNodeId: 'node.opening',
            revisionId: REVISION_ID,
            currentVideoAssetId: VIDEO_ASSET_ID,
            latestGenerationAttempt: { status: 'running' },
          },
        },
      ],
    });

    expect(projectSummary(service, row).production).toMatchObject({
      clipCount: 1,
      currentVideoCount: 1,
      generatingClipCount: 1,
    });
  });
});

describe('StoryProjectsService canvas layout CAS', () => {
  it('reads a tenant-scoped layout without touching canonical story data', async () => {
    const { service, prisma, permissions } = makeHarness({
      currentCanvasLayout: canvasLayoutRow({
        revision: 4,
        nodePositions: { __story_root__: { x: -400, y: 80 } },
      }),
    });

    const result = await service.getCanvasLayout(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(permissions.requireProject).toHaveBeenCalledWith(
      USER.userId,
      PROJECT_ID,
      'story.read',
      { allowArchived: true },
    );
    expect(result).toMatchObject({
      projectId: PROJECT_ID,
      revision: 4,
      nodePositions: { __story_root__: { x: -400, y: 80 } },
    });
    expect(prisma.storyProject.update).not.toHaveBeenCalled();
    expect(prisma.storyProject.updateMany).not.toHaveBeenCalled();
    expect(prisma.storyDraft.findUnique).not.toHaveBeenCalled();
  });

  it('persists only layout coordinates with revision CAS', async () => {
    const { service, prisma, tx } = makeHarness({
      currentCanvasLayout: canvasLayoutRow({
        revision: 5,
        updatedBySessionId: 'canvas-session',
        nodePositions: {
          __story_root__: { x: -500, y: 120 },
          'clip:opening': { x: 0, y: 120 },
        },
      }),
    });
    const nodePositions = {
      __story_root__: { x: -500, y: 120 },
      'clip:opening': { x: 0, y: 120 },
    };

    const result = await service.putCanvasLayout(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      {
        expectedRevision: 4,
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions,
        sessionId: 'canvas-session',
      },
    );

    expect(tx.storyCanvasLayout.updateMany).toHaveBeenCalledWith({
      where: {
        storyProjectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        revision: 4,
      },
      data: {
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions,
        revision: { increment: 1 },
        updatedByUserId: USER.userId,
        updatedBySessionId: 'canvas-session',
      },
    });
    expect(result.revision).toBe(5);
    expect(prisma.storyCanvasLayout.findUnique).not.toHaveBeenCalled();
    expect(prisma.storyProject.update).not.toHaveBeenCalled();
    expect(prisma.storyProject.updateMany).not.toHaveBeenCalled();
    expect(prisma.storyDraft.findUnique).not.toHaveBeenCalled();
  });

  it('returns the row read under the successful CAS transaction lock', async () => {
    const savedByThisRequest = canvasLayoutRow({
      revision: 5,
      updatedBySessionId: 'canvas-session-a',
      nodePositions: { __story_root__: { x: -500, y: 120 } },
    });
    const concurrentlySavedAfterCommit = canvasLayoutRow({
      revision: 6,
      updatedBySessionId: 'canvas-session-b',
      nodePositions: { __story_root__: { x: 900, y: 300 } },
    });
    const { service, prisma, tx } = makeHarness({
      transactionCanvasLayout: savedByThisRequest,
      currentCanvasLayout: concurrentlySavedAfterCommit,
    });

    const result = await service.putCanvasLayout(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      {
        expectedRevision: 4,
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions: savedByThisRequest.nodePositions,
        sessionId: 'canvas-session-a',
      },
    );

    expect(result).toMatchObject({
      revision: 5,
      updatedBySessionId: 'canvas-session-a',
      nodePositions: { __story_root__: { x: -500, y: 120 } },
    });
    expect(tx.storyCanvasLayout.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.storyCanvasLayout.findUnique).not.toHaveBeenCalled();
  });

  it('returns the current complete layout on a stale save', async () => {
    const { service } = makeHarness({
      canvasLayoutUpdateCount: 0,
      currentCanvasLayout: canvasLayoutRow({
        revision: 9,
        nodePositions: { '__ending__:truth': { x: 900, y: 40 } },
      }),
    });

    const response = await expectApiError(
      service.putCanvasLayout(USER as never, WORKSPACE_ID, PROJECT_ID, {
        expectedRevision: 8,
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions: {},
        sessionId: 'canvas-session',
      }),
    );

    expect(response).toMatchObject({
      code: 'CANVAS_LAYOUT_REVISION_CONFLICT',
      expectedRevision: 8,
      actualRevision: 9,
      current: {
        projectId: PROJECT_ID,
        revision: 9,
        nodePositions: { '__ending__:truth': { x: 900, y: 40 } },
      },
    });
  });
});

describe('StoryProjectsService draft CAS', () => {
  it('returns the complete current draft on a stale save', async () => {
    const { service } = makeHarness({ draftUpdateCount: 0 });

    const response = await expectApiError(
      service.putDraft(USER as never, WORKSPACE_ID, PROJECT_ID, {
        expectedRevision: 2,
        schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
        content: EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
        sessionId: 'session-b',
      }),
    );
    expect(response).toMatchObject({
      code: 'DRAFT_REVISION_CONFLICT',
      expectedRevision: 2,
      actualRevision: 7,
    });
    expect(response.current).toMatchObject({
      revision: 7,
      projectId: PROJECT_ID,
    });
  });
});

describe('StoryProjectsService revision locking', () => {
  it('rejects an incomplete mutable draft at the lock boundary', async () => {
    const { service } = makeHarness({
      transactionDraft: draftRow({
        content: EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
      }),
    });

    const response = await expectApiError(
      service.lockRevision(USER as never, WORKSPACE_ID, PROJECT_ID, {
        expectedDraftRevision: 3,
        source: 'creator',
      }),
    );
    expect(response.code).toBe('STORY_REVISION_NOT_LOCKABLE');
    expect(Array.isArray(response.issues)).toBe(true);
  });

  it('is idempotent for an already-locked draft revision', async () => {
    const content = lockableDraft();
    const existing = revisionRow({
      content,
      contentHash: canonicalJsonHash(content),
    });
    const { service, tx } = makeHarness({
      transactionDraft: draftRow({ content }),
      existingRevision: existing,
    });

    const result = await service.lockRevision(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      { expectedDraftRevision: 3, source: 'creator' },
    );

    expect(result.id).toBe(REVISION_ID);
    expect(tx.storyRevision.create).not.toHaveBeenCalled();
    expect(tx.storyFilmSpec.create).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmClip.create).toHaveBeenCalledTimes(1);
  });

  it('creates the immutable revision and its film production plane atomically', async () => {
    const { service, tx } = makeHarness({
      transactionDraft: draftRow({ content: lockableDraft() }),
    });

    const result = await service.lockRevision(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      { expectedDraftRevision: 3, source: 'creator' },
    );

    expect(result.id).toBe(REVISION_ID);
    expect(tx.storyRevision.create).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmSpec.create).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmClip.create).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmSpec.create.mock.calls[0]?.[0].data).toMatchObject({
      revisionId: REVISION_ID,
      storyProjectId: PROJECT_ID,
      targetClipCount: 1,
      targetEndingCount: 1,
      frameWidth: 1920,
      frameHeight: 1080,
      defaultCanonicalModelId: MODEL_ID,
    });
    expect(tx.storyFilmClip.create.mock.calls[0]?.[0].data).toMatchObject({
      revisionId: REVISION_ID,
      key: 'S00',
      graphNodeId: 'node.opening',
      generationMode: 'frame_lock',
      frameMode: 'first_frame',
      targetDurationMs: 15_000,
    });
    expect(tx.storyFilmTrailer.create).not.toHaveBeenCalled();
  });

  it('carries the stable clip current video into a new revision without carrying generation ownership', async () => {
    const assetId = '0197f4a2-0800-7000-8000-000000000030';
    const variantId = '0197f4a2-0800-7000-8000-000000000031';
    const oldSpecHash = 'a'.repeat(64);
    const oldInputHash = 'b'.repeat(64);
    const { service, tx } = makeHarness({
      transactionDraft: draftRow({ content: lockableDraft() }),
      priorFilmClips: [
        {
          key: 'S00',
          currentVideoAssetId: assetId,
          currentVideoVariantId: variantId,
          currentVideoSpecHash: oldSpecHash,
          currentVideoInputHash: oldInputHash,
          currentVideoChecksumSha256: 'c'.repeat(64),
          currentVideoTechnicalChecks: [
            { key: 'kind', status: 'passed', message: null },
          ],
          currentVideoRevision: 3,
          currentVideoSetByUserId: USER.userId,
          currentVideoSetAt: NOW,
        },
      ],
    });

    await service.lockRevision(USER as never, WORKSPACE_ID, PROJECT_ID, {
      expectedDraftRevision: 3,
      source: 'creator',
    });

    expect(tx.storyFilmClip.create.mock.calls[0]?.[0].data).toMatchObject({
      key: 'S00',
      currentVideoAssetId: assetId,
      currentVideoVariantId: variantId,
      currentVideoSourceAttemptId: null,
      currentVideoSpecHash: oldSpecHash,
      currentVideoInputHash: oldInputHash,
      currentVideoChecksumSha256: 'c'.repeat(64),
      currentVideoRevision: 3,
      latestGenerationAttemptId: null,
    });
  });

  it('projects an authored trailer beside the runtime clips without changing clip targets', async () => {
    const content: InteractiveFilmDraftContent = {
      ...lockableDraft(),
      trailerPrompt: {
        title: '15-second trailer',
        description: 'A promotional root video.',
        targetDurationMs: 15_000,
        generationControl: { mode: 'omni_reference' },
        masterDirection: 'Build restrained dread without revealing the ending.',
        referenceRoleNotes: [],
        emotionalArc: 'Curiosity becomes danger.',
        beats: [
          {
            id: 'trailer:beat:1',
            startMs: 0,
            endMs: 15_000,
            visual: 'The dragon gate emerges from the rain.',
            camera: 'Slow controlled push toward the gate.',
            action: 'The two visitors stop as the cassette starts.',
            performance: '',
            emotion: '',
            dialogue: '',
            audio: 'Tape hiss and wet night ambience.',
            endState: 'Hold on the open dragon mouth.',
            continuity: '',
          },
        ],
        negativeConstraints: ['Do not reveal an ending.'],
        continuityNotes: [],
      },
    };
    const trailerAssetId = '0197f4a2-0800-7000-8000-000000000040';
    const trailerVariantId = '0197f4a2-0800-7000-8000-000000000041';
    const { service, tx } = makeHarness({
      transactionDraft: draftRow({ content }),
      priorFilmTrailer: {
        currentVideoAssetId: trailerAssetId,
        currentVideoVariantId: trailerVariantId,
        currentVideoSpecHash: 'd'.repeat(64),
        currentVideoInputHash: 'e'.repeat(64),
        currentVideoChecksumSha256: 'f'.repeat(64),
        currentVideoTechnicalChecks: [],
        currentVideoRevision: 2,
        currentVideoSetByUserId: USER.userId,
        currentVideoSetAt: NOW,
      },
    });

    await service.lockRevision(USER as never, WORKSPACE_ID, PROJECT_ID, {
      expectedDraftRevision: 3,
      source: 'creator',
    });

    expect(tx.storyFilmSpec.create.mock.calls[0]?.[0].data).toMatchObject({
      targetClipCount: 1,
      targetChoiceCount: 0,
      targetEndingCount: 1,
    });
    expect(tx.storyFilmClip.create).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmTrailer.create).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmTrailer.create.mock.calls[0]?.[0].data).toMatchObject({
      revisionId: REVISION_ID,
      storyProjectId: PROJECT_ID,
      title: '15-second trailer',
      generationMode: 'omni_reference',
      frameMode: null,
      targetDurationMs: 15_000,
      currentVideoAssetId: trailerAssetId,
      currentVideoVariantId: trailerVariantId,
      currentVideoSourceAttemptId: null,
      currentVideoSpecHash: 'd'.repeat(64),
      currentVideoInputHash: 'e'.repeat(64),
      currentVideoRevision: 2,
      latestGenerationAttemptId: null,
    });
  });

  it('hashes the exact normalized Revision content for a legacy v1 draft head', async () => {
    const legacy = lockableDraft();
    delete (legacy as { trailerPrompt?: unknown }).trailerPrompt;
    const rawDraftHash = canonicalJsonHash(legacy);
    const { service, tx } = makeHarness({
      transactionDraft: draftRow({
        content: legacy,
        contentHash: rawDraftHash,
      }),
    });

    await service.lockRevision(USER as never, WORKSPACE_ID, PROJECT_ID, {
      expectedDraftRevision: 3,
      source: 'creator',
    });

    const createData = tx.storyRevision.create.mock.calls[0]?.[0].data as {
      content: InteractiveFilmDraftContent;
      contentHash: string;
    };
    expect(createData.content.trailerPrompt).toBeNull();
    expect(createData.contentHash).toBe(canonicalJsonHash(createData.content));
    expect(createData.contentHash).not.toBe(rawDraftHash);
  });

  it('fails loudly when no system or project video model is selected', async () => {
    const configured = process.env.STORY_STUDIO_DEFAULT_VIDEO_MODEL_SLUG;
    delete process.env.STORY_STUDIO_DEFAULT_VIDEO_MODEL_SLUG;
    try {
      const { service } = makeHarness({
        transactionDraft: draftRow({ content: lockableDraft() }),
      });

      const response = await expectApiError(
        service.lockRevision(USER as never, WORKSPACE_ID, PROJECT_ID, {
          expectedDraftRevision: 3,
          source: 'creator',
        }),
      );
      expect(response).toMatchObject({
        code: 'STORY_DEFAULT_VIDEO_MODEL_NOT_CONFIGURED',
      });
    } finally {
      if (configured) {
        process.env.STORY_STUDIO_DEFAULT_VIDEO_MODEL_SLUG = configured;
      }
    }
  });

  it('rejects a default model that cannot run the authored generation mode', async () => {
    const { service } = makeHarness({
      transactionDraft: draftRow({ content: lockableDraft() }),
      modelGenerationModes: ['text_to_video'],
    });

    const response = await expectApiError(
      service.lockRevision(USER as never, WORKSPACE_ID, PROJECT_ID, {
        expectedDraftRevision: 3,
        source: 'creator',
      }),
    );
    expect(response).toMatchObject({
      code: 'STORY_DEFAULT_VIDEO_MODEL_CAPABILITY_MISMATCH',
      requiredModes: [
        'first_last_frame_to_video',
        'image_to_video',
        'multimodal_to_video',
      ],
      availableModes: ['text_to_video'],
    });
  });

  it('verifies a complete existing production projection without rewriting it', async () => {
    const content = lockableDraft();
    const projection = projectStoryFilmRevision({
      draft: content,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });
    const filmSpec = projection.filmSpec;
    const clip = projection.clipSpecs[0];
    if (!clip) throw new Error('Expected the projected film clip.');
    const { service, tx } = makeHarness({
      transactionDraft: draftRow({ content }),
      existingRevision: revisionRow({
        content,
        contentHash: canonicalJsonHash(content),
      }),
      existingFilmSpec: {
        storyProjectId: PROJECT_ID,
        revisionId: REVISION_ID,
        defaultCanonicalModelId: MODEL_ID,
        specJson: filmSpec,
        specHash: canonicalJsonHash(filmSpec),
      },
      existingFilmClips: [
        {
          storyProjectId: PROJECT_ID,
          revisionId: REVISION_ID,
          key: clip.key,
          graphNodeId: clip.graphNodeId,
          archivedAt: null,
          specJson: clip,
          specHash: canonicalJsonHash(clip),
        },
      ],
    });

    await service.lockRevision(USER as never, WORKSPACE_ID, PROJECT_ID, {
      expectedDraftRevision: 3,
      source: 'creator',
    });

    expect(tx.storyFilmSpec.create).not.toHaveBeenCalled();
    expect(tx.storyFilmClip.create).not.toHaveBeenCalled();
  });

  it('returns the current draft when the lock CAS is stale', async () => {
    const { service } = makeHarness({
      transactionDraft: draftRow({ revision: 4, content: lockableDraft() }),
    });

    const response = await expectApiError(
      service.lockRevision(USER as never, WORKSPACE_ID, PROJECT_ID, {
        expectedDraftRevision: 3,
        source: 'creator',
      }),
    );
    expect(response).toMatchObject({
      code: 'DRAFT_REVISION_CONFLICT',
      expectedRevision: 3,
      actualRevision: 4,
    });
  });
});

describe('StoryProjectsService film workbench', () => {
  it('returns stable canonical model metadata beside the UUID film contract', async () => {
    const content = lockableDraft();
    const projection = projectStoryFilmRevision({
      draft: content,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });
    const projectedClip = projection.clipSpecs[0];
    if (!projectedClip) throw new Error('Expected the projected clip.');
    const generationId = '0197f4a2-0800-7000-8000-000000000006';
    const outputAssetId = '0197f4a2-0800-7000-8000-000000000007';
    const outputVariantId = '0197f4a2-0800-7000-8000-000000000012';
    const outputUrl = 'https://media.example.com/story-video.mp4';
    const { service, prisma, tx } = makeHarness({
      workbenchRevision: revisionRow({ content }),
      workbenchFilmSpec: {
        storyProjectId: PROJECT_ID,
        revisionId: REVISION_ID,
        specJson: projection.filmSpec,
        version: 0,
        productionRevision: 0,
        updatedByUserId: USER.userId,
        createdAt: NOW,
        updatedAt: NOW,
        defaultCanonicalModel: {
          id: MODEL_ID,
          slug: 'seedance-2-0',
          displayName: 'Seedance 2.0',
          generationModes: [
            'image_to_video',
            'first_last_frame_to_video',
            'multimodal_to_video',
          ],
        },
      },
      workbenchFilmClips: [
        {
          id: '0197f4a2-0800-7000-8000-000000000008',
          storyProjectId: PROJECT_ID,
          revisionId: REVISION_ID,
          graphNodeId: projectedClip.graphNodeId,
          rank: projectedClip.rank,
          specJson: projectedClip,
          specHash: canonicalJsonHash(projectedClip),
          version: 0,
          productionInputHash: 'a'.repeat(64),
          currentVideoAssetId: outputAssetId,
          currentVideoVariantId: outputVariantId,
          currentVideoSourceAttemptId: generationId,
          currentVideoSpecHash: canonicalJsonHash(projectedClip),
          currentVideoInputHash: 'a'.repeat(64),
          currentVideoChecksumSha256: 'b'.repeat(64),
          currentVideoTechnicalChecks: [],
          currentVideoRevision: 1,
          currentVideoSetByUserId: USER.userId,
          currentVideoSetAt: NOW,
          updatedAt: NOW,
          references: [
            {
              id: '0197f4a2-0800-7000-8000-000000000009',
              referenceSlotId: '0197f4a2-0800-7000-8000-000000000010',
              role: 'first_frame',
              position: 0,
              required: true,
              referenceSlot: {
                approvedVersionId: '0197f4a2-0800-7000-8000-000000000011',
              },
            },
          ],
          currentVideoAsset: {
            id: outputAssetId,
            kind: 'video',
            status: 'ready',
            moderationStatus: 'approved',
            contentType: 'video/mp4',
            width: 1920,
            height: 1080,
            durationSeconds: 15,
            checksumSha256: 'b'.repeat(64),
            storageProvider: 'external_url',
            bucket: null,
            region: null,
            objectKey: null,
            externalUrl: outputUrl,
            deletedAt: null,
            placements: [],
            variants: [],
          },
          latestGenerationAttempt: null,
        },
      ],
    });

    const result = await service.workbench(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      {},
    );

    expect(result.film?.spec?.generation.defaultCanonicalModelId).toBe(
      MODEL_ID,
    );
    expect(result.film?.defaultModel).toEqual({
      id: MODEL_ID,
      slug: 'seedance-2-0',
      displayName: 'Seedance 2.0',
      generationModes: [
        'image_to_video',
        'first_last_frame_to_video',
        'multimodal_to_video',
      ],
    });
    expect(result.film?.trailer).toBeNull();
    expect(result.film?.clips[0]?.currentVideo).toMatchObject({
      sourceGenerationId: generationId,
      revision: 1,
      asset: {
        id: outputAssetId,
        previewUrl: outputUrl,
      },
    });
    expect(result.film?.clips[0]?.referenceBindings).toEqual([
      {
        id: '0197f4a2-0800-7000-8000-000000000009',
        referenceSlotId: '0197f4a2-0800-7000-8000-000000000010',
        role: 'first_frame',
        rank: 0,
        required: true,
        approvedReferenceVersionId: '0197f4a2-0800-7000-8000-000000000011',
      },
    ]);
    const transactionCalls = prisma.$transaction.mock.calls as unknown as Array<
      [unknown, { isolationLevel: Prisma.TransactionIsolationLevel }]
    >;
    expect(transactionCalls[0]?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(tx.storyProject.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.storyDraft.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.storyRevision.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmSpec.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.storyFilmClipHead.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.storyProject.findUnique).not.toHaveBeenCalled();
    expect(prisma.storyDraft.findUnique).not.toHaveBeenCalled();
    expect(prisma.storyRevision.findFirst).not.toHaveBeenCalled();
    expect(prisma.storyFilmSpec.findUnique).not.toHaveBeenCalled();
    expect(prisma.storyFilmClipHead.findMany).not.toHaveBeenCalled();
  });

  it('returns a revision trailer with neutral current-video state', async () => {
    const content: InteractiveFilmDraftContent = {
      ...lockableDraft(),
      trailerPrompt: {
        title: '15-second trailer',
        description: 'Root promotional video.',
        targetDurationMs: 15_000,
        generationControl: { mode: 'omni_reference' },
        masterDirection: 'A restrained nocturnal mystery trailer.',
        referenceRoleNotes: [],
        emotionalArc: 'Wonder turns into danger.',
        beats: [
          {
            id: 'trailer:beat:1',
            startMs: 0,
            endMs: 15_000,
            visual: 'The dragon gate emerges from the rain.',
            camera: 'Slow push toward the entrance.',
            action: 'The visitor stops.',
            performance: '',
            emotion: '',
            dialogue: '',
            audio: '',
            endState: '',
            continuity: '',
          },
        ],
        negativeConstraints: [],
        continuityNotes: [],
      },
    };
    const projection = projectStoryFilmRevision({
      draft: content,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });
    const trailer = projection.trailerSpec;
    if (!trailer) throw new Error('Expected a projected trailer.');
    const { service } = makeHarness({
      workbenchRevision: revisionRow({ content }),
      workbenchFilmSpec: {
        storyProjectId: PROJECT_ID,
        revisionId: REVISION_ID,
        specJson: projection.filmSpec,
        version: 0,
        productionRevision: 0,
        updatedByUserId: USER.userId,
        createdAt: NOW,
        updatedAt: NOW,
        defaultCanonicalModel: {
          id: MODEL_ID,
          slug: MODEL_SLUG,
          displayName: 'Story video model',
          generationModes: ['multimodal_to_video'],
        },
      },
      workbenchFilmTrailer: {
        id: '0197f4a2-0800-7000-8000-000000000020',
        storyProjectId: PROJECT_ID,
        revisionId: REVISION_ID,
        title: trailer.title,
        generationMode: 'omni_reference',
        frameMode: null,
        targetDurationMs: trailer.targetDurationMs,
        specJson: trailer,
        specHash: canonicalJsonHash(trailer),
        productionInputManifest: null,
        productionInputHash: null,
        version: 0,
        currentVideoAssetId: null,
        currentVideoVariantId: null,
        currentVideoSourceAttemptId: null,
        currentVideoSpecHash: null,
        currentVideoInputHash: null,
        currentVideoChecksumSha256: null,
        currentVideoTechnicalChecks: null,
        currentVideoRevision: 0,
        currentVideoSetByUserId: null,
        currentVideoSetAt: null,
        createdByUserId: USER.userId,
        updatedByUserId: USER.userId,
        createdAt: NOW,
        updatedAt: NOW,
        references: [],
        currentVideoAsset: null,
        latestGenerationAttempt: null,
      },
    });

    const result = await service.workbench(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      {},
    );

    expect(result.film?.clips).toEqual([]);
    expect(result.film?.trailer).toMatchObject({
      id: '0197f4a2-0800-7000-8000-000000000020',
      title: '15-second trailer',
      currentVideoRevision: 0,
      referenceBindings: [],
      currentVideo: null,
      generation: null,
    });
  });
});

describe('StoryProjectsService project CAS and access', () => {
  it('returns a concrete conflict for a stale project patch', async () => {
    const { service } = makeHarness({
      projectUpdateCount: 0,
      currentProjectVersion: 9,
    });

    const response = await expectApiError(
      service.patch(USER as never, WORKSPACE_ID, PROJECT_ID, {
        expectedProjectVersion: 3,
        title: 'New title',
      }),
    );
    expect(response).toMatchObject({
      code: 'PROJECT_VERSION_CONFLICT',
      expectedVersion: 3,
      actualVersion: 9,
    });
  });

  it('archives by CAS and never hard-deletes the project', async () => {
    const { service, prisma } = makeHarness();

    const result = await service.archive(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      { expectedProjectVersion: 3 },
    );

    const update = prisma.storyProject.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toMatchObject({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      version: 3,
    });
    expect(update.data).toMatchObject({
      status: StoryProjectStatus.archived,
      version: { increment: 1 },
    });
    expect(update.data.archivedAt).toBeInstanceOf(Date);
    expect(result.id).toBe(PROJECT_ID);
  });

  it('does not reveal a project to a non-member', async () => {
    const { service, prisma } = makeHarness({
      permissionError: new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      }),
    });

    const response = await expectApiError(
      service.get(USER as never, WORKSPACE_ID, PROJECT_ID),
    );
    expect(response.code).toBe('STORY_PROJECT_NOT_FOUND');
    expect(prisma.storyProject.findUnique).not.toHaveBeenCalled();
  });
});

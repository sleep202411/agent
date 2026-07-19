import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaStorageProvider,
  Prisma,
  StoryBuildKind,
  StoryBuildStatus,
  StoryRevisionSource,
  StoryVideoTargetKind,
} from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';
import {
  compileStoryBuild,
  type FrozenStoryVideoAsset,
  type StoryBuildCompilerInput,
  type StoryBuildVideoInput,
} from './story-build-compiler';
import {
  StoryBuildService,
  storyBuildRequestFingerprint,
} from './story-build.service';
import { LockableInteractiveFilmDraftContentSchema } from './interactive-film.schema';
import {
  storyVideoSnapshotHash,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';

const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000003';
const BUILD_ID = '0197f4a2-0800-7000-8000-000000000004';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000005';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000006';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000007';
const CHECKSUM = 'a'.repeat(64);

function simpleDraft() {
  return LockableInteractiveFilmDraftContentSchema.parse({
    storyBible: {
      logline: 'A single consequential moment.',
      synopsis: 'The protagonist reaches the truth.',
      worldview: 'Choices leave visible traces.',
      storyRules: [],
      characters: [
        {
          id: 'hero',
          name: { 'en-US': 'Hero' },
          role: 'Protagonist',
          summary: 'The person who must face the truth.',
          playable: true,
          continuityRules: [],
        },
      ],
      locations: [],
      props: [],
      stateVariables: [],
      endings: [
        {
          id: 'truth',
          title: { 'en-US': 'Truth' },
          summary: { 'en-US': 'The truth is accepted.' },
          kind: 'truth',
        },
      ],
    },
    graph: {
      entryNodeId: 'clip.start',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'clip.start',
          clipKey: 'START',
          exit: { kind: 'ending', endingId: 'truth' },
        },
      ],
    },
    productionNotes: [],
  });
}

function choiceDraft(triggerAtMs: number) {
  const base = simpleDraft();
  return LockableInteractiveFilmDraftContentSchema.parse({
    ...base,
    storyBible: {
      ...base.storyBible,
      endings: [
        {
          id: 'truth',
          title: { 'en-US': 'Truth' },
          summary: { 'en-US': 'The truth is accepted.' },
          kind: 'truth',
        },
        {
          id: 'echo',
          title: { 'en-US': 'Echo' },
          summary: { 'en-US': 'The moment echoes.' },
          kind: 'echo',
        },
      ],
    },
    graph: {
      entryNodeId: 'clip.start',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'clip.start',
          clipKey: 'START',
          exit: {
            kind: 'choice',
            decisionId: 'decision.path',
            prompt: { 'en-US': 'Which path?' },
            trigger: { kind: 'timecode', atMs: triggerAtMs },
            choices: [
              {
                choiceId: 'choose.truth',
                label: { 'en-US': 'Truth' },
                effects: [],
                nextNodeId: 'clip.truth',
                afterSelect: { kind: 'immediate' },
              },
              {
                choiceId: 'choose.echo',
                label: { 'en-US': 'Echo' },
                effects: [],
                nextNodeId: 'clip.echo',
                afterSelect: { kind: 'immediate' },
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'clip.truth',
          clipKey: 'TRUTH',
          exit: { kind: 'ending', endingId: 'truth' },
        },
        {
          kind: 'clip',
          nodeId: 'clip.echo',
          clipKey: 'ECHO',
          exit: { kind: 'ending', endingId: 'echo' },
        },
      ],
    },
  });
}

function frozenAsset(index: number, durationMs: number): FrozenStoryVideoAsset {
  return {
    assetId: `0197f4a2-1000-7000-8000-${index.toString().padStart(12, '0')}`,
    variantId: `0197f4a2-2000-7000-8000-${index.toString().padStart(12, '0')}`,
    checksumSha256: index.toString(16).padStart(64, '0'),
    contentType: 'video/mp4',
    sizeBytes: 1_000n,
    width: 1920,
    height: 1080,
    durationMs,
    hasAudio: index % 2 === 0,
    browserSafeMp4: true,
    url: `/aurora/story-projects/${PROJECT_ID}/builds/${BUILD_ID}/assets/asset-${index}/variants/variant-${index}/content`,
  };
}

function compilerInput(
  draft = simpleDraft(),
  overrides: Partial<StoryBuildCompilerInput> = {},
): StoryBuildCompilerInput {
  const videos: StoryBuildVideoInput[] = draft.graph.nodes.flatMap(
    (node, index) =>
      node.kind === 'clip'
        ? [
            {
              graphNodeId: node.nodeId,
              sourceGenerationId: null,
              selectionVersion: 1,
              asset: frozenAsset(index + 1, 5_000),
              eligibilityDiagnostics: [],
            },
          ]
        : [],
  );
  return {
    projectId: PROJECT_ID,
    buildId: BUILD_ID,
    sourceDraftRevision: 7,
    channel: 'production',
    scope: { kind: 'full' },
    frameProfile: 'landscape_16_9',
    defaultLocale: 'en-US',
    metadata: { title: 'Test Story', summary: 'A test.' },
    draft,
    videos,
    ...overrides,
  };
}

describe('compileStoryBuild', () => {
  it('keeps channel explicit even for a full-graph preview', () => {
    const result = compileStoryBuild(
      compilerInput(simpleDraft(), { channel: 'preview' }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.runtime).toMatchObject({
      schemaVersion: 2,
      channel: 'preview',
      gameId: PROJECT_ID,
      buildId: BUILD_ID,
    });
  });

  it('fails a required clip with no current selection instead of inventing media', () => {
    const input = compilerInput();
    input.videos[0] = {
      ...input.videos[0],
      asset: null,
    };

    const result = compileStoryBuild(input);

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'STORY_BUILD_CURRENT_VIDEO_REQUIRED' }),
      ]),
    );
  });

  it('fails exact media with missing technical metadata', () => {
    const input = compilerInput();
    input.videos[0] = {
      ...input.videos[0],
      asset: null,
      eligibilityDiagnostics: [
        {
          severity: 'error',
          code: 'STORY_BUILD_VIDEO_METADATA_REQUIRED',
          message: 'Exact variant metadata is incomplete.',
          entityType: 'asset',
          entityId: ASSET_ID,
        },
      ],
    };

    const result = compileStoryBuild(input);

    expect(result.runtime).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toContain(
      'STORY_BUILD_VIDEO_METADATA_REQUIRED',
    );
  });

  it('validates choice timecodes and path totals from actual frozen durations', () => {
    const draft = choiceDraft(4_999);
    const input = compilerInput(draft);
    const durations = new Map([
      ['clip.start', 5_000],
      ['clip.truth', 7_000],
      ['clip.echo', 9_000],
    ]);
    input.videos = input.videos.map((video, index) => ({
      ...video,
      asset: frozenAsset(index + 1, durations.get(video.graphNodeId) as number),
    }));

    const compiled = compileStoryBuild(input);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.pathReport).toMatchObject({
      durationMinMs: 12_000,
      durationMaxMs: 14_000,
    });

    const outOfRange = compileStoryBuild({
      ...input,
      draft: choiceDraft(5_000),
    });
    expect(outOfRange.runtime).toBeNull();
    expect(outOfRange.diagnostics.map((item) => item.code)).toContain(
      'STORY_BUILD_CHOICE_TIMECODE_OUT_OF_RANGE',
    );
  });
});

describe('StoryBuildService concurrency boundaries', () => {
  const user = { userId: 'user-1' } as never;
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
    }),
  };
  const storage = { createReadUrl: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('takes the project write fence before materializing a Build snapshot', async () => {
    const tx = { storyBuild: { findUnique: jest.fn() } };
    const prisma = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const locked = new Error('agent applying');
    const guard = {
      assertHumanWriteAllowed: jest.fn().mockRejectedValue(locked),
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      guard as never,
    );

    await expect(
      service.createBuild(
        user,
        WORKSPACE_ID,
        PROJECT_ID,
        {
          expectedDraftRevision: 1,
          expectedVideoSnapshotHash: 'a'.repeat(64),
          scope: { kind: 'full' },
        },
        'locked-build',
      ),
    ).rejects.toBe(locked);
    expect(guard.assertHumanWriteAllowed).toHaveBeenCalledWith(tx, PROJECT_ID);
    expect(tx.storyBuild.findUnique).not.toHaveBeenCalled();
  });

  it('rejects reuse of an Idempotency-Key with another body', async () => {
    const existingFingerprint = storyBuildRequestFingerprint({
      expectedDraftRevision: 1,
      expectedVideoSnapshotHash: '1'.repeat(64),
      scope: { kind: 'full' },
    });
    const prisma = {
      storyBuild: {
        findUnique: jest.fn().mockResolvedValue({
          requestFingerprint: existingFingerprint,
        }),
      },
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    await expect(
      service.createBuild(
        user,
        WORKSPACE_ID,
        PROJECT_ID,
        {
          expectedDraftRevision: 2,
          expectedVideoSnapshotHash: '2'.repeat(64),
          scope: { kind: 'full' },
        },
        'same-key',
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_BUILD_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('recomputes and CAS-checks the canonical video snapshot in Serializable', async () => {
    const draft = simpleDraft();
    const tx = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(null) },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue({
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          title: 'Story',
          summary: null,
          defaultLocale: 'en-US',
          frameProfile: 'landscape_16_9',
        }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 3,
          schemaVersion: 'interactive-film-draft-v3',
          content: draft,
          contentHash: canonicalJsonHash(draft),
        }),
      },
      storyVideoSelection: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown, options) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        return work(tx);
      }),
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    await expect(
      service.createBuild(
        user,
        WORKSPACE_ID,
        PROJECT_ID,
        {
          expectedDraftRevision: 3,
          expectedVideoSnapshotHash: 'f'.repeat(64),
          scope: { kind: 'full' },
        },
        'hash-cas',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_BUILD_VIDEO_SNAPSHOT_CONFLICT',
        actualVideoSnapshotHash: storyVideoSnapshotHash([
          {
            graphNodeId: 'clip.start',
            selectionVersion: 0,
            assetId: null,
            variantId: null,
            sourceGenerationAttemptId: null,
            checksumSha256: null,
            contentType: null,
            durationMs: null,
            width: null,
            height: null,
            hasAudio: null,
            browserSafeMp4: null,
          },
        ]),
      },
    });
  });

  it('returns a controlled retired-contract error for an old Build row', async () => {
    const prisma = {
      storyBuild: {
        findFirst: jest.fn().mockResolvedValue({ runtimeSchemaVersion: 1 }),
      },
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    await expect(
      service.getBuild(user, WORKSPACE_ID, PROJECT_ID, BUILD_ID),
    ).rejects.toMatchObject({
      response: { code: 'STORY_BUILD_SCHEMA_RETIRED' },
    });
  });

  it('freezes exact asset and video-clip rows with no mutable recipe fields', async () => {
    const draft = simpleDraft();
    const entry: StoryVideoSnapshotEntry = {
      graphNodeId: 'clip.start',
      selectionVersion: 4,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      sourceGenerationAttemptId: null,
      checksumSha256: CHECKSUM,
      contentType: 'video/mp4',
      durationMs: 7_000,
      width: 1920,
      height: 1080,
      hasAudio: true,
      browserSafeMp4: true,
    };
    const variant = {
      id: VARIANT_ID,
      assetId: ASSET_ID,
      variantKey: 'original',
      kind: 'original',
      status: MediaAssetVariantStatus.ready,
      contentType: 'video/mp4',
      sizeBytes: 7_000n,
      width: 1920,
      height: 1080,
      durationSeconds: 7,
      durationMs: 7_000,
      hasAudio: true,
      checksumSha256: CHECKSUM,
      metadata: { browserSafeMp4: true },
      deletedAt: null,
      placements: [],
    };
    const asset = {
      id: ASSET_ID,
      workspaceId: WORKSPACE_ID,
      kind: MediaAssetKind.video,
      storageProvider: MediaStorageProvider.external_url,
      bucket: null,
      region: null,
      objectKey: null,
      externalUrl: 'https://cdn.example.test/video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 7_000n,
      status: MediaAssetStatus.ready,
      moderationStatus: MediaAssetModerationStatus.approved,
      deletedAt: null,
      placements: [],
    };
    const selection = {
      id: '0197f4a2-0800-7000-8000-000000000008',
      storyProjectId: PROJECT_ID,
      targetKind: StoryVideoTargetKind.clip,
      targetKey: 'clip.start',
      version: 4,
      currentAssetId: ASSET_ID,
      currentVariantId: VARIANT_ID,
      currentSourceGenerationAttemptId: null,
      currentChecksumSha256: CHECKSUM,
      currentContentType: 'video/mp4',
      currentDurationMs: 7_000,
      currentWidth: 1920,
      currentHeight: 1080,
      currentHasAudio: true,
      currentBrowserSafeMp4: true,
      currentAsset: asset,
      currentVariant: variant,
    };
    const revision = {
      id: REVISION_ID,
      storyProjectId: PROJECT_ID,
      number: 1,
      sourceDraftRevision: 3,
      schemaVersion: 'interactive-film-draft-v3',
      content: draft,
      contentHash: canonicalJsonHash(draft),
      label: null,
      source: StoryRevisionSource.creator,
      createdByUserId: 'user-1',
      createdAt: new Date(),
    };
    let buildData: Record<string, unknown> | null = null;
    let frozenAssetData: Record<string, unknown> | null = null;
    let frozenClipData: Record<string, unknown> | null = null;
    const operations: string[] = [];
    const tx = {
      storyBuild: {
        findUnique: jest.fn(({ where }: { where: { id?: string } }) => {
          if (!where.id) return null;
          const data = buildData as Record<string, unknown>;
          const frozen = frozenAssetData as Record<string, unknown>;
          return {
            ...data,
            id: where.id,
            buildNumber: data.buildNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: data.completedAt,
            experiencePublication: null,
            assets: frozen
              ? [
                  {
                    ...frozen,
                    id: '0197f4a2-0800-7000-8000-000000000009',
                    buildId: where.id,
                    createdAt: new Date(),
                    videoClip: { graphNodeId: 'clip.start' },
                    asset: {
                      ...asset,
                    },
                    variant: {
                      ...variant,
                    },
                  },
                ]
              : [],
          };
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          operations.push(`build:${String(data.status)}`);
          buildData = { ...data, version: 0 };
          return buildData;
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          operations.push(`build:${String(data.status)}`);
          buildData = {
            ...(buildData as Record<string, unknown>),
            ...data,
            version: 1,
          };
          return buildData;
        }),
      },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue({
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          title: 'Story',
          summary: null,
          defaultLocale: 'en-US',
          frameProfile: 'landscape_16_9',
        }),
        update: jest.fn().mockResolvedValue({ nextBuildNumber: 2 }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 3,
          schemaVersion: 'interactive-film-draft-v3',
          content: draft,
          contentHash: canonicalJsonHash(draft),
        }),
      },
      storyVideoSelection: {
        findMany: jest.fn().mockResolvedValue([selection]),
      },
      storyRevision: {
        findUnique: jest.fn().mockResolvedValue(revision),
      },
      storyBuildAsset: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          operations.push('asset');
          frozenAssetData = data;
          return {
            ...data,
            id: '0197f4a2-0800-7000-8000-000000000009',
          };
        }),
      },
      storyVideoBuildClip: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          operations.push('clip');
          frozenClipData = data;
          return data;
        }),
      },
    };
    const prisma = {
      storyBuild: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(({ where }: { where: { id: string } }) =>
          tx.storyBuild.findUnique({ where: { id: where.id } }),
        ),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    const result = await service.createBuild(
      user,
      WORKSPACE_ID,
      PROJECT_ID,
      {
        expectedDraftRevision: 3,
        expectedVideoSnapshotHash: storyVideoSnapshotHash([entry]),
        scope: { kind: 'full' },
      },
      'freeze-exact',
    );

    expect(result.status).toBe(StoryBuildStatus.ready);
    expect(result.runtimeSchemaVersion).toBe(2);
    expect(frozenAssetData).toMatchObject({
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      checksumSha256: CHECKSUM,
      contentType: 'video/mp4',
      durationMs: 7_000,
      width: 1920,
      height: 1080,
      hasAudio: true,
      browserSafeMp4: true,
    });
    expect(frozenClipData).toMatchObject({
      graphNodeId: 'clip.start',
      sourceGenerationAttemptId: null,
      checksumSha256: CHECKSUM,
      durationMs: 7_000,
      hasAudio: true,
      browserSafeMp4: true,
    });
    expect(frozenClipData).not.toHaveProperty('prompt');
    expect(frozenClipData).not.toHaveProperty('spec');
    expect(buildData).toMatchObject({
      kind: StoryBuildKind.production,
      sourceDraftRevision: 3,
      videoSnapshotHash: storyVideoSnapshotHash([entry]),
      runtimeSchemaVersion: 2,
    });
    expect(operations).toEqual([
      'build:compiling',
      'asset',
      'clip',
      'build:ready',
    ]);

    variant.metadata = { browserSafeMp4: false };
    const drifted = await service.getBuild(
      user,
      WORKSPACE_ID,
      PROJECT_ID,
      BUILD_ID,
    );
    expect(drifted.runtimeJson).toBeNull();
    expect(drifted.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'STORY_BUILD_ASSET_METADATA_CHANGED',
        entityId: ASSET_ID,
      }),
    );
  });
});

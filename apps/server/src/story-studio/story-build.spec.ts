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
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
} from '@repo/shared/experience-runtime';
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
import { LockableInteractiveStoryDraftContentSchema } from './interactive-film.schema';
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
  return LockableInteractiveStoryDraftContentSchema.parse({
    storyBible: {
      logline: 'A single consequential moment.',
      synopsis: 'The protagonist reaches the truth.',
      worldview: 'Choices leave visible traces.',
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
      endings: [
        {
          id: 'truth',
          title: { 'en-US': 'Truth' },
          summary: { 'en-US': 'The truth is accepted.' },
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

function textDraft() {
  return LockableInteractiveStoryDraftContentSchema.parse({
    storyBible: {
      logline: '',
      synopsis: '',
      worldview: '',
      characters: [],
      endings: [
        {
          id: 'truth',
          title: { 'en-US': 'Truth' },
        },
      ],
    },
    graph: {
      entryNodeId: 'text.start',
      nodes: [
        {
          kind: 'text',
          nodeId: 'text.start',
          body: { 'en-US': 'At dawn, a sealed letter waits on the table.' },
          exit: { kind: 'ending', endingId: 'truth' },
        },
      ],
    },
    productionNotes: [],
  });
}

function mixedDraft() {
  const base = simpleDraft();
  return LockableInteractiveStoryDraftContentSchema.parse({
    ...base,
    graph: {
      entryNodeId: 'text.prologue',
      nodes: [
        {
          kind: 'text',
          nodeId: 'text.prologue',
          title: { 'en-US': 'Prologue' },
          body: { 'en-US': 'The story begins in words.' },
          exit: { kind: 'auto', nextNodeId: 'clip.start' },
        },
        ...base.graph.nodes,
      ],
    },
  });
}

function choiceDraft() {
  const base = simpleDraft();
  return LockableInteractiveStoryDraftContentSchema.parse({
    ...base,
    storyBible: {
      ...base.storyBible,
      endings: [
        {
          id: 'truth',
          title: { 'en-US': 'Truth' },
          summary: { 'en-US': 'The truth is accepted.' },
        },
        {
          id: 'echo',
          title: { 'en-US': 'Echo' },
          summary: { 'en-US': 'The moment echoes.' },
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
            choices: [
              {
                choiceId: 'choose.truth',
                label: { 'en-US': 'Truth' },
                nextNodeId: 'clip.truth',
              },
              {
                choiceId: 'choose.echo',
                label: { 'en-US': 'Echo' },
                nextNodeId: 'clip.echo',
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
    format: 'interactive_film',
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
  it('compiles a pure-text narrative with no frozen video assets', () => {
    const result = compileStoryBuild(
      compilerInput(textDraft(), {
        format: 'text_adventure',
        videos: [],
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.includedGraphNodeIds).toEqual([]);
    expect(result.runtime).toMatchObject({
      metadata: { experienceProfile: 'narrative' },
      rendererRequirements: [
        expect.objectContaining({
          rendererId: EXPERIENCE_CORE_TEXT_RENDERER_ID,
          outcomes: [{ outcomeType: 'text-completed' }],
        }),
      ],
    });
    const entry = result.runtime?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'text.start',
    );
    const textRenderer =
      entry?.kind === 'scene'
        ? entry.renderers.find(
            (renderer) =>
              renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID,
          )
        : undefined;
    expect(entry).toMatchObject({
      kind: 'scene',
      clock: { kind: 'none' },
    });
    expect(textRenderer?.config).toMatchObject({ completion: 'continue' });
    expect(textRenderer?.config).not.toHaveProperty('title');
    expect(result.runtime?.endings[0]).not.toHaveProperty('summary');
  });

  it('compiles text and video nodes in one graph regardless of the preferred profile', () => {
    const result = compileStoryBuild(
      compilerInput(mixedDraft(), { format: 'text_adventure' }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.includedGraphNodeIds).toEqual(['clip.start']);
    expect(
      result.runtime?.rendererRequirements.map(
        (requirement) => requirement.rendererId,
      ),
    ).toEqual(
      expect.arrayContaining([
        EXPERIENCE_CORE_TEXT_RENDERER_ID,
        EXPERIENCE_CORE_VIDEO_RENDERER_ID,
      ]),
    );
  });

  it('accepts native video dimensions and presents inline without a frame profile', () => {
    const input = compilerInput(mixedDraft(), {
      format: 'text_adventure',
      frameProfile: null,
    });
    // A narrative clip keeps its intrinsic, non-1920x1080 dimensions.
    input.videos = input.videos.map((video) =>
      video.asset
        ? { ...video, asset: { ...video.asset, width: 1280, height: 720 } }
        : video,
    );

    const result = compileStoryBuild(input);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.diagnostics.some(
        (item) => item.code === 'STORY_BUILD_VIDEO_FRAME_MISMATCH',
      ),
    ).toBe(false);

    // The media asset keeps its native size and derives orientation from it.
    const videoAsset = result.runtime?.assets.find(
      (asset) => asset.kind === 'video',
    );
    expect(videoAsset).toMatchObject({
      kind: 'video',
      variants: [
        expect.objectContaining({
          orientation: 'landscape',
          width: 1280,
          height: 720,
        }),
      ],
    });

    // The video renderer presents inline at native size, not aspect-cover.
    const clipScene = result.runtime?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'clip.start',
    );
    const videoRenderer =
      clipScene?.kind === 'scene'
        ? clipScene.renderers.find(
            (renderer) =>
              renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID,
          )
        : undefined;
    expect(videoRenderer?.config).toMatchObject({ fit: 'native' });
  });

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

  it('reports path totals from actual frozen durations across a choice branch', () => {
    const draft = choiceDraft();
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
          format: 'interactive_film',
          defaultLocale: 'en-US',
          frameProfile: 'landscape_16_9',
        }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 3,
          schemaVersion: 'interactive-story-draft-v1',
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

  it('materializes a pure-text Build without querying or freezing video assets', async () => {
    const draft = textDraft();
    const revision = {
      id: REVISION_ID,
      storyProjectId: PROJECT_ID,
      number: 1,
      sourceDraftRevision: 3,
      schemaVersion: 'interactive-story-draft-v1',
      content: draft,
      contentHash: canonicalJsonHash(draft),
      label: null,
      source: StoryRevisionSource.creator,
      createdByUserId: 'user-1',
      createdAt: new Date(),
    };
    let buildData: Record<string, unknown> | null = null;
    const findSelections = jest.fn();
    const freezeAsset = jest.fn();
    const freezeClip = jest.fn();
    const tx = {
      storyBuild: {
        findUnique: jest.fn(({ where }: { where: { id?: string } }) => {
          if (!where.id) return null;
          const data = buildData as Record<string, unknown>;
          return {
            ...data,
            id: where.id,
            createdAt: new Date(),
            updatedAt: new Date(),
            experiencePublication: null,
            assets: [],
          };
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          buildData = { ...data, version: 0 };
          return buildData;
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
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
          title: 'A Text Story',
          summary: null,
          format: 'text_adventure',
          defaultLocale: 'en-US',
          frameProfile: 'landscape_16_9',
        }),
        update: jest.fn().mockResolvedValue({ nextBuildNumber: 2 }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 3,
          schemaVersion: 'interactive-story-draft-v1',
          content: draft,
          contentHash: canonicalJsonHash(draft),
        }),
      },
      storyVideoSelection: { findMany: findSelections },
      storyRevision: { findUnique: jest.fn().mockResolvedValue(revision) },
      storyBuildAsset: { create: freezeAsset },
      storyVideoBuildClip: { create: freezeClip },
    };
    const prisma = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const guard = { assertHumanWriteAllowed: jest.fn() };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      guard as never,
    );

    const result = await service.createBuild(
      user,
      WORKSPACE_ID,
      PROJECT_ID,
      {
        expectedDraftRevision: 3,
        expectedVideoSnapshotHash: storyVideoSnapshotHash([]),
        scope: { kind: 'full' },
      },
      'pure-text',
    );

    expect(result).toMatchObject({
      status: StoryBuildStatus.ready,
      assets: [],
      videoSnapshotHash: storyVideoSnapshotHash([]),
      runtimeJson: {
        metadata: { experienceProfile: 'narrative' },
      },
    });
    expect(guard.assertHumanWriteAllowed).toHaveBeenCalledWith(tx, PROJECT_ID);
    expect(findSelections).not.toHaveBeenCalled();
    expect(freezeAsset).not.toHaveBeenCalled();
    expect(freezeClip).not.toHaveBeenCalled();
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
      schemaVersion: 'interactive-story-draft-v1',
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
          format: 'interactive_film',
          defaultLocale: 'en-US',
          frameProfile: 'landscape_16_9',
        }),
        update: jest.fn().mockResolvedValue({ nextBuildNumber: 2 }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 3,
          schemaVersion: 'interactive-story-draft-v1',
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

    // browserSafeMp4 is now purely informational: a frozen asset that becomes a
    // browser-unsafe MP4 but is otherwise technically identical is NOT drift.
    variant.metadata = { browserSafeMp4: false };
    const stillValid = await service.getBuild(
      user,
      WORKSPACE_ID,
      PROJECT_ID,
      BUILD_ID,
    );
    expect(stillValid.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'STORY_BUILD_ASSET_METADATA_CHANGED',
      }),
    );

    // A genuine technical change (duration) is still detected as frozen drift.
    variant.durationMs = 8_000;
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

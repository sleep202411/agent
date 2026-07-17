import { Prisma } from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';
import { buildInteractiveFilmTestBundle } from './__tests__/interactive-film-test-bundle';
import { projectStoryFilmRevision } from './story-film-revision-projector';
import { StoryWorkingPreviewController } from './story-working-preview.controller';
import {
  selectWorkingPreviewVideo,
  StoryWorkingPreviewService,
} from './story-working-preview.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const MODEL_ID = '01980f10-7a20-7c01-8000-000000000099';

function scopedService(
  draftContent: ReturnType<
    typeof buildInteractiveFilmTestBundle
  >['draftContent'],
  clips: unknown[] = [],
) {
  const contentHash = canonicalJsonHash(draftContent);
  const tx = {
    storyDraft: {
      findUnique: jest.fn().mockResolvedValue({
        revision: 9,
        content: draftContent,
        contentHash,
      }),
    },
    storyFilmSpec: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ defaultCanonicalModelId: MODEL_ID }),
    },
    aiCanonicalModel: { findFirst: jest.fn() },
    storyFilmClip: {
      findMany: jest.fn().mockResolvedValue(clips),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        frameProfile: 'landscape_16_9',
        defaultLocale: 'zh-CN',
        title: 'Branching Film Test',
        summary: 'A branching interactive film.',
      },
    }),
  };
  return {
    contentHash,
    prisma,
    tx,
    service: new StoryWorkingPreviewService(
      prisma as never,
      permissions as never,
    ),
  };
}

function currentPreviewClips(
  draft: ReturnType<typeof buildInteractiveFilmTestBundle>['draftContent'],
) {
  const projection = projectStoryFilmRevision({
    draft,
    frameProfile: 'landscape_16_9',
    defaultLocale: 'zh-CN',
    defaultCanonicalModelId: MODEL_ID,
    includeTrailer: false,
  });
  return projection.clipSpecs.map((clip, index) => {
    const checksum = `${index + 1}`.padStart(64, '0');
    const assetId = uuidAt(100 + index);
    const variantId = uuidAt(300 + index);
    const specHash = canonicalJsonHash(clip);
    const inputHash = canonicalJsonHash({ clip: clip.key });
    return {
      id: uuidAt(400 + index),
      graphNodeId: clip.graphNodeId,
      specHash,
      productionInputHash: inputHash,
      currentVideoAssetId: assetId,
      currentVideoVariantId: variantId,
      currentVideoSourceAttemptId: uuidAt(200 + index),
      currentVideoSpecHash: specHash,
      currentVideoInputHash: inputHash,
      currentVideoChecksumSha256: checksum,
      currentVideoTechnicalChecks: [],
      currentVideoRevision: 1,
      currentVideoAsset: {
        id: assetId,
        workspaceId: WORKSPACE_ID,
        kind: 'video',
        status: 'ready',
        moderationStatus: 'approved',
        deletedAt: null,
        storageProvider: 'external_url',
        bucket: null,
        region: null,
        objectKey: null,
        externalUrl: `https://assets.example/${clip.key}.mp4`,
        contentType: 'video/mp4',
        checksumSha256: checksum,
        width: clip.outputContract.width,
        height: clip.outputContract.height,
        durationSeconds: clip.outputContract.durationMs / 1_000,
        sizeBytes: BigInt(1_000 + index),
        placements: [],
        variants: [],
      },
      currentVideoVariant: {
        id: variantId,
        assetId,
        status: 'ready',
        deletedAt: null,
        contentType: 'video/mp4',
        checksumSha256: checksum,
        width: clip.outputContract.width,
        height: clip.outputContract.height,
        durationSeconds: clip.outputContract.durationMs / 1_000,
        sizeBytes: BigInt(1_000 + index),
        placements: [],
      },
    };
  });
}

describe('StoryWorkingPreviewService', () => {
  it('returns actionable draft diagnostics without requiring a formal version', async () => {
    const draft = buildInteractiveFilmTestBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    const unfinished = draft.clipPrompts[0];
    if (!unfinished) throw new Error('Fixture prompt missing.');
    unfinished.beats = [];
    const { service, tx } = scopedService(draft);

    await expect(
      service.getWorkingPreview(USER as never, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toMatchObject({
      draftRevision: 9,
      runtimeSchemaVersion: 2,
      runtime: null,
      pathReport: null,
      diagnostics: [
        expect.objectContaining({
          code: 'STORY_WORKING_PREVIEW_DRAFT_INCOMPLETE',
          severity: 'error',
        }),
      ],
    });
    expect(tx.storyFilmClip.findMany).not.toHaveBeenCalled();
  });

  it('compiles the full player runtime without requiring the separate project trailer prompt', async () => {
    const draft = buildInteractiveFilmTestBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    draft.trailerPrompt = {
      title: 'Unfinished project trailer',
      description: '',
      targetDurationMs: 12_000,
      generationControl: { mode: 'omni_reference' },
      masterDirection: '',
      referenceRoleNotes: [],
      emotionalArc: '',
      beats: [
        {
          id: 'trailer:beat:1',
          startMs: 0,
          endMs: 12_000,
          visual: '',
          camera: '',
          action: '',
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
    };
    const { service } = scopedService(draft, currentPreviewClips(draft));

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.runtime).toMatchObject({
      manifestType: 'fizzdragon.experience',
      schemaVersion: 2,
      gameId: PROJECT_ID,
    });
    expect(preview.diagnostics).toEqual([]);
    expect(preview.pathReport).toMatchObject({
      reachableEndingIds: ['E01', 'E02', 'E03', 'E04'],
    });
  });

  it('reuses exact-spec current videos from an earlier production revision after the draft advances', async () => {
    const draft = buildInteractiveFilmTestBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    const clips = currentPreviewClips(draft);
    const { service, contentHash, prisma, tx } = scopedService(draft, clips);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.draftRevision).toBe(9);
    expect(preview.contentHash).toBe(contentHash);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(preview.runtime).toMatchObject({
      manifestType: 'fizzdragon.experience',
      schemaVersion: 2,
      gameId: PROJECT_ID,
      buildId: `preview:${PROJECT_ID}:draft:9`,
      contentVersion: `build:preview:${PROJECT_ID}:draft:9`,
    });
    expect(preview.pathReport).toMatchObject({
      reachableEndingIds: ['E01', 'E02', 'E03', 'E04'],
    });
    expect(preview.diagnostics).toEqual([]);
    expect(preview.sources).toHaveLength(21);
    expect(
      preview.sources.every((source) => source.selection === 'current'),
    ).toBe(true);
    const calls = tx.storyFilmClip.findMany.mock.calls as unknown as Array<
      [
        {
          where: Record<string, unknown>;
          orderBy: unknown[];
        },
      ]
    >;
    const query = calls[0]?.[0];
    if (!query) throw new Error('Expected the preview clip query.');
    expect(query.where).not.toHaveProperty('revision');
    expect(query.where).toMatchObject({
      storyProjectId: PROJECT_ID,
      archivedAt: null,
      currentVideoAssetId: { not: null },
      currentVideoVariantId: { not: null },
    });
    expect(query.orderBy).toEqual([
      { revision: { number: 'desc' } },
      { currentVideoRevision: 'desc' },
      { currentVideoSetAt: 'desc' },
      { updatedAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('compiles the same saved content hash deterministically across repeated requests', async () => {
    const draft = buildInteractiveFilmTestBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    const originalDraftHash = canonicalJsonHash(draft);
    const { service, contentHash } = scopedService(
      draft,
      currentPreviewClips(draft),
    );

    const first = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    const second = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(first.contentHash).toBe(contentHash);
    expect(second).toEqual(first);
    expect(second.runtime).toMatchObject({
      graph: { entrySceneId: draft.graph.entryNodeId },
    });
    expect(canonicalJsonHash(draft)).toBe(originalDraftHash);
  });

  it('does not reuse a previous video when its projected ClipSpec changed', async () => {
    const draft = buildInteractiveFilmTestBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    const clips = currentPreviewClips(draft);
    const incompatible = clips[0];
    if (!incompatible) throw new Error('Fixture clip missing.');
    incompatible.specHash = 'f'.repeat(64);
    const { service } = scopedService(draft, clips);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.runtime).toBeNull();
    expect(preview.sources).toHaveLength(clips.length - 1);
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'STORY_WORKING_PREVIEW_CURRENT_VIDEO_MISSING',
        entityId: incompatible.graphNodeId,
      }),
    );
  });

  it('selects only the direct current pointer and never a generation fallback', () => {
    const current = {
      specHash: 'spec-hash',
      productionInputHash: 'production-hash',
      currentVideoAssetId: uuidAt(700),
      currentVideoVariantId: uuidAt(701),
    };
    expect(selectWorkingPreviewVideo(current as never, 'spec-hash')).toBe(
      current,
    );
    expect(
      selectWorkingPreviewVideo(
        {
          specHash: 'spec-hash',
          currentVideoAssetId: null,
          currentVideoVariantId: null,
        } as never,
        'spec-hash',
      ),
    ).toBeNull();
    expect(
      selectWorkingPreviewVideo(current as never, 'different-spec-hash'),
    ).toBeNull();
  });
});

describe('StoryWorkingPreviewController', () => {
  it('forwards the current project and Workspace scope without a draft revision query', async () => {
    const preview = {
      draftRevision: 9,
      contentHash: 'a'.repeat(64),
      runtimeSchemaVersion: 2,
      runtime: null,
      diagnostics: [],
      pathReport: null,
      sources: [],
    };
    const service = { getWorkingPreview: jest.fn().mockResolvedValue(preview) };
    const controller = new StoryWorkingPreviewController(service as never);

    await expect(
      controller.getWorkingPreview(USER as never, WORKSPACE_ID, {
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({ code: 200, data: preview });
    expect(service.getWorkingPreview).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
    );
  });
});

function uuidAt(value: number): string {
  return `01980f10-7a20-7c01-8000-${value.toString().padStart(12, '0')}`;
}

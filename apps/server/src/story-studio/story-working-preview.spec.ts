import { canonicalJsonHash } from './canonical-json';
import { StoryWorkingPreviewQuerySchema } from './dto';
import { buildHuBaoVillaImportBundle } from './import/hu-bao-villa.builder';
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
  draftContent: ReturnType<typeof buildHuBaoVillaImportBundle>['draftContent'],
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
      },
    }),
  };
  return {
    contentHash,
    tx,
    service: new StoryWorkingPreviewService(
      prisma as never,
      permissions as never,
    ),
  };
}

describe('StoryWorkingPreviewService', () => {
  it('rejects a preview request for a different saved draft head', async () => {
    const draft = buildHuBaoVillaImportBundle().draftContent;
    const { service, tx } = scopedService(draft);

    await expect(
      service.getWorkingPreview(USER as never, WORKSPACE_ID, PROJECT_ID, 8),
    ).rejects.toMatchObject({
      response: {
        code: 'DRAFT_REVISION_CONFLICT',
        expectedRevision: 8,
        actualRevision: 9,
      },
    });
    expect(tx.storyFilmClip.findMany).not.toHaveBeenCalled();
  });

  it('returns actionable draft diagnostics without requiring a formal version', async () => {
    const draft = buildHuBaoVillaImportBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    const unfinished = draft.clipPrompts[0];
    if (!unfinished) throw new Error('Fixture prompt missing.');
    unfinished.beats = [];
    const { service, tx } = scopedService(draft);

    await expect(
      service.getWorkingPreview(USER as never, WORKSPACE_ID, PROJECT_ID, 9),
    ).resolves.toMatchObject({
      draftRevision: 9,
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

  it('plays only each shot current video directly from the saved draft', async () => {
    const draft = buildHuBaoVillaImportBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    const projection = projectStoryFilmRevision({
      draft,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });
    const clips = projection.clipSpecs.map((clip, index) => {
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
    const { service, contentHash } = scopedService(draft, clips);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      9,
    );

    expect(preview.draftRevision).toBe(9);
    expect(preview.contentHash).toBe(contentHash);
    expect(preview.runtime).toMatchObject({
      gameId: PROJECT_ID,
      releaseId: PROJECT_ID,
    });
    expect(preview.pathReport).toMatchObject({
      reachableEndingIds: ['E01', 'E02', 'E03', 'E04'],
    });
    expect(preview.diagnostics).toEqual([]);
    expect(preview.sources).toHaveLength(21);
    expect(
      preview.sources.every((source) => source.selection === 'current'),
    ).toBe(true);
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
  });
});

describe('StoryWorkingPreviewController', () => {
  it('coerces the HTTP query string revision before calling the controller', () => {
    expect(
      StoryWorkingPreviewQuerySchema.parse({ expectedDraftRevision: '9' }),
    ).toEqual({ expectedDraftRevision: 9 });
  });

  it('forwards the current project and Workspace scope', async () => {
    const preview = {
      draftRevision: 9,
      runtime: null,
      diagnostics: [],
      pathReport: null,
    };
    const service = { getWorkingPreview: jest.fn().mockResolvedValue(preview) };
    const controller = new StoryWorkingPreviewController(service as never);

    await expect(
      controller.getWorkingPreview(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID },
        { expectedDraftRevision: 9 },
      ),
    ).resolves.toEqual({ code: 200, data: preview });
    expect(service.getWorkingPreview).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      9,
    );
  });
});

function uuidAt(value: number): string {
  return `01980f10-7a20-7c01-8000-${value.toString().padStart(12, '0')}`;
}

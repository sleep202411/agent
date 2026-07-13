import { canonicalJsonHash } from './canonical-json';
import { StoryWorkingPreviewQuerySchema } from './dto';
import { buildHuBaoVillaImportBundle } from './import/hu-bao-villa.builder';
import { projectStoryFilmRevision } from './story-film-revision-projector';
import { StoryWorkingPreviewController } from './story-working-preview.controller';
import {
  selectWorkingPreviewTake,
  StoryWorkingPreviewService,
} from './story-working-preview.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const MODEL_ID = '01980f10-7a20-7c01-8000-000000000099';

function scopedService(
  draftContent: ReturnType<typeof buildHuBaoVillaImportBundle>['draftContent'],
  takes: unknown[] = [],
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
      findMany: jest.fn().mockResolvedValue(
        takes.map((take) => {
          const row = take as {
            clip: { graphNodeId: string };
            clipSpecHash: string;
            productionInputHash: string;
          };
          return {
            graphNodeId: row.clip.graphNodeId,
            specHash: row.clipSpecHash,
            productionInputHash: row.productionInputHash,
            masterTakeId: null,
            masterTake: null,
            takes: [take],
          };
        }),
      ),
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

  it('plays the latest ready Takes directly from the saved draft, with review only a warning', async () => {
    const draft = buildHuBaoVillaImportBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    const projection = projectStoryFilmRevision({
      draft,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });
    const takes = projection.clipSpecs.map((clip, index) => {
      const checksum = `${index + 1}`.padStart(64, '0');
      const assetId = uuidAt(100 + index);
      return {
        id: uuidAt(200 + index),
        clipSpecHash: canonicalJsonHash(clip),
        productionInputHash: canonicalJsonHash({ clip: clip.key }),
        technicalChecks: [],
        outputChecksumSha256: checksum,
        approval: null,
        reviews: [],
        status: 'ready',
        supersededAt: null,
        createdAt: new Date(1_800_000_000_000 + index),
        clip: { graphNodeId: clip.graphNodeId },
        outputAsset: {
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
        outputVariant: {
          id: uuidAt(300 + index),
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
    const { service, contentHash } = scopedService(draft, takes);

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
    expect(preview.diagnostics).toHaveLength(21);
    expect(
      preview.diagnostics.every(
        (item) =>
          item.severity === 'warning' &&
          item.code === 'STORY_WORKING_PREVIEW_READY_TAKE_FALLBACK',
      ),
    ).toBe(true);
    expect(preview.sources).toHaveLength(21);
    expect(
      preview.sources.every((source) => source.selection === 'latest_ready'),
    ).toBe(true);
  });

  it('prefers the compatible Master over a newer ready candidate', () => {
    const master = {
      id: uuidAt(700),
      status: 'ready',
      supersededAt: null,
      clipSpecHash: 'spec-hash',
      productionInputHash: 'production-hash',
      approval: { takeId: uuidAt(700) },
      reviews: [],
    };
    const newer = {
      ...master,
      id: uuidAt(701),
      approval: null,
    };
    expect(
      selectWorkingPreviewTake(
        {
          specHash: 'spec-hash',
          productionInputHash: 'production-hash',
          masterTakeId: master.id,
          masterTake: master,
          takes: [newer],
        } as never,
        'spec-hash',
      ),
    ).toMatchObject({ kind: 'master', take: { id: master.id } });
    expect(
      selectWorkingPreviewTake(
        {
          specHash: 'spec-hash',
          productionInputHash: 'new-production-hash',
          masterTakeId: null,
          masterTake: null,
          takes: [newer],
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

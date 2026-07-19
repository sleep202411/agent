import { Prisma } from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';
import { buildInteractiveFilmTestBundle } from './__tests__/interactive-film-test-bundle';
import { INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION } from './interactive-film.schema';
import { StoryWorkingPreviewController } from './story-working-preview.controller';
import { StoryWorkingPreviewService } from './story-working-preview.service';
import { storyVideoSnapshotHash } from './story-video-production.schema';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';

type Draft = ReturnType<typeof buildInteractiveFilmTestBundle>['draftContent'];

function scopedService(
  draftContent: Draft,
  selections: unknown[] = currentPreviewSelections(draftContent),
  schemaVersion: string = INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
) {
  const contentHash = canonicalJsonHash(draftContent);
  const tx = {
    storyDraft: {
      findUnique: jest.fn().mockResolvedValue({
        revision: 9,
        schemaVersion,
        content: draftContent,
        contentHash,
      }),
    },
    storyVideoSelection: {
      findMany: jest.fn().mockResolvedValue(selections),
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
  const assetUrls = {
    resolveVariant: jest.fn(
      (asset: { externalUrl: string | null }) => asset.externalUrl,
    ),
  };
  return {
    contentHash,
    prisma,
    tx,
    assetUrls,
    service: new StoryWorkingPreviewService(
      prisma as never,
      permissions as never,
      assetUrls as never,
    ),
  };
}

function currentPreviewSelections(draft: Draft) {
  return draft.graph.nodes
    .filter((node) => node.kind === 'clip')
    .map((node, index) => {
      const checksum = `${index + 1}`.padStart(64, '0');
      const assetId = uuidAt(100 + index);
      const variantId = uuidAt(300 + index);
      const variant = {
        id: variantId,
        assetId,
        variantKey: 'original',
        kind: 'original',
        status: 'ready',
        deletedAt: null,
        contentType: 'video/mp4',
        checksumSha256: checksum,
        width: 1920,
        height: 1080,
        durationSeconds: 15,
        durationMs: 15_000,
        // Nullable on the real variant row; tests null it to model unprobed.
        hasAudio: true as boolean | null,
        sizeBytes: BigInt(1_000 + index),
        metadata: { browserSafeMp4: true },
        createdAt: new Date(),
        updatedAt: new Date(),
        placements: [],
      };
      return {
        id: uuidAt(500 + index),
        storyProjectId: PROJECT_ID,
        targetKind: 'clip',
        targetKey: node.nodeId,
        currentAssetId: assetId,
        currentVariantId: variantId,
        currentSourceGenerationAttemptId: uuidAt(700 + index),
        currentChecksumSha256: checksum,
        currentContentType: 'video/mp4',
        currentDurationMs: 15_000,
        currentWidth: 1920,
        currentHeight: 1080,
        currentHasAudio: true,
        // Boolean? in the schema; tests null it for pre-cutover selections.
        currentBrowserSafeMp4: true as boolean | null,
        version: index + 3,
        setByUserId: USER.userId,
        setAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        currentAsset: {
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
          externalUrl: `https://assets.example/${node.clipKey}.mp4`,
          contentType: 'video/mp4',
          checksumSha256: checksum,
          width: 1920,
          height: 1080,
          durationSeconds: 15,
          sizeBytes: BigInt(1_000 + index),
          placements: [],
          variants: [variant],
        },
        currentVariant: variant,
      };
    });
}

describe('StoryWorkingPreviewService', () => {
  it('returns actionable diagnostics for an incomplete v3 draft before loading videos', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    draft.storyBible.logline = '';
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
    expect(tx.storyVideoSelection.findMany).not.toHaveBeenCalled();
  });

  it('compiles the current v3 draft and exact video selections to a Preview manifest', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, contentHash, prisma, tx } = scopedService(draft);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.draftRevision).toBe(9);
    expect(preview.contentHash).toBe(contentHash);
    expect(preview.videoSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(preview.runtime).toMatchObject({
      manifestType: 'fizzdragon.experience',
      schemaVersion: 2,
      channel: 'preview',
      gameId: PROJECT_ID,
      buildId: `preview:${canonicalJsonHash({
        projectId: PROJECT_ID,
        draftContentHash: contentHash,
        videoSnapshotHash: preview.videoSnapshotHash,
      })}`,
      contentVersion: `preview:${canonicalJsonHash({
        projectId: PROJECT_ID,
        draftContentHash: contentHash,
        videoSnapshotHash: preview.videoSnapshotHash,
      })}`,
      graph: { entrySceneId: draft.graph.entryNodeId },
    });
    expect(preview.diagnostics).toEqual([]);
    expect(preview.pathReport).toMatchObject({
      reachableEndingIds: ['E01', 'E02', 'E03', 'E04'],
    });
    expect(preview.sources).toHaveLength(21);
    expect(preview.sources[0]).toMatchObject({
      selection: 'current',
      selectionVersion: 3,
    });
    const calls = tx.storyVideoSelection.findMany.mock
      .calls as unknown as Array<
      [
        {
          where: {
            storyProjectId: string;
            targetKind: string;
            targetKey: { in: string[] };
          };
          include: unknown;
        },
      ]
    >;
    const query = calls[0]?.[0];
    expect(query?.where).toEqual({
      storyProjectId: PROJECT_ID,
      targetKind: 'clip',
      targetKey: {
        in: draft.graph.nodes
          .filter((node) => node.kind === 'clip')
          .map((node) => node.nodeId),
      },
    });
    expect(query?.include).toBeDefined();
  });

  it('changes the complete Preview identity when the exact current video changes', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const firstPreview = await scopedService(
      draft,
      currentPreviewSelections(draft),
    ).service.getWorkingPreview(USER as never, WORKSPACE_ID, PROJECT_ID);
    const changedSelections = currentPreviewSelections(draft);
    const changed = changedSelections[0];
    if (!changed) throw new Error('Fixture selection missing.');
    const changedAssetId = uuidAt(900);
    const changedVariantId = uuidAt(901);
    changed.currentAssetId = changedAssetId;
    changed.currentVariantId = changedVariantId;
    changed.version += 1;
    changed.currentAsset.id = changedAssetId;
    changed.currentAsset.variants[0].assetId = changedAssetId;
    changed.currentAsset.variants[0].id = changedVariantId;
    changed.currentVariant.assetId = changedAssetId;
    changed.currentVariant.id = changedVariantId;

    const secondPreview = await scopedService(
      draft,
      changedSelections,
    ).service.getWorkingPreview(USER as never, WORKSPACE_ID, PROJECT_ID);

    expect(secondPreview.videoSnapshotHash).not.toBe(
      firstPreview.videoSnapshotHash,
    );
    expect(secondPreview.runtime?.buildId).not.toBe(
      firstPreview.runtime?.buildId,
    );
    expect(secondPreview.runtime?.contentVersion).not.toBe(
      firstPreview.runtime?.contentVersion,
    );
  });

  it('returns null runtime and explicit diagnostics when one clip has no selection', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const selections = currentPreviewSelections(draft);
    const missing = selections.shift();
    if (!missing) throw new Error('Fixture selection missing.');
    const { service } = scopedService(draft, selections);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.runtime).toBeNull();
    expect(preview.sources).toHaveLength(20);
    expect(preview.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_WORKING_PREVIEW_CURRENT_VIDEO_MISSING',
          entityId: missing.targetKey,
        }),
        expect.objectContaining({
          code: 'STORY_BUILD_CURRENT_VIDEO_REQUIRED',
          entityId: missing.targetKey,
        }),
      ]),
    );
  });

  it('does not synthesize missing probed variant metadata', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const selections = currentPreviewSelections(draft);
    const incomplete = selections[0];
    if (!incomplete) throw new Error('Fixture selection missing.');
    incomplete.currentVariant.hasAudio = null;
    const { service } = scopedService(draft, selections);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.runtime).toBeNull();
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'STORY_WORKING_PREVIEW_OUTPUT_METADATA_MISSING',
        entityId: incomplete.currentAssetId,
      }),
    );
  });

  it('invalidates Preview playback when the exact variant loses its browser-safe MP4 fact', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const selections = currentPreviewSelections(draft);
    const unsafe = selections[0];
    if (!unsafe) throw new Error('Fixture selection missing.');
    unsafe.currentVariant.metadata = { browserSafeMp4: false };
    const { service } = scopedService(draft, selections);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.videoSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.runtime).toBeNull();
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'STORY_WORKING_PREVIEW_OUTPUT_METADATA_MISSING',
        entityId: unsafe.currentAssetId,
      }),
    );
  });

  it('rejects a selection snapshot that differs from its exact persisted variant', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const selections = currentPreviewSelections(draft);
    const mismatched = selections[0];
    if (!mismatched) throw new Error('Fixture selection missing.');
    mismatched.currentDurationMs += 1_000;
    const { service } = scopedService(draft, selections);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.runtime).toBeNull();
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'STORY_WORKING_PREVIEW_OUTPUT_METADATA_MISMATCH',
        entityId: mismatched.currentAssetId,
      }),
    );
  });

  it('turns a partial pre-cutover selection into controlled diagnostics instead of throwing', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const selections = currentPreviewSelections(draft);
    const partial = selections[0];
    if (!partial) throw new Error('Fixture selection missing.');
    partial.currentBrowserSafeMp4 = null;
    const { service } = scopedService(draft, selections);

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    expect(preview).toMatchObject({
      runtime: null,
      videoSnapshotHash: null,
    });
    expect(preview.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_WORKING_PREVIEW_CURRENT_VIDEO_SELECTION_INCOMPLETE',
        }),
        expect.objectContaining({
          code: 'STORY_WORKING_PREVIEW_VIDEO_SNAPSHOT_INVALID',
        }),
      ]),
    );
  });

  it('reports an unavailable exact variant URL instead of throwing', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, assetUrls } = scopedService(draft);
    assetUrls.resolveVariant.mockImplementationOnce(() => {
      throw new Error('storage is not configured');
    });

    const preview = await service.getWorkingPreview(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );

    expect(preview.runtime).toBeNull();
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'STORY_WORKING_PREVIEW_OUTPUT_URL_UNAVAILABLE',
      }),
    );
  });

  it('ignores an old stored schema with a controlled diagnostic instead of parsing it', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, tx } = scopedService(
      draft,
      [],
      'interactive-film-draft-v2',
    );

    await expect(
      service.getWorkingPreview(USER as never, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toMatchObject({
      runtime: null,
      videoSnapshotHash: null,
      pathReport: null,
      sources: [],
      diagnostics: [
        expect.objectContaining({
          code: 'STORY_WORKING_PREVIEW_DRAFT_SCHEMA_UNSUPPORTED',
        }),
      ],
    });
    expect(tx.storyVideoSelection.findMany).not.toHaveBeenCalled();
  });
});

describe('StoryWorkingPreviewController', () => {
  it('forwards the current project and Workspace scope without a revision query', async () => {
    const preview = {
      draftRevision: 9,
      contentHash: 'a'.repeat(64),
      videoSnapshotHash: storyVideoSnapshotHash([]),
      runtimeSchemaVersion: 2 as const,
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

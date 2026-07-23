import { StoryVideoGenerationAttemptStatus } from '@prisma/client';
import { StoryVideoProductionService } from './story-video-production.service';
import {
  CreateStoryTrailerVideoGenerationSchema,
  PutStoryClipVideoSelectionSchema,
  RetryStoryVideoGenerationSchema,
  StoryVideoSnapshotEntrySchema,
  storyVideoSnapshotHash,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const SELECTION_ID = '0197f4a2-0800-7000-8000-000000000003';
const GENERATION_A_ID = '0197f4a2-0800-7000-8000-000000000004';
const GENERATION_B_ID = '0197f4a2-0800-7000-8000-000000000005';

describe('Story video request schemas', () => {
  it('accepts one complete trailer recipe without a stored director card', () => {
    expect(
      CreateStoryTrailerVideoGenerationSchema.parse({
        expectedSelectionVersion: 2,
        prompt: 'Follow the protagonist through the moon gate.',
        modelId: 'seedance-2-0',
        mode: 'multimodal_to_video',
        durationMs: 10_000,
        references: [],
      }),
    ).toEqual({
      expectedSelectionVersion: 2,
      prompt: 'Follow the protagonist through the moon gate.',
      modelId: 'seedance-2-0',
      mode: 'multimodal_to_video',
      durationMs: 10_000,
      references: [],
    });
  });

  it('rejects partial manual selections and unknown legacy fields', () => {
    expect(
      PutStoryClipVideoSelectionSchema.safeParse({
        expectedDraftRevision: 4,
        expectedSelectionVersion: 2,
        assetId: '0197f4a2-0800-7000-8000-000000000006',
        variantId: null,
      }).success,
    ).toBe(false);
    expect(
      CreateStoryTrailerVideoGenerationSchema.safeParse({
        expectedSelectionVersion: 2,
        prompt: 'A direct prompt.',
        modelId: 'seedance-2-0',
        mode: 'multimodal_to_video',
        durationMs: 10_000,
        references: [],
        retiredRecipeEnvelope: { title: 'retired' },
      }).success,
    ).toBe(false);
  });

  it('rejects retrying a retired clip-direct generation path', () => {
    expect(
      RetryStoryVideoGenerationSchema.parse({
        expectedGenerationVersion: 1,
        expectedSelectionVersion: 2,
      }),
    ).toEqual({
      expectedGenerationVersion: 1,
      expectedSelectionVersion: 2,
    });
    expect(
      RetryStoryVideoGenerationSchema.safeParse({
        expectedGenerationVersion: 1,
        expectedSelectionVersion: 2,
        target: {
          kind: 'clip',
          graphNodeId: 'scene-opening',
          expectedDraftRevision: 4,
        },
      }).success,
    ).toBe(false);
  });
});

describe('canonical Story video snapshot', () => {
  const selected: StoryVideoSnapshotEntry = {
    graphNodeId: 'clip-b',
    selectionVersion: 3,
    assetId: '0197f4a2-0800-7000-8000-000000000010',
    variantId: '0197f4a2-0800-7000-8000-000000000011',
    sourceGenerationAttemptId: null,
    checksumSha256: 'a'.repeat(64),
    contentType: 'video/mp4',
    durationMs: 10_000,
    width: 1920,
    height: 1080,
    browserSafeMp4: true,
  };
  const empty: StoryVideoSnapshotEntry = {
    graphNodeId: 'clip-a',
    selectionVersion: 0,
    assetId: null,
    variantId: null,
    sourceGenerationAttemptId: null,
    checksumSha256: null,
    contentType: null,
    durationMs: null,
    width: null,
    height: null,
    browserSafeMp4: null,
  };

  it('is order independent and includes exact playback metadata', () => {
    const hash = storyVideoSnapshotHash([selected, empty]);
    expect(storyVideoSnapshotHash([empty, selected])).toBe(hash);
    expect(
      storyVideoSnapshotHash([{ ...selected, browserSafeMp4: false }, empty]),
    ).not.toBe(hash);
  });

  it('allows manual selections without a source generation', () => {
    expect(StoryVideoSnapshotEntrySchema.parse(selected)).toEqual(selected);
  });

  it('rejects partial and duplicate snapshot entries', () => {
    expect(
      StoryVideoSnapshotEntrySchema.safeParse({
        ...empty,
        assetId: selected.assetId,
      }).success,
    ).toBe(false);
    expect(() => storyVideoSnapshotHash([empty, empty])).toThrow(
      'each graph node only once',
    );
  });
});

describe('Story video selection concurrency', () => {
  it('rejects cancellation at the permission boundary before the AI side effect', async () => {
    const locked = new Error('agent applying');
    const permissions = { requireProject: jest.fn().mockRejectedValue(locked) };
    const aiGeneration = { cancelJob: jest.fn() };
    const service = new StoryVideoProductionService(
      {} as never,
      permissions as never,
      aiGeneration as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.cancelGeneration(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        GENERATION_A_ID,
        { expectedGenerationVersion: 0 },
      ),
    ).rejects.toBe(locked);
    expect(aiGeneration.cancelJob).not.toHaveBeenCalled();
  });

  it('rejects cancellation when Agent claims the project after the early permission check', async () => {
    const agentClaimed = new Error('agent claimed project write state');
    const tx = { $queryRaw: jest.fn() };
    const writeGuard = {
      assertHumanWriteAllowed: jest.fn().mockRejectedValue(agentClaimed),
    };
    let canonicalCancellationClaimed = false;
    const aiGeneration = {
      cancelJob: jest.fn(
        async (
          _user: unknown,
          aiJobId: string,
          hooks: {
            beforeCancel: (
              transaction: typeof tx,
              job: { id: string },
            ) => Promise<void>;
          },
        ) => {
          await hooks.beforeCancel(tx, { id: aiJobId });
          canonicalCancellationClaimed = true;
        },
      ),
    };
    const prisma = {
      storyVideoGenerationAttempt: {
        findFirst: jest.fn(() => ({
          id: GENERATION_A_ID,
          storyProjectId: PROJECT_ID,
          aiJobId: uuid('71'),
          version: 3,
          status: StoryVideoGenerationAttemptStatus.queued,
        })),
      },
    };
    const service = new StoryVideoProductionService(
      prisma as never,
      {
        requireProject: jest.fn(() => ({
          project: { workspaceId: WORKSPACE_ID },
        })),
      } as never,
      aiGeneration as never,
      {} as never,
      writeGuard as never,
    );

    await expect(
      service.cancelGeneration(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        GENERATION_A_ID,
        { expectedGenerationVersion: 3 },
      ),
    ).rejects.toBe(agentClaimed);

    expect(writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(canonicalCancellationClaimed).toBe(false);
  });

  it('takes the project write fence before changing a manual selection', async () => {
    const video = readyVideo('10', '11', 'a');
    const harness = productionHarness([], [video]);
    const locked = new Error('agent applying');
    harness.writeGuard.assertHumanWriteAllowed.mockRejectedValueOnce(locked);

    await expect(harness.putManual(video)).rejects.toBe(locked);
    expect(harness.writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      harness.transaction,
      PROJECT_ID,
    );
    expect(harness.selection.version).toBe(0);
  });

  it('lets the latest generation intent win and supersedes stale completion', async () => {
    const videoA = readyVideo('20', '21', 'a');
    const videoB = readyVideo('30', '31', 'b');
    const generationA = completedGeneration(GENERATION_A_ID, 1, videoA, 1);
    const generationB = completedGeneration(GENERATION_B_ID, 2, videoB, 2);
    const harness = productionHarness(
      [generationA, generationB],
      [videoA, videoB],
    );

    await harness.finalize(generationB);
    await harness.finalize(generationA);

    expect(harness.selection.currentAssetId).toBe(videoB.id);
    expect(harness.selection.currentVariantId).toBe(videoB.variants[0]?.id);
    expect(harness.selection.currentDurationMs).toBe(10_375);
    expect(harness.selection.currentBrowserSafeMp4).toBe(true);
    expect(harness.selection.currentSourceGenerationAttemptId).toBe(
      GENERATION_B_ID,
    );
    expect(harness.selection.version).toBe(3);
    expect(harness.attempt(GENERATION_B_ID).status).toBe(
      StoryVideoGenerationAttemptStatus.ready,
    );
    expect(harness.attempt(GENERATION_A_ID).status).toBe(
      StoryVideoGenerationAttemptStatus.superseded,
    );
  });

  it('defers when Agent claims the project after a completed generation was read', async () => {
    const video = readyVideo('22', '23', 'b');
    const generation = completedGeneration(GENERATION_A_ID, 1, video, 1);
    const harness = productionHarness([generation], [video], 1);
    harness.writeGuard.tryAcquireDeferredWriteFence.mockResolvedValueOnce(
      false,
    );

    await expect(harness.finalize(generation)).resolves.toMatchObject({
      status: StoryVideoGenerationAttemptStatus.processing,
    });
    expect(
      harness.writeGuard.tryAcquireDeferredWriteFence,
    ).toHaveBeenCalledWith(harness.transaction, PROJECT_ID);
    expect(harness.transaction.$executeRaw).not.toHaveBeenCalled();
    expect(
      harness.transaction.storyVideoSelection.updateMany,
    ).not.toHaveBeenCalled();
    expect(
      harness.transaction.storyVideoGenerationAttempt.update,
    ).not.toHaveBeenCalled();
    expect(harness.selection).toMatchObject({
      currentAssetId: null,
      currentVariantId: null,
      currentSourceGenerationAttemptId: null,
      version: 1,
    });
    expect(harness.attempt(GENERATION_A_ID)).toMatchObject({
      status: StoryVideoGenerationAttemptStatus.processing,
      version: 0,
    });
  });

  it('holds the project write fence before normal completion mutates the selection', async () => {
    const video = readyVideo('24', '25', 'c');
    const generation = completedGeneration(GENERATION_A_ID, 1, video, 1);
    const harness = productionHarness([generation], [video], 1);

    await expect(harness.finalize(generation)).resolves.toMatchObject({
      status: StoryVideoGenerationAttemptStatus.ready,
    });

    const fenceOrder =
      harness.writeGuard.tryAcquireDeferredWriteFence.mock
        .invocationCallOrder[0];
    const selectionLockOrder =
      harness.transaction.$executeRaw.mock.invocationCallOrder[0];
    const selectionWriteOrder =
      harness.transaction.storyVideoSelection.updateMany.mock
        .invocationCallOrder[0];
    expect(fenceOrder).toBeLessThan(selectionLockOrder);
    expect(selectionLockOrder).toBeLessThan(selectionWriteOrder);
    expect(harness.selection.currentAssetId).toBe(video.id);
    expect(harness.attempt(GENERATION_A_ID).status).toBe(
      StoryVideoGenerationAttemptStatus.ready,
    );
  });

  it('keeps a newer manual selection when an older generation completes', async () => {
    const generated = readyVideo('40', '41', 'c');
    const manual = readyVideo('50', '51', 'd');
    const generation = completedGeneration(GENERATION_A_ID, 1, generated, 1);
    const harness = productionHarness([generation], [generated, manual], 1);

    await harness.putManual(manual);
    await harness.finalize(generation);

    expect(harness.selection.version).toBe(2);
    expect(harness.selection.currentAssetId).toBe(manual.id);
    expect(harness.selection.currentVariantId).toBe(manual.variants[0]?.id);
    expect(harness.selection.currentDurationMs).toBe(10_375);
    expect(harness.selection.currentBrowserSafeMp4).toBe(true);
    expect(harness.selection.currentSourceGenerationAttemptId).toBeNull();
    expect(harness.attempt(GENERATION_A_ID).status).toBe(
      StoryVideoGenerationAttemptStatus.superseded,
    );
  });

  it('accepts non-MP4 and browser-unsafe variants that carry exact technical metadata', async () => {
    const unsafe = readyVideo('60', '61', 'e');
    unsafe.variants[0].metadata = {
      videoProbe: { browserSafeMp4: false },
    };
    const unprobed = readyVideo('62', '63', 'f');
    unprobed.variants[0].metadata = {};
    const webm = readyVideo('64', '65', '0');
    webm.variants[0].contentType = 'video/webm';

    // browserSafeMp4 is now purely informational: a browser-unsafe MP4, an
    // MP4 with no probe flag, and a non-MP4 container are all selectable, and
    // the actual probed value flows through to the selection.
    const cases: Array<[VideoAsset, boolean]> = [
      [unsafe, false],
      [unprobed, false],
      [webm, true],
    ];
    for (const [video, expectedBrowserSafeMp4] of cases) {
      const harness = productionHarness([], [video]);
      await harness.putManual(video);
      expect(harness.selection.version).toBe(1);
      expect(harness.selection.currentAssetId).toBe(video.id);
      expect(harness.selection.currentVariantId).toBe(video.variants[0].id);
      expect(harness.selection.currentContentType).toBe(
        video.variants[0].contentType,
      );
      expect(harness.selection.currentBrowserSafeMp4).toBe(
        expectedBrowserSafeMp4,
      );
    }
  });

  it('rejects variants missing exact probed technical metadata', async () => {
    const badChecksum = readyVideo('66', '67', '1');
    badChecksum.variants[0].checksumSha256 = 'not-a-valid-sha256';
    const zeroDuration = readyVideo('68', '69', '2');
    zeroDuration.variants[0].durationMs = 0;
    const notVideo = readyVideo('6a', '6b', '3');
    notVideo.variants[0].contentType = 'image/png';

    for (const video of [badChecksum, zeroDuration, notVideo]) {
      const harness = productionHarness([], [video]);
      await expect(harness.putManual(video)).rejects.toMatchObject({
        response: { code: 'STORY_VIDEO_VARIANT_NOT_USABLE' },
      });
      expect(harness.selection.version).toBe(0);
    }
  });
});

type VideoAsset = ReturnType<typeof readyVideo>;
type Generation = ReturnType<typeof completedGeneration>;

function readyVideo(assetSuffix: string, variantSuffix: string, hash: string) {
  const assetId = uuid(assetSuffix);
  // Probe metadata is an optional JSON field on the real variant row; keep it
  // wide so tests can model unprobed ({}) and unsafe variants.
  const probedMetadata: { videoProbe?: { browserSafeMp4: boolean } } = {
    videoProbe: { browserSafeMp4: true },
  };
  return {
    id: assetId,
    workspaceId: WORKSPACE_ID,
    kind: 'video',
    status: 'ready',
    moderationStatus: 'approved',
    contentType: 'video/mp4',
    width: 1920,
    height: 1080,
    durationSeconds: 10,
    checksumSha256: hash.repeat(64),
    storageProvider: 'external_url',
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl: `https://assets.example/${assetSuffix}.mp4`,
    deletedAt: null,
    placements: [],
    variants: [
      {
        id: uuid(variantSuffix),
        assetId,
        variantKey: 'original',
        kind: 'original',
        status: 'ready',
        contentType: 'video/mp4',
        sizeBytes: 1_024n,
        width: 1920,
        height: 1080,
        durationSeconds: 10,
        durationMs: 10_375,
        checksumSha256: hash.repeat(64),
        metadata: probedMetadata,
        deletedAt: null,
        placements: [],
      },
    ],
  };
}

function completedGeneration(
  id: string,
  attemptNumber: number,
  video: VideoAsset,
  selectionVersionAtSubmit: number,
) {
  const now = new Date('2026-07-17T12:00:00.000Z');
  return {
    id,
    storyProjectId: PROJECT_ID,
    selectionId: SELECTION_ID,
    attemptNumber,
    submissionKey: `submission-${attemptNumber}`,
    requestFingerprint: String(attemptNumber).repeat(64),
    status: StoryVideoGenerationAttemptStatus.processing,
    selectionVersionAtSubmit,
    recipeSnapshot: recipeSnapshot(),
    aiJobId: uuid(String(70 + attemptNumber)),
    aiJobOutputId: null,
    outputAssetId: null,
    outputVariantId: null,
    outputChecksumSha256: null,
    technicalChecks: [],
    error: null,
    version: 0,
    createdByUserId: USER.userId,
    queuedAt: now,
    startedAt: now,
    readyAt: null,
    cancelledAt: null,
    supersededAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    selection: { targetKind: 'trailer', targetKey: 'trailer' },
    aiJob: {
      status: 'completed',
      stage: 'completed',
      error: null,
      startedAt: now,
      completedAt: now,
      outputs: [
        {
          id: `output-${attemptNumber}`,
          assetId: video.id,
          outputIndex: 0,
          asset: video,
        },
      ],
    },
    outputAsset: null,
    outputVariant: null,
  };
}

function productionHarness(
  initialAttempts: Generation[],
  initialAssets: VideoAsset[],
  initialSelectionVersion = initialAttempts.length,
) {
  const attempts = new Map(initialAttempts.map((row) => [row.id, row]));
  const assets = new Map(initialAssets.map((row) => [row.id, row]));
  const selection = {
    id: SELECTION_ID,
    storyProjectId: PROJECT_ID,
    targetKind: 'trailer',
    targetKey: 'trailer',
    currentAssetId: null as string | null,
    currentVariantId: null as string | null,
    currentSourceGenerationAttemptId: null as string | null,
    currentChecksumSha256: null as string | null,
    currentContentType: null as string | null,
    currentDurationMs: null as number | null,
    currentWidth: null as number | null,
    currentHeight: null as number | null,
    currentBrowserSafeMp4: null as boolean | null,
    version: initialSelectionVersion,
    setByUserId: null as string | null,
    setAt: null as Date | null,
  };

  const storyVideoSelection = {
    findFirst: jest.fn(() => selection),
    updateMany: jest.fn(
      ({ where, data }: { where: { version?: number }; data: object }) => {
        if (
          where.version !== undefined &&
          where.version !== selection.version
        ) {
          return { count: 0 };
        }
        const requestedVersion = (
          data as { version?: number | { increment?: number } }
        ).version;
        const nextVersion =
          typeof requestedVersion === 'number'
            ? requestedVersion
            : selection.version + (requestedVersion?.increment ?? 0);
        Object.assign(selection, data, {
          version: nextVersion,
        });
        return { count: 1 };
      },
    ),
    create: jest.fn(),
  };
  const storyVideoGenerationAttempt = {
    findUnique: jest.fn(({ where }: { where: { id?: string } }) =>
      where.id ? (attempts.get(where.id) ?? null) : null,
    ),
    findFirst: jest.fn(({ where }: { where: { id?: string } }) =>
      where.id ? (attempts.get(where.id) ?? null) : null,
    ),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = attempts.get(where.id);
        if (!row) throw new Error('Missing fake generation.');
        const increment = (data.version as { increment?: number } | undefined)
          ?.increment;
        Object.assign(row, data, {
          version: row.version + (increment ?? 0),
        });
        return row;
      },
    ),
  };
  const transaction = {
    $executeRaw: jest.fn(() => 1),
    storyVideoSelection,
    storyVideoGenerationAttempt,
    mediaAsset: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; workspaceId: string } }) => {
          const asset = assets.get(where.id);
          return asset?.workspaceId === where.workspaceId ? asset : null;
        },
      ),
    },
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const writeGuard = {
    assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
    tryAcquireDeferredWriteFence: jest.fn().mockResolvedValue(true),
  };
  const service = new StoryVideoProductionService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    writeGuard as never,
  );
  const internals = service as unknown as {
    finalizeCompletedGeneration(
      generation: Generation,
      workspaceId: string,
    ): Promise<Generation>;
    putCurrentVideo(
      user: typeof USER,
      workspaceId: string,
      projectId: string,
      args: {
        target: { kind: 'trailer' };
        expectedSelectionVersion: number;
        assetId: string;
        variantId: string;
      },
    ): Promise<void>;
  };

  return {
    transaction,
    writeGuard,
    selection,
    attempt: (id: string) => {
      const row = attempts.get(id);
      if (!row) throw new Error('Missing fake generation.');
      return row;
    },
    finalize: (generation: Generation) =>
      internals.finalizeCompletedGeneration(generation, WORKSPACE_ID),
    putManual: (video: VideoAsset) =>
      internals.putCurrentVideo(USER, WORKSPACE_ID, PROJECT_ID, {
        target: { kind: 'trailer' },
        expectedSelectionVersion: selection.version,
        assetId: video.id,
        variantId: video.variants[0].id,
      }),
  };
}

function recipeSnapshot() {
  return {
    schemaVersion: 1,
    prompt: 'A direct prompt.',
    mode: 'multimodal_to_video',
    durationMs: 10_000,
    seed: null,
    model: {
      id: uuid('90'),
      slug: 'seedance-2-0',
      displayName: 'Seedance 2.0',
      schemaVersion: '1',
      generationModes: ['multimodal_to_video'],
    },
    references: [],
  };
}

function uuid(suffix: string): string {
  return `0197f4a2-0800-7000-8000-${suffix.padStart(12, '0')}`;
}

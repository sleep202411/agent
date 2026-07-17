import { StoryVideoGenerationAttemptStatus } from '@prisma/client';
import { StoryVideoProductionService } from './story-video-production.service';
import {
  CreateStoryClipVideoGenerationSchema,
  PutStoryClipVideoSelectionSchema,
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

describe('direct Story video request schemas', () => {
  it('accepts one complete clip recipe without a stored director card', () => {
    expect(
      CreateStoryClipVideoGenerationSchema.parse({
        expectedDraftRevision: 4,
        expectedSelectionVersion: 2,
        prompt: 'Follow the protagonist through the moon gate.',
        modelId: 'seedance-2-0',
        mode: 'multimodal_to_video',
        durationMs: 10_000,
        references: [],
      }),
    ).toEqual({
      expectedDraftRevision: 4,
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
      CreateStoryClipVideoGenerationSchema.safeParse({
        expectedDraftRevision: 4,
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
    hasAudio: true,
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
    hasAudio: null,
    browserSafeMp4: null,
  };

  it('is order independent and includes exact playback metadata', () => {
    const hash = storyVideoSnapshotHash([selected, empty]);
    expect(storyVideoSnapshotHash([empty, selected])).toBe(hash);
    expect(
      storyVideoSnapshotHash([{ ...selected, hasAudio: false }, empty]),
    ).not.toBe(hash);
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

  it('rejects non-MP4, unprobed, and browser-unsafe variants', async () => {
    const unsafe = readyVideo('60', '61', 'e');
    unsafe.variants[0].metadata = {
      videoProbe: { browserSafeMp4: false },
    };
    const unprobed = readyVideo('62', '63', 'f');
    unprobed.variants[0].metadata = {};
    const webm = readyVideo('64', '65', '0');
    webm.variants[0].contentType = 'video/webm';

    for (const video of [unsafe, unprobed, webm]) {
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
        hasAudio: true,
        checksumSha256: hash.repeat(64),
        metadata: { videoProbe: { browserSafeMp4: true } },
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
    currentHasAudio: null as boolean | null,
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
  const service = new StoryVideoProductionService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
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

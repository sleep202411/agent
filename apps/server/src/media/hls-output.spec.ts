import {
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaProcessingJobStatus,
} from '@prisma/client';
import {
  HLS_CDN_SETTLE_MS,
  blockingHlsTakedownWhere,
  findBlockingHlsTakedown,
  hlsStreamJobKey,
  parseHlsPrefixTakedownMetadata,
  retireHlsOutput,
  storyHlsPlayback,
  transcodeMayStillWrite,
} from './hls-output';

const ASSET_ID = '019f60f4-b101-70d4-8000-00000000b001';
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

describe('transcodeMayStillWrite', () => {
  const withTask = { immTaskId: 'MediaConvert-1', submittedAt: minutesAgo(5) };
  afterEach(() => {
    delete process.env.IMM_MAX_MINUTES;
  });

  it.each([
    ['no job', null, false],
    [
      'processing (may be about to submit)',
      { status: 'processing', output: {} },
      true,
    ],
    [
      'pending between polls of a live task',
      { status: 'pending', output: withTask },
      true,
    ],
    ['pending before submit', { status: 'pending', output: {} }, false],
    ['failed with a live task', { status: 'failed', output: withTask }, true],
    ['failed before submit', { status: 'failed', output: {} }, false],
    [
      'dead, task submitted within 2x the ceiling',
      {
        status: 'dead',
        output: { immTaskId: 'x', submittedAt: minutesAgo(59) },
      },
      true,
    ],
    [
      'dead, task submitted past 2x the ceiling',
      {
        status: 'dead',
        output: { immTaskId: 'x', submittedAt: minutesAgo(61) },
      },
      false,
    ],
    [
      'dead without a task',
      { status: 'dead', output: { submittedAt: minutesAgo(1) } },
      false,
    ],
    [
      'dead with an unreadable submit time',
      { status: 'dead', output: { immTaskId: 'x', submittedAt: 'soon' } },
      false,
    ],
    ['completed', { status: 'completed', output: withTask }, false],
    ['cancelled', { status: 'cancelled', output: withTask }, false],
  ] as const)('%s → %s', (_label, job, expected) => {
    expect(
      transcodeMayStillWrite(
        job as Parameters<typeof transcodeMayStillWrite>[0],
        NOW,
      ),
    ).toBe(expected);
  });

  it('follows IMM_MAX_MINUTES for the dead-job window', () => {
    process.env.IMM_MAX_MINUTES = '10';
    expect(
      transcodeMayStillWrite(
        {
          status: MediaProcessingJobStatus.dead,
          output: { immTaskId: 'x', submittedAt: minutesAgo(21) },
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('retireHlsOutput', () => {
  function tx(variantCount: number) {
    return {
      mediaAssetVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: variantCount }),
      },
      mediaObjectPlacement: {
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      mediaProcessingJob: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }
  const now = new Date(NOW);

  it('changes nothing when the variant is not in an expected status', async () => {
    const client = tx(0);
    await expect(
      retireHlsOutput(client as never, {
        assetId: ASSET_ID,
        variantId: 'variant',
        fromStatuses: [MediaAssetVariantStatus.ready],
        now,
      }),
    ).resolves.toBe(false);
    expect(client.mediaAssetVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'variant',
        assetId: ASSET_ID,
        status: { in: [MediaAssetVariantStatus.ready] },
      },
      data: { status: MediaAssetVariantStatus.deleted, deletedAt: now },
    });
    expect(client.mediaObjectPlacement.updateMany).not.toHaveBeenCalled();
    expect(client.mediaProcessingJob.deleteMany).not.toHaveBeenCalled();
  });

  it('retires the variant, its placements and the terminal job rows', async () => {
    const client = tx(1);
    await expect(
      retireHlsOutput(client as never, {
        assetId: ASSET_ID,
        variantId: 'variant',
        fromStatuses: [
          MediaAssetVariantStatus.blocked,
          MediaAssetVariantStatus.deleted,
        ],
        now,
      }),
    ).resolves.toBe(true);
    expect(client.mediaObjectPlacement.updateMany).toHaveBeenCalledWith({
      where: { variantId: 'variant', deletedAt: null },
      data: { status: 'deleted', deletedAt: now },
    });
    expect(client.mediaProcessingJob.deleteMany).toHaveBeenCalledWith({
      where: {
        idempotencyKey: hlsStreamJobKey(ASSET_ID),
        status: { in: ['completed', 'dead', 'cancelled'] },
      },
    });
  });
});

describe('parseHlsPrefixTakedownMetadata', () => {
  const metadata = {
    scope: 'hls_prefix',
    origin: 'moderation',
    bucket: 'fizzdragon-ai-outputs',
    region: 'cn-hangzhou',
    prefix: `hls/${ASSET_ID}/`,
    refreshKeys: [`hls/${ASSET_ID}/master.m3u8`],
  };

  it('reads a takedown with and without progress', () => {
    expect(parseHlsPrefixTakedownMetadata(metadata)).toEqual(metadata);
    expect(
      parseHlsPrefixTakedownMetadata({
        ...metadata,
        passes: 2,
        deletedObjects: 121,
        refreshedChunks: 1,
        cdnRefreshTaskIds: ['task'],
        cdnRefreshedAt: null,
        waitingForJobId: 'job',
        takedownResult: { passes: 2 },
      }),
    ).toMatchObject({ passes: 2, waitingForJobId: 'job' });
  });

  it.each([
    ['another scope', { ...metadata, scope: 'other' }],
    ['an unknown origin', { ...metadata, origin: 'admin' }],
    ['no bucket', { ...metadata, bucket: '' }],
    ['keys that are not strings', { ...metadata, refreshKeys: [1] }],
    ['a restrict action', { direction: 'restrict' }],
    ['not an object', 'hls_prefix'],
  ])('rejects %s', (_label, value) => {
    expect(parseHlsPrefixTakedownMetadata(value as never)).toBeNull();
  });
});

describe('blockingHlsTakedownWhere', () => {
  it('blocks on a running takedown or one completed within the settle window', () => {
    const where = blockingHlsTakedownWhere({ in: [ASSET_ID] }, new Date(NOW));
    expect(where).toEqual({
      assetId: { in: [ASSET_ID] },
      actionType: 'delete_object',
      metadata: { path: ['scope'], equals: 'hls_prefix' },
      OR: [
        {
          status: {
            in: [
              MediaModerationActionStatus.pending,
              MediaModerationActionStatus.failed,
            ],
          },
        },
        {
          status: MediaModerationActionStatus.completed,
          completedAt: { gt: new Date(NOW - HLS_CDN_SETTLE_MS) },
        },
      ],
    });
  });
});

describe('findBlockingHlsTakedown', () => {
  it('returns the newest takedown that blocks the asset now', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'action' });
    await expect(
      findBlockingHlsTakedown(
        { mediaModerationAction: { findFirst } } as never,
        ASSET_ID,
        new Date(NOW),
      ),
    ).resolves.toEqual({ id: 'action' });
    expect(findFirst).toHaveBeenCalledWith({
      where: blockingHlsTakedownWhere(ASSET_ID, new Date(NOW)),
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  });
});

describe('storyHlsPlayback', () => {
  const previous = process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
  beforeAll(() => {
    process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = 'https://media.fizzspace.cn';
  });
  afterAll(() => {
    if (previous === undefined)
      delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    else process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = previous;
  });
  const asset = {
    storageProvider: 'aliyun_oss',
    bucket: 'fizzdragon-ai-outputs',
    region: 'cn-hangzhou',
    objectKey: 'media/clip.mp4',
    externalUrl: null,
    status: 'ready',
    moderationStatus: 'approved',
    deletedAt: null,
  };
  const hls = {
    variantKey: 'hls',
    status: 'ready',
    deletedAt: null,
    contentType: 'application/vnd.apple.mpegurl',
    placements: [
      {
        role: 'primary',
        status: 'active',
        storageProvider: 'aliyun_oss',
        bucket: 'fizzdragon-ai-outputs',
        region: 'cn-hangzhou',
        objectKey: `hls/${ASSET_ID}/master.m3u8`,
        externalUrl: null,
        deletedAt: null,
      },
    ],
  };

  it('offers the master of a ready output on the public CDN', () => {
    expect(storyHlsPlayback(asset, hls)).toEqual({
      url: `https://media.fizzspace.cn/hls/${ASSET_ID}/master.m3u8`,
      contentType: 'application/vnd.apple.mpegurl',
    });
  });

  it('keeps progressive playback without an output, a placement, or for a blocked asset', () => {
    expect(storyHlsPlayback(asset, null)).toBeNull();
    expect(storyHlsPlayback(asset, { ...hls, placements: [] })).toBeNull();
    expect(
      storyHlsPlayback({ ...asset, moderationStatus: 'blocked' }, hls),
    ).toBeNull();
  });
});

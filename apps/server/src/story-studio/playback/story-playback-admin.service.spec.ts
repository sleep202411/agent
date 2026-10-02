/* eslint-disable @typescript-eslint/no-unsafe-assignment -- introspecting untyped jest mock.calls payloads */
import {
  BadGatewayException,
  ConflictException,
  GatewayTimeoutException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaProcessingJobStatus,
  MediaStorageProvider,
  StoryBuildStatus,
} from '@prisma/client';
import {
  StoryPlaybackOverviewSchema,
  StoryPlaybackRetryFailedResultSchema,
} from '@repo/shared/story-playback';
import { hasFeature } from '../../common/region';
import {
  StoryPlaybackAdminService,
  clipState,
} from './story-playback-admin.service';
import {
  StoryPlaybackReconcileService,
  type LiveAsset,
} from './story-playback-reconcile.service';

jest.mock('../../common/region', () => ({
  ...jest.requireActual<object>('../../common/region'),
  hasFeature: jest.fn().mockReturnValue(true),
}));
jest.mock('../story-build-access', () => ({
  ...jest.requireActual<object>('../story-build-access'),
  storyManifestAccess: jest.fn((runtimeJson: unknown) => runtimeJson),
}));

const GAME_SERIAL = '019f60f4-b101-70d4-8000-000000000002';
const GAME_OFFLINE = '019f60f4-b101-70d4-8000-000000000003';
const GAME_UNMANAGED = '019f60f4-b101-70d4-8000-000000000004';
const BUILD_CHAPTER = '019f60f4-b101-70d4-8000-0000000000b2';
const REVISION = '019f60f4-b101-70d4-8000-0000000000c1';
const CHAPTER = '019f60f4-b101-70d4-8000-0000000000d1';
const BUCKET = 'fizzdragon-ai-outputs';
const NOW = new Date('2026-10-02T00:00:00.000Z');
const asset = (n: number) =>
  `019f60f4-b101-70d4-8000-${String(n).padStart(12, '0')}`;
const job = (n: number) =>
  `019f60f4-b101-70d4-9000-${String(n).padStart(12, '0')}`;

const CATALOGUE = [
  { gameId: GAME_SERIAL, currentVersion: 'serial-version-hash' },
  { gameId: GAME_UNMANAGED, currentVersion: 'v9' },
  { gameId: 'jinling-legacy', currentVersion: 'v1' },
];

function clipRow(
  n: number,
  options: {
    rank?: number;
    asset?: Record<string, unknown>;
    hls?: Record<string, unknown> | null;
  } = {},
) {
  return {
    id: `row-${n}`,
    buildId: BUILD_CHAPTER,
    rank: options.rank ?? 1000 + n,
    logicalKey: `video:clip-${n}`,
    contentType: 'video/mp4',
    sizeBytes: 7_000n,
    width: 1920,
    height: 1080,
    durationMs: 7_000,
    variant: { variantKey: 'original' },
    videoClip: { graphNodeId: n === 1 ? 'clip:s1' : `clip:s${n}` },
    asset: {
      id: asset(n),
      storageProvider: MediaStorageProvider.aliyun_oss,
      bucket: BUCKET,
      region: 'cn-hangzhou',
      objectKey: `media/${n}.mp4`,
      externalUrl: null,
      status: MediaAssetStatus.ready,
      deletedAt: null,
      moderationStatus: MediaAssetModerationStatus.approved,
      moderationReason: null,
      sizeBytes: 7_000n,
      ...options.asset,
      variants: options.hls ? [options.hls] : [],
    },
  };
}

const READY_HLS = (n: number) => ({
  id: `hls-${n}`,
  variantKey: 'hls',
  status: MediaAssetVariantStatus.ready,
  contentType: 'application/vnd.apple.mpegurl',
  sizeBytes: 54_321n,
  metadata: {
    renditions: [
      { name: '1080p', width: 1920, height: 1080, segmentCount: 2 },
      { name: '720p', width: 1280, height: 720, segmentCount: 2 },
      { name: 'bogus', width: 1, height: 1 },
    ],
  },
  deletedAt: null,
  placements: [
    {
      id: `master-${n}`,
      role: 'primary',
      status: 'active',
      priority: 0,
      storageProvider: MediaStorageProvider.aliyun_oss,
      bucket: BUCKET,
      region: 'cn-hangzhou',
      objectKey: `hls/${asset(n)}/master.m3u8`,
      externalUrl: null,
      publicBaseUrl: null,
      deletedAt: null,
      lastVerifiedAt: NOW,
    },
  ],
});

function jobRow(
  n: number,
  status: MediaProcessingJobStatus,
  output: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  return {
    id: job(n),
    idempotencyKey: `hls-stream:${asset(n)}`,
    status,
    attempt: 1,
    maxAttempts: 8,
    output,
    errorMessage: status === 'dead' ? 'IMM transcode failed (task=t): x' : null,
    completedAt: null,
    nextAttemptAt: null,
    ...extra,
  };
}

const TAKEDOWN_META = {
  scope: 'hls_prefix',
  bucket: BUCKET,
  region: 'cn-hangzhou',
  refreshKeys: [],
};

function harness() {
  const rows = [
    clipRow(1, { hls: READY_HLS(1) }),
    clipRow(2),
    clipRow(3),
    clipRow(4),
    clipRow(5),
    clipRow(6),
    clipRow(7),
    clipRow(8),
    clipRow(9, {
      asset: {
        moderationStatus: MediaAssetModerationStatus.blocked,
        moderationReason: 'policy',
      },
    }),
    clipRow(10, { asset: { bucket: 'legacy-bucket' } }),
  ];
  const jobs = [
    jobRow(2, MediaProcessingJobStatus.pending),
    jobRow(3, MediaProcessingJobStatus.pending, {
      immTaskId: 'task-3',
      submittedAt: '2026-10-01T23:58:00.000Z',
    }),
    jobRow(4, MediaProcessingJobStatus.processing),
    jobRow(5, MediaProcessingJobStatus.failed, { immTaskId: 'task-5' }),
    jobRow(6, MediaProcessingJobStatus.dead),
    jobRow(8, MediaProcessingJobStatus.cancelled),
    jobRow(
      1,
      MediaProcessingJobStatus.completed,
      { immTaskId: 'task-1', submittedAt: '2026-10-01T23:00:00.000Z' },
      { completedAt: new Date('2026-10-01T23:04:30.000Z') },
    ),
  ];
  const prisma = {
    storyProject: {
      findMany: jest.fn((args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          args.where.id.in
            .filter((id) => id === GAME_SERIAL || id === GAME_OFFLINE)
            .map((id) => ({ id })),
        ),
      ),
    },
    storyExperienceGameRelease: {
      findMany: jest.fn().mockResolvedValue([
        {
          storyProjectId: GAME_SERIAL,
          chapters: [
            {
              buildId: BUILD_CHAPTER,
              rank: 1,
              storyChapterId: CHAPTER,
              build: {
                status: StoryBuildStatus.ready,
                runtimeSchemaVersion: 2,
                sourceRevisionId: REVISION,
              },
            },
          ],
        },
      ]),
    },
    storyBuild: {
      findMany: jest.fn((args: { select: { runtimeJson?: boolean } }) =>
        Promise.resolve(
          args.select.runtimeJson
            ? [{ id: BUILD_CHAPTER, runtimeJson: 'free' }]
            : [],
        ),
      ),
    },
    storyBuildAsset: { findMany: jest.fn().mockResolvedValue(rows) },
    mediaProcessingJob: { findMany: jest.fn().mockResolvedValue(jobs) },
    mediaModerationAction: {
      findMany: jest.fn(
        (args: { where: { AND: Array<{ metadata: { equals: string } }> } }) =>
          Promise.resolve(
            args.where.AND[1].metadata.equals === 'moderation'
              ? [
                  {
                    id: job(90),
                    assetId: asset(9),
                    status: MediaModerationActionStatus.pending,
                    attempt: 1,
                    nextAttemptAt: new Date('2026-10-02T00:01:00.000Z'),
                    completedAt: null,
                    errorMessage: null,
                    createdAt: NOW,
                    metadata: {
                      ...TAKEDOWN_META,
                      origin: 'moderation',
                      prefix: `hls/${asset(9)}/`,
                      cdnRefreshedAt: '2026-10-01T23:59:00.000Z',
                      waitingForJobId: job(9),
                    },
                  },
                ]
              : [
                  {
                    id: job(91),
                    assetId: asset(21),
                    status: MediaModerationActionStatus.failed,
                    attempt: 3,
                    nextAttemptAt: new Date('2026-10-02T00:30:00.000Z'),
                    completedAt: null,
                    errorMessage: 'AccessDenied: DeleteObjects',
                    createdAt: NOW,
                    metadata: {
                      ...TAKEDOWN_META,
                      origin: 'lifecycle',
                      prefix: `hls/${asset(21)}/`,
                    },
                    variant: { sizeBytes: 9_000n },
                    asset: {
                      storyBuildAssets: [{ storyProjectId: GAME_SERIAL }],
                    },
                  },
                ],
          ),
      ),
    },
    mediaAssetVariant: {
      findMany: jest.fn().mockResolvedValue([
        {
          assetId: asset(20),
          sizeBytes: 5_000n,
          placements: [
            { lastVerifiedAt: new Date('2026-10-01T20:00:00.000Z') },
          ],
          asset: { storyBuildAssets: [{ storyProjectId: GAME_SERIAL }] },
        },
        {
          // Still live in GAME_SERIAL (eligible there): not scheduled for it.
          assetId: asset(1),
          sizeBytes: 54_321n,
          placements: [
            { lastVerifiedAt: new Date('2026-10-01T20:00:00.000Z') },
          ],
          asset: {
            storyBuildAssets: [
              { storyProjectId: GAME_SERIAL },
              { storyProjectId: GAME_OFFLINE },
            ],
          },
        },
      ]),
    },
    storyRevision: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: REVISION,
          content: {
            graph: {
              nodes: [
                { nodeId: 'clip:s1', name: 'Opening', clipKey: 'S1' },
                { nodeId: 'clip:s2', clipKey: 'S2' },
                { nodeId: 7 },
              ],
            },
          },
        },
      ]),
    },
    storyChapter: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: CHAPTER, title: 'Chapter One' }]),
    },
  };
  const redis = {
    hset: jest.fn(),
    hgetall: jest.fn().mockResolvedValue({
      lastRun: JSON.stringify({
        status: 'succeeded',
        startedAt: '2026-10-01T23:59:00.000Z',
        finishedAt: '2026-10-01T23:59:02.000Z',
        error: null,
        stats: {
          cataloguePages: 1,
          catalogueGames: 3,
          enqueued: 1,
          expired: 0,
        },
      }),
      lastSucceededAt: '2026-10-01T23:59:02.000Z',
    }),
  };
  const imm = {
    ossBucket: () => BUCKET,
    getTaskStatus: jest.fn(),
  };
  const media = { retryJob: jest.fn() };
  const reconcile = new StoryPlaybackReconcileService(
    prisma as never,
    {} as never,
    imm as never,
    {} as never,
    redis as never,
  );
  const service = new StoryPlaybackAdminService(
    prisma as never,
    reconcile,
    media as never,
    imm as never,
  );
  return { service, reconcile, prisma, redis, imm, media };
}

/** Page 1 lists `data`, later pages are empty; `onPage` sees each request. */
function javaCatalogue(
  data: unknown = CATALOGUE,
  onPage?: (page: number) => void,
) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request) => {
      const page = Number(
        new URL(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        ).searchParams.get('page'),
      );
      onPage?.(page);
      return Promise.resolve(
        Response.json({ code: 200, data: page === 1 ? data : [] }),
      );
    });
}

/** The terminating empty page returns after the 12 s admin deadline. */
const lastPageAfterDeadline = (page: number) => {
  if (page === 2) jest.setSystemTime(NOW.getTime() + 12_500);
};

describe('clipState', () => {
  const clip = (overrides: Partial<LiveAsset> = {}) =>
    ({
      blocked: false,
      exclusion: null,
      hlsReady: false,
      ...overrides,
    }) as LiveAsset;
  const withJob = (status: MediaProcessingJobStatus, output = {}) => ({
    status,
    output,
  });

  it.each([
    [
      'blocked beats everything',
      clip({ blocked: true, exclusion: 'paid_content', hlsReady: true }),
      null,
      'blocked',
    ],
    [
      'excluded beats ready',
      clip({ exclusion: 'paid_content', hlsReady: true }),
      null,
      'excluded',
    ],
    [
      'ready beats any job',
      clip({ hlsReady: true }),
      withJob(MediaProcessingJobStatus.dead),
      'ready',
    ],
    [
      'processing (claimed)',
      clip(),
      withJob(MediaProcessingJobStatus.processing),
      'processing',
    ],
    [
      'processing (between polls)',
      clip(),
      withJob(MediaProcessingJobStatus.pending, { immTaskId: 't' }),
      'processing',
    ],
    ['queued', clip(), withJob(MediaProcessingJobStatus.pending), 'queued'],
    ['retrying', clip(), withJob(MediaProcessingJobStatus.failed), 'retrying'],
    ['failed', clip(), withJob(MediaProcessingJobStatus.dead), 'failed'],
    ['not queued: no job', clip(), null, 'not_queued'],
    [
      'not queued: cancelled',
      clip(),
      withJob(MediaProcessingJobStatus.cancelled),
      'not_queued',
    ],
    [
      'not queued: completed without output',
      clip(),
      withJob(MediaProcessingJobStatus.completed),
      'not_queued',
    ],
  ])('%s', (_label, value, jobValue, expected) => {
    expect(clipState(value, jobValue)).toBe(expected);
  });
});

describe('StoryPlaybackAdminService', () => {
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW.getTime(),
      doNotFake: ['nextTick', 'setImmediate'],
    });
    process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = 'https://media.fizzspace.cn';
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnLog = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    jest.mocked(hasFeature).mockReturnValue(true);
    delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
  });

  describe('overview', () => {
    it('summarises each requested work in request order', async () => {
      javaCatalogue();
      const h = harness();

      const overview = await h.service.overview({
        gameIds: [GAME_UNMANAGED, GAME_SERIAL, GAME_OFFLINE, 'jinling-legacy'],
      });

      expect(StoryPlaybackOverviewSchema.parse(overview)).toEqual(overview);
      expect(overview.games.map((game) => game.gameId)).toEqual([
        GAME_UNMANAGED,
        GAME_SERIAL,
        GAME_OFFLINE,
        'jinling-legacy',
      ]);
      const [unmanaged, serial, offline, legacy] = overview.games;
      expect(unmanaged).toEqual(
        expect.objectContaining({
          managed: false,
          catalogue: { listed: true, version: 'v9', versionResolved: false },
          summary: null,
          clips: null,
        }),
      );
      expect(legacy.managed).toBe(false);
      expect(serial.catalogue).toEqual({
        listed: true,
        version: 'serial-version-hash',
        versionResolved: true,
      });
      expect(serial.summary).toEqual({
        total: 10,
        eligible: 8,
        ready: 1,
        queued: 1,
        processing: 2,
        retrying: 1,
        failed: 1,
        notQueued: 2,
        blocked: 1,
        excluded: 1,
      });
      const summary = serial.summary!;
      expect(
        summary.ready +
          summary.queued +
          summary.processing +
          summary.retrying +
          summary.failed +
          summary.notQueued +
          summary.blocked +
          summary.excluded,
      ).toBe(summary.total);
      expect(serial.clips).toBeNull();
      expect(serial.cleanup).toEqual({
        pending: 2,
        nextAt: '2026-10-02T21:00:00.000Z',
        items: null,
      });
      expect(offline).toEqual(
        expect.objectContaining({
          managed: true,
          catalogue: { listed: false, version: null, versionResolved: false },
          summary: null,
          cleanup: {
            pending: 1,
            nextAt: '2026-10-02T21:00:00.000Z',
            items: null,
          },
        }),
      );
      expect(overview.renditionLadder).toEqual(['1080p', '720p', '480p']);
      expect(overview.reconciler).toEqual(
        expect.objectContaining({
          intervalSeconds: 120,
          graceHours: 24,
          stale: false,
          lastSucceededAt: '2026-10-01T23:59:02.000Z',
          stateError: null,
        }),
      );
    });

    it('lists clips, labels, renditions, jobs and cleanup items with include=clips', async () => {
      javaCatalogue();
      const h = harness();

      const overview = await h.service.overview({
        gameIds: [GAME_SERIAL],
        include: 'clips',
      });

      expect(StoryPlaybackOverviewSchema.parse(overview)).toEqual(overview);
      const game = overview.games[0];
      const clips = game.clips!;
      expect(clips.map((clip) => clip.hls.state)).toEqual([
        'ready',
        'queued',
        'processing',
        'processing',
        'retrying',
        'failed',
        'not_queued',
        'not_queued',
        'blocked',
        'excluded',
      ]);
      const [ready] = clips;
      expect(ready.occurrences).toEqual([
        {
          buildId: BUILD_CHAPTER,
          chapterRank: 1,
          chapterTitle: 'Chapter One',
          sceneId: 'clip:s1',
          sceneLabel: 'Opening',
          clipIndex: 2,
          logicalKey: 'video:clip-1',
        },
      ]);
      expect(clips[1].occurrences[0].sceneLabel).toBe('S2');
      expect(clips[2].occurrences[0].sceneLabel).toBe('clip:s3');
      expect(ready.hls).toEqual({
        state: 'ready',
        exclusion: null,
        renditions: [
          { name: '1080p', width: 1920, height: 1080 },
          { name: '720p', width: 1280, height: 720 },
        ],
        outputBytes: '54321',
        job: expect.objectContaining({
          immTaskId: 'task-1',
          submittedAt: '2026-10-01T23:00:00.000Z',
          completedAt: '2026-10-01T23:04:30.000Z',
          transcodeSeconds: 270,
        }),
        playback: {
          url: `https://media.fizzspace.cn/hls/${asset(1)}/master.m3u8`,
          contentType: 'application/vnd.apple.mpegurl',
        },
      });
      const blocked = clips[8];
      expect(blocked.moderation).toEqual({
        status: 'blocked',
        reason: 'policy',
        takedown: expect.objectContaining({
          origin: 'moderation',
          status: 'pending',
          waitingForTranscode: true,
          cdnRefreshedAt: '2026-10-01T23:59:00.000Z',
        }),
      });
      expect(blocked.hls.exclusion).toBeNull();
      expect(clips[9].hls).toEqual(
        expect.objectContaining({
          state: 'excluded',
          exclusion: 'storage_provider',
          playback: null,
        }),
      );
      expect(game.cleanup.items).toEqual([
        {
          assetId: asset(20),
          reason: 'replaced',
          state: 'scheduled',
          scheduledAt: '2026-10-02T21:00:00.000Z',
          outputBytes: '5000',
          takedown: null,
        },
        {
          assetId: asset(21),
          reason: 'replaced',
          state: 'cleaning',
          scheduledAt: null,
          outputBytes: '9000',
          takedown: expect.objectContaining({
            origin: 'lifecycle',
            status: 'failed',
            attempt: 3,
            waitingForTranscode: false,
            error: 'AccessDenied: DeleteObjects',
          }),
        },
      ]);
    });

    it('marks the reconciler stale when the heartbeat is unreadable', async () => {
      javaCatalogue();
      const h = harness();
      h.redis.hgetall.mockRejectedValue(new Error('NOAUTH'));

      const overview = await h.service.overview({ gameIds: [GAME_SERIAL] });

      expect(overview.reconciler).toEqual({
        intervalSeconds: 120,
        graceHours: 24,
        stale: true,
        lastRun: null,
        lastSucceededAt: null,
        stateError: 'NOAUTH',
      });
    });

    it('answers 404 off the cn cell', async () => {
      jest.mocked(hasFeature).mockReturnValue(false);
      const fetch = javaCatalogue();
      const h = harness();

      const error = await h.service
        .overview({ gameIds: [GAME_SERIAL] })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'STORY_PLAYBACK_HLS_DISABLED',
        msg: '播放分发（HLS）仅在中国站启用。',
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('answers 502 with the Java failure verbatim', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ code: 500, msg: '目录服务不可用' }));
      const h = harness();

      const error = await h.service
        .overview({ gameIds: [GAME_SERIAL] })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).getResponse()).toEqual({
        code: 'JAVA_CATALOGUE_FAILED',
        msg: 'Java playable-story catalogue failed (HTTP 200, code 500): 目录服务不可用',
      });
    });

    it('answers 504 with the deadline verbatim when the last catalogue page returns after it, logging a warning', async () => {
      javaCatalogue(CATALOGUE, lastPageAfterDeadline);
      const h = harness();

      const error = await h.service
        .overview({ gameIds: [GAME_SERIAL] })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(GatewayTimeoutException);
      expect((error as GatewayTimeoutException).getResponse()).toEqual({
        code: 'STORY_PLAYBACK_REQUEST_DEADLINE',
        msg: 'request deadline exceeded during live builds',
      });
      expect(warnLog.mock.calls).toEqual([
        [
          'Admin read overran its deadline: request deadline exceeded during live builds',
        ],
      ]);
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('answers 500 with any other failure after the catalogue verbatim, logging its stack', async () => {
      javaCatalogue();
      const h = harness();
      const down = new Error("Can't reach database server at `postgres:5432`");
      h.prisma.storyBuildAsset.findMany.mockRejectedValue(down);

      const error = await h.service
        .overview({ gameIds: [GAME_SERIAL] })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getResponse()).toEqual({
        code: 'STORY_PLAYBACK_READ_FAILED',
        msg: "Can't reach database server at `postgres:5432`",
      });
      expect(errorLog.mock.calls).toEqual([
        [`Admin read failed: ${down.message}`, down],
      ]);
    });
  });

  describe('retryFailed', () => {
    it('restarts failed and retrying clips, refusing live IMM tasks and every failure verbatim, logging the unexpected ones', async () => {
      javaCatalogue();
      const h = harness();
      const recent = { submittedAt: '2026-10-01T23:50:00.000Z' };
      const unavailable = new Error('IMM GetTask: ServiceUnavailable');
      const closed = new Error('Transaction already closed');
      h.prisma.mediaProcessingJob.findMany.mockResolvedValue([
        jobRow(4, MediaProcessingJobStatus.dead),
        jobRow(5, MediaProcessingJobStatus.failed, { immTaskId: 'task-5' }),
        jobRow(6, MediaProcessingJobStatus.dead),
        jobRow(7, MediaProcessingJobStatus.dead, {
          immTaskId: 'task-7',
          ...recent,
        }),
        jobRow(8, MediaProcessingJobStatus.dead, {
          immTaskId: 'task-8',
          ...recent,
        }),
        jobRow(2, MediaProcessingJobStatus.pending),
      ]);
      h.imm.getTaskStatus.mockImplementation((taskId: string) =>
        taskId === 'task-5'
          ? Promise.resolve({ state: 'running', raw: 'Running' })
          : taskId === 'task-7'
            ? Promise.reject(unavailable)
            : Promise.resolve({ state: 'failed', raw: 'Failed' }),
      );
      h.media.retryJob.mockImplementation((jobId: string) =>
        jobId === job(8)
          ? Promise.reject(
              new ConflictException(
                'The processing job is no longer available for retry. Refresh and retry if it fails again.',
              ),
            )
          : jobId === job(4)
            ? Promise.reject(closed)
            : Promise.resolve({ id: jobId }),
      );

      const result = await h.service.retryFailed(GAME_SERIAL);

      expect(StoryPlaybackRetryFailedResultSchema.parse(result)).toEqual(
        result,
      );
      expect(result).toEqual({
        gameId: GAME_SERIAL,
        version: 'serial-version-hash',
        requeued: [{ assetId: asset(6), jobId: job(6) }],
        refused: [
          { assetId: asset(4), reason: 'Transaction already closed' },
          {
            assetId: asset(5),
            reason:
              'IMM task task-5 is still running (Running); retry after it finishes.',
          },
          { assetId: asset(7), reason: 'IMM GetTask: ServiceUnavailable' },
          {
            assetId: asset(8),
            reason:
              'The processing job is no longer available for retry. Refresh and retry if it fails again.',
          },
        ],
      });
      expect(h.media.retryJob).toHaveBeenCalledTimes(3);
      // The running task and the ConflictException are deliberate refusals.
      expect(errorLog.mock.calls).toEqual([
        [`Retry of clip ${asset(4)} failed: ${closed.message}`, closed],
        [
          `Retry of clip ${asset(7)} failed: ${unavailable.message}`,
          unavailable,
        ],
      ]);
    });

    it('asks IMM only while the task could still write the prefix', async () => {
      javaCatalogue();
      const h = harness();
      h.prisma.mediaProcessingJob.findMany.mockResolvedValue([
        // Submitted past 2×IMM_MAX_MINUTES: the task can no longer write.
        jobRow(6, MediaProcessingJobStatus.dead, {
          immTaskId: 'task-6',
          submittedAt: '2026-10-01T22:59:00.000Z',
        }),
        jobRow(7, MediaProcessingJobStatus.dead, {
          immTaskId: 'task-7',
          submittedAt: '2026-10-01T23:01:00.000Z',
        }),
      ]);
      // IMM keeps a task only for a while; GetTask then answers no Status.
      h.imm.getTaskStatus.mockRejectedValue(
        Object.assign(
          new Error('The specified resource TaskId is not found.'),
          {
            code: 'ResourceNotFound',
            data: { RequestId: 'r', Code: 'ResourceNotFound' },
          },
        ),
      );
      h.media.retryJob.mockImplementation((jobId: string) =>
        Promise.resolve({ id: jobId }),
      );

      const result = await h.service.retryFailed(GAME_SERIAL);

      expect(result.requeued).toEqual([{ assetId: asset(6), jobId: job(6) }]);
      expect(result.refused).toEqual([
        {
          assetId: asset(7),
          reason: 'The specified resource TaskId is not found.',
        },
      ]);
      expect(h.imm.getTaskStatus).toHaveBeenCalledTimes(1);
      expect(h.imm.getTaskStatus).toHaveBeenCalledWith('task-7');
    });

    it('refuses every clip not reached within the retry budget', async () => {
      javaCatalogue();
      const h = harness();
      h.prisma.mediaProcessingJob.findMany.mockResolvedValue(
        [2, 3, 4, 5, 6, 7, 8].map((n) =>
          jobRow(n, MediaProcessingJobStatus.dead, {
            immTaskId: `task-${n}`,
            submittedAt: '2026-10-01T23:50:00.000Z',
          }),
        ),
      );
      // A degraded IMM: every GetTask hangs until its client timeout.
      h.imm.getTaskStatus.mockImplementation(() => {
        jest.setSystemTime(Date.now() + 31_000);
        return Promise.reject(new Error('IMM GetTask: ReadTimeout'));
      });

      const result = await h.service.retryFailed(GAME_SERIAL);

      const notReached =
        'not attempted: retry time budget exhausted after 3 of 7 clips; press retry again.';
      expect(result.requeued).toEqual([]);
      expect(result.refused).toEqual([
        ...[2, 3, 4].map((n) => ({
          assetId: asset(n),
          reason: 'IMM GetTask: ReadTimeout',
        })),
        ...[5, 6, 7, 8].map((n) => ({ assetId: asset(n), reason: notReached })),
      ]);
      expect(h.imm.getTaskStatus).toHaveBeenCalledTimes(3);
      expect(Date.now() - NOW.getTime()).toBe(93_000);
    });

    it('answers 504 with the deadline verbatim and restarts nothing when the reads overrun it', async () => {
      javaCatalogue(CATALOGUE, lastPageAfterDeadline);
      const h = harness();

      const error = await h.service
        .retryFailed(GAME_SERIAL)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(GatewayTimeoutException);
      expect((error as GatewayTimeoutException).getResponse()).toEqual({
        code: 'STORY_PLAYBACK_REQUEST_DEADLINE',
        msg: 'request deadline exceeded during live builds',
      });
      expect(h.imm.getTaskStatus).not.toHaveBeenCalled();
      expect(h.media.retryJob).not.toHaveBeenCalled();
    });

    it('answers 404 for a work the player catalogue does not list', async () => {
      javaCatalogue();
      const h = harness();

      const error = await h.service
        .retryFailed(GAME_OFFLINE)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual(
        expect.objectContaining({ code: 'STORY_PLAYBACK_GAME_NOT_LISTED' }),
      );
    });

    it('answers 404 off the cn cell', async () => {
      jest.mocked(hasFeature).mockReturnValue(false);
      const h = harness();
      await expect(h.service.retryFailed(GAME_SERIAL)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        Promise.resolve().then(() => h.service.reconcileNow()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('reconcileNow runs an admin-triggered cycle', async () => {
    const h = harness();
    const runCycle = jest
      .spyOn(h.reconcile, 'runCycle')
      .mockResolvedValue({ outcome: 'already_running', run: null });

    await expect(h.service.reconcileNow()).resolves.toEqual({
      outcome: 'already_running',
      run: null,
    });
    expect(runCycle).toHaveBeenCalledWith('admin');
  });
});

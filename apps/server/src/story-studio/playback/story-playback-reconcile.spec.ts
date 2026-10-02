/* eslint-disable @typescript-eslint/no-unsafe-assignment -- introspecting untyped jest mock.calls payloads */
import { ConflictException, Logger } from '@nestjs/common';
import {
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaProcessingJobStatus,
  MediaStorageProvider,
  Prisma,
  StoryBuildStatus,
} from '@prisma/client';
import { StoryPlaybackReconcileRunSchema } from '@repo/shared/story-playback';
import { hasFeature } from '../../common/region';
import { blockingHlsTakedownWhere } from '../../media/hls-output';
import {
  CATALOGUE_MAX_PAGES,
  EXPIRE_AFTER_MS,
  INTERVAL_MS,
  LIVE_REFRESH_MS,
  STATE_KEY,
  StoryPlaybackReconcileService,
  parseCataloguePage,
  parseLivePlayableGames,
} from './story-playback-reconcile.service';

jest.mock('../../common/region', () => ({
  ...jest.requireActual<object>('../../common/region'),
  hasFeature: jest.fn().mockReturnValue(false),
}));
// Access is the manifest's own business (story-build-access.spec): here a
// Build's runtimeJson simply names its access.
jest.mock('../story-build-access', () => ({
  ...jest.requireActual<object>('../story-build-access'),
  storyManifestAccess: jest.fn((runtimeJson: unknown) => runtimeJson),
}));

const GAME_SINGLE = '019f60f4-b101-70d4-8000-000000000001';
const GAME_SERIAL = '019f60f4-b101-70d4-8000-000000000002';
const BUILD_SINGLE = '019f60f4-b101-70d4-8000-0000000000b1';
const BUILD_CHAPTER = '019f60f4-b101-70d4-8000-0000000000b2';
const REVISION = '019f60f4-b101-70d4-8000-0000000000c1';
const CHAPTER = '019f60f4-b101-70d4-8000-0000000000d1';
const BUCKET = 'fizzdragon-ai-outputs';
const NOW = new Date('2026-10-02T00:00:00.000Z');

const asset = (n: number) =>
  `019f60f4-b101-70d4-8000-${String(n).padStart(12, '0')}`;

type Build = {
  id: string;
  storyProjectId: string;
  status: StoryBuildStatus;
  runtimeSchemaVersion: number;
  sourceRevisionId: string;
  runtimeJson: string;
};

function clipRow(options: {
  assetId: string;
  buildId?: string;
  rank?: number;
  variantKey?: string;
  asset?: Record<string, unknown>;
  hls?: Record<string, unknown> | null;
}) {
  return {
    id: `row-${options.assetId}-${options.buildId ?? BUILD_SINGLE}`,
    buildId: options.buildId ?? BUILD_SINGLE,
    rank: options.rank ?? 1000,
    logicalKey: `video:${options.assetId}`,
    contentType: 'video/mp4',
    sizeBytes: 7_000n,
    width: 1920,
    height: 1080,
    durationMs: 7_000,
    variant: { variantKey: options.variantKey ?? 'original' },
    videoClip: { graphNodeId: 'clip:s1' },
    asset: {
      id: options.assetId,
      storageProvider: MediaStorageProvider.aliyun_oss,
      bucket: BUCKET,
      region: 'cn-hangzhou',
      objectKey: `media/${options.assetId}.mp4`,
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

function readyHls(assetId: string, lastVerifiedAt: Date | null = null) {
  return {
    id: `hls-${assetId}`,
    variantKey: 'hls',
    status: MediaAssetVariantStatus.ready,
    contentType: 'application/vnd.apple.mpegurl',
    sizeBytes: 1_000n,
    metadata: {},
    deletedAt: null,
    placements: [
      {
        id: `master-${assetId}`,
        role: 'primary',
        status: 'active',
        priority: 0,
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: BUCKET,
        region: 'cn-hangzhou',
        objectKey: `hls/${assetId}/master.m3u8`,
        externalUrl: null,
        publicBaseUrl: null,
        deletedAt: null,
        lastVerifiedAt,
      },
    ],
  };
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

function catalogue(...pages: unknown[][]) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request) => {
      const page = Number(new URL(requestUrl(input)).searchParams.get('page'));
      return Promise.resolve(
        Response.json({ code: 200, data: pages[page - 1] ?? [] }),
      );
    });
}

const LIVE = [
  { gameId: GAME_SINGLE, currentVersion: BUILD_SINGLE },
  { gameId: GAME_SERIAL, currentVersion: 'serial-version-hash' },
  { gameId: 'jinling-legacy', currentVersion: 'v1' },
];

function harness(
  options: {
    builds?: Build[];
    chapters?: Array<{ buildId: string; rank: number; build: Partial<Build> }>;
    rows?: ReturnType<typeof clipRow>[];
    jobs?: Array<{ idempotencyKey: string; status: MediaProcessingJobStatus }>;
    takedowns?: Array<{ assetId: string }>;
    inflight?: number;
    expired?: Array<{ id: string; assetId: string }>;
    current?: Record<string, unknown> | null;
    retired?: number;
    acquired?: boolean;
  } = {},
) {
  const builds = options.builds ?? [
    {
      id: BUILD_SINGLE,
      storyProjectId: GAME_SINGLE,
      status: StoryBuildStatus.ready,
      runtimeSchemaVersion: 2,
      sourceRevisionId: REVISION,
      runtimeJson: 'free',
    },
  ];
  const chapters = options.chapters ?? [
    {
      buildId: BUILD_CHAPTER,
      rank: 1,
      build: {
        status: StoryBuildStatus.ready,
        runtimeSchemaVersion: 2,
        sourceRevisionId: REVISION,
        runtimeJson: 'free',
      },
    },
  ];
  const runtimeJsonById = new Map<string, string>([
    ...builds.map((build) => [build.id, build.runtimeJson] as const),
    ...chapters.map(
      (chapter) =>
        [chapter.buildId, chapter.build.runtimeJson ?? 'free'] as const,
    ),
  ]);
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ acquired: options.acquired ?? true }]),
    mediaAssetVariant: {
      findFirst: jest.fn().mockResolvedValue(
        options.current === undefined
          ? {
              id: 'hls-gone',
              assetId: asset(90),
              asset: { bucket: BUCKET, region: 'cn-hangzhou' },
              placements: [
                {
                  objectKey: `hls/${asset(90)}/master.m3u8`,
                  role: 'primary',
                  status: 'active',
                  storageProvider: MediaStorageProvider.aliyun_oss,
                  lastVerifiedAt: new Date('2026-09-30T00:00:00.000Z'),
                  deletedAt: null,
                },
                {
                  objectKey: `hls/${asset(90)}/480p-0.ts`,
                  role: 'replica',
                  status: 'active',
                  storageProvider: MediaStorageProvider.aliyun_oss,
                  lastVerifiedAt: null,
                  deletedAt: null,
                },
                {
                  // Retired by a re-transcode that produced fewer keys; the
                  // object may still be cached.
                  objectKey: `hls/${asset(90)}/480p-1.ts`,
                  role: 'replica',
                  status: 'deleted',
                  storageProvider: MediaStorageProvider.aliyun_oss,
                  lastVerifiedAt: null,
                  deletedAt: new Date('2026-09-29T00:00:00.000Z'),
                },
              ],
            }
          : options.current,
      ),
      updateMany: jest.fn().mockResolvedValue({ count: options.retired ?? 1 }),
    },
    mediaObjectPlacement: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    mediaProcessingJob: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaModerationAction: {
      create: jest.fn().mockResolvedValue({ id: 'gc' }),
    },
  };
  const order: string[] = [];
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
    storyExperienceGameRelease: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            storyProjectId: GAME_SERIAL,
            chapters: chapters.map((chapter) => ({
              buildId: chapter.buildId,
              rank: chapter.rank,
              storyChapterId: CHAPTER,
              build: {
                status: chapter.build.status ?? StoryBuildStatus.ready,
                runtimeSchemaVersion: chapter.build.runtimeSchemaVersion ?? 2,
                sourceRevisionId: REVISION,
              },
            })),
          },
        ]),
      ),
    },
    storyBuild: {
      findMany: jest.fn(
        (args: {
          select: { runtimeJson?: boolean };
          where: { id?: { in: string[] } };
        }) =>
          Promise.resolve(
            args.select.runtimeJson
              ? (args.where.id?.in ?? []).map((id) => ({
                  id,
                  runtimeJson: runtimeJsonById.get(id),
                }))
              : builds,
          ),
      ),
    },
    storyBuildAsset: {
      findMany: jest.fn().mockResolvedValue(options.rows ?? []),
    },
    mediaProcessingJob: {
      findMany: jest.fn().mockResolvedValue(options.jobs ?? []),
      count: jest.fn().mockResolvedValue(options.inflight ?? 0),
    },
    mediaModerationAction: {
      findMany: jest.fn().mockResolvedValue(options.takedowns ?? []),
    },
    mediaObjectPlacement: {
      updateMany: jest.fn(() => {
        order.push('markLive');
        return Promise.resolve({ count: 1 });
      }),
    },
    mediaAssetVariant: {
      findMany: jest.fn(() => {
        order.push('expire');
        return Promise.resolve(options.expired ?? []);
      }),
    },
  };
  const media = {
    enqueueJob: jest.fn(() => {
      order.push('enqueue');
      return Promise.resolve({ id: 'job' });
    }),
    enqueueJobTx: jest.fn(() => {
      order.push('restart');
      return Promise.resolve({ id: 'job' });
    }),
  };
  const imm = { ossBucket: () => BUCKET, assertConfigured: jest.fn() };
  const cdn = { assertAliyunRefreshConfigured: jest.fn() };
  const redis = {
    hset: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
  };
  const service = new StoryPlaybackReconcileService(
    prisma as never,
    media as never,
    imm as never,
    cdn as never,
    redis as never,
  );
  return { service, prisma, tx, media, imm, cdn, redis, order };
}

function whereOf(mock: jest.Mock, call = 0): Record<string, unknown> {
  return (mock.mock.calls[call] as [{ where: Record<string, unknown> }])[0]
    .where;
}

describe('catalogue parsing', () => {
  it('keeps object rows and refuses a non-list page', () => {
    expect(parseCataloguePage([{ gameId: 'a' }, null, 'x', [1]])).toEqual([
      { gameId: 'a' },
    ]);
    expect(() => parseCataloguePage({ data: [] })).toThrow(
      'Java returned an invalid playable-story catalogue.',
    );
  });

  it('keeps only UUID games with a current version', () => {
    expect(
      parseLivePlayableGames([
        { gameId: GAME_SINGLE, currentVersion: BUILD_SINGLE },
        { gameId: 'jinling-legacy', currentVersion: 'v1' },
        { gameId: GAME_SERIAL, currentVersion: '' },
        { gameId: 7, currentVersion: 'v' },
      ]),
    ).toEqual([{ gameId: GAME_SINGLE, currentVersion: BUILD_SINGLE }]);
  });
});

describe('StoryPlaybackReconcileService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    jest.mocked(hasFeature).mockReturnValue(false);
  });

  describe('catalogue', () => {
    it('pages until an empty page and counts distinct raw games', async () => {
      const fetch = catalogue(LIVE.slice(0, 2), [LIVE[2], LIVE[0]], []);
      const { service } = harness();

      const result = await service.fetchLiveGames({
        at: Date.now() + 60_000,
        label: 'test',
      });

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(requestUrl(fetch.mock.calls[0][0])).toBe(
        'http://java-studio.test.invalid/api/player/interactive-film/games?page=1&pageSize=100',
      );
      expect(result.pages).toBe(2);
      expect(result.rawCount).toBe(3);
      expect(result.games.map((game) => game.gameId)).toEqual([
        GAME_SINGLE,
        GAME_SERIAL,
      ]);
      expect(result.listed.get('jinling-legacy')).toBe('v1');
    });

    it('stops when a page adds no new game (Java ignoring page)', async () => {
      const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(Response.json({ code: 200, data: LIVE })),
        );
      const { service } = harness();

      const result = await service.fetchLiveGames({
        at: Date.now() + 60_000,
        label: 'test',
      });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.pages).toBe(1);
    });

    it(`fails rather than act on a catalogue past ${CATALOGUE_MAX_PAGES} pages`, async () => {
      let next = 0;
      jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
        next += 1;
        return Promise.resolve(
          Response.json({
            code: 200,
            data: [{ gameId: `legacy-${next}`, currentVersion: 'v' }],
          }),
        );
      });
      const { service } = harness();

      await expect(
        service.fetchLiveGames({ at: Date.now() + 60_000, label: 'test' }),
      ).rejects.toThrow('has more than 50 pages of 100');
      expect(next).toBe(CATALOGUE_MAX_PAGES);
    });

    it('surfaces a Java failure verbatim', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          Response.json({ code: 500, msg: '服务繁忙' }, { status: 200 }),
        );
      const { service } = harness();

      await expect(
        service.fetchLiveGames({ at: Date.now() + 60_000, label: 'test' }),
      ).rejects.toThrow(
        'Java playable-story catalogue failed (HTTP 200, code 500): 服务繁忙',
      );
    });
  });

  describe('cycle', () => {
    it('fails before prepare on an empty catalogue and writes only the heartbeat', async () => {
      catalogue([]);
      const h = harness();

      const result = await h.service.runCycle('admin');

      expect(result.outcome).toBe('completed');
      expect(result.run).toEqual(
        expect.objectContaining({
          status: 'failed',
          error:
            'Java returned an empty playable-story catalogue; refusing to expire every work.',
        }),
      );
      expect(
        h.prisma.storyExperienceGameRelease.findMany,
      ).not.toHaveBeenCalled();
      expect(h.order).toEqual([]);
      expect(h.redis.hset).toHaveBeenCalledWith(STATE_KEY, {
        lastRun: JSON.stringify(result.run),
      });
    });

    it('fails before prepare when Java is down', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('bad gateway', { status: 502 }));
      const h = harness();

      const result = await h.service.runCycle('schedule');

      expect(result.run?.error).toBe(
        'Java playable-story catalogue failed (HTTP 502, code none): non-JSON response',
      );
      expect(h.order).toEqual([]);
    });

    it('does nothing at all — not even read Java — when another pod holds the lock', async () => {
      const fetch = catalogue(LIVE);
      const h = harness({ acquired: false });

      await expect(h.service.runCycle('admin')).resolves.toEqual({
        outcome: 'already_running',
        run: null,
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(h.redis.hset).not.toHaveBeenCalled();
      expect(h.tx.$queryRaw).toHaveBeenCalled();
      expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 5_000,
        timeout: 180_000,
      });
    });

    it('resolves single and serial versions and keeps only playable Builds', async () => {
      catalogue(LIVE);
      const h = harness({
        builds: [
          {
            id: BUILD_SINGLE,
            storyProjectId: GAME_SINGLE,
            status: StoryBuildStatus.ready,
            runtimeSchemaVersion: 1,
            sourceRevisionId: REVISION,
            runtimeJson: 'free',
          },
        ],
        chapters: [
          { buildId: BUILD_CHAPTER, rank: 1, build: { runtimeJson: 'free' } },
          {
            buildId: '019f60f4-b101-70d4-8000-0000000000b3',
            rank: 2,
            build: { status: StoryBuildStatus.failed },
          },
        ],
      });

      const versions = await h.service.resolveLiveBuilds(
        parseLivePlayableGames(LIVE),
        { at: Date.now() + 60_000, label: 'test' },
      );

      expect(whereOf(h.prisma.storyExperienceGameRelease.findMany).OR).toEqual([
        { storyProjectId: GAME_SINGLE, contentVersion: BUILD_SINGLE },
        { storyProjectId: GAME_SERIAL, contentVersion: 'serial-version-hash' },
      ]);
      expect(whereOf(h.prisma.storyBuild.findMany).OR).toEqual([
        { id: BUILD_SINGLE, storyProjectId: GAME_SINGLE },
      ]);
      // Old-schema single and failed chapter are out; the version is
      // resolved only where a playable Build remains.
      expect(versions.get(GAME_SINGLE)).toEqual({
        version: BUILD_SINGLE,
        versionResolved: false,
        builds: [],
      });
      expect(versions.get(GAME_SERIAL)?.builds).toEqual([
        {
          buildId: BUILD_CHAPTER,
          storyProjectId: GAME_SERIAL,
          gameOrder: 1,
          chapterRank: 1,
          storyChapterId: CHAPTER,
          sourceRevisionId: REVISION,
          access: 'free',
        },
      ]);
    });

    it('memoises Build access: runtimeJson is read once per Build', async () => {
      const h = harness();
      const games = parseLivePlayableGames(LIVE);
      const deadline = { at: Date.now() + 60_000, label: 'test' };

      await h.service.resolveLiveBuilds(games, deadline);
      await h.service.resolveLiveBuilds(games, deadline);

      const jsonReads = h.prisma.storyBuild.findMany.mock.calls.filter(
        ([args]) => args.select.runtimeJson,
      );
      expect(jsonReads).toHaveLength(1);
      expect([...(jsonReads[0][0].where.id?.in ?? [])].sort()).toEqual(
        [BUILD_SINGLE, BUILD_CHAPTER].sort(),
      );
    });

    it('reads only frozen video segments of video assets (stills are ignored)', async () => {
      const h = harness();
      await h.service.loadClipRows(
        [
          {
            buildId: BUILD_SINGLE,
            storyProjectId: GAME_SINGLE,
            gameOrder: 0,
            chapterRank: null,
            storyChapterId: null,
            sourceRevisionId: REVISION,
            access: 'free',
          },
        ],
        { at: Date.now() + 60_000, label: 'test' },
      );
      expect(whereOf(h.prisma.storyBuildAsset.findMany)).toEqual({
        buildId: { in: [BUILD_SINGLE] },
        role: 'video',
        asset: { is: { kind: 'video' } },
      });
    });

    it.each([
      ['a deleted asset', { asset: { deletedAt: new Date() } }, 'unavailable'],
      [
        'a not-ready asset',
        { asset: { status: MediaAssetStatus.uploading } },
        'unavailable',
      ],
      [
        'an asset on another provider',
        { asset: { storageProvider: MediaStorageProvider.s3_compatible } },
        'storage_provider',
      ],
      [
        'an asset in another bucket',
        { asset: { bucket: 'legacy' } },
        'storage_provider',
      ],
      [
        'an unapproved asset where approval is required',
        { asset: { moderationStatus: MediaAssetModerationStatus.unreviewed } },
        'moderation_pending',
      ],
      [
        'a free Build pinning a rendition',
        { variantKey: 'mp4-720p' },
        'pinned_rendition',
      ],
    ])('excludes %s', async (_label, row, exclusion) => {
      process.env.MEDIA_REQUIRE_MODERATION_APPROVAL = 'true';
      try {
        const h = harness({
          rows: [clipRow({ assetId: asset(1), ...row })],
        });
        const clips = await h.service.loadLiveAssets(
          [
            {
              buildId: BUILD_SINGLE,
              storyProjectId: GAME_SINGLE,
              gameOrder: 0,
              chapterRank: null,
              storyChapterId: null,
              sourceRevisionId: REVISION,
              access: 'free',
            },
          ],
          { at: Date.now() + 60_000, label: 'test' },
        );
        expect(clips.get(asset(1))).toEqual(
          expect.objectContaining({ eligible: false, exclusion }),
        );
      } finally {
        delete process.env.MEDIA_REQUIRE_MODERATION_APPROVAL;
      }
    });

    it.each([
      ['paid', 'paid_content'],
      ['invalid', 'invalid_build'],
    ] as const)(
      'excludes clips of a %s Build only (%s)',
      async (access, exclusion) => {
        const h = harness({
          rows: [
            clipRow({ assetId: asset(1) }),
            clipRow({ assetId: asset(2), buildId: BUILD_CHAPTER }),
          ],
        });
        const base = {
          storyProjectId: GAME_SINGLE,
          gameOrder: 0,
          chapterRank: null,
          storyChapterId: null,
          sourceRevisionId: REVISION,
        };
        const clips = await h.service.loadLiveAssets(
          [
            { ...base, buildId: BUILD_SINGLE, access },
            { ...base, buildId: BUILD_CHAPTER, access: 'free' },
          ],
          { at: Date.now() + 60_000, label: 'test' },
        );
        expect(clips.get(asset(1))?.exclusion).toBe(exclusion);
        expect(clips.get(asset(2))?.eligible).toBe(true);
      },
    );

    it('reports a blocked clip as blocked, not excluded', async () => {
      const h = harness({
        rows: [
          clipRow({
            assetId: asset(1),
            asset: { moderationStatus: MediaAssetModerationStatus.blocked },
          }),
        ],
      });
      const clips = await h.service.loadLiveAssets(
        [
          {
            buildId: BUILD_SINGLE,
            storyProjectId: GAME_SINGLE,
            gameOrder: 0,
            chapterRank: null,
            storyChapterId: null,
            sourceRevisionId: REVISION,
            access: 'free',
          },
        ],
        { at: Date.now() + 60_000, label: 'test' },
      );
      expect(clips.get(asset(1))).toEqual(
        expect.objectContaining({
          blocked: true,
          exclusion: null,
          eligible: false,
        }),
      );
    });

    it('prepare creates missing jobs, restarts cancelled/completed ones, skips the rest, within the budget', async () => {
      catalogue(LIVE);
      const rows = [
        clipRow({ assetId: asset(1), rank: 1000 }), // no job → create
        clipRow({ assetId: asset(2), rank: 1001 }), // cancelled → restart
        clipRow({ assetId: asset(3), rank: 1002 }), // completed, not ready → restart
        clipRow({ assetId: asset(4), rank: 1003 }), // pending → in flight
        clipRow({ assetId: asset(5), rank: 1004 }), // failed → retrying
        clipRow({ assetId: asset(6), rank: 1005 }), // dead → operator
        clipRow({ assetId: asset(7), rank: 1006, hls: readyHls(asset(7)) }), // ready
        clipRow({ assetId: asset(8), rank: 1007 }), // over budget
      ];
      const h = harness({
        rows,
        inflight: 17,
        jobs: [
          [2, MediaProcessingJobStatus.cancelled],
          [3, MediaProcessingJobStatus.completed],
          [4, MediaProcessingJobStatus.pending],
          [5, MediaProcessingJobStatus.failed],
          [6, MediaProcessingJobStatus.dead],
        ].map(([n, status]) => ({
          idempotencyKey: `hls-stream:${asset(n as number)}`,
          status: status as MediaProcessingJobStatus,
        })),
      });

      const result = await h.service.runCycle('schedule');

      expect(result.run?.status).toBe('succeeded');
      expect(result.run?.stats.enqueued).toBe(3);
      expect(h.media.enqueueJob).toHaveBeenCalledWith({
        assetId: asset(1),
        jobType: 'hls_stream',
        priority: 50,
        idempotencyKey: `hls-stream:${asset(1)}`,
      });
      expect(
        (
          h.media.enqueueJobTx.mock.calls as unknown as Array<
            [{ assetId: string }, unknown, boolean]
          >
        ).map(([input, , restart]) => [input.assetId, restart]),
      ).toEqual([
        [asset(2), true],
        [asset(3), true],
      ]);
      // A job the worker deferred behind a takedown does not hold a slot.
      expect(whereOf(h.prisma.mediaProcessingJob.count)).toEqual({
        jobType: 'hls_stream',
        status: { in: ['pending', 'processing'] },
        output: { path: ['deferredByTakedown'], equals: Prisma.AnyNull },
      });
    });

    it('prepare leaves clips whose prefix a takedown still blocks to a later cycle and logs them', async () => {
      catalogue(LIVE);
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const h = harness({
        rows: [
          clipRow({ assetId: asset(1), rank: 1000 }), // no job, takedown running
          clipRow({ assetId: asset(2), rank: 1001 }), // cancelled, takedown settling
          clipRow({ assetId: asset(3), rank: 1002 }), // no job → create
        ],
        jobs: [
          {
            idempotencyKey: `hls-stream:${asset(2)}`,
            status: MediaProcessingJobStatus.cancelled,
          },
        ],
        takedowns: [{ assetId: asset(1) }, { assetId: asset(2) }],
      });
      jest.useFakeTimers({
        now: NOW.getTime(),
        doNotFake: ['nextTick', 'setImmediate'],
      });

      const result = await h.service.runCycle('schedule');

      // Exactly what the worker defers on (running, or completed within the
      // CDN settle window), on the cycle clock.
      expect(whereOf(h.prisma.mediaModerationAction.findMany)).toEqual(
        blockingHlsTakedownWhere({ in: [asset(1), asset(2), asset(3)] }, NOW),
      );
      expect(result.run?.stats.enqueued).toBe(1);
      expect(h.media.enqueueJob).toHaveBeenCalledTimes(1);
      expect(h.media.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: asset(3) }),
      );
      expect(h.media.enqueueJobTx).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('enqueued=1 waitingOnTakedown=2 expired=0'),
      );
    });

    it('prepare treats a lost restart race as benign', async () => {
      catalogue(LIVE);
      const h = harness({
        rows: [clipRow({ assetId: asset(2) })],
        jobs: [
          {
            idempotencyKey: `hls-stream:${asset(2)}`,
            status: MediaProcessingJobStatus.cancelled,
          },
        ],
      });
      h.media.enqueueJobTx.mockRejectedValue(
        new ConflictException(
          'The processing job is active and cannot be restarted.',
        ),
      );

      const result = await h.service.runCycle('schedule');

      expect(result.run).toEqual(
        expect.objectContaining({ status: 'succeeded', error: null }),
      );
    });

    it('markLive stamps live eligible ready outputs not stamped within the hour', async () => {
      catalogue(LIVE);
      const h = harness({
        rows: [
          clipRow({ assetId: asset(7), hls: readyHls(asset(7)) }),
          clipRow({
            assetId: asset(8),
            hls: readyHls(asset(8)),
            asset: { moderationStatus: MediaAssetModerationStatus.blocked },
          }),
        ],
      });
      jest.useFakeTimers({
        now: NOW.getTime(),
        doNotFake: ['nextTick', 'setImmediate'],
      });

      await h.service.runCycle('schedule');

      expect(h.prisma.mediaObjectPlacement.updateMany).toHaveBeenCalledWith({
        where: {
          assetId: { in: [asset(7)] },
          role: 'primary',
          storageProvider: 'aliyun_oss',
          status: 'active',
          deletedAt: null,
          variant: {
            is: { variantKey: 'hls', status: 'ready', deletedAt: null },
          },
          OR: [
            { lastVerifiedAt: null },
            {
              lastVerifiedAt: { lt: new Date(NOW.getTime() - LIVE_REFRESH_MS) },
            },
          ],
        },
        data: { lastVerifiedAt: NOW },
      });
      expect(h.order).toEqual(['markLive', 'expire']);
    });

    it('expires outputs unstamped for 25 h that no IP work plays and nothing is busy with', async () => {
      catalogue(LIVE);
      const h = harness();
      jest.useFakeTimers({
        now: NOW.getTime(),
        doNotFake: ['nextTick', 'setImmediate'],
      });

      await h.service.runCycle('schedule');

      const findMany = h.prisma.mediaAssetVariant.findMany.mock
        .calls[0] as unknown as [Record<string, unknown>];
      expect(findMany[0]).toEqual(
        expect.objectContaining({ orderBy: { createdAt: 'asc' }, take: 20 }),
      );
      expect(findMany[0].where).toEqual({
        kind: 'stream',
        variantKey: 'hls',
        status: 'ready',
        deletedAt: null,
        placements: {
          some: {
            role: 'primary',
            status: 'active',
            deletedAt: null,
            storageProvider: 'aliyun_oss',
            lastVerifiedAt: { lt: new Date(NOW.getTime() - EXPIRE_AFTER_MS) },
          },
        },
        asset: {
          is: {
            ipEpisodeMedia: { none: {} },
            ipEpisodeTrailers: { none: {} },
            ipTrailers: { none: {} },
            ipDiscoveryTrailerMedia: { none: {} },
            processingJobs: {
              none: {
                jobType: 'hls_stream',
                status: { in: ['pending', 'processing'] },
              },
            },
            moderationActions: {
              none: {
                actionType: 'delete_object',
                status: { in: ['pending', 'failed'] },
                metadata: { path: ['scope'], equals: 'hls_prefix' },
              },
            },
          },
        },
      });
      expect(EXPIRE_AFTER_MS).toBe(25 * 60 * 60_000);
    });

    it('retires an expired output in one transaction: re-check, CAS off ready, then the takedown', async () => {
      catalogue(LIVE);
      const h = harness({ expired: [{ id: 'hls-gone', assetId: asset(90) }] });

      const result = await h.service.runCycle('schedule');

      expect(result.run?.stats.expired).toBe(1);
      expect(whereOf(h.tx.mediaAssetVariant.findFirst)).toEqual(
        expect.objectContaining({ id: 'hls-gone', status: 'ready' }),
      );
      expect(h.tx.mediaAssetVariant.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'hls-gone',
          assetId: asset(90),
          status: { in: ['ready'] },
        },
        data: { status: 'deleted', deletedAt: expect.any(Date) },
      });
      expect(h.tx.mediaModerationAction.create).toHaveBeenCalledWith({
        data: {
          caseId: null,
          assetId: asset(90),
          variantId: 'hls-gone',
          actionType: 'delete_object',
          status: 'pending',
          reason: 'story_playback_lifecycle',
          provider: 'aliyun_oss',
          idempotencyKey: `media-hls-gc:hls-gone:${Date.parse('2026-09-30T00:00:00.000Z')}`,
          metadata: {
            scope: 'hls_prefix',
            origin: 'lifecycle',
            bucket: BUCKET,
            region: 'cn-hangzhou',
            prefix: `hls/${asset(90)}/`,
            // Every key ever published, the retired replica included.
            refreshKeys: [
              `hls/${asset(90)}/master.m3u8`,
              `hls/${asset(90)}/480p-0.ts`,
              `hls/${asset(90)}/480p-1.ts`,
            ],
          },
        },
      });
      const updateOrder =
        h.tx.mediaAssetVariant.updateMany.mock.invocationCallOrder[0];
      const createOrder =
        h.tx.mediaModerationAction.create.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(createOrder);
    });

    it('never retires the output of a clip live and eligible in this cycle', async () => {
      // Loaded while its output was failed (so markLive skipped it), then
      // republished with the clock the failed output kept.
      catalogue(LIVE);
      const h = harness({
        rows: [clipRow({ assetId: asset(90) })],
        expired: [{ id: 'hls-gone', assetId: asset(90) }],
      });

      const result = await h.service.runCycle('schedule');

      expect(result.run?.stats.expired).toBe(0);
      expect(h.tx.mediaAssetVariant.findFirst).not.toHaveBeenCalled();
      expect(h.tx.mediaModerationAction.create).not.toHaveBeenCalled();
    });

    it('skips an output that stopped qualifying or lost the CAS', async () => {
      catalogue(LIVE);
      const raced = harness({
        expired: [{ id: 'hls-gone', assetId: asset(90) }],
        current: null,
      });
      await raced.service.runCycle('schedule');
      expect(raced.tx.mediaAssetVariant.updateMany).not.toHaveBeenCalled();

      catalogue(LIVE);
      const republished = harness({
        expired: [{ id: 'hls-gone', assetId: asset(90) }],
        retired: 0,
      });
      const result = await republished.service.runCycle('schedule');
      expect(
        republished.tx.mediaModerationAction.create,
      ).not.toHaveBeenCalled();
      expect(result.run?.stats.expired).toBe(0);
    });

    it('stops writing once the cycle deadline passes', async () => {
      jest.useFakeTimers({
        now: NOW.getTime(),
        doNotFake: ['nextTick', 'setImmediate'],
      });
      jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
        jest.setSystemTime(NOW.getTime() + 151_000);
        return Promise.resolve(Response.json({ code: 200, data: LIVE }));
      });
      const h = harness({ rows: [clipRow({ assetId: asset(1) })] });

      const result = await h.service.runCycle('schedule');

      expect(result.run).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'cycle deadline exceeded during catalogue page 2',
        }),
      );
      expect(
        h.prisma.storyExperienceGameRelease.findMany,
      ).not.toHaveBeenCalled();
      expect(h.order).toEqual([]);
    });

    it('records the first error verbatim and counts the rest', async () => {
      catalogue(LIVE);
      const h = harness({
        rows: [
          clipRow({ assetId: asset(1), rank: 1000 }),
          clipRow({ assetId: asset(2), rank: 1001 }),
          clipRow({ assetId: asset(7), rank: 1002, hls: readyHls(asset(7)) }),
        ],
      });
      h.media.enqueueJob
        .mockRejectedValueOnce(new Error('first failure'))
        .mockRejectedValueOnce(new Error('second failure'));

      const result = await h.service.runCycle('schedule');

      expect(result.run?.error).toBe(
        `enqueue ${asset(1)}: first failure (+1 more)`,
      );
      // A per-clip failure does not stop the liveness bookkeeping.
      expect(h.order).toEqual(['markLive', 'expire']);
    });
  });

  describe('heartbeat', () => {
    it('advances lastSucceededAt only on success', async () => {
      catalogue(LIVE);
      const h = harness();

      const result = await h.service.runCycle('schedule');

      expect(StoryPlaybackReconcileRunSchema.parse(result.run)).toEqual(
        result.run,
      );
      expect(h.redis.hset).toHaveBeenCalledWith(STATE_KEY, {
        lastRun: JSON.stringify(result.run),
        lastSucceededAt: result.run?.finishedAt,
      });
    });

    it('a heartbeat write failure does not change the run', async () => {
      catalogue(LIVE);
      const h = harness();
      h.redis.hset.mockRejectedValue(new Error('READONLY'));

      const result = await h.service.runCycle('schedule');

      expect(result.run?.status).toBe('succeeded');
    });

    it('reads the state back', async () => {
      const h = harness();
      const lastRun = {
        status: 'succeeded',
        startedAt: '2026-10-02T00:00:00.000Z',
        finishedAt: '2026-10-02T00:00:03.000Z',
        error: null,
        stats: {
          cataloguePages: 1,
          catalogueGames: 3,
          enqueued: 2,
          expired: 0,
        },
      };
      h.redis.hgetall.mockResolvedValue({
        lastRun: JSON.stringify(lastRun),
        lastSucceededAt: lastRun.finishedAt,
      });

      await expect(h.service.readState()).resolves.toEqual({
        state: { lastRun, lastSucceededAt: lastRun.finishedAt },
        error: null,
      });
    });

    it('time-boxes the read to 2 s and reports why', async () => {
      jest.useFakeTimers();
      const h = harness();
      h.redis.hgetall.mockReturnValue(new Promise(() => undefined));

      const pending = h.service.readState();
      await jest.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toEqual({
        state: null,
        error: `Redis HGETALL ${STATE_KEY} timed out after 2000ms`,
      });
    });
  });

  describe('boot', () => {
    it('is a no-op off the cn cell', () => {
      const setInterval = jest.spyOn(globalThis, 'setInterval');
      const h = harness();

      h.service.onApplicationBootstrap();

      expect(h.imm.assertConfigured).not.toHaveBeenCalled();
      expect(setInterval).not.toHaveBeenCalled();
    });

    it('refuses to boot on cn without the IMM, CDN and public-URL configuration', () => {
      jest.mocked(hasFeature).mockReturnValue(true);
      const previous = process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
      delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
      const h = harness();
      h.imm.assertConfigured.mockImplementation(() => {
        throw new Error('story playback HLS requires: IMM_REGION');
      });
      h.cdn.assertAliyunRefreshConfigured.mockImplementation(() => {
        throw new Error(
          'story playback HLS requires: MEDIA_CDN_PURGE_MODE=aliyun',
        );
      });
      try {
        expect(() => h.service.onApplicationBootstrap()).toThrow(
          'story playback HLS requires: IMM_REGION; story playback HLS requires: MEDIA_CDN_PURGE_MODE=aliyun; story playback HLS requires: MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS',
        );
      } finally {
        if (previous !== undefined)
          process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = previous;
      }
    });

    it('schedules the cycle on cn and stops it on shutdown', async () => {
      jest.mocked(hasFeature).mockReturnValue(true);
      process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS =
        'https://media.fizzspace.cn';
      const setInterval = jest.spyOn(globalThis, 'setInterval');
      const clearInterval = jest.spyOn(globalThis, 'clearInterval');
      const h = harness();
      try {
        h.service.onApplicationBootstrap();
        expect(h.imm.assertConfigured).toHaveBeenCalledWith(
          'story playback HLS',
        );
        expect(setInterval).toHaveBeenCalledWith(
          expect.any(Function),
          INTERVAL_MS,
        );
        await h.service.onModuleDestroy();
        expect(clearInterval).toHaveBeenCalled();
      } finally {
        delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
      }
    });
  });
});

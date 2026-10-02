/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- introspecting untyped jest mock.calls payloads */
import {
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaProcessingJobStatus,
  MediaStorageProvider,
} from '@prisma/client';
import { MediaTakedownWorkerService } from './media-takedown-worker.service';

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    assetId: 'asset-1',
    placementId: null,
    actionType: MediaModerationActionType.restrict_visibility,
    status: MediaModerationActionStatus.pending,
    metadata: { direction: 'restrict' },
    attempt: 0,
    ...overrides,
  };
}

function makeHarness(opts: {
  claimed: ReturnType<typeof action>[];
  asset?: Record<string, unknown> | null;
  placement?: Record<string, unknown> | null;
  /** Rows affected by the guarded terminal updateMany (1 = live, 0 = superseded). */
  terminalCount?: number;
  storage?: {
    restrictObject?: jest.Mock;
    restoreObject?: jest.Mock;
  } | null;
}) {
  const assetUpdate = jest.fn().mockResolvedValue({});
  const placementUpdate = jest.fn().mockResolvedValue({});
  // Both claim-lock and terminal writes go through updateMany; terminal returns
  // the configured affected-row count to exercise the superseded path.
  const actionUpdateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.terminalCount ?? 1 });
  let claimPhase = 0;
  const prisma = {
    mediaModerationAction: {
      findMany: jest.fn().mockImplementation(() => {
        const index = Math.floor(claimPhase / 2);
        const candidates = claimPhase % 2 === 0;
        claimPhase += 1;
        const row = opts.claimed[index];
        return Promise.resolve(
          row ? (candidates ? [{ id: row.id }] : [row]) : [],
        );
      }),
      updateMany: actionUpdateMany,
    },
    mediaAsset: {
      findUnique: jest.fn().mockResolvedValue(opts.asset ?? null),
      update: assetUpdate,
    },
    mediaObjectPlacement: {
      findUnique: jest.fn().mockResolvedValue(opts.placement ?? null),
      update: placementUpdate,
    },
    // complete()/fail() run inside a transaction; the tx exposes the terminal +
    // target mocks (an explicit literal, not `prisma`, to avoid a self-reference
    // that would erase the object's inferred type).
    $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(
        cb({
          mediaModerationAction: { updateMany: actionUpdateMany },
          mediaAsset: { update: assetUpdate },
          mediaObjectPlacement: { update: placementUpdate },
        }),
      ),
    ),
  };
  const storage =
    opts.storage === null
      ? null
      : {
          restrictObject:
            opts.storage?.restrictObject ??
            jest.fn().mockResolvedValue({
              bucket: 'b',
              storageKey: 'k',
              relocated: false,
            }),
          restoreObject:
            opts.storage?.restoreObject ??
            jest.fn().mockResolvedValue({
              bucket: 'b',
              storageKey: 'k',
              relocated: false,
            }),
        };
  const registry = { forProvider: jest.fn().mockReturnValue(storage) };
  const service = new MediaTakedownWorkerService(
    prisma as never,
    registry as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    service,
    prisma,
    registry,
    storage,
    actionUpdateMany,
    assetUpdate,
    placementUpdate,
  };
}

function terminalData(mock: jest.Mock): Record<string, unknown> | undefined {
  // The claim-lock updateMany sets { lockedAt, lockedBy }; the terminal one sets
  // a status. Return the first call whose data carries a terminal status.
  const call = mock.mock.calls.find(
    (c) =>
      (c[0] as { data?: { status?: unknown } })?.data?.status ===
        MediaModerationActionStatus.completed ||
      (c[0] as { data?: { status?: unknown } })?.data?.status ===
        MediaModerationActionStatus.failed,
  );
  return call ? (call[0] as { data: Record<string, unknown> }).data : undefined;
}

describe('MediaTakedownWorkerService', () => {
  it('restricts an asset-level OSS object in place and completes atomically', async () => {
    const h = makeHarness({
      claimed: [action()],
      asset: {
        id: 'asset-1',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'bucket',
        region: 'cn-hangzhou',
        objectKey: 'a/0.png',
        metadata: {},
      },
    });
    await h.service.drainOnce();

    expect(h.storage!.restrictObject).toHaveBeenCalledWith({
      bucket: 'bucket',
      storageKey: 'a/0.png',
      region: 'cn-hangzhou',
    });
    expect(h.assetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'asset-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({ moderationRestricted: true }),
        }),
      }),
    );
    expect(terminalData(h.actionUpdateMany)?.status).toBe(
      MediaModerationActionStatus.completed,
    );
  });

  it('restricts an HLS rendition placement object (playlist/segment) in place', async () => {
    const h = makeHarness({
      claimed: [action({ placementId: 'placement-hls-2' })],
      placement: {
        id: 'placement-hls-2',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'bucket',
        region: 'cn-hangzhou',
        objectKey: 'hls/asset-1/480p-0.ts',
        metadata: {},
      },
    });
    await h.service.drainOnce();

    expect(h.storage!.restrictObject).toHaveBeenCalledWith({
      bucket: 'bucket',
      storageKey: 'hls/asset-1/480p-0.ts',
      region: 'cn-hangzhou',
    });
    expect(h.placementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'placement-hls-2' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({ moderationRestricted: true }),
        }),
      }),
    );
    expect(h.assetUpdate).not.toHaveBeenCalled();
    expect(terminalData(h.actionUpdateMany)?.status).toBe(
      MediaModerationActionStatus.completed,
    );
  });

  it('restores an HLS rendition placement object symmetrically', async () => {
    const h = makeHarness({
      claimed: [
        action({
          placementId: 'placement-hls-1',
          metadata: { direction: 'restore' },
        }),
      ],
      placement: {
        id: 'placement-hls-1',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'bucket',
        region: 'cn-hangzhou',
        objectKey: 'hls/asset-1/480p.m3u8',
        metadata: { moderationRestricted: true },
      },
    });
    await h.service.drainOnce();

    expect(h.storage!.restoreObject).toHaveBeenCalledWith(
      {
        bucket: 'bucket',
        storageKey: 'hls/asset-1/480p.m3u8',
        region: 'cn-hangzhou',
      },
      {
        bucket: 'bucket',
        storageKey: 'hls/asset-1/480p.m3u8',
        region: 'cn-hangzhou',
      },
    );
    expect(h.placementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'placement-hls-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            moderationRestricted: false,
            quarantine: null,
          }),
        }),
      }),
    );
    expect(terminalData(h.actionUpdateMany)?.status).toBe(
      MediaModerationActionStatus.completed,
    );
  });

  it('records the original location when Azure relocates to quarantine', async () => {
    const h = makeHarness({
      claimed: [action()],
      asset: {
        id: 'asset-1',
        storageProvider: MediaStorageProvider.azure_blob,
        bucket: 'media',
        region: null,
        objectKey: 'a/0.png',
        metadata: {},
      },
      storage: {
        restrictObject: jest.fn().mockResolvedValue({
          bucket: 'media-quarantine',
          storageKey: 'a/0.png',
          relocated: true,
        }),
      },
    });
    await h.service.drainOnce();

    expect(h.assetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bucket: 'media-quarantine',
          objectKey: 'a/0.png',
          metadata: expect.objectContaining({
            moderationRestricted: true,
            quarantine: { originalBucket: 'media', originalKey: 'a/0.png' },
          }),
        }),
      }),
    );
  });

  it('does NOT touch target state when the action was superseded (count 0)', async () => {
    const h = makeHarness({
      terminalCount: 0,
      claimed: [action()],
      asset: {
        id: 'asset-1',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'bucket',
        region: null,
        objectKey: 'a/0.png',
        metadata: {},
      },
    });
    await h.service.drainOnce();

    // Storage op ran (idempotent), but the guarded terminal affected 0 rows so
    // the target row must NOT be mutated with contradictory state.
    expect(h.storage!.restrictObject).toHaveBeenCalled();
    expect(h.assetUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent: skips an already-restricted object without calling storage', async () => {
    const h = makeHarness({
      claimed: [action()],
      asset: {
        id: 'asset-1',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'bucket',
        region: null,
        objectKey: 'a/0.png',
        metadata: { moderationRestricted: true },
      },
    });
    await h.service.drainOnce();

    expect(h.storage!.restrictObject).not.toHaveBeenCalled();
    expect(h.assetUpdate).not.toHaveBeenCalled();
    expect(terminalData(h.actionUpdateMany)?.status).toBe(
      MediaModerationActionStatus.completed,
    );
  });

  it('restores by copying back to the recorded original location', async () => {
    const h = makeHarness({
      claimed: [action({ metadata: { direction: 'restore' } })],
      asset: {
        id: 'asset-1',
        storageProvider: MediaStorageProvider.azure_blob,
        bucket: 'media-quarantine',
        region: null,
        objectKey: 'a/0.png',
        metadata: {
          moderationRestricted: true,
          quarantine: { originalBucket: 'media', originalKey: 'a/0.png' },
        },
      },
      storage: {
        restoreObject: jest.fn().mockResolvedValue({
          bucket: 'media',
          storageKey: 'a/0.png',
          relocated: true,
        }),
      },
    });
    await h.service.drainOnce();

    expect(h.storage!.restoreObject).toHaveBeenCalledWith(
      { bucket: 'media-quarantine', storageKey: 'a/0.png', region: null },
      { bucket: 'media', storageKey: 'a/0.png', region: null },
    );
    expect(h.assetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bucket: 'media',
          objectKey: 'a/0.png',
          metadata: expect.objectContaining({
            moderationRestricted: false,
            quarantine: null,
          }),
        }),
      }),
    );
  });

  it('marks completed (no retry) when the provider has no controllable object', async () => {
    const h = makeHarness({
      claimed: [action()],
      asset: {
        id: 'asset-1',
        storageProvider: MediaStorageProvider.external_url,
        bucket: null,
        region: null,
        objectKey: 'x',
        metadata: {},
      },
      storage: null,
    });
    await h.service.drainOnce();

    expect(terminalData(h.actionUpdateMany)?.status).toBe(
      MediaModerationActionStatus.completed,
    );
  });

  it('fails with a retry when storage throws', async () => {
    const h = makeHarness({
      claimed: [action()],
      asset: {
        id: 'asset-1',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'bucket',
        region: null,
        objectKey: 'a/0.png',
        metadata: {},
      },
      storage: {
        restrictObject: jest.fn().mockRejectedValue(new Error('oss down')),
      },
    });
    await h.service.drainOnce();

    const data = terminalData(h.actionUpdateMany);
    expect(data?.status).toBe(MediaModerationActionStatus.failed);
    expect(data?.errorMessage).toBe('oss down');
    expect(data?.nextAttemptAt).toEqual(expect.any(Date));
  });
});

describe('MediaTakedownWorkerService — HLS prefix takedown', () => {
  const ASSET_ID = '019f60f4-b101-70d4-8000-00000000b001';
  const PREFIX = `hls/${ASSET_ID}/`;
  const keys = (count: number) =>
    Array.from({ length: count }, (_, index) => `${PREFIX}480p-${index}.ts`);

  function hlsAction(
    overrides: Record<string, unknown> = {},
    metadata: Record<string, unknown> = {},
  ) {
    return {
      id: 'hls-action',
      assetId: ASSET_ID,
      variantId: 'hls-variant',
      placementId: null,
      actionType: MediaModerationActionType.delete_object,
      status: MediaModerationActionStatus.pending,
      attempt: 0,
      lockedAt: null,
      metadata: {
        scope: 'hls_prefix',
        origin: 'moderation',
        bucket: 'fizzdragon-ai-outputs',
        region: 'cn-hangzhou',
        prefix: PREFIX,
        refreshKeys: keys(2),
        ...metadata,
      },
      ...overrides,
    };
  }

  type Write = {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };

  function hlsHarness(opts: {
    row: ReturnType<typeof hlsAction>;
    asset?: Record<string, unknown> | null;
    job?: Record<string, unknown> | null;
    deletion?: jest.Mock;
    refresh?: jest.Mock;
    /** Rows matched by guarded writes after the claim (0 = lease lost). */
    leaseCount?: number;
    /** Rows matched by the variant CAS of the completion. */
    variantCount?: number;
  }) {
    const events: string[] = [];
    const writes: Write[] = [];
    const actionUpdateMany = jest.fn((args: Write) => {
      writes.push(args);
      if ('lockedBy' in args.data && args.data.lockedBy !== null) {
        return Promise.resolve({ count: 1 }); // the claim itself
      }
      if (args.data.status === MediaModerationActionStatus.completed) {
        events.push('complete');
      }
      return Promise.resolve({ count: opts.leaseCount ?? 1 });
    });
    const variantUpdateMany = jest
      .fn()
      .mockResolvedValue({ count: opts.variantCount ?? 1 });
    const placementUpdateMany = jest.fn().mockResolvedValue({ count: 4 });
    const jobDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      mediaModerationAction: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: opts.row.id }])
          .mockResolvedValueOnce([opts.row])
          .mockResolvedValue([]),
        updateMany: actionUpdateMany,
      },
      mediaAsset: {
        findUnique: jest.fn().mockResolvedValue(
          opts.asset === undefined
            ? {
                id: ASSET_ID,
                bucket: 'fizzdragon-ai-outputs',
                objectKey: 'media/cn/clip.mp4',
              }
            : opts.asset,
        ),
      },
      mediaProcessingJob: {
        findUnique: jest.fn().mockResolvedValue(opts.job ?? null),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        Promise.resolve(
          cb({
            mediaModerationAction: { updateMany: actionUpdateMany },
            mediaAssetVariant: { updateMany: variantUpdateMany },
            mediaObjectPlacement: { updateMany: placementUpdateMany },
            mediaProcessingJob: { deleteMany: jobDeleteMany },
          }),
        ),
      ),
    };
    const deleteHlsOutput =
      opts.deletion ??
      jest.fn().mockResolvedValue({ deleted: 121, complete: true });
    const refreshFiles =
      opts.refresh ?? jest.fn().mockResolvedValue('refresh-task');
    const imm = {
      deleteHlsOutput: jest.fn((...args: unknown[]) => {
        events.push('delete');
        return deleteHlsOutput(...args) as unknown;
      }),
    };
    const cdn = {
      refreshFiles: jest.fn((...args: unknown[]) => {
        events.push('refresh');
        return refreshFiles(...args) as unknown;
      }),
    };
    const urls = {
      resolvePlacement: jest.fn(
        (placement: { objectKey: string }) =>
          `https://media.fizzspace.cn/${placement.objectKey}`,
      ),
    };
    const service = new MediaTakedownWorkerService(
      prisma as never,
      { forProvider: jest.fn() } as never,
      imm as never,
      cdn as never,
      urls as never,
    );
    const statusWrite = (status: MediaModerationActionStatus) =>
      writes.find((write) => write.data.status === status)?.data;
    const lastMetadata = () =>
      [...writes].reverse().find((write) => write.data.metadata)?.data
        .metadata as Record<string, unknown> | undefined;
    return {
      service,
      prisma,
      imm,
      cdn,
      events,
      writes,
      statusWrite,
      lastMetadata,
      variantUpdateMany,
      placementUpdateMany,
      jobDeleteMany,
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('deletes the prefix, then refreshes the published keys, then completes', async () => {
    const h = hlsHarness({ row: hlsAction() });

    await h.service.drainOnce();

    expect(h.events).toEqual(['delete', 'refresh', 'complete']);
    expect(h.imm.deleteHlsOutput).toHaveBeenCalledWith(
      ASSET_ID,
      'fizzdragon-ai-outputs',
      expect.any(Number),
    );
    expect(h.cdn.refreshFiles).toHaveBeenCalledWith(
      keys(2).map((key) => `https://media.fizzspace.cn/${key}`),
    );
    const completed = h.statusWrite(MediaModerationActionStatus.completed);
    expect(completed?.metadata).toEqual(
      expect.objectContaining({
        passes: 1,
        deletedObjects: 121,
        refreshedChunks: 1,
        cdnRefreshTaskIds: ['refresh-task'],
        cdnRefreshedAt: expect.any(String),
        takedownResult: {
          deletedObjects: 121,
          cdnRefreshTaskIds: ['refresh-task'],
          passes: 1,
        },
      }),
    );
    expect(h.variantUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'hls-variant',
        assetId: ASSET_ID,
        status: {
          in: [
            MediaAssetVariantStatus.blocked,
            MediaAssetVariantStatus.deleted,
            MediaAssetVariantStatus.failed,
          ],
        },
      },
      data: {
        status: MediaAssetVariantStatus.deleted,
        deletedAt: expect.any(Date),
      },
    });
    expect(h.jobDeleteMany).toHaveBeenCalled();
  });

  it('skips the CDN refresh when nothing was ever published', async () => {
    const h = hlsHarness({
      row: hlsAction({ variantId: null }, { refreshKeys: [] }),
    });

    await h.service.drainOnce();

    expect(h.events).toEqual(['delete', 'complete']);
    expect(h.variantUpdateMany).not.toHaveBeenCalled();
  });

  it('never retires a variant a newer publish made ready again', async () => {
    const h = hlsHarness({ row: hlsAction(), variantCount: 0 });

    await h.service.drainOnce();

    expect(h.statusWrite(MediaModerationActionStatus.completed)).toBeDefined();
    const where = (
      h.variantUpdateMany.mock.calls[0] as [
        { where: { status: { in: string[] } } },
      ]
    )[0].where;
    expect(where.status.in).not.toContain(MediaAssetVariantStatus.ready);
    expect(h.placementUpdateMany).not.toHaveBeenCalled();
    expect(h.jobDeleteMany).not.toHaveBeenCalled();
  });

  it('keeps finished refresh chunks across a failure and resumes after them', async () => {
    const refresh = jest
      .fn()
      .mockResolvedValueOnce('chunk-1')
      .mockRejectedValueOnce(
        new Error(
          'Aliyun CDN RefreshObjectCaches failed: Throttling: Request was denied due to request throttling.',
        ),
      );
    const first = hlsHarness({
      row: hlsAction({}, { refreshKeys: keys(150) }),
      refresh,
    });

    await first.service.drainOnce();

    expect(first.cdn.refreshFiles).toHaveBeenCalledTimes(2);
    const failed = first.statusWrite(MediaModerationActionStatus.failed);
    expect(failed?.errorMessage).toBe(
      'Aliyun CDN RefreshObjectCaches failed: Throttling: Request was denied due to request throttling.',
    );
    const progress = first.lastMetadata();
    expect(progress).toEqual(
      expect.objectContaining({
        refreshedChunks: 1,
        cdnRefreshTaskIds: ['chunk-1'],
      }),
    );
    expect(progress).not.toHaveProperty('cdnRefreshedAt');

    const second = hlsHarness({
      row: hlsAction({ attempt: 1 }, progress),
      refresh: jest.fn().mockResolvedValue('chunk-2'),
    });

    await second.service.drainOnce();

    expect(second.cdn.refreshFiles).toHaveBeenCalledTimes(1);
    expect(second.cdn.refreshFiles).toHaveBeenCalledWith(
      keys(150)
        .slice(100)
        .map((key) => `https://media.fizzspace.cn/${key}`),
    );
    expect(
      second.statusWrite(MediaModerationActionStatus.completed)?.metadata,
    ).toEqual(
      expect.objectContaining({
        refreshedChunks: 2,
        cdnRefreshTaskIds: ['chunk-1', 'chunk-2'],
      }),
    );
  });

  it('defers when the OSS budget runs out before the prefix is empty', async () => {
    const h = hlsHarness({
      row: hlsAction(),
      deletion: jest.fn().mockResolvedValue({ deleted: 1000, complete: false }),
    });

    await h.service.drainOnce();

    expect(h.cdn.refreshFiles).not.toHaveBeenCalled();
    const deferred = h.statusWrite(MediaModerationActionStatus.pending);
    expect(deferred).toEqual(
      expect.objectContaining({
        errorMessage: null,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: expect.any(Date),
      }),
    );
    expect(deferred).not.toHaveProperty('attempt');
    expect(h.lastMetadata()).toEqual(
      expect.objectContaining({ passes: 1, deletedObjects: 1000 }),
    );
    expect(
      h.statusWrite(MediaModerationActionStatus.completed),
    ).toBeUndefined();
  });

  it('defers between CDN chunks once the pass budget is spent', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-02T00:00:00.000Z') });
    const h = hlsHarness({
      row: hlsAction({}, { refreshKeys: keys(150) }),
      deletion: jest.fn(() => {
        jest.setSystemTime(Date.parse('2026-10-02T00:01:20.000Z'));
        return Promise.resolve({ deleted: 3, complete: true });
      }),
    });

    await h.service.drainOnce();

    expect(h.cdn.refreshFiles).not.toHaveBeenCalled();
    expect(h.statusWrite(MediaModerationActionStatus.pending)).toBeDefined();
    expect(
      h.statusWrite(MediaModerationActionStatus.completed),
    ).toBeUndefined();
  });

  it.each([
    ['processing', { status: MediaProcessingJobStatus.processing, output: {} }],
    [
      'pending with a live task',
      {
        status: MediaProcessingJobStatus.pending,
        output: { immTaskId: 'task', submittedAt: new Date().toISOString() },
      },
    ],
    [
      'failed with a live task',
      {
        status: MediaProcessingJobStatus.failed,
        output: { immTaskId: 'task', submittedAt: new Date().toISOString() },
      },
    ],
    [
      'dead within 2x IMM_MAX_MINUTES of submit',
      {
        status: MediaProcessingJobStatus.dead,
        output: { immTaskId: 'task', submittedAt: new Date().toISOString() },
      },
    ],
  ])(
    'waits while a transcode can still write (%s), without consuming an attempt',
    async (_label, job) => {
      const h = hlsHarness({ row: hlsAction(), job: { id: 'job-1', ...job } });

      await h.service.drainOnce();

      expect(h.events).toEqual(['delete', 'refresh']);
      expect(h.lastMetadata()).toEqual(
        expect.objectContaining({ waitingForJobId: 'job-1' }),
      );
      const deferred = h.statusWrite(MediaModerationActionStatus.pending);
      expect(deferred).toBeDefined();
      expect(deferred).not.toHaveProperty('attempt');
      const delay = (deferred!.nextAttemptAt as Date).getTime() - Date.now();
      expect(delay).toBeGreaterThan(55_000);
      expect(
        h.statusWrite(MediaModerationActionStatus.completed),
      ).toBeUndefined();
    },
  );

  it('refreshes once more after the transcode it waited for has stopped', async () => {
    const h = hlsHarness({
      row: hlsAction(
        {},
        {
          passes: 3,
          deletedObjects: 40,
          refreshedChunks: 1,
          cdnRefreshTaskIds: ['first'],
          cdnRefreshedAt: '2026-10-02T00:00:00.000Z',
          waitingForJobId: 'job-1',
        },
      ),
      job: {
        id: 'job-1',
        status: MediaProcessingJobStatus.cancelled,
        output: { immTaskId: 'task' },
      },
      refresh: jest.fn().mockResolvedValue('second'),
    });

    await h.service.drainOnce();

    expect(h.events).toEqual(['delete', 'refresh', 'complete']);
    expect(
      h.statusWrite(MediaModerationActionStatus.completed)?.metadata,
    ).toEqual(
      expect.objectContaining({
        waitingForJobId: null,
        passes: 4,
        cdnRefreshTaskIds: ['first', 'second'],
      }),
    );
  });

  it('never dead-letters: the 8th failure still retries, capped at 30 min, error verbatim', async () => {
    const h = hlsHarness({
      row: hlsAction({ attempt: 7 }),
      deletion: jest
        .fn()
        .mockRejectedValue(new Error('AccessDenied: ListObjects')),
    });

    await h.service.drainOnce();

    const failed = h.statusWrite(MediaModerationActionStatus.failed);
    expect(failed).toEqual(
      expect.objectContaining({
        attempt: 8,
        errorMessage: 'AccessDenied: ListObjects',
        deadAt: null,
        nextAttemptAt: expect.any(Date),
      }),
    );
    const delay = (failed!.nextAttemptAt as Date).getTime() - Date.now();
    expect(delay).toBeGreaterThan(29 * 60_000);
    expect(delay).toBeLessThanOrEqual(30 * 60_000);
  });

  it('stops without touching anything once the lease is lost (superseded/cancelled)', async () => {
    const h = hlsHarness({ row: hlsAction(), leaseCount: 0 });

    await h.service.drainOnce();

    // The first progress write found no row: no refresh, no completion, and
    // no failure write either.
    expect(h.events).toEqual(['delete']);
    expect(h.variantUpdateMany).not.toHaveBeenCalled();
    expect(h.statusWrite(MediaModerationActionStatus.failed)).toBeUndefined();
  });

  it('does not retire anything when the terminal write is superseded', async () => {
    const h = hlsHarness({
      row: hlsAction({}, { refreshKeys: [] }),
    });
    h.prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      Promise.resolve(
        cb({
          mediaModerationAction: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          mediaAssetVariant: { updateMany: h.variantUpdateMany },
          mediaObjectPlacement: { updateMany: h.placementUpdateMany },
          mediaProcessingJob: { deleteMany: h.jobDeleteMany },
        }),
      ),
    );

    await h.service.drainOnce();

    expect(h.variantUpdateMany).not.toHaveBeenCalled();
  });

  it('completes an unknown delete_object scope as skipped', async () => {
    const h = hlsHarness({
      row: hlsAction({ metadata: { scope: 'something_else' } }),
    });

    await h.service.drainOnce();

    expect(h.imm.deleteHlsOutput).not.toHaveBeenCalled();
    expect(
      h.statusWrite(MediaModerationActionStatus.completed)?.metadata,
    ).toEqual(
      expect.objectContaining({ takedownResult: { skipped: 'unknown_scope' } }),
    );
  });

  it.each([
    ['another asset prefix', {}, { prefix: 'hls/other/' }],
    ['another bucket', {}, { bucket: 'other-bucket' }],
    [
      'a legacy asset that IS the playlist',
      { objectKey: `${PREFIX}master.m3u8` },
      {},
    ],
  ])(
    'fails on metadata that does not match the asset (%s)',
    async (_label, asset, metadata) => {
      const h = hlsHarness({
        row: hlsAction({}, metadata),
        asset: {
          id: ASSET_ID,
          bucket: 'fizzdragon-ai-outputs',
          objectKey: 'media/cn/clip.mp4',
          ...asset,
        },
      });

      await h.service.drainOnce();

      expect(h.imm.deleteHlsOutput).not.toHaveBeenCalled();
      expect(
        h.statusWrite(MediaModerationActionStatus.failed)?.errorMessage,
      ).toEqual(
        expect.stringContaining(
          'HLS prefix takedown metadata does not match the asset',
        ),
      );
    },
  );

  it('claims delete_object alongside restrict_visibility actions', async () => {
    const h = hlsHarness({ row: hlsAction() });

    await h.service.drainOnce();

    const selection = (
      h.prisma.mediaModerationAction.findMany.mock.calls[0] as [
        { where: { actionType: unknown } },
      ]
    )[0].where;
    expect(selection.actionType).toEqual({
      in: [
        MediaModerationActionType.restrict_visibility,
        MediaModerationActionType.delete_object,
      ],
    });
  });
});

import { MediaAssetStatus } from '@prisma/client';
import { CrewAssetUploadCleanupWorker } from './upload-cleanup.worker';

describe('CrewAssetUploadCleanupWorker', () => {
  it.each(['reservation', 'discovery', 'reclaim'] as const)(
    'stops queued cleanup after shutdown during %s while finishing active work',
    async (stage) => {
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pause = async () => {
        entered();
        await waiting;
      };
      const candidates = [{ id: 'first' }, { id: 'second' }];
      const mediaAsset = {
        findMany: jest.fn(async () => {
          if (stage === 'discovery') await pause();
          return candidates;
        }),
      };
      const assets = {
        cleanupUploadReservations: jest.fn(async () => {
          if (stage === 'reservation') await pause();
        }),
        reclaimExpiredPendingUpload: jest.fn(async () => {
          if (stage === 'reclaim') await pause();
          return true;
        }),
      };
      const worker = new CrewAssetUploadCleanupWorker(
        { mediaAsset } as never,
        assets as never,
      );
      const drain = worker.drainOnce();
      await started;
      let shutdownFinished = false;
      const shutdown = worker.onModuleDestroy().then(() => {
        shutdownFinished = true;
      });
      await worker.drainOnce();
      expect(shutdownFinished).toBe(false);
      release();
      await Promise.all([drain, shutdown]);
      expect(assets.cleanupUploadReservations).toHaveBeenCalledTimes(1);
      expect(mediaAsset.findMany).toHaveBeenCalledTimes(
        stage === 'reservation' ? 0 : 1,
      );
      expect(assets.reclaimExpiredPendingUpload).toHaveBeenCalledTimes(
        stage === 'reclaim' ? 1 : 0,
      );
      await worker.drainOnce();
      worker.onApplicationBootstrap();
      expect(assets.cleanupUploadReservations).toHaveBeenCalledTimes(1);
    },
  );

  it('discovers only expired unclaimed crew uploads and reclaims a bounded batch', async () => {
    const mediaAsset = {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'media-1' }, { id: 'media-2' }])
        .mockResolvedValue([]),
    };
    const prisma = { mediaAsset };
    const assets = {
      cleanupUploadReservations: jest.fn().mockResolvedValue(undefined),
      reclaimExpiredPendingUpload: jest.fn().mockResolvedValue(true),
    };
    const worker = new CrewAssetUploadCleanupWorker(
      prisma as never,
      assets as never,
    );
    const now = new Date('2026-07-29T12:00:00.000Z');
    const createdBefore = new Date('2026-07-28T12:00:00.000Z');

    await worker.drainOnce(now);

    expect(mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        status: MediaAssetStatus.ready,
        deletedAt: null,
        createdAt: { lt: createdBefore },
        metadata: {
          path: ['uploadKind'],
          equals: 'crew_asset_file',
        },
        crewAssetNodes: { none: {} },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 50,
    });
    expect(assets.reclaimExpiredPendingUpload).toHaveBeenNthCalledWith(
      1,
      'media-1',
      createdBefore,
    );
    expect(assets.reclaimExpiredPendingUpload).toHaveBeenNthCalledWith(
      2,
      'media-2',
      createdBefore,
    );
  });

  it('retries committed deletions independently of expired pending uploads', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'deleted-1' }, { id: 'deleted-2' }]);
    const assets = {
      cleanupUploadReservations: jest.fn(),
      reclaimExpiredPendingUpload: jest.fn(),
      reclaimDeletedCrewUpload: jest
        .fn()
        .mockRejectedValueOnce(new Error('retry later'))
        .mockResolvedValue(undefined),
    };
    const worker = new CrewAssetUploadCleanupWorker(
      { mediaAsset: { findMany } } as never,
      assets as never,
    );
    await worker.drainOnce();
    expect((findMany.mock.calls as unknown[][]).at(-1)?.[0]).toMatchObject({
      where: {
        status: 'deleted',
        deletedAt: { not: null },
        crewAssetNodes: { none: {} },
      },
      take: 50,
    });
    expect(assets.reclaimDeletedCrewUpload.mock.calls).toEqual([
      ['deleted-1'],
      ['deleted-2'],
    ]);
    expect(assets.reclaimExpiredPendingUpload).not.toHaveBeenCalled();
  });

  it('does not overlap two drains in the same server process', async () => {
    let resolvePending!: (value: Array<{ id: string }>) => void;
    const pending = new Promise<Array<{ id: string }>>((resolve) => {
      resolvePending = resolve;
    });
    const mediaAsset = { findMany: jest.fn().mockReturnValue(pending) };
    const worker = new CrewAssetUploadCleanupWorker(
      { mediaAsset } as never,
      {
        cleanupUploadReservations: jest.fn().mockResolvedValue(undefined),
        reclaimExpiredPendingUpload: jest.fn(),
      } as never,
    );

    const first = worker.drainOnce();
    const second = worker.drainOnce();
    await Promise.resolve();
    expect(mediaAsset.findMany).toHaveBeenCalledTimes(1);
    resolvePending([]);
    await Promise.all([first, second]);
  });
});

describe('cleanup queue fairness', () => {
  it.each(['ready', 'deleted'] as const)(
    'advances past a full failing %s batch and wraps for retry',
    async (status) => {
      const rows = Array.from({ length: 51 }, (_, index) => ({
        id: String(index + 1).padStart(3, '0'),
      }));
      const findMany = jest.fn(
        (query: {
          where: { status: string; id?: { gt: string } };
          take: number;
        }) =>
          Promise.resolve(
            query.where.status === status
              ? rows
                  .filter(
                    (row) => !query.where.id || row.id > query.where.id.gt,
                  )
                  .slice(0, query.take)
              : [],
          ),
      );
      const reclaim = jest.fn((id: string) =>
        id !== '051'
          ? Promise.reject(new Error('Storage temporarily unavailable'))
          : Promise.resolve(),
      );
      const worker = new CrewAssetUploadCleanupWorker(
        { mediaAsset: { findMany } } as never,
        {
          cleanupUploadReservations: jest.fn(),
          reclaimExpiredPendingUpload: status === 'ready' ? reclaim : jest.fn(),
          reclaimDeletedCrewUpload: status === 'deleted' ? reclaim : jest.fn(),
        } as never,
      );
      await worker.drainOnce();
      expect(reclaim).toHaveBeenCalledTimes(50);
      await worker.drainOnce();
      expect(reclaim.mock.calls.map(([id]) => id)).toContain('051');
      expect(reclaim).toHaveBeenCalledTimes(51);
      await worker.drainOnce();
      expect(reclaim.mock.calls[51][0]).toBe('001');
      expect(reclaim).toHaveBeenCalledTimes(101);
    },
  );
});

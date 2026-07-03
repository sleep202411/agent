/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- introspecting untyped jest mock.calls payloads */
import {
  MediaModerationActionStatus,
  MediaModerationActionType,
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
        claimPhase += 1;
        if (claimPhase === 1) {
          return Promise.resolve(opts.claimed.map((a) => ({ id: a.id })));
        }
        return Promise.resolve(opts.claimed);
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

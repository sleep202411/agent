/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- asserting on untyped jest mock.calls payloads */
import {
  AiOutboxEventType,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
} from '@prisma/client';
import { MediaModerationAdminService } from './media-moderation-admin.service';

function updatedAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-7111-9111-111111111111',
    status: MediaAssetStatus.ready,
    moderationStatus: MediaAssetModerationStatus.blocked,
    moderationReason: 'policy',
    workspaceId: null,
    createdByUserId: 'user-1',
    updatedAt: new Date('2026-06-12T12:00:00.000Z'),
    ...overrides,
  };
}

const ASSET_ID = '11111111-1111-7111-9111-111111111111';

describe('MediaModerationAdminService', () => {
  it('blocks: cancels stale actions, queues CDN purge + physical takedown, keeps lifecycle status untouched', async () => {
    const placements = [
      {
        id: 'placement-1',
        status: MediaObjectPlacementStatus.active,
        storageProvider: MediaStorageProvider.azure_blob,
        objectKey: 'a/1.png',
        cdnProvider: 'azure_cdn',
        cdnCacheKey: '/a/1.png',
        publicBaseUrl: null,
        metadata: {},
      },
      {
        id: 'placement-2',
        status: MediaObjectPlacementStatus.active,
        storageProvider: MediaStorageProvider.azure_blob,
        objectKey: 'a/2.png',
        cdnProvider: null,
        cdnCacheKey: null,
        publicBaseUrl: null,
        metadata: {},
      },
    ];
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const placementUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const actionUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const assetUpdate = jest.fn().mockResolvedValue(updatedAsset());
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      mediaAsset: { update: assetUpdate },
      mediaModerationCase: {
        create: jest.fn().mockResolvedValue({ id: 'case-1' }),
      },
      mediaModerationAction: {
        create: jest.fn().mockResolvedValue({ id: 'action-1' }),
        createMany,
        updateMany: actionUpdateMany,
      },
      mediaObjectPlacement: {
        findMany: jest.fn().mockResolvedValue(placements),
        updateMany: placementUpdateMany,
      },
      mediaAssetUsage: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'user-1',
            projectId: '22222222-2222-7222-9222-222222222222',
            sourceSurface: 'fizzstudio-canvas',
          },
        ]),
      },
      aiEventOutbox: {
        create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      },
    };
    const prisma = {
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: ASSET_ID,
          moderationStatus: MediaAssetModerationStatus.approved,
          storageProvider: MediaStorageProvider.azure_blob,
          objectKey: 'a/0.png',
          metadata: {},
        }),
      },
      $transaction: jest.fn((cb: (inner: typeof tx) => unknown) =>
        Promise.resolve(
          cb({ ...tx, mediaAsset: { ...tx.mediaAsset, ...prisma.mediaAsset } }),
        ),
      ),
    };
    const service = new MediaModerationAdminService(prisma as never);

    await service.updateAssetModeration(ASSET_ID, 'admin-1', {
      moderationStatus: MediaAssetModerationStatus.blocked,
      reason: 'policy',
    });

    // Lifecycle status is orthogonal — moderation must NOT force it to ready.
    const updateArg = assetUpdate.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.moderationStatus).toBe(
      MediaAssetModerationStatus.blocked,
    );
    expect(updateArg.data).not.toHaveProperty('status');

    // Stale queued actions cancelled before re-enqueue.
    expect(actionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetId: ASSET_ID,
          actionType: {
            in: [
              MediaModerationActionType.purge_cdn,
              MediaModerationActionType.restrict_visibility,
            ],
          },
        }),
        data: expect.objectContaining({
          status: MediaModerationActionStatus.cancelled,
        }),
      }),
    );

    // CDN purge only for the CDN-surfaced placement.
    expect(placementUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['placement-1'] } },
      data: { status: MediaObjectPlacementStatus.purging },
    });

    // Two createMany calls: purge_cdn (1 row) + takedown restrict (3 objects:
    // asset's own object + both placements).
    const purgeCall = createMany.mock.calls.find(
      (c) =>
        (c[0] as { data: Array<{ actionType: MediaModerationActionType }> })
          .data[0]?.actionType === MediaModerationActionType.purge_cdn,
    );
    expect(purgeCall).toBeDefined();
    expect((purgeCall![0] as { data: unknown[] }).data).toHaveLength(1);

    const takedownCall = createMany.mock.calls.find(
      (c) =>
        (c[0] as { data: Array<{ actionType: MediaModerationActionType }> })
          .data[0]?.actionType ===
        MediaModerationActionType.restrict_visibility,
    );
    expect(takedownCall).toBeDefined();
    const takedownRows = (
      takedownCall![0] as {
        data: Array<{
          placementId: string | null;
          metadata: { direction: string };
        }>;
      }
    ).data;
    expect(takedownRows).toHaveLength(3);
    expect(takedownRows.every((r) => r.metadata.direction === 'restrict')).toBe(
      true,
    );
    expect(takedownRows.map((r) => r.placementId)).toEqual(
      expect.arrayContaining(['placement-1', 'placement-2', null]),
    );

    expect(tx.aiEventOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        eventType: AiOutboxEventType.media_asset_moderation_changed,
        jobId: null,
        payload: expect.objectContaining({
          kind: 'media_asset_moderation_changed',
          action: 'blocked',
        }),
      }),
    });
  });

  it('restores: reactivates only non-deleted placements and queues takedown reversal', async () => {
    const placements = [
      {
        id: 'placement-1',
        status: MediaObjectPlacementStatus.purged,
        storageProvider: MediaStorageProvider.aliyun_oss,
        objectKey: 'a/1.png',
        cdnProvider: null,
        cdnCacheKey: null,
        publicBaseUrl: null,
        metadata: { moderationRestricted: true },
      },
    ];
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const placementUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      mediaAsset: {
        update: jest.fn().mockResolvedValue(
          updatedAsset({
            moderationStatus: MediaAssetModerationStatus.unreviewed,
            moderationReason: null,
          }),
        ),
      },
      mediaModerationCase: {
        create: jest.fn().mockResolvedValue({ id: 'case-restore' }),
      },
      mediaModerationAction: {
        create: jest.fn().mockResolvedValue({ id: 'action-restore' }),
        createMany,
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      mediaObjectPlacement: {
        findMany: jest.fn().mockResolvedValue(placements),
        updateMany: placementUpdateMany,
      },
      mediaAssetUsage: { findMany: jest.fn().mockResolvedValue([]) },
      aiEventOutbox: { create: jest.fn() },
    };
    const prisma = {
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: ASSET_ID,
          moderationStatus: MediaAssetModerationStatus.blocked,
          storageProvider: MediaStorageProvider.aliyun_oss,
          objectKey: 'a/0.png',
          metadata: { moderationRestricted: true },
        }),
      },
      $transaction: jest.fn((cb: (inner: typeof tx) => unknown) =>
        Promise.resolve(
          cb({ ...tx, mediaAsset: { ...tx.mediaAsset, ...prisma.mediaAsset } }),
        ),
      ),
    };
    const service = new MediaModerationAdminService(prisma as never);

    await service.updateAssetModeration(ASSET_ID, 'admin-1', {
      moderationStatus: MediaAssetModerationStatus.unreviewed,
      reason: 'restore',
    });

    // Reactivation is scoped to non-deleted placements (the prior scope bug).
    expect(placementUpdateMany).toHaveBeenCalledWith({
      where: {
        assetId: ASSET_ID,
        deletedAt: null,
        status: {
          in: [
            MediaObjectPlacementStatus.purging,
            MediaObjectPlacementStatus.purged,
          ],
        },
      },
      data: { status: MediaObjectPlacementStatus.active, purgedAt: null },
    });

    // Restore takedown actions for the restricted objects (asset + placement).
    const takedownCall = createMany.mock.calls.find(
      (c) =>
        (c[0] as { data: Array<{ actionType: MediaModerationActionType }> })
          .data[0]?.actionType ===
        MediaModerationActionType.restrict_visibility,
    );
    expect(takedownCall).toBeDefined();
    const rows = (
      takedownCall![0] as {
        data: Array<{ metadata: { direction: string } }>;
      }
    ).data;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.metadata.direction === 'restore')).toBe(true);
  });

  describe('HLS-transcoded asset (master + rendition placements)', () => {
    const HLS_PREFIX = `hls/${ASSET_ID}/`;

    /** Placement ledger an HLS transcode leaves behind: the master playlist
     *  (primary) plus one replica per rendition playlist and segment. */
    function hlsPlacements(metadata: Record<string, unknown> = {}) {
      return [
        `${HLS_PREFIX}master.m3u8`,
        `${HLS_PREFIX}480p.m3u8`,
        `${HLS_PREFIX}480p-0.ts`,
        `${HLS_PREFIX}480p-1.ts`,
      ].map((objectKey, index) => ({
        id: `placement-hls-${index}`,
        status: MediaObjectPlacementStatus.active,
        storageProvider: MediaStorageProvider.aliyun_oss,
        objectKey,
        cdnProvider: null,
        cdnCacheKey: null,
        publicBaseUrl: null,
        metadata,
      }));
    }

    function makeHarness(opts: {
      placements: ReturnType<typeof hlsPlacements>;
      currentModeration: MediaAssetModerationStatus;
    }) {
      const createMany = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        mediaAsset: { update: jest.fn().mockResolvedValue(updatedAsset()) },
        mediaModerationCase: {
          create: jest.fn().mockResolvedValue({ id: 'case-hls' }),
        },
        mediaModerationAction: {
          create: jest.fn().mockResolvedValue({ id: 'action-hls' }),
          createMany,
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        mediaObjectPlacement: {
          findMany: jest.fn().mockResolvedValue(opts.placements),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        mediaAssetUsage: { findMany: jest.fn().mockResolvedValue([]) },
        aiEventOutbox: { create: jest.fn() },
      };
      const prisma = {
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue({
            id: ASSET_ID,
            moderationStatus: opts.currentModeration,
            storageProvider: MediaStorageProvider.aliyun_oss,
            objectKey: 'media/cn/episode-video/34/x.mp4',
            metadata: {},
          }),
        },
        $transaction: jest.fn((cb: (inner: typeof tx) => unknown) =>
          Promise.resolve(
            cb({
              ...tx,
              mediaAsset: { ...tx.mediaAsset, ...prisma.mediaAsset },
            }),
          ),
        ),
      };
      return {
        service: new MediaModerationAdminService(prisma as never),
        createMany,
      };
    }

    function takedownRows(createMany: jest.Mock) {
      const call = createMany.mock.calls.find(
        (c) =>
          (c[0] as { data: Array<{ actionType: MediaModerationActionType }> })
            .data[0]?.actionType ===
          MediaModerationActionType.restrict_visibility,
      );
      expect(call).toBeDefined();
      return (
        call![0] as {
          data: Array<{
            placementId: string | null;
            metadata: { direction: string };
          }>;
        }
      ).data;
    }

    it('block queues a restrict action for EVERY physical HLS object, not just the master', async () => {
      const { service, createMany } = makeHarness({
        placements: hlsPlacements(),
        currentModeration: MediaAssetModerationStatus.approved,
      });

      await service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.blocked,
        reason: 'policy',
      });

      const rows = takedownRows(createMany);
      // Source mp4 (asset object) + master + rendition playlist + 2 segments.
      expect(rows).toHaveLength(5);
      expect(rows.every((r) => r.metadata.direction === 'restrict')).toBe(true);
      expect(rows.map((r) => r.placementId)).toEqual(
        expect.arrayContaining([
          null,
          'placement-hls-0',
          'placement-hls-1',
          'placement-hls-2',
          'placement-hls-3',
        ]),
      );
    });

    it('restore queues a restore action for EVERY physical HLS object symmetrically', async () => {
      const { service, createMany } = makeHarness({
        placements: hlsPlacements({ moderationRestricted: true }),
        currentModeration: MediaAssetModerationStatus.blocked,
      });

      await service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.approved,
        reason: 'appeal upheld',
      });

      const rows = takedownRows(createMany);
      expect(rows).toHaveLength(5);
      expect(rows.every((r) => r.metadata.direction === 'restore')).toBe(true);
      expect(rows.map((r) => r.placementId)).toEqual(
        expect.arrayContaining([
          null,
          'placement-hls-0',
          'placement-hls-1',
          'placement-hls-2',
          'placement-hls-3',
        ]),
      );
    });
  });
});

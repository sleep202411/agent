/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- asserting on untyped jest mock.calls payloads */
import { ConflictException } from '@nestjs/common';
import {
  AiOutboxEventType,
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaObjectPlacementStatus,
  MediaProcessingJobStatus,
  MediaProcessingJobType,
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
    const service = new MediaModerationAdminService(
      prisma as never,
      { enqueueJobTx: jest.fn() } as never,
    );

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
    const service = new MediaModerationAdminService(
      prisma as never,
      { enqueueJobTx: jest.fn() } as never,
    );

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

  describe('HLS-transcoded asset (one prefix takedown, not per object)', () => {
    const HLS_PREFIX = `hls/${ASSET_ID}/`;
    const SOURCE_KEY = 'media/cn/episode-video/34/x.mp4';

    /** Placement ledger a published transcode leaves behind: the master
     *  playlist (primary) plus one replica per rendition playlist and segment,
     *  next to the original mp4 placement. */
    function placements(metadata: Record<string, unknown> = {}) {
      return [
        {
          id: 'placement-original',
          status: MediaObjectPlacementStatus.active,
          storageProvider: MediaStorageProvider.aliyun_oss,
          objectKey: SOURCE_KEY,
          cdnProvider: null,
          cdnCacheKey: null,
          publicBaseUrl: null,
          metadata,
          variant: { variantKey: 'original' },
        },
        ...[
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
          variant: { variantKey: 'hls' },
        })),
      ];
    }

    function makeHarness(opts: {
      currentModeration: MediaAssetModerationStatus;
      objectKey?: string;
      hlsVariant?: {
        id: string;
        status: MediaAssetVariantStatus;
        deletedAt: Date | null;
        placements: Array<{ objectKey: string }>;
      } | null;
      job?: {
        id?: string;
        status: MediaProcessingJobStatus;
        lockedAt: Date | null;
        output?: Record<string, unknown>;
      } | null;
      ipReferenced?: boolean;
      placementMetadata?: Record<string, unknown>;
    }) {
      const createMany = jest.fn().mockResolvedValue({ count: 1 });
      const actionCreate = jest.fn().mockResolvedValue({ id: 'action-hls' });
      const variantUpdate = jest.fn().mockResolvedValue({});
      const actionUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
      const existing = {
        id: ASSET_ID,
        kind: MediaAssetKind.video,
        moderationStatus: opts.currentModeration,
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'fizzdragon-ai-outputs',
        region: 'cn-hangzhou',
        objectKey: opts.objectKey ?? SOURCE_KEY,
        metadata: {},
      };
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
        mediaAsset: {
          update: jest.fn().mockResolvedValue(updatedAsset()),
          findFirst: jest.fn((args: { where: { OR?: unknown } }) =>
            Promise.resolve(
              args.where.OR
                ? opts.ipReferenced
                  ? { id: ASSET_ID }
                  : null
                : existing,
            ),
          ),
        },
        mediaAssetVariant: {
          findUnique: jest.fn().mockResolvedValue(opts.hlsVariant ?? null),
          update: variantUpdate,
        },
        mediaProcessingJob: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              opts.job ? { id: opts.job.id ?? 'job-1', ...opts.job } : null,
            ),
        },
        mediaModerationCase: {
          create: jest.fn().mockResolvedValue({ id: 'case-hls' }),
        },
        mediaModerationAction: {
          create: actionCreate,
          createMany,
          updateMany: actionUpdateMany,
        },
        mediaObjectPlacement: {
          findMany: jest
            .fn()
            .mockResolvedValue(placements(opts.placementMetadata)),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        mediaAssetUsage: { findMany: jest.fn().mockResolvedValue([]) },
        aiEventOutbox: { create: jest.fn() },
      };
      const prisma = {
        $transaction: jest.fn((cb: (inner: typeof tx) => unknown) =>
          Promise.resolve(cb(tx)),
        ),
      };
      const processing = {
        enqueueJobTx: jest.fn().mockResolvedValue({ id: 'job-1' }),
      };
      return {
        service: new MediaModerationAdminService(
          prisma as never,
          processing as never,
        ),
        tx,
        createMany,
        actionCreate,
        variantUpdate,
        actionUpdateMany,
        processing,
      };
    }

    function restrictRows(createMany: jest.Mock) {
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

    function hlsTakedowns(actionCreate: jest.Mock) {
      return actionCreate.mock.calls
        .map((c) => (c[0] as { data: Record<string, unknown> }).data)
        .filter(
          (data) => data.actionType === MediaModerationActionType.delete_object,
        );
    }

    const READY_HLS = {
      id: 'hls-variant',
      status: MediaAssetVariantStatus.ready,
      deletedAt: null,
      placements: [
        { objectKey: `${HLS_PREFIX}master.m3u8` },
        { objectKey: `${HLS_PREFIX}480p.m3u8` },
        { objectKey: `${HLS_PREFIX}480p-0.ts` },
        { objectKey: `${HLS_PREFIX}480p-1.ts` },
      ],
    };

    it('block queues ONE prefix takedown with the published keys and blocks the variant', async () => {
      const h = makeHarness({
        currentModeration: MediaAssetModerationStatus.approved,
        hlsVariant: READY_HLS,
        job: { status: MediaProcessingJobStatus.completed, lockedAt: null },
      });

      await h.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.blocked,
        reason: 'policy',
      });

      expect(h.variantUpdate).toHaveBeenCalledWith({
        where: { id: 'hls-variant' },
        data: { status: MediaAssetVariantStatus.blocked },
      });
      // The ledger is every placement row, retired ones included: a key a
      // degenerate re-run or a shorter re-transcode retired may still be
      // cached on CDN edges.
      expect(h.tx.mediaAssetVariant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            placements: { select: { objectKey: true } },
          }),
        }),
      );
      const takedowns = hlsTakedowns(h.actionCreate);
      expect(takedowns).toEqual([
        {
          caseId: 'case-hls',
          assetId: ASSET_ID,
          variantId: 'hls-variant',
          placementId: null,
          actionType: MediaModerationActionType.delete_object,
          status: MediaModerationActionStatus.pending,
          reason: 'policy',
          actorAdminId: 'admin-1',
          idempotencyKey: 'media-hls-takedown:case-hls',
          provider: MediaStorageProvider.aliyun_oss,
          metadata: {
            scope: 'hls_prefix',
            origin: 'moderation',
            bucket: 'fizzdragon-ai-outputs',
            region: 'cn-hangzhou',
            prefix: HLS_PREFIX,
            refreshKeys: READY_HLS.placements.map((p) => p.objectKey),
          },
        },
      ]);
      // The per-object ACL path keeps the source mp4 (asset + its placement)
      // and never fans out over HLS objects.
      expect(restrictRows(h.createMany).map((r) => r.placementId)).toEqual([
        null,
        'placement-original',
      ]);
    });

    it('block of a transcode still in flight takes the prefix down with nothing to refresh', async () => {
      const h = makeHarness({
        currentModeration: MediaAssetModerationStatus.unreviewed,
        hlsVariant: null,
        job: {
          status: MediaProcessingJobStatus.processing,
          lockedAt: new Date(),
        },
      });

      await h.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.blocked,
      });

      expect(h.variantUpdate).not.toHaveBeenCalled();
      expect(hlsTakedowns(h.actionCreate)).toEqual([
        expect.objectContaining({
          variantId: null,
          metadata: expect.objectContaining({ refreshKeys: [] }),
        }),
      ]);
    });

    it('block queues nothing for an asset that never had HLS output', async () => {
      const h = makeHarness({
        currentModeration: MediaAssetModerationStatus.approved,
        hlsVariant: {
          ...READY_HLS,
          status: MediaAssetVariantStatus.deleted,
          deletedAt: new Date(),
        },
        job: null,
      });

      await h.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.blocked,
      });

      expect(hlsTakedowns(h.actionCreate)).toEqual([]);
      expect(h.variantUpdate).not.toHaveBeenCalled();
    });

    it('a legacy asset whose own objectKey is the HLS master queues no prefix takedown', async () => {
      const h = makeHarness({
        currentModeration: MediaAssetModerationStatus.approved,
        objectKey: `${HLS_PREFIX}master.m3u8`,
        hlsVariant: READY_HLS,
        job: { status: MediaProcessingJobStatus.completed, lockedAt: null },
      });

      await h.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.blocked,
      });

      expect(hlsTakedowns(h.actionCreate)).toEqual([]);
      expect(h.tx.mediaAssetVariant.findUnique).not.toHaveBeenCalled();
    });

    it('restore reverses only non-HLS objects and never cancels a running prefix takedown', async () => {
      const h = makeHarness({
        currentModeration: MediaAssetModerationStatus.blocked,
        hlsVariant: { ...READY_HLS, status: MediaAssetVariantStatus.blocked },
        job: { status: MediaProcessingJobStatus.completed, lockedAt: null },
        placementMetadata: { moderationRestricted: true },
      });

      await h.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.approved,
        reason: 'appeal upheld',
      });

      const rows = restrictRows(h.createMany);
      expect(rows.every((r) => r.metadata.direction === 'restore')).toBe(true);
      expect(rows.map((r) => r.placementId)).toEqual([
        null,
        'placement-original',
      ]);
      const cancelled = (
        h.actionUpdateMany.mock.calls[0] as [
          { where: { actionType: { in: MediaModerationActionType[] } } },
        ]
      )[0].where.actionType.in;
      expect(cancelled).not.toContain(MediaModerationActionType.delete_object);
      expect(hlsTakedowns(h.actionCreate)).toEqual([]);
    });

    it('restore re-queues the transcode of an asset an IP episode or trailer plays', async () => {
      const h = makeHarness({
        currentModeration: MediaAssetModerationStatus.blocked,
        hlsVariant: { ...READY_HLS, status: MediaAssetVariantStatus.deleted },
        job: { status: MediaProcessingJobStatus.completed, lockedAt: null },
        ipReferenced: true,
      });

      await h.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.approved,
      });

      expect(h.tx.mediaAsset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: ASSET_ID,
            OR: [
              { ipEpisodeMedia: { some: {} } },
              { ipEpisodeTrailers: { some: {} } },
              { ipTrailers: { some: {} } },
              { ipDiscoveryTrailerMedia: { some: {} } },
            ],
          },
        }),
      );
      expect(h.processing.enqueueJobTx).toHaveBeenCalledWith(
        {
          assetId: ASSET_ID,
          jobType: MediaProcessingJobType.hls_stream,
          priority: 50,
          idempotencyKey: `hls-stream:${ASSET_ID}`,
        },
        h.tx,
        true,
      );
    });

    it('restore locks the job as enqueueJobTx does before its idle check', async () => {
      const h = makeHarness({
        currentModeration: MediaAssetModerationStatus.blocked,
        hlsVariant: { ...READY_HLS, status: MediaAssetVariantStatus.deleted },
        job: {
          status: MediaProcessingJobStatus.failed,
          lockedAt: null,
          output: {},
        },
        ipReferenced: true,
      });

      await h.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.approved,
      });

      // A worker claim cannot slip in between the check and the restart: it
      // waits for the decision, then picks up the restarted job.
      const key = `hls-stream:${ASSET_ID}`;
      const sql = (call: unknown[]) => (call[0] as string[]).join('?');
      const advisory = h.tx.$executeRaw.mock.calls.findIndex(
        (call: unknown[]) =>
          sql(call).includes('pg_advisory_xact_lock') &&
          call[1] === `media:enqueue:${key}`,
      );
      const rowLock = h.tx.$queryRaw.mock.calls.findIndex(
        (call: unknown[]) =>
          sql(call).includes('FROM media_processing_jobs') &&
          sql(call).includes('FOR UPDATE') &&
          call[1] === key,
      );
      expect(advisory).toBeGreaterThanOrEqual(0);
      expect(rowLock).toBeGreaterThanOrEqual(0);
      const order = [
        h.tx.$executeRaw.mock.invocationCallOrder[advisory],
        h.tx.$queryRaw.mock.invocationCallOrder[rowLock],
        h.tx.mediaProcessingJob.findUnique.mock.invocationCallOrder[0],
        h.processing.enqueueJobTx.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((left, right) => left - right));
    });

    it('a restart refused under the job lock fails the decision', async () => {
      const h = makeHarness({
        currentModeration: MediaAssetModerationStatus.blocked,
        hlsVariant: { ...READY_HLS, status: MediaAssetVariantStatus.deleted },
        job: null,
        ipReferenced: true,
      });
      h.processing.enqueueJobTx.mockRejectedValue(
        new ConflictException(
          'The processing key belongs to a different asset, variant or job type.',
        ),
      );

      await expect(
        h.service.updateAssetModeration(ASSET_ID, 'admin-1', {
          moderationStatus: MediaAssetModerationStatus.approved,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('restore leaves story clips to the reconcile and busy jobs alone', async () => {
      const storyClip = makeHarness({
        currentModeration: MediaAssetModerationStatus.blocked,
        hlsVariant: { ...READY_HLS, status: MediaAssetVariantStatus.blocked },
        job: { status: MediaProcessingJobStatus.cancelled, lockedAt: null },
        ipReferenced: false,
      });
      await storyClip.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.approved,
      });
      expect(storyClip.processing.enqueueJobTx).not.toHaveBeenCalled();

      const busy = makeHarness({
        currentModeration: MediaAssetModerationStatus.blocked,
        hlsVariant: { ...READY_HLS, status: MediaAssetVariantStatus.blocked },
        job: { status: MediaProcessingJobStatus.pending, lockedAt: null },
        ipReferenced: true,
      });
      await busy.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.approved,
      });
      expect(busy.processing.enqueueJobTx).not.toHaveBeenCalled();

      const imMayStillWrite = makeHarness({
        currentModeration: MediaAssetModerationStatus.blocked,
        hlsVariant: { ...READY_HLS, status: MediaAssetVariantStatus.blocked },
        job: {
          status: MediaProcessingJobStatus.dead,
          lockedAt: null,
          output: {
            immTaskId: 'MediaConvert-1',
            submittedAt: new Date().toISOString(),
          },
        },
        ipReferenced: true,
      });
      await imMayStillWrite.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.approved,
      });
      expect(imMayStillWrite.processing.enqueueJobTx).not.toHaveBeenCalled();

      const neverBlocked = makeHarness({
        currentModeration: MediaAssetModerationStatus.flagged,
        hlsVariant: READY_HLS,
        job: { status: MediaProcessingJobStatus.completed, lockedAt: null },
        ipReferenced: true,
      });
      await neverBlocked.service.updateAssetModeration(ASSET_ID, 'admin-1', {
        moderationStatus: MediaAssetModerationStatus.approved,
      });
      expect(neverBlocked.processing.enqueueJobTx).not.toHaveBeenCalled();
    });
  });
});

import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaAssetVisibility,
  MediaProcessingJobStatus,
  MediaProcessingJobType,
  MediaStorageProvider,
} from '@prisma/client';
import { MediaProcessingWorkerService } from './media-processing-worker.service';

describe('MediaProcessingWorkerService', () => {
  function processingJob(overrides: Record<string, unknown> = {}) {
    return {
      id: '01900000-0000-7000-8000-000000000010',
      assetId: '01900000-0000-7000-8000-000000000011',
      sourceVariantId: null,
      jobType: MediaProcessingJobType.backfill_original_placement,
      status: MediaProcessingJobStatus.pending,
      priority: 10,
      attempt: 0,
      maxAttempts: 8,
      idempotencyKey: 'job-key',
      input: {},
      output: {},
      errorMessage: null,
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      deadAt: null,
      createdByAdminId: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function mediaAsset() {
    return {
      id: '01900000-0000-7000-8000-000000000011',
      kind: MediaAssetKind.image,
      storageProvider: MediaStorageProvider.azure_blob,
      workspaceId: null,
      bucket: 'foundry-outputs',
      region: 'eastus2',
      objectKey: 'media/example.png',
      externalUrl: null,
      contentType: 'image/png',
      sizeBytes: BigInt(120),
      width: 512,
      height: 512,
      durationSeconds: null,
      checksumSha256: null,
      visibility: MediaAssetVisibility.public,
      status: MediaAssetStatus.ready,
      source: MediaAssetSource.ai_output,
      moderationStatus: MediaAssetModerationStatus.unreviewed,
      moderationReason: null,
      moderatedByAdminId: null,
      moderatedAt: null,
      metadata: {},
      createdByUserId: '2259',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
  }

  function setup(row = processingJob()) {
    const tx = {
      mediaAssetVariant: {
        upsert: jest.fn().mockResolvedValue({
          id: '01900000-0000-7000-8000-000000000012',
        }),
      },
      mediaObjectPlacement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: '01900000-0000-7000-8000-000000000013',
        }),
      },
    };
    const prisma = {
      mediaProcessingJob: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: row.id }])
          .mockResolvedValueOnce([row]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(row),
      },
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue(mediaAsset()),
      },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    return {
      service: new MediaProcessingWorkerService(prisma as never),
      prisma,
      tx,
      row,
    };
  }

  it('backfills the original variant and placement', async () => {
    const { service, prisma, tx, row } = setup();

    await service.drainOnce();

    expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          variantKey: 'original',
          kind: MediaAssetVariantKind.original,
          status: MediaAssetVariantStatus.ready,
        }),
      }),
    );
    expect(tx.mediaObjectPlacement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assetId: row.assetId,
          storageProvider: MediaStorageProvider.azure_blob,
        }),
      }),
    );
    expect(prisma.mediaProcessingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id },
        data: expect.objectContaining({
          status: MediaProcessingJobStatus.completed,
          output: {
            variantId: '01900000-0000-7000-8000-000000000012',
            placementId: '01900000-0000-7000-8000-000000000013',
          },
        }),
      }),
    );
  });

  it('moves unsupported handlers to DLQ instead of faking derivatives', async () => {
    const row = processingJob({
      jobType: MediaProcessingJobType.thumbnail,
    });
    const { service, prisma } = setup(row);

    await service.drainOnce();

    expect(prisma.mediaProcessingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id },
        data: expect.objectContaining({
          status: MediaProcessingJobStatus.dead,
          deadAt: expect.any(Date),
          errorMessage:
            'Media processing handler "thumbnail" is not configured in this deployment.',
        }),
      }),
    );
  });
});

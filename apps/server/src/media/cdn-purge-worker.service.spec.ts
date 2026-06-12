import {
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
} from '@prisma/client';
import { CdnPurgeWorkerService } from './cdn-purge-worker.service';

describe('CdnPurgeWorkerService', () => {
  function setup(rowOverrides: Record<string, unknown> = {}) {
    const placement = {
      id: '01900000-0000-7000-8000-000000000002',
      assetId: '01900000-0000-7000-8000-000000000001',
      variantId: '01900000-0000-7000-8000-000000000003',
      role: MediaObjectPlacementRole.primary,
      status: MediaObjectPlacementStatus.purging,
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'foundry-outputs',
      region: 'eastus2',
      objectKey: 'media/example.png',
      externalUrl: null,
      publicBaseUrl: 'https://cdn.example.com',
      cdnProvider: 'azure_cdn',
      cdnCacheKey: '/media/example.png',
      priority: 0,
      metadata: {},
      lastVerifiedAt: null,
      purgedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const row = {
      id: '01900000-0000-7000-8000-000000000004',
      caseId: '01900000-0000-7000-8000-000000000005',
      assetId: placement.assetId,
      variantId: placement.variantId,
      placementId: placement.id,
      actionType: MediaModerationActionType.purge_cdn,
      status: MediaModerationActionStatus.pending,
      reason: 'blocked',
      actorAdminId: 'admin',
      idempotencyKey: 'purge-key',
      provider: 'azure_cdn',
      providerTaskId: null,
      errorMessage: null,
      metadata: {},
      attempt: 0,
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
      lastAttemptAt: null,
      deadAt: null,
      createdAt: new Date(),
      completedAt: null,
      failedAt: null,
      placement,
      ...rowOverrides,
    };
    const prisma = {
      mediaModerationAction: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: row.id }])
          .mockResolvedValueOnce([row]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(row),
      },
      mediaObjectPlacement: {
        update: jest.fn().mockResolvedValue(placement),
      },
      $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
    };
    const assetUrls = {
      resolvePlacement: jest
        .fn()
        .mockReturnValue('https://cdn.example.com/media/example.png'),
    };
    const purgeProvider = {
      purge: jest.fn().mockResolvedValue({
        providerTaskId: 'provider-task-1',
        metadata: { accepted: true },
      }),
    };
    const service = new CdnPurgeWorkerService(
      prisma as never,
      assetUrls as never,
      purgeProvider as never,
    );
    return { service, prisma, assetUrls, purgeProvider, row, placement };
  }

  it('purges a claimed placement and marks action + placement completed', async () => {
    const { service, prisma, purgeProvider, row } = setup();

    await service.drainOnce();

    expect(purgeProvider.purge).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: row.id,
        provider: 'azure_cdn',
        cacheKey: '/media/example.png',
        url: 'https://cdn.example.com/media/example.png',
      }),
    );
    expect(prisma.mediaModerationAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id },
        data: expect.objectContaining({
          status: MediaModerationActionStatus.completed,
          providerTaskId: 'provider-task-1',
          deadAt: null,
        }),
      }),
    );
    expect(prisma.mediaObjectPlacement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MediaObjectPlacementStatus.purged,
          purgedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('schedules a retry when provider purge fails', async () => {
    const { service, prisma, purgeProvider, row } = setup();
    purgeProvider.purge.mockRejectedValueOnce(new Error('gateway unavailable'));

    await service.drainOnce();

    expect(prisma.mediaModerationAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id },
        data: expect.objectContaining({
          status: MediaModerationActionStatus.failed,
          attempt: 1,
          errorMessage: 'gateway unavailable',
          nextAttemptAt: expect.any(Date),
          deadAt: null,
        }),
      }),
    );
  });

  it('moves placement to failed when purge reaches DLQ', async () => {
    const { service, prisma, purgeProvider, row, placement } = setup({
      attempt: 7,
    });
    purgeProvider.purge.mockRejectedValueOnce(new Error('gateway unavailable'));

    await service.drainOnce();

    expect(prisma.mediaModerationAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id },
        data: expect.objectContaining({
          attempt: 8,
          deadAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.mediaObjectPlacement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: placement.id },
        data: { status: MediaObjectPlacementStatus.failed },
      }),
    );
  });
});

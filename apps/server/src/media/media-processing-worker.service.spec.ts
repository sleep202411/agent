/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- asserting on untyped jest mock payloads */
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
  type MediaAsset,
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

  // Typed against the real Prisma model so kind/provider stay the enum unions
  // (a bare literal would pin them to the image/azure defaults).
  function mediaAsset(): MediaAsset {
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

  function videoAsset(
    overrides: Record<string, unknown> = {},
  ): ReturnType<typeof mediaAsset> {
    return {
      ...mediaAsset(),
      kind: MediaAssetKind.video,
      storageProvider: MediaStorageProvider.aliyun_oss,
      bucket: 'fizzdragon-ai-outputs',
      region: 'cn-hangzhou',
      objectKey: 'media/cn/episode-video/34/x.mp4',
      contentType: 'video/mp4',
      durationSeconds: 230,
      ...overrides,
    } as ReturnType<typeof mediaAsset>;
  }

  function immMock(overrides: Record<string, unknown> = {}) {
    return {
      isConfigured: jest.fn().mockReturnValue(true),
      submitHlsTask: jest.fn().mockResolvedValue('imm-task-1'),
      getTaskStatus: jest.fn(),
      finalizeHls: jest.fn(),
      masterObjectKey: (id: string) => `hls/${id}/master.m3u8`,
      ...overrides,
    };
  }

  function setup(
    row = processingJob(),
    opts: {
      asset?: ReturnType<typeof mediaAsset>;
      imm?: ReturnType<typeof immMock>;
    } = {},
  ) {
    const asset = opts.asset ?? mediaAsset();
    const imm = opts.imm ?? immMock();
    const posters = {
      generate: jest.fn().mockResolvedValue({ variantId: 'poster-1' }),
    };
    const tx = {
      mediaProcessingJob: { upsert: jest.fn().mockResolvedValue({}) },
      mediaAssetVariant: {
        upsert: jest.fn().mockResolvedValue({
          id: '01900000-0000-7000-8000-000000000012',
        }),
      },
      mediaObjectPlacement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: '01900000-0000-7000-8000-000000000013',
        }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      mediaProcessingJob: {
        findMany: jest
          .fn()
          .mockResolvedValue([])
          .mockResolvedValueOnce([{ id: row.id }])
          .mockResolvedValueOnce([row]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue(asset),
      },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    return {
      service: new MediaProcessingWorkerService(
        prisma as never,
        imm as never,
        posters as never,
      ),
      prisma,
      tx,
      imm,
      posters,
      row,
    };
  }

  it('completes a poster job only after its image is stored', async () => {
    const { service, prisma, posters, row } = setup(
      processingJob({ jobType: 'poster' }),
    );
    await service.drainOnce();
    expect(posters.generate).toHaveBeenCalledWith(row.assetId);
    expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          output: { variantId: 'poster-1' },
        }),
      }),
    );
  });

  it('retries a transient poster failure through the existing queue', async () => {
    const { service, prisma, posters } = setup(
      processingJob({ jobType: 'poster', maxAttempts: 4 }),
    );
    posters.generate.mockRejectedValue(
      new Error('Storage temporarily unavailable'),
    );
    await service.drainOnce();
    expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          attempt: 1,
          nextAttemptAt: expect.any(Date),
          errorMessage: 'Storage temporarily unavailable',
        }),
      }),
    );
  });

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
    expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: row.id,
          status: MediaProcessingJobStatus.processing,
          lockedBy: row.lockedBy,
          startedAt: row.startedAt,
        },
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

    expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: row.id,
          status: MediaProcessingJobStatus.processing,
          lockedBy: row.lockedBy,
          startedAt: row.startedAt,
        },
        data: expect.objectContaining({
          status: MediaProcessingJobStatus.dead,
          deadAt: expect.any(Date),
          errorMessage:
            'Media processing handler "thumbnail" is not configured in this deployment.',
        }),
      }),
    );
  });

  describe('hls_stream', () => {
    const ASSET_ID = '01900000-0000-7000-8000-000000000011';
    function hlsJob(output: Record<string, unknown> = {}) {
      return processingJob({
        jobType: MediaProcessingJobType.hls_stream,
        priority: 50,
        output,
      });
    }
    function running(output: Record<string, unknown>) {
      return {
        immTaskId: 'imm-task-1',
        submittedAt: new Date().toISOString(),
        ...output,
      };
    }

    it('phase 1: submits the IMM task and re-queues for poll without burning an attempt', async () => {
      const imm = immMock();
      const { service, prisma } = setup(hlsJob({}), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(imm.submitHlsTask).toHaveBeenCalledWith(
        ASSET_ID,
        'fizzdragon-ai-outputs',
        'media/cn/episode-video/34/x.mp4',
      );
      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.pending,
            nextAttemptAt: expect.any(Date),
            output: expect.objectContaining({
              immTaskId: 'imm-task-1',
              pollErrors: 0,
            }),
          }),
        }),
      );
      expect(prisma.mediaProcessingJob.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.completed,
          }),
        }),
      );
    });

    it('phase 2: a running task re-queues and resets pollErrors', async () => {
      const imm = immMock();
      imm.getTaskStatus.mockResolvedValue({ state: 'running', raw: 'Running' });
      const { service, prisma } = setup(hlsJob(running({ pollErrors: 2 })), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(imm.getTaskStatus).toHaveBeenCalledWith('imm-task-1');
      expect(imm.submitHlsTask).not.toHaveBeenCalled();
      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.pending,
            output: expect.objectContaining({ pollErrors: 0 }),
          }),
        }),
      );
    });

    it('phase 3: a multi-segment success publishes a ready stream variant and completes', async () => {
      const imm = immMock();
      imm.getTaskStatus.mockResolvedValue({
        state: 'succeeded',
        raw: 'Succeeded',
      });
      imm.finalizeHls.mockResolvedValue({
        masterObjectKey: `hls/${ASSET_ID}/master.m3u8`,
        segmentCount: 31,
        objectKeys: [
          `hls/${ASSET_ID}/master.m3u8`,
          `hls/${ASSET_ID}/480p.m3u8`,
          `hls/${ASSET_ID}/480p-0.ts`,
        ],
      });
      const { service, prisma, tx } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            variantKey: 'hls',
            kind: MediaAssetVariantKind.stream,
            status: MediaAssetVariantStatus.ready,
          }),
        }),
      );
      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.completed,
            output: expect.objectContaining({ segmentCount: 31 }),
          }),
        }),
      );
    });

    it('phase 3: registers EVERY produced HLS object (renditions + segments) as replica placements so takedown covers them', async () => {
      const imm = immMock();
      imm.getTaskStatus.mockResolvedValue({
        state: 'succeeded',
        raw: 'Succeeded',
      });
      imm.finalizeHls.mockResolvedValue({
        masterObjectKey: `hls/${ASSET_ID}/master.m3u8`,
        segmentCount: 2,
        objectKeys: [
          `hls/${ASSET_ID}/master.m3u8`,
          `hls/${ASSET_ID}/720p.m3u8`,
          `hls/${ASSET_ID}/720p-0.ts`,
          `hls/${ASSET_ID}/720p-1.ts`,
          `hls/${ASSET_ID}/480p.m3u8`,
          `hls/${ASSET_ID}/480p-0.ts`,
          `hls/${ASSET_ID}/480p-1.ts`,
        ],
      });
      const { service, prisma, tx } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      const createManyArg = tx.mediaObjectPlacement.createMany.mock
        .calls[0]?.[0] as {
        data: Array<{ objectKey: string; role: string; status: string }>;
        skipDuplicates: boolean;
      };
      expect(createManyArg).toBeDefined();
      expect(createManyArg.skipDuplicates).toBe(true);
      // Master is the primary placement (ensureStreamVariantPlacement) — the
      // replica sync must register everything else, and nothing more.
      expect(createManyArg.data.map((row) => row.objectKey).sort()).toEqual([
        `hls/${ASSET_ID}/480p-0.ts`,
        `hls/${ASSET_ID}/480p-1.ts`,
        `hls/${ASSET_ID}/480p.m3u8`,
        `hls/${ASSET_ID}/720p-0.ts`,
        `hls/${ASSET_ID}/720p-1.ts`,
        `hls/${ASSET_ID}/720p.m3u8`,
      ]);
      expect(createManyArg.data.every((row) => row.role === 'replica')).toBe(
        true,
      );
      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.completed,
            output: expect.objectContaining({
              outputPlacements: { created: 6, reactivated: 0, retired: 0 },
            }),
          }),
        }),
      );
    });

    it('a degenerate (<=1 segment) result marks the variant failed and keeps the mp4', async () => {
      const imm = immMock();
      imm.getTaskStatus.mockResolvedValue({
        state: 'succeeded',
        raw: 'Succeeded',
      });
      imm.finalizeHls.mockResolvedValue({
        masterObjectKey: `hls/${ASSET_ID}/master.m3u8`,
        segmentCount: 1,
        objectKeys: [
          `hls/${ASSET_ID}/master.m3u8`,
          `hls/${ASSET_ID}/480p.m3u8`,
          `hls/${ASSET_ID}/480p-0.ts`,
        ],
      });
      const { service, prisma, tx } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            variantKey: 'hls',
            status: MediaAssetVariantStatus.failed,
          }),
        }),
      );
      expect(tx.mediaObjectPlacement.updateMany).toHaveBeenCalled();
      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.completed,
            output: expect.objectContaining({ skipped: 'degenerate_output' }),
          }),
        }),
      );
    });

    it('an IMM failed status dead-letters permanently (keeps mp4)', async () => {
      const imm = immMock();
      imm.getTaskStatus.mockResolvedValue({
        state: 'failed',
        raw: 'Failed',
        errorMessage: 'bad input',
      });
      const { service, prisma } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.dead,
            deadAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects a non-aliyun_oss asset permanently and never calls IMM', async () => {
      const imm = immMock();
      const { service, prisma } = setup(hlsJob({}), {
        asset: videoAsset({ storageProvider: MediaStorageProvider.azure_blob }),
        imm,
      });

      await service.drainOnce();

      expect(imm.submitHlsTask).not.toHaveBeenCalled();
      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.dead,
            errorMessage: expect.stringContaining('aliyun_oss'),
          }),
        }),
      );
    });

    it('a transient poll error re-queues with an incremented counter (not the retry budget)', async () => {
      const imm = immMock();
      imm.getTaskStatus.mockRejectedValue(new Error('ETIMEDOUT'));
      const { service, prisma } = setup(hlsJob(running({ pollErrors: 2 })), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.pending,
            output: expect.objectContaining({ pollErrors: 3 }),
          }),
        }),
      );
    });

    it('a transient poll error at the cap dead-letters permanently', async () => {
      const imm = immMock();
      imm.getTaskStatus.mockRejectedValue(new Error('ETIMEDOUT'));
      const { service, prisma } = setup(hlsJob(running({ pollErrors: 29 })), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(prisma.mediaProcessingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MediaProcessingJobStatus.dead,
          }),
        }),
      );
    });
  });
});

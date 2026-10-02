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
      applyHlsCacheControl: jest.fn().mockResolvedValue(undefined),
      deleteHlsOutput: jest
        .fn()
        .mockResolvedValue({ deleted: 3, complete: true }),
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
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ moderation_status: asset.moderationStatus }]),
      mediaModerationAction: { findFirst: jest.fn().mockResolvedValue(null) },
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
      mediaAssetVariant: { findUnique: jest.fn().mockResolvedValue(null) },
      mediaModerationAction: { findFirst: jest.fn().mockResolvedValue(null) },
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
    const SUBMITTED_AT = new Date(Date.now() - 4 * 60_000).toISOString();
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
        submittedAt: SUBMITTED_AT,
        ...output,
      };
    }
    function rendition(overrides: Record<string, unknown> = {}) {
      return {
        name: '1080p',
        playlistKey: `hls/${ASSET_ID}/1080p.m3u8`,
        width: 1920,
        height: 1080,
        segmentCount: 39,
        durationSeconds: 229.84,
        maxSegmentSeconds: 6,
        ...overrides,
      };
    }
    function finalized(overrides: Record<string, unknown> = {}) {
      return {
        masterObjectKey: `hls/${ASSET_ID}/master.m3u8`,
        objectKeys: [
          `hls/${ASSET_ID}/master.m3u8`,
          `hls/${ASSET_ID}/1080p.m3u8`,
          `hls/${ASSET_ID}/1080p-0.ts`,
        ],
        renditions: [rendition()],
        totalBytes: 123_456n,
        missingKeys: [],
        ...overrides,
      };
    }
    function succeeded(finalize: ReturnType<typeof finalized>) {
      const imm = immMock();
      imm.getTaskStatus.mockResolvedValue({
        state: 'succeeded',
        raw: 'Succeeded',
      });
      imm.finalizeHls.mockResolvedValue(finalize);
      return imm;
    }
    function jobWrite(
      prisma: ReturnType<typeof setup>['prisma'],
      status: MediaProcessingJobStatus,
    ): Record<string, unknown> | undefined {
      const call = (
        prisma.mediaProcessingJob.updateMany.mock.calls as Array<
          [{ data: Record<string, unknown> }]
        >
      ).find(([arg]) => arg.data.status === status);
      return call?.[0].data;
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
      const write = jobWrite(prisma, MediaProcessingJobStatus.pending);
      expect(write).toEqual(
        expect.objectContaining({
          nextAttemptAt: expect.any(Date),
          output: expect.objectContaining({
            immTaskId: 'imm-task-1',
            pollErrors: 0,
          }),
        }),
      );
      expect(write).not.toHaveProperty('attempt');
      expect(jobWrite(prisma, MediaProcessingJobStatus.completed)).toBe(
        undefined,
      );
    });

    it('phase 1: refuses a moderation-blocked asset as cancelled, never calling IMM', async () => {
      const imm = immMock();
      const { service, prisma } = setup(hlsJob({}), {
        asset: videoAsset({
          moderationStatus: MediaAssetModerationStatus.blocked,
        }),
        imm,
      });

      await service.drainOnce();

      expect(imm.submitHlsTask).not.toHaveBeenCalled();
      expect(jobWrite(prisma, MediaProcessingJobStatus.cancelled)).toEqual(
        expect.objectContaining({
          attempt: 1,
          errorMessage:
            'Media asset is moderation-blocked; HLS transcode refused.',
          nextAttemptAt: null,
          deadAt: null,
          lockedAt: null,
        }),
      );
    });

    it('phase 1: waits for an unfinished or settling takedown without consuming an attempt', async () => {
      const imm = immMock();
      const { service, prisma } = setup(hlsJob({}), {
        asset: videoAsset(),
        imm,
      });
      prisma.mediaModerationAction.findFirst.mockResolvedValue({
        id: 'takedown-1',
      });

      await service.drainOnce();

      expect(imm.submitHlsTask).not.toHaveBeenCalled();
      const where = (
        prisma.mediaModerationAction.findFirst.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0].where;
      expect(where).toEqual(
        expect.objectContaining({
          assetId: ASSET_ID,
          actionType: 'delete_object',
          metadata: { path: ['scope'], equals: 'hls_prefix' },
        }),
      );
      const write = jobWrite(prisma, MediaProcessingJobStatus.pending);
      expect(write).toEqual(
        expect.objectContaining({
          output: { deferredByTakedown: 'takedown-1' },
          nextAttemptAt: expect.any(Date),
        }),
      );
      expect(write).not.toHaveProperty('attempt');
      const delay = (write!.nextAttemptAt as Date).getTime() - Date.now();
      expect(delay).toBeGreaterThan(55_000);
      expect(delay).toBeLessThanOrEqual(60_000);
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

    it('phase 2: an in-flight poll is never cut short by a block', async () => {
      const imm = immMock();
      imm.getTaskStatus.mockResolvedValue({ state: 'running', raw: 'Running' });
      const { service, prisma } = setup(hlsJob(running({})), {
        asset: videoAsset({
          moderationStatus: MediaAssetModerationStatus.blocked,
        }),
        imm,
      });

      await service.drainOnce();

      expect(imm.getTaskStatus).toHaveBeenCalled();
      expect(jobWrite(prisma, MediaProcessingJobStatus.cancelled)).toBe(
        undefined,
      );
      expect(jobWrite(prisma, MediaProcessingJobStatus.pending)).toBeDefined();
    });

    it('phase 3: publishes the measured output and keeps submittedAt in the completion', async () => {
      const imm = succeeded(finalized());
      const { service, prisma, tx } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(imm.applyHlsCacheControl).toHaveBeenCalledWith(ASSET_ID);
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            variantKey: 'hls',
            kind: MediaAssetVariantKind.stream,
            status: MediaAssetVariantStatus.ready,
            sizeBytes: 123_456n,
            width: 1920,
            height: 1080,
            durationMs: 229_840,
            metadata: expect.objectContaining({
              immTaskId: 'imm-task-1',
              submittedAt: SUBMITTED_AT,
              totalBytes: '123456',
              renditions: [
                {
                  name: '1080p',
                  width: 1920,
                  height: 1080,
                  segmentCount: 39,
                  durationSeconds: 229.84,
                },
              ],
            }),
          }),
        }),
      );
      expect(jobWrite(prisma, MediaProcessingJobStatus.completed)).toEqual(
        expect.objectContaining({
          output: expect.objectContaining({
            immTaskId: 'imm-task-1',
            submittedAt: SUBMITTED_AT,
            renditions: ['1080p'],
            totalBytes: '123456',
          }),
        }),
      );
    });

    it('phase 3: a single 5 s segment is a valid output and publishes', async () => {
      const imm = succeeded(
        finalized({
          renditions: [
            rendition({
              name: '480p',
              width: 854,
              height: 480,
              segmentCount: 1,
              durationSeconds: 5,
              maxSegmentSeconds: 5,
            }),
          ],
          totalBytes: 512_000n,
        }),
      );
      const { service, prisma, tx } = setup(hlsJob(running({})), {
        asset: videoAsset({ durationSeconds: 5 }),
        imm,
      });

      await service.drainOnce();

      expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: MediaAssetVariantStatus.ready,
            sizeBytes: 512_000n,
            width: 854,
            height: 480,
            durationMs: 5_000,
          }),
        }),
      );
      expect(
        jobWrite(prisma, MediaProcessingJobStatus.completed),
      ).toBeDefined();
    });

    it('phase 3: records the tallest tier whatever order the master lists it in', async () => {
      const imm = succeeded(
        finalized({
          renditions: [
            rendition({ name: '480p', width: 854, height: 480 }),
            rendition({ name: '1080p', width: 1920, height: 1080 }),
          ],
        }),
      );
      const { service, tx } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ width: 1920, height: 1080 }),
        }),
      );
    });

    it('phase 3: registers EVERY produced HLS object (renditions + segments) as replica placements so takedown covers them', async () => {
      const imm = succeeded(
        finalized({
          objectKeys: [
            `hls/${ASSET_ID}/master.m3u8`,
            `hls/${ASSET_ID}/720p.m3u8`,
            `hls/${ASSET_ID}/720p-0.ts`,
            `hls/${ASSET_ID}/720p-1.ts`,
            `hls/${ASSET_ID}/480p.m3u8`,
            `hls/${ASSET_ID}/480p-0.ts`,
            `hls/${ASSET_ID}/480p-1.ts`,
          ],
        }),
      );
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
      expect(jobWrite(prisma, MediaProcessingJobStatus.completed)).toEqual(
        expect.objectContaining({
          output: expect.objectContaining({
            outputPlacements: { created: 6, reactivated: 0, retired: 0 },
          }),
        }),
      );
    });

    it('phase 3: a block that landed during the transcode cancels without publishing', async () => {
      const imm = succeeded(finalized());
      const { service, prisma, tx } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });
      tx.$queryRaw.mockResolvedValue([
        { moderation_status: MediaAssetModerationStatus.blocked },
      ]);

      await service.drainOnce();

      expect(tx.mediaAssetVariant.upsert).not.toHaveBeenCalled();
      expect(tx.mediaObjectPlacement.createMany).not.toHaveBeenCalled();
      expect(imm.deleteHlsOutput).not.toHaveBeenCalled();
      expect(jobWrite(prisma, MediaProcessingJobStatus.cancelled)).toEqual(
        expect.objectContaining({
          errorMessage:
            'Asset was moderation-blocked during transcoding; HLS output not published.',
        }),
      );
      expect(jobWrite(prisma, MediaProcessingJobStatus.completed)).toBe(
        undefined,
      );
    });

    it('phase 3: an HLS takedown still emptying the prefix cancels without publishing', async () => {
      const imm = succeeded(finalized());
      const { service, prisma, tx } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });
      tx.mediaModerationAction.findFirst.mockResolvedValue({
        id: 'takedown-9',
      });

      await service.drainOnce();

      expect(tx.mediaAssetVariant.upsert).not.toHaveBeenCalled();
      expect(jobWrite(prisma, MediaProcessingJobStatus.cancelled)).toEqual(
        expect.objectContaining({
          errorMessage: expect.stringContaining('takedown-9'),
        }),
      );
    });

    describe('degenerate output', () => {
      it.each([
        ['no rendition', { renditions: [] }, 'renditions=none'],
        [
          'a rendition without segments',
          {
            renditions: [
              rendition(),
              rendition({
                name: '480p',
                segmentCount: 0,
                durationSeconds: 0,
                maxSegmentSeconds: 0,
              }),
            ],
          },
          'segments=[39,0]',
        ],
        [
          'a referenced object missing from the bucket',
          { missingKeys: [`hls/${ASSET_ID}/1080p-7.ts`] },
          `missing=[hls/${ASSET_ID}/1080p-7.ts]`,
        ],
        [
          'one segment for the whole video',
          {
            renditions: [
              rendition({ segmentCount: 1, maxSegmentSeconds: 229.84 }),
            ],
          },
          'maxSegmentSeconds=229.84',
        ],
        [
          'an output far shorter than its source',
          {
            renditions: [
              rendition({
                segmentCount: 1,
                durationSeconds: 4,
                maxSegmentSeconds: 4,
              }),
            ],
          },
          'durationSeconds=4 (source 230)',
        ],
      ])(
        '%s ends dead and discards the never-published output',
        async (_label, overrides, detail) => {
          const imm = succeeded(finalized(overrides));
          const { service, prisma, tx } = setup(hlsJob(running({})), {
            asset: videoAsset(),
            imm,
          });

          await service.drainOnce();

          expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
              update: expect.objectContaining({
                status: MediaAssetVariantStatus.failed,
              }),
            }),
          );
          expect(imm.applyHlsCacheControl).not.toHaveBeenCalled();
          expect(imm.deleteHlsOutput).toHaveBeenCalledWith(
            ASSET_ID,
            'fizzdragon-ai-outputs',
            expect.any(Number),
          );
          const dead = jobWrite(prisma, MediaProcessingJobStatus.dead);
          expect(dead).toEqual(
            expect.objectContaining({ deadAt: expect.any(Date) }),
          );
          expect(dead?.errorMessage).toEqual(
            expect.stringContaining(
              'IMM output rejected as degenerate (task=imm-task-1): ',
            ),
          );
          expect(dead?.errorMessage).toEqual(expect.stringContaining(detail));
        },
      );

      it('keeps a previously published output and its key ledger in place (only a takedown may remove them)', async () => {
        const imm = succeeded(finalized({ renditions: [] }));
        const { service, prisma, tx } = setup(hlsJob(running({})), {
          asset: videoAsset(),
          imm,
        });
        prisma.mediaAssetVariant.findUnique.mockResolvedValue({
          status: MediaAssetVariantStatus.ready,
          deletedAt: null,
        });

        await service.drainOnce();

        expect(imm.deleteHlsOutput).not.toHaveBeenCalled();
        expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              status: MediaAssetVariantStatus.failed,
            }),
          }),
        );
        // The placements name every published key a later takedown refreshes.
        expect(tx.mediaObjectPlacement.updateMany).not.toHaveBeenCalled();
        expect(jobWrite(prisma, MediaProcessingJobStatus.dead)).toBeDefined();
      });

      it('appends a cleanup failure to the error verbatim', async () => {
        const imm = succeeded(finalized({ renditions: [] }));
        imm.deleteHlsOutput.mockRejectedValue(new Error('AccessDenied'));
        const { service, prisma } = setup(hlsJob(running({})), {
          asset: videoAsset(),
          imm,
        });

        await service.drainOnce();

        expect(
          jobWrite(prisma, MediaProcessingJobStatus.dead)?.errorMessage,
        ).toEqual(
          expect.stringMatching(/; output cleanup failed: AccessDenied$/),
        );
      });
    });

    it("an IMM failed status dead-letters with IMM's code and discards the unpublished output", async () => {
      const imm = immMock();
      imm.getTaskStatus.mockResolvedValue({
        state: 'failed',
        raw: 'Failed',
        errorCode: 'InvalidParameter.Video',
        errorMessage: 'bad input',
      });
      const { service, prisma } = setup(hlsJob(running({})), {
        asset: videoAsset(),
        imm,
      });

      await service.drainOnce();

      expect(imm.deleteHlsOutput).toHaveBeenCalled();
      expect(jobWrite(prisma, MediaProcessingJobStatus.dead)).toEqual(
        expect.objectContaining({
          deadAt: expect.any(Date),
          errorMessage:
            'IMM transcode failed (task=imm-task-1): InvalidParameter.Video: bad input',
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

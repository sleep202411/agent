import { hostname } from 'os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaProcessingJobStatus,
  MediaProcessingJobType,
  Prisma,
  type MediaAsset,
  type MediaProcessingJob,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { ensureOriginalMediaPlacement } from '../infra/storage/media-asset-placement';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;
const LOCK_TTL_MS = 10 * 60_000;
const BACKOFFS_MS = [
  10_000,
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
];
const POD_ID = `${hostname()}-${process.pid}`;

@Injectable()
export class MediaProcessingWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MediaProcessingWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (process.env.MEDIA_PROCESSING_WORKER_ENABLED === 'false') return;
    const intervalMs = positiveInt(
      process.env.MEDIA_PROCESSING_WORKER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Media processing worker running every ${intervalMs}ms (pod=${POD_ID})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(batch = DEFAULT_BATCH_SIZE): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const rows = await this.claim(batch);
      for (const row of rows) {
        await this.processOne(row);
      }
    } catch (err) {
      this.logger.warn(`media processing drain failed: ${errorText(err)}`);
    } finally {
      this.draining = false;
    }
  }

  private async claim(batch: number): Promise<MediaProcessingJob[]> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - LOCK_TTL_MS);
    const candidates = await this.prisma.mediaProcessingJob.findMany({
      where: {
        deadAt: null,
        OR: [
          {
            status: {
              in: [
                MediaProcessingJobStatus.pending,
                MediaProcessingJobStatus.failed,
              ],
            },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            AND: [
              { OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }] },
            ],
          },
          {
            status: MediaProcessingJobStatus.processing,
            lockedAt: { lt: lockCutoff },
          },
        ],
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: batch,
      select: { id: true },
    });
    if (candidates.length === 0) return [];

    const ids = candidates.map((row) => row.id);
    await this.prisma.mediaProcessingJob.updateMany({
      where: {
        id: { in: ids },
        deadAt: null,
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }],
      },
      data: {
        status: MediaProcessingJobStatus.processing,
        lockedAt: now,
        lockedBy: POD_ID,
        startedAt: now,
      },
    });

    return this.prisma.mediaProcessingJob.findMany({
      where: {
        id: { in: ids },
        lockedBy: POD_ID,
        status: MediaProcessingJobStatus.processing,
        deadAt: null,
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async processOne(row: MediaProcessingJob): Promise<void> {
    try {
      switch (row.jobType) {
        case MediaProcessingJobType.backfill_original_placement:
          await this.backfillOriginalPlacement(row);
          return;
        case MediaProcessingJobType.thumbnail:
        case MediaProcessingJobType.poster:
        case MediaProcessingJobType.transcode:
        case MediaProcessingJobType.hls_stream:
        case MediaProcessingJobType.waveform:
        case MediaProcessingJobType.metadata_probe:
        case MediaProcessingJobType.moderation_scan:
          await this.fail(
            row,
            `Media processing handler "${row.jobType}" is not configured in this deployment.`,
            { permanent: true },
          );
          return;
      }
    } catch (err) {
      await this.fail(row, errorText(err));
    }
  }

  private async backfillOriginalPlacement(
    row: MediaProcessingJob,
  ): Promise<void> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: row.assetId, deletedAt: null },
    });
    if (!asset) {
      await this.fail(row, 'Media asset no longer exists.', {
        permanent: true,
      });
      return;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      return ensureOriginalMediaPlacement(tx, placementInputFromAsset(asset));
    });
    await this.complete(row, {
      variantId: result.variantId,
      placementId: result.placementId,
    });
  }

  private async complete(
    row: MediaProcessingJob,
    output: Prisma.InputJsonObject,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.mediaProcessingJob.update({
      where: { id: row.id },
      data: {
        status: MediaProcessingJobStatus.completed,
        attempt: row.attempt + 1,
        output,
        errorMessage: null,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
        completedAt: now,
        failedAt: null,
        deadAt: null,
      },
    });
  }

  private async fail(
    row: MediaProcessingJob,
    message: string,
    options: { permanent?: boolean } = {},
  ): Promise<void> {
    const now = new Date();
    const nextAttempt = row.attempt + 1;
    const reachedMaxAttempts = nextAttempt >= row.maxAttempts;
    const isDead = Boolean(options.permanent) || reachedMaxAttempts;
    const backoff = BACKOFFS_MS[Math.min(row.attempt, BACKOFFS_MS.length - 1)];
    await this.prisma.mediaProcessingJob.update({
      where: { id: row.id },
      data: {
        status: isDead
          ? MediaProcessingJobStatus.dead
          : MediaProcessingJobStatus.failed,
        attempt: nextAttempt,
        errorMessage: message.slice(0, 4000),
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: isDead ? null : new Date(Date.now() + backoff),
        failedAt: now,
        deadAt: isDead ? now : null,
      },
    });
    this.logger.warn(
      `media processing failed job=${row.id} type=${row.jobType} attempt=${nextAttempt}/${row.maxAttempts}${isDead ? ' [DLQ]' : ''}: ${message}`,
    );
  }
}

function placementInputFromAsset(asset: MediaAsset) {
  return {
    assetId: asset.id,
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    checksumSha256: asset.checksumSha256,
    metadata: {
      source: 'media_processing_backfill',
    },
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { hostname } from 'os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaProcessingJobStatus,
  MediaProcessingJobType,
  MediaStorageProvider,
  Prisma,
  type MediaAsset,
  type MediaProcessingJob,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import {
  ensureOriginalMediaPlacement,
  ensureStreamVariantPlacement,
  markStreamVariantFailed,
} from '../infra/storage/media-asset-placement';
import { ImmTranscodeService } from '../infra/storage/imm-transcode.service';

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
/**
 * Bound on consecutive transient errors while polling/finalizing an async
 * provider task, BEFORE the job is permanently dead-lettered. Decoupled from
 * `maxAttempts` (the submit/retry budget) so a network blip mid-transcode can't
 * kill a healthy job. At the ~20s poll cadence this is ~10 min of failures.
 */
const MAX_POLL_ERRORS = 30;

@Injectable()
export class MediaProcessingWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MediaProcessingWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly imm: ImmTranscodeService,
  ) {}

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
        case MediaProcessingJobType.hls_stream:
          await this.processHlsStream(row);
          return;
        case MediaProcessingJobType.thumbnail:
        case MediaProcessingJobType.poster:
        case MediaProcessingJobType.transcode:
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

  /**
   * Transcode a CN video asset to ABR HLS via IMM. IMM is async (submit → poll
   * over minutes) but the drain loop is sequential and `fail()` burns a retry
   * attempt, so this is a poll state-machine driven by `job.output`:
   * first run submits + re-queues; subsequent runs poll `GetTask` and re-queue
   * (via {@link requeueForPoll}, which does NOT consume an attempt) until the
   * task succeeds, fails, or times out. Only genuine errors go through
   * `fail()`. A ≤1-segment result (degenerate/truncated/ultra-short source) is
   * recorded as a failed variant and the original mp4 is kept.
   */
  private async processHlsStream(row: MediaProcessingJob): Promise<void> {
    if (!this.imm.isConfigured()) {
      await this.fail(
        row,
        'IMM transcoding is not configured in this deployment.',
        { permanent: true },
      );
      return;
    }

    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: row.assetId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        storageProvider: true,
        bucket: true,
        region: true,
        objectKey: true,
        durationSeconds: true,
      },
    });
    if (!asset) {
      await this.fail(row, 'Media asset no longer exists.', {
        permanent: true,
      });
      return;
    }
    if (asset.storageProvider !== MediaStorageProvider.aliyun_oss) {
      await this.fail(
        row,
        `HLS transcode only supported for aliyun_oss (got ${asset.storageProvider}).`,
        { permanent: true },
      );
      return;
    }
    if (asset.kind !== MediaAssetKind.video) {
      await this.fail(
        row,
        `HLS transcode only applies to video assets (got ${asset.kind}).`,
        { permanent: true },
      );
      return;
    }
    if (!asset.bucket || !asset.objectKey) {
      await this.fail(row, 'Video asset is missing bucket/objectKey.', {
        permanent: true,
      });
      return;
    }
    if (
      asset.objectKey.endsWith('.m3u8') ||
      asset.objectKey.startsWith('hls/')
    ) {
      // The asset already points at an HLS playlist (older manual-repoint shape:
      // MediaAsset.objectKey was set to hls/{id}/master.m3u8 with no variant).
      // Transcoding a playlist as the IMM SOURCE would overwrite the good HLS
      // with garbage — refuse. Normalize such assets to source-mp4 + variant.
      await this.fail(
        row,
        `Asset objectKey is already an HLS playlist (${asset.objectKey}); refusing to transcode a playlist as source.`,
        { permanent: true },
      );
      return;
    }

    const state = (row.output ?? {}) as {
      immTaskId?: string;
      submittedAt?: string;
      pollErrors?: number;
    };

    // Phase 1 — submit the IMM task, then poll. A submit failure bubbles to
    // processOne's catch → fail() (normal retry budget); a rejected submit is
    // worth a few backed-off retries before dead-lettering.
    if (!state.immTaskId) {
      const taskId = await this.imm.submitHlsTask(
        asset.id,
        asset.bucket,
        asset.objectKey,
      );
      this.logger.log(
        `hls_stream submitted job=${row.id} asset=${asset.id} task=${taskId}`,
      );
      await this.requeueForPoll(
        row,
        {
          immTaskId: taskId,
          submittedAt: new Date().toISOString(),
          pollErrors: 0,
        },
        pollIntervalMs(),
      );
      return;
    }

    // Phase 2 + 3 — poll, then finalize. Transient IMM/OSS errors here must NOT
    // burn the submit retry budget or trigger the exponential fail() backoff
    // (which would dead-letter a healthy transcode and/or delay HLS publish by
    // hours). They're bounded separately by `pollErrors` + the wall-clock
    // `maxMinutes` ceiling. Only TERMINAL provider outcomes call fail().
    try {
      const status = await this.imm.getTaskStatus(state.immTaskId);
      if (status.state === 'running') {
        const submittedAt = state.submittedAt
          ? Date.parse(state.submittedAt)
          : Date.now();
        if (Date.now() - submittedAt > maxMinutes() * 60_000) {
          // A transcode that never finishes is a dead end — re-polling won't
          // help. Dead-letter (visible); a re-enqueue resets state + re-submits.
          await this.fail(
            row,
            `IMM transcode timed out after ${maxMinutes()}m (task=${state.immTaskId}).`,
            { permanent: true },
          );
          return;
        }
        // Healthy poll → reset the transient-error counter.
        await this.requeueForPoll(
          row,
          {
            immTaskId: state.immTaskId,
            submittedAt: state.submittedAt,
            pollErrors: 0,
          },
          pollIntervalMs(),
        );
        return;
      }
      if (status.state === 'failed') {
        // IMM failed the task — re-polling the same task can never recover.
        await this.fail(
          row,
          `IMM transcode failed (task=${state.immTaskId}): ${status.errorMessage ?? status.raw}`,
          { permanent: true },
        );
        return;
      }

      // Succeeded → inspect output, publish variant or keep mp4.
      const finalize = await this.imm.finalizeHls(asset.id);
      if (finalize.segmentCount <= 1) {
        await this.prisma.$transaction((tx) =>
          markStreamVariantFailed(tx, asset.id, {
            reason: 'degenerate_output',
            segmentCount: finalize.segmentCount,
            immTaskId: state.immTaskId ?? null,
          }),
        );
        this.logger.warn(
          `hls_stream degenerate output (${finalize.segmentCount} segment) asset=${asset.id} — keeping mp4`,
        );
        await this.complete(row, {
          skipped: 'degenerate_output',
          segmentCount: finalize.segmentCount,
          immTaskId: state.immTaskId ?? null,
        });
        return;
      }

      const result = await this.prisma.$transaction((tx) =>
        ensureStreamVariantPlacement(tx, {
          assetId: asset.id,
          storageProvider: asset.storageProvider,
          bucket: asset.bucket,
          region: asset.region,
          objectKey: finalize.masterObjectKey,
          durationSeconds: asset.durationSeconds,
          metadata: {
            source: 'imm_media_convert',
            segmentCount: finalize.segmentCount,
            immTaskId: state.immTaskId ?? null,
          },
        }),
      );
      this.logger.log(
        `hls_stream ready job=${row.id} asset=${asset.id} segments=${finalize.segmentCount}`,
      );
      await this.complete(row, {
        variantId: result.variantId,
        placementId: result.placementId,
        segmentCount: finalize.segmentCount,
        immTaskId: state.immTaskId ?? null,
      });
    } catch (err) {
      // Transient poll/finalize error (network blip, OSS read-after-write lag,
      // IMM throttle). Re-queue with a short fixed delay and a bounded counter —
      // never the submit retry budget. Exhaustion → permanent dead-letter.
      const pollErrors = (state.pollErrors ?? 0) + 1;
      if (pollErrors >= MAX_POLL_ERRORS) {
        await this.fail(
          row,
          `IMM poll/finalize failed ${pollErrors}x (task=${state.immTaskId}): ${errorText(err)}`,
          { permanent: true },
        );
        return;
      }
      this.logger.warn(
        `hls_stream transient poll error ${pollErrors}/${MAX_POLL_ERRORS} job=${row.id}: ${errorText(err)}`,
      );
      await this.requeueForPoll(
        row,
        {
          immTaskId: state.immTaskId,
          submittedAt: state.submittedAt,
          pollErrors,
        },
        pollIntervalMs(),
      );
    }
  }

  /**
   * Re-queue a job for its next poll WITHOUT consuming a retry attempt — polling
   * an async provider task is not a failure. Sets `pending` + a future
   * `nextAttemptAt` and clears the lock so `claim()` re-picks it once due.
   */
  private async requeueForPoll(
    row: MediaProcessingJob,
    output: Prisma.InputJsonObject,
    delayMs: number,
  ): Promise<void> {
    await this.prisma.mediaProcessingJob.update({
      where: { id: row.id },
      data: {
        status: MediaProcessingJobStatus.pending,
        output,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: new Date(Date.now() + delayMs),
        errorMessage: null,
      },
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

/** Delay between IMM GetTask polls (tuning knob). */
function pollIntervalMs(): number {
  return positiveInt(process.env.IMM_POLL_INTERVAL_MS, 20_000);
}

/** Ceiling on total IMM transcode wall time before the job is failed. */
function maxMinutes(): number {
  return positiveInt(process.env.IMM_MAX_MINUTES, 30);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

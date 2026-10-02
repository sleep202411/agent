import { MEDIA_PROCESSING_LOCK_TTL_MS } from './media-worker-leases';
import { hostname } from 'os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetVariantStatus,
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
  HLS_VARIANT_KEY,
  markStreamVariantFailed,
  syncStreamOutputPlacements,
} from '../infra/storage/media-asset-placement';
import {
  IMM_HLS_SEGMENT_SECONDS,
  ImmTranscodeService,
  immMaxMinutes,
  type ImmFinalizeResult,
} from '../infra/storage/imm-transcode.service';
import {
  findBlockingHlsTakedown,
  unfinishedHlsTakedownWhere,
} from './hls-output';
import { VideoPosterService } from './video-poster.service';

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 10;
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
/** Phase-1 re-check cadence while an HLS takedown owns the asset's prefix. */
const TAKEDOWN_DEFER_MS = 60_000;
/** Budget for deleting an unpublished output after IMM failed or degenerated. */
const DISCARD_BUDGET_MS = 60_000;

/** The asset became unpublishable while IMM was transcoding it. */
class HlsPublishBlockedError extends Error {}

@Injectable()
export class MediaProcessingWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MediaProcessingWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly imm: ImmTranscodeService,
    private readonly posters: VideoPosterService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.stopped) return;
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

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining;
  }

  async drainOnce(batch = DEFAULT_BATCH_SIZE): Promise<void> {
    if (this.stopped) return;
    if (this.draining) return this.draining;
    this.draining = this.drain(batch).finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(batch: number): Promise<void> {
    try {
      for (
        let processed = 0;
        processed < batch && !this.stopped;
        processed += 1
      ) {
        // Do not age later jobs' leases while a poster or transcode operation
        // is still running. Keep the per-drain work cap without preclaiming it.
        const [row] = await this.claim(1);
        if (!row || this.stopped) break;
        await this.processOne(row);
      }
    } catch (err) {
      this.logger.warn(`media processing drain failed: ${errorText(err)}`);
    }
  }

  private async claim(batch: number): Promise<MediaProcessingJob[]> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - MEDIA_PROCESSING_LOCK_TTL_MS);
    const eligibility = {
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
          AND: [{ OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }] }],
        },
        {
          status: MediaProcessingJobStatus.processing,
          lockedAt: { lt: lockCutoff },
        },
      ],
    };
    const candidates = await this.prisma.mediaProcessingJob.findMany({
      where: eligibility,
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: batch,
      select: { id: true },
    });
    if (this.stopped || candidates.length === 0) return [];

    const ids = candidates.map((row) => row.id);
    await this.prisma.mediaProcessingJob.updateMany({
      where: { ...eligibility, id: { in: ids } },
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
        lockedAt: now,
        status: MediaProcessingJobStatus.processing,
        deadAt: null,
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async processOne(row: MediaProcessingJob): Promise<void> {
    const stopHeartbeat = this.startHeartbeat(row);
    try {
      switch (row.jobType) {
        case MediaProcessingJobType.backfill_original_placement:
          await this.backfillOriginalPlacement(row);
          return;
        case MediaProcessingJobType.hls_stream:
          await this.processHlsStream(row);
          return;
        case MediaProcessingJobType.poster:
          await this.complete(row, await this.posters.generate(row.assetId));
          return;
        case MediaProcessingJobType.thumbnail:
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
    } finally {
      await stopHeartbeat();
    }
  }

  /** Renew liveness without changing startedAt, the immutable claim fence. */
  private startHeartbeat(row: MediaProcessingJob): () => Promise<void> {
    let pending: Promise<void> | null = null;
    let stopped = false;
    const timer = setInterval(
      () => {
        if (stopped || pending) return;
        const now = new Date();
        pending = this.prisma.mediaProcessingJob
          .updateMany({
            where: {
              id: row.id,
              status: MediaProcessingJobStatus.processing,
              deadAt: null,
              lockedBy: row.lockedBy,
              startedAt: row.startedAt,
              lockedAt: {
                gte: new Date(now.getTime() - MEDIA_PROCESSING_LOCK_TTL_MS),
              },
            },
            data: { lockedAt: now },
          })
          .then((result) => {
            if (result.count === 0) {
              stopped = true;
              clearInterval(timer);
            }
          })
          .catch((err: unknown) => {
            this.logger.warn(
              `media processing heartbeat failed job=${row.id}: ${errorText(err)}`,
            );
          })
          .finally(() => {
            pending = null;
          });
      },
      Math.floor(MEDIA_PROCESSING_LOCK_TTL_MS / 3),
    );
    timer.unref?.();
    return async () => {
      stopped = true;
      clearInterval(timer);
      await pending;
    };
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
   * `fail()`. A degenerate output (see {@link degenerateOutput}) is recorded as
   * a failed variant, dead-lettered for an operator retry, and the original mp4
   * keeps playing.
   *
   * Moderation is re-checked at both ends: a blocked asset is never submitted,
   * and the publish transaction takes `FOR SHARE` on the asset so a block that
   * lands mid-transcode cancels the job instead of publishing.
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
        moderationStatus: true,
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
    // Narrowed local: property narrowing does not survive into the
    // $transaction callback below.
    const assetBucket = asset.bucket;
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
    // worth a few backed-off retries before dead-lettering. The guards apply
    // only before submit: an in-flight task is never cut short, IMM must
    // finish writing before anyone can clean its prefix.
    if (!state.immTaskId) {
      if (asset.moderationStatus === MediaAssetModerationStatus.blocked) {
        await this.cancel(
          row,
          'Media asset is moderation-blocked; HLS transcode refused.',
        );
        return;
      }
      const takedown = await findBlockingHlsTakedown(
        this.prisma,
        asset.id,
        new Date(),
      );
      if (takedown) {
        // The prefix is being emptied (or its CDN refresh is still settling).
        // Writing it now would race the delete or splice cached bytes; wait
        // without consuming an attempt.
        await this.requeueForPoll(
          row,
          { deferredByTakedown: takedown.id },
          TAKEDOWN_DEFER_MS,
        );
        return;
      }
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
    // `immMaxMinutes()` ceiling. Only TERMINAL provider outcomes call fail().
    try {
      const status = await this.imm.getTaskStatus(state.immTaskId);
      if (status.state === 'running') {
        const submittedAt = state.submittedAt
          ? Date.parse(state.submittedAt)
          : Date.now();
        if (Date.now() - submittedAt > immMaxMinutes() * 60_000) {
          // A transcode that never finishes is a dead end — re-polling won't
          // help. Dead-letter (visible); a re-enqueue resets state + re-submits.
          await this.fail(
            row,
            `IMM transcode timed out after ${immMaxMinutes()}m (task=${state.immTaskId}).`,
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
        const cleanup = await this.discardUnpublishedOutput(
          asset.id,
          assetBucket,
        );
        await this.fail(
          row,
          `IMM transcode failed (task=${state.immTaskId}): ${status.errorCode ? `${status.errorCode}: ` : ''}${status.errorMessage ?? status.raw}${cleanup}`,
          { permanent: true },
        );
        return;
      }

      // Succeeded → judge the output, then publish it or keep the mp4.
      const finalize = await this.imm.finalizeHls(asset.id);
      const top = topRendition(finalize);
      if (!top || degenerateOutput(finalize, top, asset.durationSeconds)) {
        const wasReady = await this.hlsVariantReady(asset.id);
        await this.prisma.$transaction((tx) =>
          markStreamVariantFailed(tx, asset.id, {
            reason: 'degenerate_output',
            immTaskId: state.immTaskId ?? null,
            renditions: finalize.renditions.map((rendition) => ({
              name: rendition.name,
              segmentCount: rendition.segmentCount,
              durationSeconds: rendition.durationSeconds,
              maxSegmentSeconds: rendition.maxSegmentSeconds,
            })),
            missingKeys: finalize.missingKeys.slice(0, 20),
          }),
        );
        // A previously published output may still be cached on CDN edges;
        // only a takedown (delete + refresh) may remove it. This run's own
        // output was never served, so the worker may delete it.
        const cleanup = wasReady
          ? ''
          : await this.deleteUnpublishedOutput(asset.id, assetBucket);
        await this.fail(
          row,
          `IMM output rejected as degenerate (task=${state.immTaskId}): ${describeOutput(finalize, asset.durationSeconds)}${cleanup}`,
          { permanent: true },
        );
        return;
      }

      await this.imm
        .applyHlsCacheControl(asset.id)
        .catch((err: unknown) =>
          this.logger.warn(
            `HLS Cache-Control pass failed asset=${asset.id}: ${errorText(err)}`,
          ),
        );

      const publishedAt = new Date().toISOString();
      let result: Awaited<ReturnType<typeof ensureStreamVariantPlacement>> & {
        outputs: Awaited<ReturnType<typeof syncStreamOutputPlacements>>;
      };
      try {
        result = await this.prisma.$transaction(async (tx) => {
          // Serialises against the moderation decision's FOR UPDATE: a block
          // either commits first (and is seen here) or waits for this publish
          // and then queues the takedown of what it published.
          const [locked] = await tx.$queryRaw<
            Array<{ moderation_status: MediaAssetModerationStatus }>
          >`SELECT moderation_status FROM media_assets WHERE id=${asset.id}::uuid FOR SHARE`;
          if (!locked) throw new Error('Media asset no longer exists.');
          if (locked.moderation_status === MediaAssetModerationStatus.blocked) {
            throw new HlsPublishBlockedError(
              'Asset was moderation-blocked during transcoding; HLS output not published.',
            );
          }
          // A takedown still emptying this prefix (blocked, then restored while
          // this task ran) would delete what we publish; leave the output to it.
          const takedown = await tx.mediaModerationAction.findFirst({
            where: unfinishedHlsTakedownWhere(asset.id),
            select: { id: true },
          });
          if (takedown) {
            throw new HlsPublishBlockedError(
              `HLS takedown ${takedown.id} is still emptying this asset's output; HLS output not published.`,
            );
          }
          const placement = await ensureStreamVariantPlacement(tx, {
            assetId: asset.id,
            storageProvider: asset.storageProvider,
            bucket: asset.bucket,
            region: asset.region,
            objectKey: finalize.masterObjectKey,
            sizeBytes: finalize.totalBytes,
            width: top.width,
            height: top.height,
            durationMs: Math.round(top.durationSeconds * 1000),
            durationSeconds: asset.durationSeconds,
            metadata: {
              source: 'imm_media_convert',
              immTaskId: state.immTaskId ?? null,
              submittedAt: state.submittedAt ?? null,
              publishedAt,
              renditions: finalize.renditions.map((rendition) => ({
                name: rendition.name,
                width: rendition.width,
                height: rendition.height,
                segmentCount: rendition.segmentCount,
                durationSeconds: rendition.durationSeconds,
              })),
              totalBytes: finalize.totalBytes.toString(),
            },
          });
          // Register EVERY produced HLS object (rendition playlists + segments)
          // too: the ledger of published keys is what a later takedown
          // refreshes on the CDN.
          const outputs = await syncStreamOutputPlacements(tx, {
            assetId: asset.id,
            variantId: placement.variantId,
            storageProvider: asset.storageProvider,
            bucket: assetBucket,
            region: asset.region,
            masterObjectKey: finalize.masterObjectKey,
            objectKeys: finalize.objectKeys,
          });
          return { ...placement, outputs };
        });
      } catch (err) {
        if (!(err instanceof HlsPublishBlockedError)) throw err;
        // Terminal, not transient: the takedown removes the objects once this
        // job can no longer write.
        await this.cancel(row, err.message);
        return;
      }
      this.logger.log(
        `hls_stream ready job=${row.id} asset=${asset.id} renditions=${finalize.renditions.length} ` +
          `outputPlacements(created=${result.outputs.created} reactivated=${result.outputs.reactivated} retired=${result.outputs.retired})`,
      );
      await this.complete(row, {
        variantId: result.variantId,
        placementId: result.placementId,
        immTaskId: state.immTaskId ?? null,
        // Kept from the poll state: claim() overwrites startedAt on every poll,
        // so this is the only record of when IMM started the transcode.
        submittedAt: state.submittedAt ?? null,
        renditions: finalize.renditions.map((rendition) => rendition.name),
        totalBytes: finalize.totalBytes.toString(),
        outputPlacements: { ...result.outputs },
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

  private async hlsVariantReady(assetId: string): Promise<boolean> {
    const variant = await this.prisma.mediaAssetVariant.findUnique({
      where: { assetId_variantKey: { assetId, variantKey: HLS_VARIANT_KEY } },
      select: { status: true, deletedAt: true },
    });
    return (
      variant?.status === MediaAssetVariantStatus.ready &&
      variant.deletedAt === null
    );
  }

  /**
   * Delete a failed task's output unless a published (ready) HLS variant lives
   * under the same prefix — that one may be cached on CDN edges, and only a
   * takedown may remove it. Returns a suffix for the job error, '' on success.
   */
  private async discardUnpublishedOutput(
    assetId: string,
    bucket: string,
  ): Promise<string> {
    try {
      if (await this.hlsVariantReady(assetId)) return '';
    } catch (err) {
      return `; output cleanup failed: ${errorText(err)}`;
    }
    return this.deleteUnpublishedOutput(assetId, bucket);
  }

  /** Best-effort delete of a never-published output; never throws. */
  private async deleteUnpublishedOutput(
    assetId: string,
    bucket: string,
  ): Promise<string> {
    try {
      const result = await this.imm.deleteHlsOutput(
        assetId,
        bucket,
        Date.now() + DISCARD_BUDGET_MS,
      );
      return result.complete
        ? ''
        : `; output cleanup incomplete: deleted ${result.deleted} objects before the ${DISCARD_BUDGET_MS / 1000}s budget ran out`;
    } catch (err) {
      return `; output cleanup failed: ${errorText(err)}`;
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
    await this.prisma.mediaProcessingJob.updateMany({
      where: {
        id: row.id,
        status: MediaProcessingJobStatus.processing,
        lockedBy: row.lockedBy,
        startedAt: row.startedAt,
      },
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
    await this.prisma.mediaProcessingJob.updateMany({
      where: {
        id: row.id,
        status: MediaProcessingJobStatus.processing,
        lockedBy: row.lockedBy,
        startedAt: row.startedAt,
      },
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
    const result = await this.prisma.mediaProcessingJob.updateMany({
      where: {
        id: row.id,
        status: MediaProcessingJobStatus.processing,
        lockedBy: row.lockedBy,
        startedAt: row.startedAt,
      },
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
    if (result.count === 0) return;
    this.logger.warn(
      `media processing failed job=${row.id} type=${row.jobType} attempt=${nextAttempt}/${row.maxAttempts}${isDead ? ' [DLQ]' : ''}: ${message}`,
    );
  }

  /**
   * Terminal refusal that is not a failure: the work must not happen (e.g. the
   * asset was moderation-blocked). `claim()` never picks a cancelled job; only
   * an explicit restart (enqueue with restart) revives it. Guarded like fail().
   */
  private async cancel(
    row: MediaProcessingJob,
    message: string,
  ): Promise<void> {
    const now = new Date();
    const result = await this.prisma.mediaProcessingJob.updateMany({
      where: {
        id: row.id,
        status: MediaProcessingJobStatus.processing,
        lockedBy: row.lockedBy,
        startedAt: row.startedAt,
      },
      data: {
        status: MediaProcessingJobStatus.cancelled,
        attempt: row.attempt + 1,
        errorMessage: message.slice(0, 4000),
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
        failedAt: now,
        deadAt: null,
      },
    });
    if (result.count === 0) return;
    this.logger.warn(
      `media processing cancelled job=${row.id} type=${row.jobType}: ${message}`,
    );
  }
}

/**
 * An IMM "success" that must not be published. Each rule catches a failure
 * seen in practice or one the measurements make cheap to rule out:
 * - no rendition (the caller checks: there is no top tier), or a rendition
 *   with no segment;
 * - a referenced object missing from the bucket (players would 404 mid-play);
 * - a segment longer than twice the 6 s target — the known "one segment for
 *   the whole video" IMM failure, invisible to the duration rule;
 * - the top tier covering less than 90% of the source (truncated source).
 */
function degenerateOutput(
  finalize: ImmFinalizeResult,
  top: ImmFinalizeResult['renditions'][number],
  sourceDurationSeconds: number | null,
): boolean {
  return (
    finalize.renditions.some((rendition) => rendition.segmentCount === 0) ||
    finalize.missingKeys.length > 0 ||
    finalize.renditions.some(
      (rendition) => rendition.maxSegmentSeconds > 2 * IMM_HLS_SEGMENT_SECONDS,
    ) ||
    (sourceDurationSeconds != null &&
      top.durationSeconds < 0.9 * sourceDurationSeconds - 1)
  );
}

/** The measurements behind a degenerate verdict, for the job error. */
function describeOutput(
  finalize: ImmFinalizeResult,
  sourceDurationSeconds: number | null,
): string {
  const renditions = finalize.renditions;
  const top = topRendition(finalize);
  const maxSegmentSeconds = renditions.reduce(
    (max, rendition) => Math.max(max, rendition.maxSegmentSeconds),
    0,
  );
  const missing = finalize.missingKeys;
  return [
    `renditions=${renditions.length > 0 ? renditions.map((rendition) => rendition.name).join(',') : 'none'}`,
    `segments=[${renditions.map((rendition) => rendition.segmentCount).join(',')}]`,
    `maxSegmentSeconds=${round2(maxSegmentSeconds)}`,
    `durationSeconds=${top ? round2(top.durationSeconds) : 'n/a'} (source ${sourceDurationSeconds ?? 'unknown'})`,
    `missing=[${missing.slice(0, 5).join(', ')}${missing.length > 5 ? `, +${missing.length - 5} more` : ''}]`,
  ].join('; ');
}

/** The tallest tier (IMM's master order is not a contract); else the first. */
function topRendition(
  finalize: ImmFinalizeResult,
): ImmFinalizeResult['renditions'][number] | undefined {
  return finalize.renditions.reduce<
    ImmFinalizeResult['renditions'][number] | undefined
  >(
    (best, rendition) =>
      !best || (rendition.height ?? 0) > (best.height ?? 0) ? rendition : best,
    undefined,
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import {
  HttpException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaAssetStatus,
  MediaProcessingJobType,
  MediaStorageProvider,
  Prisma,
  StoryVideoUploadStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { CURRENT_CELL } from '../common/region/current-cell';
import { PrismaService } from '../infra/db/db.module';
import { ensureOriginalMediaPlacement } from '../infra/storage/media-asset-placement';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import { MediaProcessingService } from '../media/media-processing.service';
import { STORY_CLIP_VIDEO_CONTENT_TYPE } from '../media/media-upload.policy';
import {
  StoryUploadedVideoProbeService,
  type StoryUploadedVideoProbeResult,
} from './story-uploaded-video-probe.service';

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 2;
// The initial claim covers a bounded 55-minute provider copy. Promotion then
// renews before the 30-minute download + one-minute ffprobe, so neither phase
// needs a fragile heartbeat timer.
const LEASE_TTL_MS = 65 * 60_000;
const STAGING_SIGNATURE_GRACE_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const RECLAIM_BATCH_SIZE = 25;
const STAGING_RECLAIM_FREQUENT_WINDOW_MS = 24 * 60 * 60_000;
const STAGING_RECLAIM_DAILY_WINDOW_MS = 30 * 24 * 60 * 60_000;
const TERMINAL_STATUSES: StoryVideoUploadStatus[] = [
  StoryVideoUploadStatus.ready,
  StoryVideoUploadStatus.failed,
  StoryVideoUploadStatus.expired,
  StoryVideoUploadStatus.cancelled,
];

interface ClaimedUpload {
  id: string;
}

@Injectable()
export class StoryVideoUploadFinalizeWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(
    StoryVideoUploadFinalizeWorkerService.name,
  );
  private readonly workerId = `story-video-finalize:${hostname()}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageAccessService,
    private readonly probe: StoryUploadedVideoProbeService,
    private readonly mediaProcessing: MediaProcessingService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.STORY_VIDEO_UPLOAD_WORKER_ENABLED === 'false') return;
    const intervalMs = positiveInt(
      process.env.STORY_VIDEO_UPLOAD_WORKER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    void this.drainOnce();
    this.logger.log(
      `Story video finalize worker running every ${intervalMs}ms (${this.workerId})`,
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
      await this.expireUnsubmittedSessions();
      await this.failExhaustedStaleClaims();
      const claimed = await this.claim(Math.max(1, batch));
      await Promise.all(
        claimed.map(async (row) => {
          try {
            await this.processOne(row.id);
          } catch (error) {
            this.logger.warn(
              `Story video worker escaped processOne session=${row.id}: ${errorText(error)}`,
            );
          }
        }),
      );
      await this.reclaimTerminalObjects();
    } catch (error) {
      this.logger.warn(`Story video worker drain failed: ${errorText(error)}`);
    } finally {
      this.draining = false;
    }
  }

  /** One SQL statement chooses and claims rows before any storage I/O. */
  private async claim(batch: number): Promise<ClaimedUpload[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);
    return this.prisma.$queryRaw<ClaimedUpload[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "story_video_upload_sessions"
        WHERE "attempt_count" < "max_attempts"
          AND (
            (
              "status" = 'queued'
              AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
            )
            OR (
              "status" = 'processing'
              AND "lease_expires_at" <= ${now}
            )
          )
        ORDER BY COALESCE("next_attempt_at", "queued_at", "created_at") ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batch}
      )
      UPDATE "story_video_upload_sessions" AS session
      SET
        "status" = 'processing',
        "attempt_count" = session."attempt_count" + 1,
        "processing_at" = COALESCE(session."processing_at", ${now}),
        "lease_owner" = ${this.workerId},
        "lease_acquired_at" = ${now},
        "lease_expires_at" = ${leaseExpiresAt},
        "next_attempt_at" = NULL,
        "updated_at" = ${now}
      FROM candidates
      WHERE session."id" = candidates."id"
      RETURNING session."id"
    `;
  }

  private async processOne(sessionId: string): Promise<void> {
    const session = await this.prisma.storyVideoUploadSession.findFirst({
      where: {
        id: sessionId,
        status: StoryVideoUploadStatus.processing,
        leaseOwner: this.workerId,
      },
      include: { mediaAsset: true },
    });
    if (!session) return;

    const extension = extensionForContentType(session.contentType);
    const finalObjectKey = `media/${CURRENT_CELL}/story-clip-final/${session.workspaceId}/${session.id}.${extension}`;
    try {
      const promoted = await this.storage.promoteObject(
        {
          storageProvider: session.storageProvider,
          bucket: session.bucket,
          region: session.region,
          objectKey: session.stagingObjectKey,
          externalUrl: null,
          contentType: session.contentType,
        },
        {
          storageKey: finalObjectKey,
          contentType: session.contentType,
          expectedSizeBytes: Number(
            session.actualSizeBytes ?? session.declaredSizeBytes,
          ),
          cacheControl: 'public, max-age=31536000, immutable',
        },
      );

      const promotedAt = new Date();
      const recorded = await this.prisma.storyVideoUploadSession.updateMany({
        where: {
          id: session.id,
          status: StoryVideoUploadStatus.processing,
          leaseOwner: this.workerId,
          leaseExpiresAt: { gt: promotedAt },
        },
        data: {
          finalObjectKey: promoted.storageKey,
          leaseExpiresAt: new Date(promotedAt.getTime() + LEASE_TTL_MS),
        },
      });
      if (recorded.count === 0) return;

      // Probe the immutable destination, never the still-signed staging key.
      // This ordering closes the overwrite race between validation and copy.
      const technical = await this.probe.probe({
        storageProvider: session.storageProvider,
        bucket: promoted.bucket,
        region: promoted.region,
        objectKey: promoted.storageKey,
        externalUrl: null,
        contentType: promoted.contentType ?? session.contentType,
        sizeBytes: BigInt(promoted.sizeBytes),
      });
      const committed = await this.commitReady(
        session.id,
        promoted.storageKey,
        promoted.bucket,
        promoted.region ?? null,
        technical,
      );
      if (
        committed &&
        session.storageProvider === MediaStorageProvider.aliyun_oss
      ) {
        await this.enqueueHls(session.mediaAssetId);
      }
    } catch (error) {
      await this.recordFailure(session.id, finalObjectKey, error);
    }
  }

  private async commitReady(
    sessionId: string,
    finalObjectKey: string,
    bucket: string,
    region: string | null,
    technical: StoryUploadedVideoProbeResult,
  ): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const guard = await tx.storyVideoUploadSession.updateMany({
        where: {
          id: sessionId,
          status: StoryVideoUploadStatus.processing,
          leaseOwner: this.workerId,
          leaseExpiresAt: { gt: now },
        },
        data: { leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS) },
      });
      if (guard.count === 0) return false;
      const locked = await tx.storyVideoUploadSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { mediaAsset: true },
      });
      const completedAt = now.toISOString();
      await tx.mediaAsset.update({
        where: { id: locked.mediaAssetId },
        data: {
          storageProvider: locked.storageProvider,
          bucket,
          region,
          objectKey: finalObjectKey,
          externalUrl: null,
          contentType: technical.contentType,
          sizeBytes: technical.sizeBytes,
          width: technical.width,
          height: technical.height,
          durationSeconds: technical.durationSeconds,
          checksumSha256: technical.checksumSha256,
          status: MediaAssetStatus.ready,
          metadata: {
            ...jsonObject(locked.mediaAsset.metadata),
            storagePhase: 'immutable_final',
            storyClipUpload: {
              completedAt,
              probedBy: 'ffprobe',
              durationSecondsExact: technical.durationSecondsExact,
              videoCodec: technical.videoCodec,
              audioCodecs: technical.audioCodecs,
              browserSafeMp4: technical.browserSafeMp4,
            },
          },
        },
      });
      await ensureOriginalMediaPlacement(tx, {
        assetId: locked.mediaAssetId,
        storageProvider: locked.storageProvider,
        bucket,
        region,
        objectKey: finalObjectKey,
        externalUrl: null,
        contentType: technical.contentType,
        sizeBytes: technical.sizeBytes,
        width: technical.width,
        height: technical.height,
        durationMs: technical.durationMs,
        durationSeconds: technical.durationSeconds,
        checksumSha256: technical.checksumSha256,
        metadata: {
          source: 'direct_upload',
          uploadKind: 'story_clip_video',
          uploadSessionId: locked.id,
          completedAt,
          probedBy: 'ffprobe',
          durationSecondsExact: technical.durationSecondsExact,
          videoCodec: technical.videoCodec,
          audioCodecs: technical.audioCodecs,
          browserSafeMp4: technical.browserSafeMp4,
        },
      });
      await tx.storyVideoUploadSession.update({
        where: { id: locked.id },
        data: {
          status: StoryVideoUploadStatus.ready,
          finalObjectKey,
          actualSizeBytes: technical.sizeBytes,
          completedAt: now,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          reclaimAfter: stagingReclaimAfter(locked.expiresAt, now),
          errorCode: null,
          errorDetail: null,
        },
      });
      return true;
    });
  }

  private async recordFailure(
    sessionId: string,
    finalObjectKey: string,
    error: unknown,
  ): Promise<void> {
    const row = await this.prisma.storyVideoUploadSession.findFirst({
      where: {
        id: sessionId,
        status: StoryVideoUploadStatus.processing,
        leaseOwner: this.workerId,
      },
    });
    if (!row) return;
    const now = new Date();
    const permanent = isPermanent(error) || row.attemptCount >= row.maxAttempts;
    const code = errorCode(error) ?? 'STORY_VIDEO_FINALIZE_FAILED';
    const detail = errorText(error);
    const changedCount = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.storyVideoUploadSession.updateMany({
        where: {
          id: row.id,
          status: StoryVideoUploadStatus.processing,
          leaseOwner: this.workerId,
        },
        data: permanent
          ? {
              status: StoryVideoUploadStatus.failed,
              finalObjectKey,
              finalReclaimAfter: now,
              failedAt: now,
              reclaimAfter: stagingReclaimAfter(row.expiresAt, now),
              nextAttemptAt: null,
              leaseOwner: null,
              leaseAcquiredAt: null,
              leaseExpiresAt: null,
              errorCode: code,
              errorDetail: detail,
            }
          : {
              status: StoryVideoUploadStatus.queued,
              finalObjectKey,
              nextAttemptAt: new Date(
                now.getTime() + retryBackoffMs(row.attemptCount),
              ),
              leaseOwner: null,
              leaseAcquiredAt: null,
              leaseExpiresAt: null,
              errorCode: code,
              errorDetail: detail,
            },
      });
      if (permanent && changed.count > 0) {
        await tx.mediaAsset.updateMany({
          where: {
            id: row.mediaAssetId,
            status: MediaAssetStatus.uploading,
          },
          data: { status: MediaAssetStatus.failed },
        });
      }
      return changed.count;
    });
    if (changedCount === 0) return;
    this.logger.warn(
      `Story video finalize ${permanent ? 'failed' : 'will retry'} session=${row.id} attempt=${row.attemptCount}: ${detail}`,
    );
  }

  private async enqueueHls(assetId: string): Promise<void> {
    try {
      await this.mediaProcessing.enqueueJob({
        assetId,
        jobType: MediaProcessingJobType.hls_stream,
        priority: 50,
        idempotencyKey: `hls-stream:${assetId}`,
      });
    } catch (error) {
      this.logger.warn(
        `failed to enqueue hls_stream after Story video finalization asset=${assetId}: ${errorText(error)}`,
      );
    }
  }

  private async expireUnsubmittedSessions(): Promise<void> {
    const now = new Date();
    const rows = await this.prisma.storyVideoUploadSession.findMany({
      where: {
        status: {
          in: [StoryVideoUploadStatus.issued, StoryVideoUploadStatus.confirmed],
        },
        expiresAt: { lte: now },
      },
      take: RECLAIM_BATCH_SIZE,
      select: { id: true, mediaAssetId: true, expiresAt: true },
    });
    if (rows.length === 0) return;
    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.storyVideoUploadSession.updateMany({
          where: {
            id: row.id,
            status: {
              in: [
                StoryVideoUploadStatus.issued,
                StoryVideoUploadStatus.confirmed,
              ],
            },
            expiresAt: { lte: now },
          },
          data: {
            status: StoryVideoUploadStatus.expired,
            reclaimAfter: new Date(now.getTime() + STAGING_SIGNATURE_GRACE_MS),
            errorCode: 'STORY_VIDEO_UPLOAD_EXPIRED',
            errorDetail: 'The upload URL expired before finalization.',
          },
        });
        if (changed.count > 0) {
          await tx.mediaAsset.updateMany({
            where: {
              id: row.mediaAssetId,
              status: MediaAssetStatus.uploading,
            },
            data: { status: MediaAssetStatus.failed },
          });
        }
      });
    }
  }

  private async failExhaustedStaleClaims(): Promise<void> {
    const now = new Date();
    const rows = await this.prisma.storyVideoUploadSession.findMany({
      where: {
        status: StoryVideoUploadStatus.processing,
        leaseExpiresAt: { lte: now },
      },
      take: RECLAIM_BATCH_SIZE,
      select: {
        id: true,
        mediaAssetId: true,
        expiresAt: true,
        workspaceId: true,
        contentType: true,
        finalObjectKey: true,
        attemptCount: true,
        maxAttempts: true,
      },
    });
    for (const row of rows.filter(
      (candidate) => candidate.attemptCount >= candidate.maxAttempts,
    )) {
      const finalObjectKey =
        row.finalObjectKey ??
        `media/${CURRENT_CELL}/story-clip-final/${row.workspaceId}/${row.id}.${extensionForContentType(row.contentType)}`;
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.storyVideoUploadSession.updateMany({
          where: {
            id: row.id,
            status: StoryVideoUploadStatus.processing,
            leaseExpiresAt: { lte: now },
          },
          data: {
            status: StoryVideoUploadStatus.failed,
            finalObjectKey,
            finalReclaimAfter: now,
            failedAt: now,
            reclaimAfter: stagingReclaimAfter(row.expiresAt, now),
            nextAttemptAt: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            errorCode: 'STORY_VIDEO_FINALIZE_WORKER_LOST',
            errorDetail:
              'The video finalization worker stopped repeatedly before completion.',
          },
        });
        if (changed.count > 0) {
          await tx.mediaAsset.updateMany({
            where: {
              id: row.mediaAssetId,
              status: MediaAssetStatus.uploading,
            },
            data: { status: MediaAssetStatus.failed },
          });
        }
      });
    }
  }

  private async reclaimTerminalObjects(): Promise<void> {
    const now = new Date();
    const staging = await this.prisma.storyVideoUploadSession.findMany({
      where: {
        status: { in: TERMINAL_STATUSES },
        reclaimAfter: { lte: now },
      },
      orderBy: [{ reclaimAfter: 'asc' }, { createdAt: 'asc' }],
      take: RECLAIM_BATCH_SIZE,
    });
    for (const row of staging) {
      try {
        await this.storage.deleteObject({
          storageProvider: row.storageProvider,
          bucket: row.bucket,
          region: row.region,
          objectKey: row.stagingObjectKey,
          externalUrl: null,
          contentType: row.contentType,
        });
        await this.prisma.storyVideoUploadSession.updateMany({
          where: {
            id: row.id,
            status: { in: TERMINAL_STATUSES },
            reclaimAfter: { lte: now },
          },
          data: {
            stagingReclaimedAt: now,
            // A PUT authorized just before signature expiry can complete after
            // an earlier delete and recreate staging. Keep scheduling
            // idempotent tombstone deletes; cadence backs off as the session
            // ages so cleanup remains bounded at scale.
            reclaimAfter: nextStagingReclaimAfter(row.expiresAt, now),
          },
        });
      } catch (error) {
        this.logger.warn(
          `failed to reclaim Story staging object session=${row.id}: ${errorText(error)}`,
        );
      }
    }

    const invalidFinals = await this.prisma.storyVideoUploadSession.findMany({
      where: {
        status: {
          in: [
            StoryVideoUploadStatus.failed,
            StoryVideoUploadStatus.expired,
            StoryVideoUploadStatus.cancelled,
          ],
        },
        finalObjectKey: { not: null },
        finalReclaimAfter: { lte: now },
      },
      orderBy: [{ finalReclaimAfter: 'asc' }, { createdAt: 'asc' }],
      take: RECLAIM_BATCH_SIZE,
    });
    for (const row of invalidFinals) {
      if (!row.finalObjectKey) continue;
      try {
        await this.storage.deleteObject({
          storageProvider: row.storageProvider,
          bucket: row.bucket,
          region: row.region,
          objectKey: row.finalObjectKey,
          externalUrl: null,
          contentType: row.contentType,
        });
        await this.prisma.storyVideoUploadSession.updateMany({
          where: {
            id: row.id,
            status: {
              in: [
                StoryVideoUploadStatus.failed,
                StoryVideoUploadStatus.expired,
                StoryVideoUploadStatus.cancelled,
              ],
            },
            finalReclaimAfter: { lte: now },
          },
          data: {
            finalReclaimedAt: now,
            // A timed-out provider copy can materialize after an earlier
            // delete. Keep an independent tombstone schedule for invalid
            // final keys until any delayed copy is eventually removed.
            finalReclaimAfter: nextStagingReclaimAfter(row.expiresAt, now),
          },
        });
      } catch (error) {
        this.logger.warn(
          `failed to reclaim invalid Story final object session=${row.id}: ${errorText(error)}`,
        );
      }
    }
  }
}

function extensionForContentType(contentType: string): string {
  if (contentType.toLowerCase() === STORY_CLIP_VIDEO_CONTENT_TYPE) {
    return 'mp4';
  }
  throw new HttpException(
    {
      code: 'STORY_VIDEO_UPLOAD_CONTENT_TYPE_INVALID',
      message: 'The Story video content type is not supported.',
    },
    422,
  );
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function stagingReclaimAfter(expiresAt: Date, now: Date): Date {
  return new Date(
    Math.max(now.getTime(), expiresAt.getTime() + STAGING_SIGNATURE_GRACE_MS),
  );
}

function nextStagingReclaimAfter(expiresAt: Date, now: Date): Date {
  const ageMs = Math.max(0, now.getTime() - expiresAt.getTime());
  const delayMs =
    ageMs < STAGING_RECLAIM_FREQUENT_WINDOW_MS
      ? 15 * 60_000
      : ageMs < STAGING_RECLAIM_DAILY_WINDOW_MS
        ? 24 * 60 * 60_000
        : 30 * 24 * 60 * 60_000;
  return new Date(now.getTime() + delayMs);
}

function retryBackoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

function isPermanent(error: unknown): boolean {
  return (
    error instanceof HttpException &&
    error.getStatus() >= 400 &&
    error.getStatus() < 500
  );
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const response: unknown = error.getResponse();
  return response &&
    typeof response === 'object' &&
    'code' in response &&
    typeof (response as { code?: unknown }).code === 'string'
    ? (response as { code: string }).code
    : null;
}

function errorText(error: unknown): string {
  if (error instanceof HttpException) {
    const response: unknown = error.getResponse();
    if (
      response &&
      typeof response === 'object' &&
      'message' in response &&
      typeof (response as { message?: unknown }).message === 'string'
    ) {
      return (response as { message: string }).message.slice(0, 4000);
    }
  }
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4000,
  );
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      'STORY_VIDEO_UPLOAD_WORKER_INTERVAL_MS must be a positive integer.',
    );
  }
  return parsed;
}

import { CDN_PURGE_LOCK_TTL_MS } from './media-worker-leases';
import { backgroundTasksEnabled } from '../common/background-tasks';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaObjectPlacementStatus,
  type MediaModerationAction,
  type MediaObjectPlacement,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { CdnPurgeProvider } from './cdn-purge.provider';
import {
  MEDIA_ACTION_MAX_ATTEMPTS as MAX_ATTEMPTS,
  MEDIA_ACTION_POD_ID as POD_ID,
  errorText,
  isJsonObject,
  mediaActionBackoffMs,
  mergeJson,
  positiveInt,
} from './media-action-queue.util';

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 25;

type PurgeActionRow = MediaModerationAction & {
  placement: MediaObjectPlacement | null;
};

@Injectable()
export class CdnPurgeWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CdnPurgeWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetUrls: MediaAssetUrlResolverService,
    private readonly purgeProvider: CdnPurgeProvider,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped) return;
    if (process.env.MEDIA_CDN_PURGE_WORKER_ENABLED === 'false') return;
    const intervalMs = positiveInt(
      process.env.MEDIA_CDN_PURGE_WORKER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `CDN purge worker running every ${intervalMs}ms (pod=${POD_ID})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining;
  }

  async drainOnce(batch = DEFAULT_BATCH_SIZE): Promise<void> {
    if (!backgroundTasksEnabled()) return;
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
        const [row] = await this.claim(1);
        if (!row || this.stopped) break;
        await this.purgeOne(row);
      }
    } catch (err) {
      this.logger.warn(`CDN purge drain failed: ${errorText(err)}`);
    }
  }

  private async claim(batch: number): Promise<PurgeActionRow[]> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - CDN_PURGE_LOCK_TTL_MS);
    const eligibility = {
      actionType: MediaModerationActionType.purge_cdn,
      status: {
        in: [
          MediaModerationActionStatus.pending,
          MediaModerationActionStatus.failed,
        ],
      },
      deadAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [
        {
          OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }],
        },
      ],
    };
    const candidates = await this.prisma.mediaModerationAction.findMany({
      where: eligibility,
      orderBy: { createdAt: 'asc' },
      take: batch,
      select: { id: true },
    });
    if (this.stopped || candidates.length === 0) return [];

    const ids = candidates.map((row) => row.id);
    await this.prisma.mediaModerationAction.updateMany({
      where: { ...eligibility, id: { in: ids } },
      data: { lockedAt: now, lockedBy: POD_ID },
    });

    return this.prisma.mediaModerationAction.findMany({
      where: {
        id: { in: ids },
        lockedBy: POD_ID,
        lockedAt: now,
        deadAt: null,
      },
      include: { placement: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async purgeOne(row: PurgeActionRow): Promise<void> {
    if (!row.placement) {
      await this.fail(
        row,
        'Cannot purge CDN: media placement no longer exists.',
      );
      return;
    }

    const now = new Date();
    try {
      const result = await this.purgeProvider.purge({
        actionId: row.id,
        provider: row.provider ?? row.placement.cdnProvider ?? null,
        cacheKey: cacheKeyFor(row),
        url: this.resolvePlacementUrl(row.placement),
        placement: row.placement,
      });
      await this.prisma.$transaction(async (tx) => {
        // Guard the terminal write: if a concurrent moderation decision
        // cancelled this action (or another pod stole an expired lock), the
        // update affects 0 rows and we must NOT flip the placement to purged —
        // otherwise a just-restored placement flaps back to purged.
        const res = await tx.mediaModerationAction.updateMany({
          where: {
            id: row.id,
            lockedBy: POD_ID,
            lockedAt: row.lockedAt,
            status: {
              in: [
                MediaModerationActionStatus.pending,
                MediaModerationActionStatus.failed,
              ],
            },
          },
          data: {
            status: MediaModerationActionStatus.completed,
            attempt: row.attempt + 1,
            providerTaskId: result.providerTaskId,
            errorMessage: null,
            metadata: mergeJson(row.metadata, {
              purgeResult: result.metadata ?? {},
            }),
            lastAttemptAt: now,
            completedAt: now,
            failedAt: null,
            nextAttemptAt: null,
            lockedAt: null,
            lockedBy: null,
            deadAt: null,
          },
        });
        if (res.count === 0 || !row.placement) return;
        await tx.mediaObjectPlacement.update({
          where: { id: row.placement.id },
          data: {
            status: MediaObjectPlacementStatus.purged,
            purgedAt: now,
          },
        });
      });
    } catch (err) {
      await this.fail(row, errorText(err));
    }
  }

  private async fail(row: PurgeActionRow, message: string): Promise<void> {
    const now = new Date();
    const nextAttempt = row.attempt + 1;
    const isDead = nextAttempt >= MAX_ATTEMPTS;
    const backoff = mediaActionBackoffMs(row.attempt);

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.mediaModerationAction.updateMany({
        where: {
          id: row.id,
          lockedBy: POD_ID,
          lockedAt: row.lockedAt,
          status: {
            in: [
              MediaModerationActionStatus.pending,
              MediaModerationActionStatus.failed,
            ],
          },
        },
        data: {
          status: MediaModerationActionStatus.failed,
          attempt: nextAttempt,
          errorMessage: message.slice(0, 4000),
          lastAttemptAt: now,
          failedAt: now,
          nextAttemptAt: isDead ? null : new Date(Date.now() + backoff),
          lockedAt: null,
          lockedBy: null,
          deadAt: isDead ? now : null,
        },
      });
      if (res.count === 0) return;
      if (isDead && row.placement) {
        await tx.mediaObjectPlacement.update({
          where: { id: row.placement.id },
          data: { status: MediaObjectPlacementStatus.failed },
        });
      }
    });
    this.logger.warn(
      `CDN purge failed action=${row.id} attempt=${nextAttempt}/${MAX_ATTEMPTS}${isDead ? ' [DLQ]' : ''}: ${message}`,
    );
  }

  private resolvePlacementUrl(placement: MediaObjectPlacement): string | null {
    try {
      return this.assetUrls.resolvePlacement(placement);
    } catch (err) {
      this.logger.warn(
        `Could not materialize placement URL placement=${placement.id}: ${errorText(err)}`,
      );
      return null;
    }
  }
}

function cacheKeyFor(row: PurgeActionRow): string | null {
  const metadataCacheKey =
    isJsonObject(row.metadata) && typeof row.metadata.cdnCacheKey === 'string'
      ? row.metadata.cdnCacheKey
      : null;
  return (
    row.placement?.cdnCacheKey ??
    metadataCacheKey ??
    row.placement?.objectKey ??
    null
  );
}

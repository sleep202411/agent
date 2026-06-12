import { hostname } from 'os';
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
  Prisma,
  type MediaModerationAction,
  type MediaObjectPlacement,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { CdnPurgeProvider } from './cdn-purge.provider';

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 25;
const LOCK_TTL_MS = 2 * 60_000;
const MAX_ATTEMPTS = 8;
const BACKOFFS_MS = [
  5_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
];
const POD_ID = `${hostname()}-${process.pid}`;

type PurgeActionRow = MediaModerationAction & {
  placement: MediaObjectPlacement | null;
};

@Injectable()
export class CdnPurgeWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CdnPurgeWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetUrls: MediaAssetUrlResolverService,
    private readonly purgeProvider: CdnPurgeProvider,
  ) {}

  onApplicationBootstrap(): void {
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

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(batch = DEFAULT_BATCH_SIZE): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const claimed = await this.claim(batch);
      for (const row of claimed) {
        await this.purgeOne(row);
      }
    } catch (err) {
      this.logger.warn(`CDN purge drain failed: ${errorText(err)}`);
    } finally {
      this.draining = false;
    }
  }

  private async claim(batch: number): Promise<PurgeActionRow[]> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - LOCK_TTL_MS);
    const candidates = await this.prisma.mediaModerationAction.findMany({
      where: {
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
      },
      orderBy: { createdAt: 'asc' },
      take: batch,
      select: { id: true },
    });
    if (candidates.length === 0) return [];

    const ids = candidates.map((row) => row.id);
    await this.prisma.mediaModerationAction.updateMany({
      where: {
        id: { in: ids },
        actionType: MediaModerationActionType.purge_cdn,
        status: {
          in: [
            MediaModerationActionStatus.pending,
            MediaModerationActionStatus.failed,
          ],
        },
        deadAt: null,
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }],
      },
      data: { lockedAt: now, lockedBy: POD_ID },
    });

    return this.prisma.mediaModerationAction.findMany({
      where: {
        id: { in: ids },
        lockedBy: POD_ID,
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
      await this.prisma.$transaction([
        this.prisma.mediaModerationAction.update({
          where: { id: row.id },
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
        }),
        this.prisma.mediaObjectPlacement.update({
          where: { id: row.placement.id },
          data: {
            status: MediaObjectPlacementStatus.purged,
            purgedAt: now,
          },
        }),
      ]);
    } catch (err) {
      await this.fail(row, errorText(err));
    }
  }

  private async fail(row: PurgeActionRow, message: string): Promise<void> {
    const now = new Date();
    const nextAttempt = row.attempt + 1;
    const isDead = nextAttempt >= MAX_ATTEMPTS;
    const backoff = BACKOFFS_MS[Math.min(row.attempt, BACKOFFS_MS.length - 1)];

    const updates: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.mediaModerationAction.update({
        where: { id: row.id },
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
      }),
    ];
    if (isDead && row.placement) {
      updates.push(
        this.prisma.mediaObjectPlacement.update({
          where: { id: row.placement.id },
          data: { status: MediaObjectPlacementStatus.failed },
        }),
      );
    }
    await this.prisma.$transaction(updates);
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

function mergeJson(
  current: Prisma.JsonValue,
  patch: Record<string, unknown>,
): Prisma.InputJsonObject {
  return {
    ...(isJsonObject(current) ? current : {}),
    ...patch,
  } as Prisma.InputJsonObject;
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { MediaAssetStatus } from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { backgroundTasksEnabled } from '../../common/background-tasks';
import { CrewAssetsService } from './assets.service';

const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 50;

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Crash recovery for confirmed crew uploads that never reached a message or
 * asset node. Discovery is bounded and index-friendly; deletion re-checks age
 * and ownership under the same per-upload advisory lock used by every claim
 * path, making multiple server replicas safe.
 */
@Injectable()
export class CrewAssetUploadCleanupWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CrewAssetUploadCleanupWorker.name);
  private readonly pollIntervalMs = positiveIntegerEnv(
    'CREW_ASSET_UPLOAD_CLEANUP_POLL_MS',
    DEFAULT_POLL_INTERVAL_MS,
  );
  private readonly maxAgeMs = positiveIntegerEnv(
    'CREW_ASSET_UPLOAD_MAX_PENDING_MS',
    DEFAULT_MAX_AGE_MS,
  );
  private readonly batchSize = positiveIntegerEnv(
    'CREW_ASSET_UPLOAD_CLEANUP_BATCH_SIZE',
    DEFAULT_BATCH_SIZE,
  );
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;
  // Traverse each bounded queue independently, even when rows fail to reclaim.
  // ID keysets stay usable after successful cleanup removes the cursor row.
  private pendingCursor: string | undefined;
  private deletedCursor: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: CrewAssetsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped) return;
    this.timer = setInterval(
      () => this.runScheduledDrain(),
      this.pollIntervalMs,
    );
    this.timer.unref?.();
    this.runScheduledDrain();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      await this.draining;
    } catch (error) {
      this.logger.warn(
        `Crew upload cleanup stopped with an unfinished sweep: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private runScheduledDrain(): void {
    void this.drainOnce().catch((error: unknown) => {
      this.logger.error(
        `Crew upload cleanup sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async drainOnce(now = new Date()): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped) return;
    if (this.draining) return this.draining;
    this.draining = this.drain(now).finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(now: Date): Promise<void> {
    await this.assets.cleanupUploadReservations();
    if (this.stopped) return;
    const createdBefore = new Date(now.getTime() - this.maxAgeMs);
    const candidates = await this.prisma.mediaAsset.findMany({
      where: {
        status: MediaAssetStatus.ready,
        ...(this.pendingCursor ? { id: { gt: this.pendingCursor } } : {}),
        deletedAt: null,
        createdAt: { lt: createdBefore },
        metadata: {
          path: ['uploadKind'],
          equals: 'crew_asset_file',
        },
        crewAssetNodes: { none: {} },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: this.batchSize,
    });

    for (const candidate of candidates) {
      if (this.stopped) return;
      try {
        await this.assets.reclaimExpiredPendingUpload(
          candidate.id,
          createdBefore,
        );
      } catch (error) {
        this.logger.warn(
          `Crew upload cleanup failed asset=${candidate.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      this.pendingCursor = candidate.id;
    }
    if (candidates.length < this.batchSize) this.pendingCursor = undefined;
    if (this.stopped) return;
    const deleted = await this.prisma.mediaAsset.findMany({
      where: {
        status: MediaAssetStatus.deleted,
        ...(this.deletedCursor ? { id: { gt: this.deletedCursor } } : {}),
        deletedAt: { not: null },
        AND: [
          { metadata: { path: ['uploadKind'], equals: 'crew_asset_file' } },
          { metadata: { path: ['crewPhysicalDeletionPending'], equals: true } },
        ],
        crewAssetNodes: { none: {} },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: this.batchSize,
    });
    for (const asset of deleted) {
      if (this.stopped) return;
      try {
        await this.assets.reclaimDeletedCrewUpload(asset.id);
      } catch (error) {
        this.logger.warn(
          `Crew deleted-media cleanup failed asset=${asset.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.deletedCursor = asset.id;
    }
    if (deleted.length < this.batchSize) this.deletedCursor = undefined;
  }
}

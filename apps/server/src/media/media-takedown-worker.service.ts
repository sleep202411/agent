import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaStorageProvider,
  Prisma,
  type MediaModerationAction,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import type {
  OutputStorageService,
  StorageObjectRef,
} from '../infra/storage/storage.types';
import {
  MEDIA_ACTION_MAX_ATTEMPTS,
  MEDIA_ACTION_POD_ID,
  errorText,
  isJsonObject,
  mediaActionBackoffMs,
  mergeJson,
  positiveInt,
} from './media-action-queue.util';

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 25;
const LOCK_TTL_MS = 2 * 60_000;

/**
 * Executes the physical half of a moderation takedown: making the stored
 * objects of a blocked asset unreachable via their public URLs, and reversing
 * it on restore.
 *
 * Companion to {@link CdnPurgeWorkerService} (which clears CDN caches); both
 * drain `MediaModerationAction` rows with the proven claim/lock/retry/DLQ
 * pattern. This worker owns `restrict_visibility` actions, whose
 * `metadata.direction` is `restrict` (block) or `restore` (unblock). Each
 * action targets ONE physical object — the asset's own object
 * (`placementId === null`) or a single placement — so a multi-object asset
 * fans out to several actions.
 *
 * Idempotency is anchored on the TARGET ROW's `metadata.moderationRestricted`
 * flag, not on blind storage retries: a restrict on an already-restricted row
 * is a no-op success, and a restore reads the row's recorded original location
 * (`metadata.quarantine`) so an Azure-relocated object goes back where it came
 * from. This makes both block→restore races and crash-mid-action retries safe.
 */
@Injectable()
export class MediaTakedownWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MediaTakedownWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageRegistry: StorageProviderRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.MEDIA_TAKEDOWN_WORKER_ENABLED === 'false') return;
    const intervalMs = positiveInt(
      process.env.MEDIA_TAKEDOWN_WORKER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Media takedown worker running every ${intervalMs}ms (pod=${MEDIA_ACTION_POD_ID})`,
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
        await this.runOne(row);
      }
    } catch (err) {
      this.logger.warn(`Takedown drain failed: ${errorText(err)}`);
    } finally {
      this.draining = false;
    }
  }

  private async claim(batch: number): Promise<MediaModerationAction[]> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - LOCK_TTL_MS);
    const candidates = await this.prisma.mediaModerationAction.findMany({
      where: {
        actionType: MediaModerationActionType.restrict_visibility,
        status: {
          in: [
            MediaModerationActionStatus.pending,
            MediaModerationActionStatus.failed,
          ],
        },
        deadAt: null,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        AND: [{ OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }] }],
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
        actionType: MediaModerationActionType.restrict_visibility,
        status: {
          in: [
            MediaModerationActionStatus.pending,
            MediaModerationActionStatus.failed,
          ],
        },
        deadAt: null,
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }],
      },
      data: { lockedAt: now, lockedBy: MEDIA_ACTION_POD_ID },
    });

    return this.prisma.mediaModerationAction.findMany({
      where: { id: { in: ids }, lockedBy: MEDIA_ACTION_POD_ID, deadAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async runOne(row: MediaModerationAction): Promise<void> {
    try {
      const direction = directionOf(row.metadata);
      if (!direction) {
        // Inert: no direction recorded — nothing the worker can act on.
        await this.complete(row, { outcome: { skipped: 'no_direction' } });
        return;
      }
      const target = await this.loadTarget(row);
      if (!target) {
        // Target row gone (asset/placement deleted). The takedown is moot.
        await this.complete(row, { outcome: { skipped: 'target_missing' } });
        return;
      }
      if (!target.objectKey || target.bucket == null) {
        await this.complete(row, { outcome: { skipped: 'no_object' } });
        return;
      }
      const storage = this.storageRegistry.forProvider(target.storageProvider);
      if (!storage) {
        // external_url / s3_compatible: no object we can flip. The DTO
        // moderation gate is the only enforcement; mark done, don't retry.
        await this.complete(row, {
          outcome: {
            skipped: `provider_unsupported:${target.storageProvider}`,
          },
        });
        return;
      }
      if (direction === 'restrict') {
        await this.runRestrict(row, target, storage);
      } else {
        await this.runRestore(row, target, storage);
      }
    } catch (err) {
      await this.fail(row, errorText(err));
    }
  }

  private async runRestrict(
    row: MediaModerationAction,
    target: TargetState,
    storage: OutputStorageService,
  ): Promise<void> {
    if (target.restricted) {
      await this.complete(row, { outcome: { skipped: 'already_restricted' } });
      return;
    }
    const before: StorageObjectRef = {
      bucket: target.bucket!,
      storageKey: target.objectKey!,
      region: target.region,
    };
    const result = await storage.restrictObject(before);
    await this.complete(row, {
      target,
      bucket: result.bucket,
      objectKey: result.storageKey,
      metadataPatch: {
        moderationRestricted: true,
        quarantine: result.relocated
          ? { originalBucket: before.bucket, originalKey: before.storageKey }
          : null,
      },
      outcome: { result: 'restricted', relocated: result.relocated },
    });
  }

  private async runRestore(
    row: MediaModerationAction,
    target: TargetState,
    storage: OutputStorageService,
  ): Promise<void> {
    // Always run the (idempotent) restore — never short-circuit on the cached
    // `restricted` flag. The flag is written asynchronously by a prior restrict
    // action; gating restore on it would strand content restricted under a
    // block→restore race (the restrict commits its flag after restore decided
    // "nothing to restore"). restoreObject is a no-op when already public.
    const current: StorageObjectRef = {
      bucket: target.bucket!,
      storageKey: target.objectKey!,
      region: target.region,
    };
    const original: StorageObjectRef = target.quarantine
      ? {
          bucket: target.quarantine.originalBucket,
          storageKey: target.quarantine.originalKey,
          region: target.region,
        }
      : current;
    const result = await storage.restoreObject(current, original);
    await this.complete(row, {
      target,
      bucket: result.bucket,
      objectKey: result.storageKey,
      metadataPatch: { moderationRestricted: false, quarantine: null },
      outcome: { result: 'restored' },
    });
  }

  private async loadTarget(
    row: MediaModerationAction,
  ): Promise<TargetState | null> {
    if (row.placementId) {
      const placement = await this.prisma.mediaObjectPlacement.findUnique({
        where: { id: row.placementId },
        select: {
          id: true,
          storageProvider: true,
          bucket: true,
          region: true,
          objectKey: true,
          metadata: true,
        },
      });
      if (!placement) return null;
      return {
        kind: 'placement',
        id: placement.id,
        storageProvider: placement.storageProvider,
        bucket: placement.bucket,
        region: placement.region,
        objectKey: placement.objectKey,
        metadata: placement.metadata,
        restricted: isRestricted(placement.metadata),
        quarantine: quarantineOf(placement.metadata),
      };
    }
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: row.assetId },
      select: {
        id: true,
        storageProvider: true,
        bucket: true,
        region: true,
        objectKey: true,
        metadata: true,
      },
    });
    if (!asset) return null;
    return {
      kind: 'asset',
      id: asset.id,
      storageProvider: asset.storageProvider,
      bucket: asset.bucket,
      region: asset.region,
      objectKey: asset.objectKey,
      metadata: asset.metadata,
      restricted: isRestricted(asset.metadata),
      quarantine: quarantineOf(asset.metadata),
    };
  }

  /**
   * Terminal write for an action. The action row update and the target-row
   * metadata/location update commit in ONE transaction, and the action update
   * is GUARDED by `{ lockedBy: me, status in [pending, failed] }`: if a
   * concurrent moderation decision cancelled the action (or another pod stole
   * an expired lock), the update affects 0 rows and we touch neither the action
   * nor the target — so a superseded action can never resurrect itself or write
   * contradictory state. The storage side is already idempotent, so the only
   * invariant that must hold is flag↔action, which this atomicity guarantees.
   */
  private async complete(
    row: MediaModerationAction,
    opts: {
      target?: TargetState;
      bucket?: string;
      objectKey?: string;
      metadataPatch?: Record<string, unknown>;
      outcome: Record<string, unknown>;
    },
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.mediaModerationAction.updateMany({
        where: {
          id: row.id,
          lockedBy: MEDIA_ACTION_POD_ID,
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
          errorMessage: null,
          metadata: mergeJson(row.metadata, { takedownResult: opts.outcome }),
          lastAttemptAt: now,
          completedAt: now,
          failedAt: null,
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          deadAt: null,
        },
      });
      if (res.count === 0) return; // superseded — do not touch target state
      if (opts.target && opts.metadataPatch) {
        const metadata = mergeJson(opts.target.metadata, opts.metadataPatch);
        const data = {
          bucket: opts.bucket,
          objectKey: opts.objectKey,
          metadata,
        };
        if (opts.target.kind === 'placement') {
          await tx.mediaObjectPlacement.update({
            where: { id: opts.target.id },
            data,
          });
        } else {
          await tx.mediaAsset.update({ where: { id: opts.target.id }, data });
        }
      }
    });
  }

  private async fail(
    row: MediaModerationAction,
    message: string,
  ): Promise<void> {
    const now = new Date();
    const nextAttempt = row.attempt + 1;
    const isDead = nextAttempt >= MEDIA_ACTION_MAX_ATTEMPTS;
    // Guarded like complete(): never resurrect a cancelled/stolen row.
    await this.prisma.mediaModerationAction.updateMany({
      where: {
        id: row.id,
        lockedBy: MEDIA_ACTION_POD_ID,
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
        nextAttemptAt: isDead
          ? null
          : new Date(Date.now() + mediaActionBackoffMs(row.attempt)),
        lockedAt: null,
        lockedBy: null,
        deadAt: isDead ? now : null,
      },
    });
    this.logger.warn(
      `Takedown failed action=${row.id} attempt=${nextAttempt}/${MEDIA_ACTION_MAX_ATTEMPTS}${isDead ? ' [DLQ]' : ''}: ${message}`,
    );
  }
}

type QuarantineRef = { originalBucket: string; originalKey: string };

interface TargetState {
  kind: 'asset' | 'placement';
  id: string;
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  metadata: Prisma.JsonValue;
  restricted: boolean;
  quarantine: QuarantineRef | null;
}

function directionOf(
  metadata: Prisma.JsonValue,
): 'restrict' | 'restore' | null {
  if (!isJsonObject(metadata)) return null;
  const direction = metadata.direction;
  if (direction === 'restrict' || direction === 'restore') return direction;
  return null;
}

function isRestricted(metadata: Prisma.JsonValue): boolean {
  return isJsonObject(metadata) && metadata.moderationRestricted === true;
}

function quarantineOf(metadata: Prisma.JsonValue): QuarantineRef | null {
  if (!isJsonObject(metadata)) return null;
  const q = metadata.quarantine ?? null;
  if (
    isJsonObject(q) &&
    typeof q.originalBucket === 'string' &&
    typeof q.originalKey === 'string'
  ) {
    return { originalBucket: q.originalBucket, originalKey: q.originalKey };
  }
  return null;
}

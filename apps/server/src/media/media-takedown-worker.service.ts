import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaStorageProvider,
  Prisma,
  type MediaModerationAction,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { ImmTranscodeService } from '../infra/storage/imm-transcode.service';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import type {
  OutputStorageService,
  StorageObjectRef,
} from '../infra/storage/storage.types';
import {
  ALIYUN_CDN_REFRESH_MAX_URLS,
  CdnPurgeProvider,
} from './cdn-purge.provider';
import {
  HLS_PREFIX_SCOPE,
  hlsStreamJobKey,
  parseHlsPrefixTakedownMetadata,
  retireHlsOutput,
  transcodeMayStillWrite,
  type HlsPrefixTakedownMetadata,
} from './hls-output';
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
/** OSS work one HLS prefix pass may do before yielding (stays under the lease). */
const HLS_PASS_BUDGET_MS = 60_000;
/** CDN refresh chunks may start this long after the OSS budget ends. */
const HLS_CDN_GRACE_MS = 15_000;
/** Re-claim delay when a pass ran out of budget mid-work. */
const HLS_CONTINUE_DELAY_MS = 5_000;
/** Re-check delay while an IMM task may still write into the prefix. */
const HLS_TRANSCODE_WAIT_MS = 60_000;
/** HLS prefix takedowns retry forever; their backoff stops growing here. */
const HLS_MAX_BACKOFF_MS = 30 * 60_000;

/** The pass lost its lease (another pod, or a superseding decision). */
class LeaseLostError extends Error {}

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
 *
 * It also owns `delete_object` actions of scope `hls_prefix`: the durable
 * removal of an asset's IMM HLS output (`hls/{assetId}/`) after a moderation
 * block or the story-playback lifecycle GC — see {@link runHlsPrefixTakedown}.
 */
@Injectable()
export class MediaTakedownWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MediaTakedownWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageRegistry: StorageProviderRegistry,
    private readonly imm: ImmTranscodeService,
    private readonly cdnPurge: CdnPurgeProvider,
    private readonly urls: MediaAssetUrlResolverService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.stopped) return;
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
        const [row] = await this.claim(1);
        if (!row || this.stopped) break;
        await this.runOne(row);
      }
    } catch (err) {
      this.logger.warn(`Takedown drain failed: ${errorText(err)}`);
    }
  }

  private async claim(batch: number): Promise<MediaModerationAction[]> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - LOCK_TTL_MS);
    const eligibility = {
      actionType: {
        in: [
          MediaModerationActionType.restrict_visibility,
          MediaModerationActionType.delete_object,
        ],
      },
      status: {
        in: [
          MediaModerationActionStatus.pending,
          MediaModerationActionStatus.failed,
        ],
      },
      deadAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }] }],
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
      data: { lockedAt: now, lockedBy: MEDIA_ACTION_POD_ID },
    });

    return this.prisma.mediaModerationAction.findMany({
      where: {
        id: { in: ids },
        lockedBy: MEDIA_ACTION_POD_ID,
        lockedAt: now,
        deadAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async runOne(row: MediaModerationAction): Promise<void> {
    try {
      if (row.actionType === MediaModerationActionType.delete_object) {
        const meta = parseHlsPrefixTakedownMetadata(row.metadata);
        if (!meta) {
          // No other delete_object producer exists; nothing safe to act on.
          await this.complete(row, { outcome: { skipped: 'unknown_scope' } });
          return;
        }
        await this.runHlsPrefixTakedown(row, meta);
        return;
      }
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
      if (err instanceof LeaseLostError) return;
      await this.fail(row, errorText(err));
    }
  }

  /**
   * One pass of an HLS prefix takedown. The action is "done" only when the
   * prefix was emptied by a pass that started after the last IMM task that
   * could write into it had stopped; until then every pass deletes again.
   * Each pass:
   * 1. reads the asset's transcode job (BEFORE deleting, so a write that lands
   *    during this pass is still caught by a later one);
   * 2. deletes the prefix within a {@link HLS_PASS_BUDGET_MS} budget;
   * 3. refreshes the published keys on the CDN in chunks of 100, persisting
   *    progress after each chunk (a retry never re-refreshes a finished chunk);
   * 4. waits while the transcode may still write — and, once it has stopped,
   *    refreshes every key once more, since anything it wrote after the first
   *    refresh may have been fetched into the CDN;
   * 5. completes, retiring the variant (never a `ready` one) and the asset's
   *    terminal job rows in the same transaction.
   * Failures retry forever with a capped backoff (see {@link fail}).
   */
  private async runHlsPrefixTakedown(
    row: MediaModerationAction,
    initial: HlsPrefixTakedownMetadata,
  ): Promise<void> {
    let meta = initial;
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: row.assetId },
      select: { id: true, bucket: true, objectKey: true },
    });
    if (!asset) {
      await this.complete(row, { outcome: { skipped: 'target_missing' } });
      return;
    }
    if (
      meta.prefix !== `hls/${asset.id}/` ||
      meta.bucket !== asset.bucket ||
      asset.objectKey?.startsWith('hls/')
    ) {
      await this.fail(
        row,
        `HLS prefix takedown metadata does not match the asset (prefix ${meta.prefix}, bucket ${meta.bucket}; asset bucket ${asset.bucket ?? 'none'}, objectKey ${asset.objectKey ?? 'none'}).`,
      );
      return;
    }

    const job = await this.prisma.mediaProcessingJob.findUnique({
      where: { idempotencyKey: hlsStreamJobKey(asset.id) },
      select: { id: true, status: true, output: true },
    });
    const mayStillWrite = transcodeMayStillWrite(job, Date.now());
    if (!mayStillWrite && meta.waitingForJobId) {
      // The transcode this action waited for has stopped. Whatever it wrote
      // after the earlier refresh could have been pulled onto CDN edges.
      meta = await this.persist(row, {
        waitingForJobId: null,
        refreshedChunks: 0,
        cdnRefreshedAt: null,
      });
    }

    const budgetEnd = Date.now() + HLS_PASS_BUDGET_MS;
    const deletion = await this.imm.deleteHlsOutput(
      asset.id,
      meta.bucket,
      budgetEnd,
    );
    meta = await this.persist(row, {
      passes: (meta.passes ?? 0) + 1,
      deletedObjects: (meta.deletedObjects ?? 0) + deletion.deleted,
    });
    if (!deletion.complete) {
      await this.defer(row, HLS_CONTINUE_DELAY_MS);
      return;
    }

    const chunks = chunk(meta.refreshKeys, ALIYUN_CDN_REFRESH_MAX_URLS);
    if (chunks.length > 0 && !meta.cdnRefreshedAt) {
      for (
        let index = meta.refreshedChunks ?? 0;
        index < chunks.length;
        index++
      ) {
        if (Date.now() > budgetEnd + HLS_CDN_GRACE_MS) {
          await this.defer(row, HLS_CONTINUE_DELAY_MS);
          return;
        }
        const taskId = await this.cdnPurge.refreshFiles(
          chunks[index].map((objectKey) =>
            this.urls.resolvePlacement({
              storageProvider: MediaStorageProvider.aliyun_oss,
              bucket: meta.bucket,
              region: meta.region,
              objectKey,
              externalUrl: null,
            }),
          ),
        );
        meta = await this.persist(row, {
          refreshedChunks: index + 1,
          cdnRefreshTaskIds: [...(meta.cdnRefreshTaskIds ?? []), taskId],
        });
      }
      meta = await this.persist(row, {
        cdnRefreshedAt: new Date().toISOString(),
      });
    }

    if (mayStillWrite && job) {
      if (meta.waitingForJobId !== job.id) {
        meta = await this.persist(row, { waitingForJobId: job.id });
      }
      await this.defer(row, HLS_TRANSCODE_WAIT_MS);
      return;
    }

    await this.complete(row, {
      outcome: {
        deletedObjects: meta.deletedObjects ?? 0,
        cdnRefreshTaskIds: meta.cdnRefreshTaskIds ?? [],
        passes: meta.passes ?? 0,
      },
      retireHlsVariantId: row.variantId,
    });
  }

  /**
   * Merge progress into the action's metadata under the claim lease. Keeps the
   * in-memory row in sync (later merges and the terminal write build on it).
   * A lost lease aborts the pass: the row belongs to someone else now.
   */
  private async persist(
    row: MediaModerationAction,
    patch: Partial<HlsPrefixTakedownMetadata>,
  ): Promise<HlsPrefixTakedownMetadata> {
    const metadata = mergeJson(row.metadata, patch);
    const res = await this.prisma.mediaModerationAction.updateMany({
      where: this.leaseWhere(row),
      data: { metadata },
    });
    if (res.count === 0) throw new LeaseLostError();
    row.metadata = metadata as Prisma.JsonValue;
    const parsed = parseHlsPrefixTakedownMetadata(row.metadata);
    if (!parsed) {
      throw new Error('HLS prefix takedown metadata became unreadable.');
    }
    return parsed;
  }

  /**
   * Release the action for another pass after `delayMs` without consuming an
   * attempt: waiting is progress, not failure.
   */
  private async defer(
    row: MediaModerationAction,
    delayMs: number,
  ): Promise<void> {
    const res = await this.prisma.mediaModerationAction.updateMany({
      where: this.leaseWhere(row),
      data: {
        status: MediaModerationActionStatus.pending,
        errorMessage: null,
        lastAttemptAt: new Date(),
        nextAttemptAt: new Date(Date.now() + delayMs),
        lockedAt: null,
        lockedBy: null,
      },
    });
    if (res.count === 0) throw new LeaseLostError();
  }

  /** This pod still holds the claim and no decision superseded the action. */
  private leaseWhere(
    row: MediaModerationAction,
  ): Prisma.MediaModerationActionWhereInput {
    return {
      id: row.id,
      lockedBy: MEDIA_ACTION_POD_ID,
      lockedAt: row.lockedAt,
      status: {
        in: [
          MediaModerationActionStatus.pending,
          MediaModerationActionStatus.failed,
        ],
      },
    };
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
      /** HLS takedown: retire this variant (never from `ready`) in the same
       *  transaction — a newer publish that made it ready is left alone. */
      retireHlsVariantId?: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.mediaModerationAction.updateMany({
        where: this.leaseWhere(row),
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
      if (opts.retireHlsVariantId) {
        await retireHlsOutput(tx, {
          assetId: row.assetId,
          variantId: opts.retireHlsVariantId,
          fromStatuses: [
            MediaAssetVariantStatus.blocked,
            MediaAssetVariantStatus.deleted,
            MediaAssetVariantStatus.failed,
          ],
          now,
        });
      }
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

  /**
   * Record a failed attempt. Restrict actions dead-letter after
   * {@link MEDIA_ACTION_MAX_ATTEMPTS}. An HLS prefix takedown never does: a
   * blocked or expired output must not stay on the CDN because an outage
   * outlasted a retry budget, so it keeps retrying with its backoff capped at
   * {@link HLS_MAX_BACKOFF_MS} while the error stays visible.
   */
  private async fail(
    row: MediaModerationAction,
    message: string,
  ): Promise<void> {
    const now = new Date();
    const nextAttempt = row.attempt + 1;
    const hlsPrefix = isHlsPrefixTakedown(row);
    const isDead = !hlsPrefix && nextAttempt >= MEDIA_ACTION_MAX_ATTEMPTS;
    const backoff = hlsPrefix
      ? Math.min(mediaActionBackoffMs(row.attempt), HLS_MAX_BACKOFF_MS)
      : mediaActionBackoffMs(row.attempt);
    // Guarded like complete(): never resurrect a cancelled/stolen row.
    await this.prisma.mediaModerationAction.updateMany({
      where: this.leaseWhere(row),
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

function isHlsPrefixTakedown(row: MediaModerationAction): boolean {
  return (
    row.actionType === MediaModerationActionType.delete_object &&
    isJsonObject(row.metadata) &&
    row.metadata.scope === HLS_PREFIX_SCOPE
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AiOutboxEventType,
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaModerationCaseStatus,
  MediaModerationSeverity,
  MediaObjectPlacementStatus,
  MediaProcessingJobStatus,
  MediaProcessingJobType,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';
import type { AssetEvent } from '@repo/shared';
import { enqueueAssetEventOutbox } from '../ai-generation/outbox.service';
import { PrismaService } from '../infra/db/db.module';
import { HLS_VARIANT_KEY } from '../infra/storage/media-asset-placement';
import {
  HLS_PREFIX_SCOPE,
  hlsStreamJobKey,
  transcodeMayStillWrite,
  type HlsPrefixTakedownMetadata,
} from './hls-output';
import { MediaProcessingService } from './media-processing.service';

export type UpdateMediaAssetModerationInput = {
  moderationStatus: MediaAssetModerationStatus;
  reason?: string | null;
};

/** Providers whose objects we can physically take down (per-object ACL flip or
 *  quarantine move). external_url / s3_compatible have no controllable object,
 *  so they rely on the DTO moderation gate alone. */
const PHYSICAL_TAKEDOWN_PROVIDERS = new Set<MediaStorageProvider>([
  MediaStorageProvider.azure_blob,
  MediaStorageProvider.aliyun_oss,
]);

type PlacementRow = {
  id: string;
  status: MediaObjectPlacementStatus;
  storageProvider: MediaStorageProvider;
  objectKey: string | null;
  cdnProvider: string | null;
  cdnCacheKey: string | null;
  publicBaseUrl: string | null;
  metadata: Prisma.JsonValue;
  variant: { variantKey: string } | null;
};

/** Job states in which an `hls_stream` job is idle and may be restarted. */
const IDLE_HLS_JOB_STATUSES = new Set<MediaProcessingJobStatus>([
  MediaProcessingJobStatus.completed,
  MediaProcessingJobStatus.failed,
  MediaProcessingJobStatus.dead,
  MediaProcessingJobStatus.cancelled,
]);

/** One physical object that a takedown acts on — the asset's own object
 *  (placementId null) or a single placement. */
type PhysicalObject = {
  placementId: string | null;
  /** Idempotency-key discriminator: 'asset' or the placement id. */
  target: string;
  storageProvider: MediaStorageProvider;
  restricted: boolean;
};

@Injectable()
export class MediaModerationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processing: MediaProcessingService,
  ) {}

  async updateAssetModeration(
    assetId: string,
    adminId: string,
    input: UpdateMediaAssetModerationInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM media_assets WHERE id=${assetId}::uuid FOR UPDATE`;
      const existing = await tx.mediaAsset.findFirst({
        where: { id: assetId, deletedAt: null },
        select: {
          id: true,
          kind: true,
          moderationStatus: true,
          storageProvider: true,
          bucket: true,
          region: true,
          objectKey: true,
          metadata: true,
        },
      });
      if (!existing)
        throw new NotFoundException('Media asset not found or deleted.');

      const now = new Date();
      const isBlock =
        input.moderationStatus === MediaAssetModerationStatus.blocked;

      const updated = await tx.mediaAsset.update({
        where: { id: assetId },
        data: {
          moderationStatus: input.moderationStatus,
          moderationReason: input.reason ?? null,
          moderatedByAdminId: adminId,
          moderatedAt: now,
          // NB: status is the lifecycle dimension (uploading/ready/deleted) and
          // is intentionally NOT touched here — moderation is orthogonal.
        },
        select: {
          id: true,
          status: true,
          moderationStatus: true,
          moderationReason: true,
          createdByUserId: true,
          workspaceId: true,
          updatedAt: true,
        },
      });

      const moderationCase = await tx.mediaModerationCase.create({
        data: {
          assetId,
          status: MediaModerationCaseStatus.actioned,
          severity: moderationSeverityFor(input.moderationStatus),
          reasonCode: `manual_${input.moderationStatus}`,
          reason: input.reason ?? null,
          openedByAdminId: adminId,
          assignedAdminId: adminId,
          resolutionSummary: `Manual moderation status changed from ${existing.moderationStatus} to ${input.moderationStatus}.`,
          openedAt: now,
          resolvedAt: now,
          metadata: {
            previousStatus: existing.moderationStatus,
            nextStatus: input.moderationStatus,
          },
        },
        select: { id: true },
      });

      await tx.mediaModerationAction.create({
        data: {
          caseId: moderationCase.id,
          assetId,
          actionType: moderationActionFor(input.moderationStatus),
          status: MediaModerationActionStatus.completed,
          reason: input.reason ?? null,
          actorAdminId: adminId,
          createdAt: now,
          completedAt: now,
          metadata: {
            previousStatus: existing.moderationStatus,
            nextStatus: input.moderationStatus,
          },
        },
      });

      // A new moderation decision supersedes any still-queued actions from a
      // prior decision on this asset — cancel them so block→restore→block can't
      // leave a stale purge/takedown that later fights the new state.
      await tx.mediaModerationAction.updateMany({
        where: {
          assetId,
          actionType: {
            in: [
              MediaModerationActionType.purge_cdn,
              MediaModerationActionType.restrict_visibility,
            ],
          },
          status: {
            in: [
              MediaModerationActionStatus.pending,
              MediaModerationActionStatus.failed,
            ],
          },
          // Only un-claimed rows: an action a worker is already mid-flight on is
          // left to finish (its terminal write is status-guarded), and the
          // re-enqueued opposite-direction actions below converge the state.
          lockedAt: null,
        },
        data: {
          status: MediaModerationActionStatus.cancelled,
          nextAttemptAt: null,
        },
      });

      const placements = await tx.mediaObjectPlacement.findMany({
        where: { assetId, deletedAt: null },
        select: {
          id: true,
          status: true,
          storageProvider: true,
          objectKey: true,
          cdnProvider: true,
          cdnCacheKey: true,
          publicBaseUrl: true,
          metadata: true,
          variant: { select: { variantKey: true } },
        },
      });

      const physicalObjects = enumeratePhysicalObjects(existing, placements);
      // IMM HLS output lives under its own `hls/{assetId}/` prefix. On .cn an
      // ACL flip achieves nothing (the bucket is private behind CDN origin
      // auth), so a block deletes the whole prefix and refreshes its published
      // keys through one durable action instead. A legacy asset whose own
      // objectKey points INTO that prefix keeps the per-object path: deleting
      // the prefix would delete the asset itself.
      const hlsOutputManaged =
        existing.kind === MediaAssetKind.video &&
        existing.storageProvider === MediaStorageProvider.aliyun_oss &&
        Boolean(existing.bucket) &&
        !existing.objectKey?.startsWith('hls/');

      if (isBlock) {
        // CDN cache invalidation for placements served behind a CDN.
        const cdnTargets = placements
          .filter((p) => p.status !== MediaObjectPlacementStatus.deleted)
          .filter(hasCdnPurgeSurface);
        if (cdnTargets.length > 0) {
          await tx.mediaObjectPlacement.updateMany({
            where: { id: { in: cdnTargets.map((t) => t.id) } },
            data: { status: MediaObjectPlacementStatus.purging },
          });
          await tx.mediaModerationAction.createMany({
            data: cdnTargets.map((target) => ({
              caseId: moderationCase.id,
              assetId,
              placementId: target.id,
              actionType: MediaModerationActionType.purge_cdn,
              status: MediaModerationActionStatus.pending,
              reason: input.reason ?? null,
              actorAdminId: adminId,
              idempotencyKey: `media-cdn-purge:${moderationCase.id}:${target.id}`,
              provider: target.cdnProvider,
              metadata: {
                cdnCacheKey: target.cdnCacheKey,
                publicBaseUrl: target.publicBaseUrl,
                source: 'manual_moderation_block',
              },
            })),
          });
        }

        // Physical takedown: flip ACL / quarantine each not-yet-restricted
        // object so its public URL stops resolving.
        const restrictTargets = physicalObjects.filter((o) => !o.restricted);
        if (restrictTargets.length > 0) {
          await tx.mediaModerationAction.createMany({
            data: takedownActionRows(
              moderationCase.id,
              assetId,
              adminId,
              input.reason ?? null,
              restrictTargets,
              'restrict',
            ),
          });
        }

        if (hlsOutputManaged && existing.bucket) {
          await this.queueHlsTakedown(tx, {
            caseId: moderationCase.id,
            assetId,
            adminId,
            reason: input.reason ?? null,
            bucket: existing.bucket,
            region: existing.region,
          });
        }
      } else {
        // Restore: reactivate placements that a prior block parked in
        // purging/purged. deletedAt:null guards against resurrecting
        // independently soft-deleted placements (the prior scope bug).
        await tx.mediaObjectPlacement.updateMany({
          where: {
            assetId,
            deletedAt: null,
            status: {
              in: [
                MediaObjectPlacementStatus.purging,
                MediaObjectPlacementStatus.purged,
              ],
            },
          },
          data: { status: MediaObjectPlacementStatus.active, purgedAt: null },
        });

        // Reverse physical takedown for ALL physical objects, NOT just those
        // whose cached `restricted` flag is set. The flag is written
        // asynchronously by the restrict worker; gating restore on it would
        // strand content restricted under a block→restore race. The restore
        // worker runs restoreObject idempotently, so a not-actually-restricted
        // object is a harmless no-op.
        if (physicalObjects.length > 0) {
          await tx.mediaModerationAction.createMany({
            data: takedownActionRows(
              moderationCase.id,
              assetId,
              adminId,
              input.reason ?? null,
              physicalObjects,
              'restore',
            ),
          });
        }

        if (
          hlsOutputManaged &&
          existing.moderationStatus === MediaAssetModerationStatus.blocked
        ) {
          await this.requeueIpHlsTranscode(tx, assetId);
        }
      }

      const usageRecipients = await tx.mediaAssetUsage.findMany({
        where: {
          assetId,
          deletedAt: null,
          OR: [{ userId: { not: null } }, { projectId: { not: null } }],
        },
        select: { userId: true, projectId: true, sourceSurface: true },
      });
      const recipientIds = uniqueStrings([
        updated.createdByUserId,
        ...usageRecipients.map((usage) => usage.userId),
      ]);
      if (recipientIds.length > 0) {
        const event = toMediaModerationChangedEvent({
          asset: updated,
          previousStatus: existing.moderationStatus,
          projectIds: uniqueStrings(
            usageRecipients.map((usage) => usage.projectId),
          ),
          sourceSurface: singleValueOrNull(
            uniqueStrings(usageRecipients.map((usage) => usage.sourceSurface)),
          ),
        });
        await Promise.all(
          recipientIds.map((userId) =>
            enqueueAssetEventOutbox(tx, {
              userId,
              eventType: AiOutboxEventType.media_asset_moderation_changed,
              payload: event,
            }),
          ),
        );
      }

      return updated;
    });
  }

  /**
   * Queue the durable deletion of the asset's HLS prefix: everything IMM wrote
   * there, published or not, plus a CDN refresh of the keys that were
   * published — every placement row of the variant, retired ones included
   * (rows are never hard-deleted, and a retired key may still be cached). The
   * variant flips to `blocked` at once, so a restore that lands before the
   * takedown finishes can never serve a prefix being emptied. Nothing is
   * queued when the asset never had an HLS variant or job.
   */
  private async queueHlsTakedown(
    tx: Prisma.TransactionClient,
    input: {
      caseId: string;
      assetId: string;
      adminId: string;
      reason: string | null;
      bucket: string;
      region: string | null;
    },
  ): Promise<void> {
    const hls = await tx.mediaAssetVariant.findUnique({
      where: {
        assetId_variantKey: {
          assetId: input.assetId,
          variantKey: HLS_VARIANT_KEY,
        },
      },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        placements: { select: { objectKey: true } },
      },
    });
    const job = await tx.mediaProcessingJob.findUnique({
      where: { idempotencyKey: hlsStreamJobKey(input.assetId) },
      select: { id: true },
    });
    const liveVariant =
      hls != null &&
      hls.status !== MediaAssetVariantStatus.deleted &&
      hls.deletedAt === null
        ? hls
        : null;
    if (!liveVariant && !job) return;

    if (liveVariant) {
      await tx.mediaAssetVariant.update({
        where: { id: liveVariant.id },
        data: { status: MediaAssetVariantStatus.blocked },
      });
    }
    const metadata: HlsPrefixTakedownMetadata = {
      scope: HLS_PREFIX_SCOPE,
      origin: 'moderation',
      bucket: input.bucket,
      region: input.region,
      prefix: `hls/${input.assetId}/`,
      refreshKeys: (liveVariant?.placements ?? []).flatMap((placement) =>
        placement.objectKey ? [placement.objectKey] : [],
      ),
    };
    await tx.mediaModerationAction.create({
      data: {
        caseId: input.caseId,
        assetId: input.assetId,
        variantId: hls?.id ?? null,
        placementId: null,
        actionType: MediaModerationActionType.delete_object,
        status: MediaModerationActionStatus.pending,
        reason: input.reason,
        actorAdminId: input.adminId,
        idempotencyKey: `media-hls-takedown:${input.caseId}`,
        provider: MediaStorageProvider.aliyun_oss,
        metadata: { ...metadata },
      },
    });
  }

  /**
   * Restore of a previously blocked asset that an IP episode or trailer plays:
   * its HLS output was taken down, so queue a fresh transcode (the worker
   * waits for the takedown and the CDN settle window before submitting). Live
   * story clips are re-prepared by the story-playback reconcile instead.
   */
  private async requeueIpHlsTranscode(
    tx: Prisma.TransactionClient,
    assetId: string,
  ): Promise<void> {
    const hls = await tx.mediaAssetVariant.findUnique({
      where: { assetId_variantKey: { assetId, variantKey: HLS_VARIANT_KEY } },
      select: { id: true },
    });
    if (!hls) return;
    const ipReferenced = await tx.mediaAsset.findFirst({
      where: {
        id: assetId,
        OR: [
          { ipEpisodeMedia: { some: {} } },
          { ipEpisodeTrailers: { some: {} } },
          { ipTrailers: { some: {} } },
          { ipDiscoveryTrailerMedia: { some: {} } },
        ],
      },
      select: { id: true },
    });
    if (!ipReferenced) return;
    const idempotencyKey = hlsStreamJobKey(assetId);
    // Take enqueueJobTx's locks before the idle check, so the check still
    // holds at the restart: a worker claim waits for this decision to commit
    // and then picks up the restarted job.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media:enqueue:${idempotencyKey}`})::bigint)`;
    await tx.$queryRaw`SELECT id FROM media_processing_jobs WHERE idempotency_key=${idempotencyKey} FOR UPDATE`;
    const job = await tx.mediaProcessingJob.findUnique({
      where: { idempotencyKey },
      select: { status: true, lockedAt: true, output: true },
    });
    // Only an idle job may restart. A restart also erases the job's IMM task
    // id, which the pending takedown relies on to wait for that task: never
    // restart one IMM may still be running (operators can re-run it from
    // media admin once it settles).
    if (
      job &&
      !(
        IDLE_HLS_JOB_STATUSES.has(job.status) &&
        !job.lockedAt &&
        !transcodeMayStillWrite(job, Date.now())
      )
    )
      return;
    await this.processing.enqueueJobTx(
      {
        assetId,
        jobType: MediaProcessingJobType.hls_stream,
        priority: 50,
        idempotencyKey,
      },
      tx,
      true,
    );
  }
}

/** Collect every physical object of an asset (its own object + each placement)
 *  that lives on a provider we can take down. */
function enumeratePhysicalObjects(
  asset: {
    storageProvider: MediaStorageProvider;
    objectKey: string | null;
    metadata: Prisma.JsonValue;
  },
  placements: PlacementRow[],
): PhysicalObject[] {
  const objects: PhysicalObject[] = [];
  if (
    PHYSICAL_TAKEDOWN_PROVIDERS.has(asset.storageProvider) &&
    asset.objectKey
  ) {
    objects.push({
      placementId: null,
      target: 'asset',
      storageProvider: asset.storageProvider,
      restricted: isObjectRestricted(asset.metadata),
    });
  }
  for (const placement of placements) {
    if (
      placement.status === MediaObjectPlacementStatus.deleted ||
      !PHYSICAL_TAKEDOWN_PROVIDERS.has(placement.storageProvider) ||
      !placement.objectKey ||
      // HLS output objects are taken down as one prefix (delete + CDN
      // refresh), never per object — see queueHlsTakedown.
      placement.variant?.variantKey === HLS_VARIANT_KEY
    ) {
      continue;
    }
    objects.push({
      placementId: placement.id,
      target: placement.id,
      storageProvider: placement.storageProvider,
      restricted: isObjectRestricted(placement.metadata),
    });
  }
  return objects;
}

function takedownActionRows(
  caseId: string,
  assetId: string,
  adminId: string,
  reason: string | null,
  objects: PhysicalObject[],
  direction: 'restrict' | 'restore',
): Prisma.MediaModerationActionCreateManyInput[] {
  return objects.map((object) => ({
    caseId,
    assetId,
    placementId: object.placementId,
    actionType: MediaModerationActionType.restrict_visibility,
    status: MediaModerationActionStatus.pending,
    reason,
    actorAdminId: adminId,
    idempotencyKey: `media-takedown:${caseId}:${object.target}:${direction}`,
    provider: object.storageProvider,
    metadata: { direction, storageProvider: object.storageProvider },
  }));
}

function isObjectRestricted(metadata: Prisma.JsonValue): boolean {
  return (
    Boolean(metadata) &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).moderationRestricted === true
  );
}

function hasCdnPurgeSurface(placement: {
  cdnProvider: string | null;
  cdnCacheKey: string | null;
  publicBaseUrl: string | null;
}): boolean {
  return Boolean(
    placement.cdnProvider || placement.cdnCacheKey || placement.publicBaseUrl,
  );
}

function moderationSeverityFor(
  status: MediaAssetModerationStatus,
): MediaModerationSeverity {
  switch (status) {
    case MediaAssetModerationStatus.blocked:
      return MediaModerationSeverity.critical;
    case MediaAssetModerationStatus.flagged:
      return MediaModerationSeverity.high;
    case MediaAssetModerationStatus.approved:
      return MediaModerationSeverity.low;
    case MediaAssetModerationStatus.unreviewed:
    default:
      return MediaModerationSeverity.medium;
  }
}

function moderationActionFor(
  status: MediaAssetModerationStatus,
): MediaModerationActionType {
  switch (status) {
    case MediaAssetModerationStatus.approved:
      return MediaModerationActionType.approve;
    case MediaAssetModerationStatus.flagged:
      return MediaModerationActionType.flag;
    case MediaAssetModerationStatus.blocked:
      return MediaModerationActionType.takedown;
    case MediaAssetModerationStatus.unreviewed:
    default:
      return MediaModerationActionType.restore;
  }
}

function toMediaModerationChangedEvent(input: {
  asset: {
    id: string;
    status: string;
    moderationStatus: MediaAssetModerationStatus;
    moderationReason: string | null;
    workspaceId: string | null;
    updatedAt: Date;
  };
  previousStatus: MediaAssetModerationStatus;
  projectIds: string[];
  sourceSurface: string | null;
}): AssetEvent {
  return {
    kind: 'media_asset_moderation_changed',
    assetId: input.asset.id,
    workspaceId: input.asset.workspaceId,
    projectIds: input.projectIds,
    sourceSurface: input.sourceSurface,
    status: input.asset.status,
    moderationStatus: input.asset.moderationStatus,
    moderationReason: input.asset.moderationReason,
    action: moderationEventAction(
      input.previousStatus,
      input.asset.moderationStatus,
    ),
    updatedAt: input.asset.updatedAt.toISOString(),
    ts: Date.now(),
  };
}

function moderationEventAction(
  previous: MediaAssetModerationStatus,
  next: MediaAssetModerationStatus,
): 'approved' | 'flagged' | 'blocked' | 'restored' {
  if (next === MediaAssetModerationStatus.blocked) return 'blocked';
  if (next === MediaAssetModerationStatus.flagged) return 'flagged';
  if (previous === MediaAssetModerationStatus.blocked) return 'restored';
  if (next === MediaAssetModerationStatus.approved) return 'approved';
  return 'restored';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function singleValueOrNull(values: string[]): string | null {
  return values.length === 1 ? values[0] : null;
}

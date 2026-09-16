import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AiOutboxEventType,
  MediaAssetModerationStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaModerationCaseStatus,
  MediaModerationSeverity,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';
import type { AssetEvent } from '@repo/shared';
import { enqueueAssetEventOutbox } from '../ai-generation/outbox.service';
import { PrismaService } from '../infra/db/db.module';

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
};

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
  constructor(private readonly prisma: PrismaService) {}

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
          moderationStatus: true,
          storageProvider: true,
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
        },
      });

      const physicalObjects = enumeratePhysicalObjects(existing, placements);

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
      !placement.objectKey
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

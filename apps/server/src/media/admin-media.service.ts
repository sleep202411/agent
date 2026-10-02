import { CDN_PURGE_LOCK_TTL_MS } from './media-worker-leases';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaObjectPlacementStatus,
  MediaProcessingJobType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import {
  MediaProcessingService,
  type EnqueueMediaProcessingJobInput,
} from './media-processing.service';
import { MediaModerationAdminService } from './media-moderation-admin.service';
import { hlsStreamJobKey } from './hls-output';
import type {
  CreateAdminMediaProcessingJobInput,
  ListAdminMediaAssetsQuery,
  ListAdminMediaModerationActionsQuery,
  ListAdminMediaProcessingJobsQuery,
  UpdateAdminMediaAssetModerationInput,
} from './admin-media.dto';

const ADMIN_MEDIA_ASSET_INCLUDE = {
  placements: {
    where: { deletedAt: null },
    orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
  },
  variants: {
    where: { deletedAt: null },
    orderBy: [{ kind: 'asc' }, { variantKey: 'asc' }],
    include: {
      placements: {
        where: { deletedAt: null },
        orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
  usages: {
    where: { deletedAt: null },
    orderBy: { lastObservedAt: 'desc' },
    take: 6,
  },
  moderationCases: {
    orderBy: { openedAt: 'desc' },
    take: 3,
  },
  moderationActions: {
    orderBy: { createdAt: 'desc' },
    take: 6,
  },
  processingJobs: {
    orderBy: { createdAt: 'desc' },
    take: 6,
  },
} satisfies Prisma.MediaAssetInclude;

@Injectable()
export class AdminMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processing: MediaProcessingService,
    private readonly moderation: MediaModerationAdminService,
  ) {}

  async overview() {
    const [
      totalAssets,
      blockedAssets,
      purgingPlacements,
      pendingPurgeActions,
      deadPurgeActions,
      activeProcessingJobs,
      deadProcessingJobs,
    ] = await Promise.all([
      this.prisma.mediaAsset.count({ where: { deletedAt: null } }),
      this.prisma.mediaAsset.count({
        where: { deletedAt: null, moderationStatus: 'blocked' },
      }),
      this.prisma.mediaObjectPlacement.count({
        where: { deletedAt: null, status: MediaObjectPlacementStatus.purging },
      }),
      this.prisma.mediaModerationAction.count({
        where: {
          actionType: MediaModerationActionType.purge_cdn,
          status: {
            in: [
              MediaModerationActionStatus.pending,
              MediaModerationActionStatus.failed,
            ],
          },
          deadAt: null,
        },
      }),
      this.prisma.mediaModerationAction.count({
        where: {
          actionType: MediaModerationActionType.purge_cdn,
          deadAt: { not: null },
        },
      }),
      this.prisma.mediaProcessingJob.count({
        where: {
          status: { in: ['pending', 'processing', 'failed'] },
          deadAt: null,
        },
      }),
      this.prisma.mediaProcessingJob.count({
        where: { deadAt: { not: null } },
      }),
    ]);
    return {
      totalAssets,
      blockedAssets,
      purgingPlacements,
      pendingPurgeActions,
      deadPurgeActions,
      activeProcessingJobs,
      deadProcessingJobs,
    };
  }

  async listAssets(query: ListAdminMediaAssetsQuery) {
    const items = await this.prisma.mediaAsset.findMany({
      where: {
        deletedAt: null,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.moderationStatus
          ? { moderationStatus: query.moderationStatus }
          : {}),
        ...(query.storageProvider
          ? { storageProvider: query.storageProvider }
          : {}),
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.userId ? { createdByUserId: query.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: ADMIN_MEDIA_ASSET_INCLUDE,
    });
    return {
      items: items.map((asset) => serializeMediaAsset(asset)),
    };
  }

  async listModerationActions(query: ListAdminMediaModerationActionsQuery) {
    const items = await this.prisma.mediaModerationAction.findMany({
      where: {
        ...(query.actionType ? { actionType: query.actionType } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.assetId ? { assetId: query.assetId } : {}),
        ...(query.dead === undefined
          ? {}
          : query.dead
            ? { deadAt: { not: null } }
            : { deadAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        asset: {
          select: {
            id: true,
            kind: true,
            source: true,
            moderationStatus: true,
            createdByUserId: true,
            createdAt: true,
          },
        },
        placement: true,
        case: {
          select: {
            id: true,
            status: true,
            severity: true,
            reasonCode: true,
            reason: true,
          },
        },
      },
    });
    return { items: items.map(serializeModerationAction) };
  }

  async retryModerationAction(actionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM media_moderation_actions WHERE id=${actionId}::uuid FOR UPDATE`;
      const existing = await tx.mediaModerationAction.findUnique({
        where: { id: actionId },
        include: { placement: true },
      });
      if (!existing) throw new NotFoundException('媒体治理任务不存在。');
      if (existing.actionType !== MediaModerationActionType.purge_cdn)
        throw new NotFoundException('该媒体治理任务不支持重试。');
      const [clock] = await tx.$queryRaw<
        { nowMs: number }[]
      >`SELECT extract(epoch FROM clock_timestamp())::double precision * 1000 AS "nowMs"`;
      if (
        existing.status !== MediaModerationActionStatus.failed ||
        (existing.lockedAt &&
          existing.lockedAt.getTime() >= clock.nowMs - CDN_PURGE_LOCK_TTL_MS)
      )
        throw new ConflictException(
          'The moderation action is no longer available for retry. Refresh and retry if it fails again.',
        );
      await tx.mediaModerationAction.update({
        where: { id: actionId },
        data: {
          status: MediaModerationActionStatus.pending,
          attempt: 0,
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          errorMessage: null,
          deadAt: null,
        },
        include: { asset: true, placement: true, case: true },
      });
      if (existing.placement)
        await tx.mediaObjectPlacement.update({
          where: { id: existing.placement.id },
          data: { status: MediaObjectPlacementStatus.purging },
        });
      const refreshed = await tx.mediaModerationAction.findUniqueOrThrow({
        where: { id: actionId },
        include: { asset: true, placement: true, case: true },
      });
      return serializeModerationAction(refreshed);
    });
  }

  async updateAssetModeration(
    assetId: string,
    adminId: string,
    input: UpdateAdminMediaAssetModerationInput,
  ) {
    await this.moderation.updateAssetModeration(assetId, adminId, input);
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: ADMIN_MEDIA_ASSET_INCLUDE,
    });
    if (!asset) throw new NotFoundException('媒体资产不存在。');
    return serializeMediaAsset(asset);
  }

  async listProcessingJobs(query: ListAdminMediaProcessingJobsQuery) {
    const items = await this.prisma.mediaProcessingJob.findMany({
      where: {
        ...(query.jobType ? { jobType: query.jobType } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.assetId ? { assetId: query.assetId } : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: query.limit,
      include: {
        asset: {
          select: {
            id: true,
            kind: true,
            source: true,
            status: true,
            moderationStatus: true,
            createdAt: true,
          },
        },
        sourceVariant: {
          select: {
            id: true,
            variantKey: true,
            kind: true,
            status: true,
          },
        },
      },
    });
    return { items: items.map(serializeProcessingJob) };
  }

  async createProcessingJob(
    assetId: string,
    adminId: string,
    input: CreateAdminMediaProcessingJobInput,
  ) {
    const enqueueInput: EnqueueMediaProcessingJobInput = {
      assetId,
      jobType: input.jobType as MediaProcessingJobType,
      sourceVariantId: input.sourceVariantId ?? null,
      priority: input.priority,
      input: (input.input ?? {}) as Prisma.InputJsonObject,
      // Stable per-asset keys for single-output job types so an admin re-request
      // (backfill / retry) restarts the canonical idle job — via the explicit reset
      // branch — instead of forking a parallel one (e.g. two hls_stream jobs
      // submitting concurrent IMM tasks onto the same hls/{assetId}/ prefix).
      idempotencyKey:
        input.jobType === MediaProcessingJobType.backfill_original_placement
          ? `media-backfill-original-placement:${assetId}`
          : input.jobType === MediaProcessingJobType.hls_stream
            ? hlsStreamJobKey(assetId)
            : null,
      createdByAdminId: adminId,
    };
    return serializeProcessingJob(
      await this.prisma.$transaction((tx) =>
        this.processing.enqueueJobTx(enqueueInput, tx, true),
      ),
    );
  }

  async retryProcessingJob(jobId: string) {
    return serializeProcessingJob(await this.processing.retryJob(jobId));
  }
}

type AdminMediaAsset = Prisma.MediaAssetGetPayload<{
  include: typeof ADMIN_MEDIA_ASSET_INCLUDE;
}>;

function serializeMediaAsset(asset: AdminMediaAsset) {
  return {
    id: asset.id,
    kind: asset.kind,
    source: asset.source,
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes?.toString() ?? null,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    visibility: asset.visibility,
    status: asset.status,
    moderationStatus: asset.moderationStatus,
    moderationReason: asset.moderationReason,
    createdByUserId: asset.createdByUserId,
    workspaceId: asset.workspaceId,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    variants: asset.variants.map((variant) => ({
      id: variant.id,
      variantKey: variant.variantKey,
      kind: variant.kind,
      status: variant.status,
      contentType: variant.contentType,
      placements: variant.placements.map(serializePlacement),
    })),
    placements: asset.placements.map(serializePlacement),
    usages: asset.usages.map((usage) => ({
      id: usage.id,
      surface: usage.surface,
      sourceSurface: usage.sourceSurface,
      role: usage.role,
      userId: usage.userId,
      workspaceId: usage.workspaceId,
      projectId: usage.projectId,
      aiJobId: usage.aiJobId,
      lastObservedAt: usage.lastObservedAt.toISOString(),
    })),
    moderationCases: asset.moderationCases.map((item) => ({
      id: item.id,
      status: item.status,
      severity: item.severity,
      reasonCode: item.reasonCode,
      reason: item.reason,
      openedAt: item.openedAt.toISOString(),
      resolvedAt: item.resolvedAt?.toISOString() ?? null,
    })),
    moderationActions: asset.moderationActions.map((item) => ({
      id: item.id,
      actionType: item.actionType,
      status: item.status,
      provider: item.provider,
      attempt: item.attempt,
      errorMessage: item.errorMessage,
      deadAt: item.deadAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
    processingJobs: asset.processingJobs.map((item) => ({
      id: item.id,
      jobType: item.jobType,
      status: item.status,
      attempt: item.attempt,
      errorMessage: item.errorMessage,
      deadAt: item.deadAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

function serializeModerationAction(
  action: Prisma.MediaModerationActionGetPayload<{
    include: {
      asset: true;
      placement: true;
      case: true;
    };
  }>,
) {
  return {
    id: action.id,
    assetId: action.assetId,
    variantId: action.variantId,
    placementId: action.placementId,
    actionType: action.actionType,
    status: action.status,
    reason: action.reason,
    actorAdminId: action.actorAdminId,
    provider: action.provider,
    providerTaskId: action.providerTaskId,
    errorMessage: action.errorMessage,
    attempt: action.attempt,
    nextAttemptAt: action.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: action.lastAttemptAt?.toISOString() ?? null,
    lockedAt: action.lockedAt?.toISOString() ?? null,
    lockedBy: action.lockedBy,
    deadAt: action.deadAt?.toISOString() ?? null,
    createdAt: action.createdAt.toISOString(),
    completedAt: action.completedAt?.toISOString() ?? null,
    failedAt: action.failedAt?.toISOString() ?? null,
    asset: action.asset
      ? {
          id: action.asset.id,
          kind: action.asset.kind,
          source: action.asset.source,
          moderationStatus: action.asset.moderationStatus,
          createdByUserId: action.asset.createdByUserId,
          createdAt: action.asset.createdAt.toISOString(),
        }
      : null,
    placement: action.placement ? serializePlacement(action.placement) : null,
    case: action.case
      ? {
          id: action.case.id,
          status: action.case.status,
          severity: action.case.severity,
          reasonCode: action.case.reasonCode,
          reason: action.case.reason,
        }
      : null,
  };
}

type SerializableProcessingJob = Prisma.MediaProcessingJobGetPayload<
  Record<string, never>
> & {
  asset?: {
    id: string;
    kind: string;
    source: string;
    status: string;
    moderationStatus: string;
    createdAt: Date;
  } | null;
  sourceVariant?: {
    id: string;
    variantKey: string;
    kind: string;
    status: string;
  } | null;
};

function serializeProcessingJob(job: SerializableProcessingJob) {
  return {
    id: job.id,
    assetId: job.assetId,
    sourceVariantId: job.sourceVariantId,
    jobType: job.jobType,
    status: job.status,
    priority: job.priority,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    input: job.input,
    output: job.output,
    errorMessage: job.errorMessage,
    lockedAt: job.lockedAt?.toISOString() ?? null,
    lockedBy: job.lockedBy,
    nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    failedAt: job.failedAt?.toISOString() ?? null,
    deadAt: job.deadAt?.toISOString() ?? null,
    createdByAdminId: job.createdByAdminId,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    asset:
      'asset' in job && job.asset
        ? {
            id: job.asset.id,
            kind: job.asset.kind,
            source: job.asset.source,
            status: job.asset.status,
            moderationStatus: job.asset.moderationStatus,
            createdAt: job.asset.createdAt.toISOString(),
          }
        : null,
    sourceVariant:
      'sourceVariant' in job && job.sourceVariant
        ? {
            id: job.sourceVariant.id,
            variantKey: job.sourceVariant.variantKey,
            kind: job.sourceVariant.kind,
            status: job.sourceVariant.status,
          }
        : null,
  };
}

function serializePlacement(placement: {
  id: string;
  role: string;
  status: string;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  publicBaseUrl: string | null;
  cdnProvider: string | null;
  cdnCacheKey: string | null;
  priority: number;
  purgedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: placement.id,
    role: placement.role,
    status: placement.status,
    storageProvider: placement.storageProvider,
    bucket: placement.bucket,
    region: placement.region,
    objectKey: placement.objectKey,
    externalUrl: placement.externalUrl,
    publicBaseUrl: placement.publicBaseUrl,
    cdnProvider: placement.cdnProvider,
    cdnCacheKey: placement.cdnCacheKey,
    priority: placement.priority,
    purgedAt: placement.purgedAt?.toISOString() ?? null,
    updatedAt: placement.updatedAt.toISOString(),
  };
}

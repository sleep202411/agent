import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaObjectPlacementStatus,
  Prisma,
  WorkspaceMemberRole,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import { WorkspacePermissionService } from '../workspaces';
import type {
  MediaAssetAccessQueryDto,
  MediaAssetAccessResponseDto,
} from './dto';

const USER_READ_URL_TTL_SECONDS = positiveInt(
  process.env.MEDIA_USER_READ_URL_TTL_SECONDS,
  5 * 60,
);
const ADMIN_READ_URL_TTL_SECONDS = positiveInt(
  process.env.MEDIA_ADMIN_READ_URL_TTL_SECONDS,
  15 * 60,
);
const USER_READ_CACHE_CONTROL = 'private, no-store';
const ADMIN_READ_CACHE_CONTROL = 'private, no-store';
const MEDIA_ACCESS_ASSET_INCLUDE = {
  placements: {
    where: { deletedAt: null },
    orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
  },
  variants: {
    where: { deletedAt: null },
    include: {
      placements: {
        where: { deletedAt: null },
        orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
} satisfies Prisma.MediaAssetInclude;

type MediaAccessAsset = Prisma.MediaAssetGetPayload<{
  include: typeof MEDIA_ACCESS_ASSET_INCLUDE;
}>;

@Injectable()
export class MediaAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageAccess: MediaStorageAccessService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  async issueAccessUrl(
    userId: string,
    assetId: string,
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    return this.issueBrowserAccessUrl(userId, assetId, query);
  }

  async issueBrowserAccessUrl(
    userId: string | null | undefined,
    assetId: string,
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    const asset = await this.loadAsset(assetId);

    if (
      asset.status === MediaAssetStatus.deleted ||
      asset.moderationStatus === MediaAssetModerationStatus.blocked
    ) {
      throw new GoneException({
        code: 'MEDIA_ASSET_UNAVAILABLE',
        message: 'Media asset is no longer available.',
      });
    }
    if (asset.status !== MediaAssetStatus.ready) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_READY',
        message: 'Media asset is not ready.',
      });
    }

    await this.requireAccess(userId, asset);

    return this.issueStorageUrl(asset, query, {
      allowInactivePlacements: false,
      cacheControl: USER_READ_CACHE_CONTROL,
      expiresInSeconds: USER_READ_URL_TTL_SECONDS,
    });
  }

  async issueAdminAccessUrl(
    assetId: string,
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    const asset = await this.loadAsset(assetId);
    if (asset.status === MediaAssetStatus.deleted || asset.deletedAt != null) {
      throw new GoneException({
        code: 'MEDIA_ASSET_UNAVAILABLE',
        message: 'Media asset is no longer available.',
      });
    }
    if (asset.status !== MediaAssetStatus.ready) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_READY',
        message: 'Media asset is not ready.',
      });
    }
    return this.issueStorageUrl(asset, query, {
      allowInactivePlacements: true,
      cacheControl: ADMIN_READ_CACHE_CONTROL,
      expiresInSeconds: ADMIN_READ_URL_TTL_SECONDS,
    });
  }

  private async requireAccess(
    userId: string | null | undefined,
    asset: {
      visibility: MediaAssetVisibility;
      createdByUserId: string | null;
      workspaceId: string | null;
    },
  ): Promise<void> {
    if (asset.visibility === MediaAssetVisibility.public) return;
    if (!userId) {
      throw new UnauthorizedException({
        code: 'MEDIA_ASSET_AUTH_REQUIRED',
        message: 'Sign in to access this media asset.',
      });
    }
    if (asset.createdByUserId === userId) return;
    if (asset.workspaceId) {
      await this.workspacePermissions.requireWorkspaceRole(
        userId,
        asset.workspaceId,
        WorkspaceMemberRole.viewer,
      );
      return;
    }
    throw new ForbiddenException({
      code: 'MEDIA_ASSET_ACCESS_DENIED',
      message: 'You do not have access to this media asset.',
    });
  }

  private async loadAsset(assetId: string): Promise<MediaAccessAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: MEDIA_ACCESS_ASSET_INCLUDE,
    });
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'Media asset not found.',
      });
    }
    return asset;
  }

  private async issueStorageUrl(
    asset: MediaAccessAsset,
    query: MediaAssetAccessQueryDto,
    options: {
      allowInactivePlacements: boolean;
      cacheControl: string;
      expiresInSeconds: number;
    },
  ): Promise<MediaAssetAccessResponseDto> {
    const source = selectReadSource(asset, query, {
      allowInactivePlacements: options.allowInactivePlacements,
    });
    if (!source) {
      throw new NotFoundException({
        code: 'MEDIA_VARIANT_NOT_FOUND',
        message: 'Media asset object is not available.',
      });
    }
    const signed = await this.storageAccess.createReadUrl(source, {
      cacheControl: options.cacheControl,
      expiresInSeconds: options.expiresInSeconds,
    });
    return {
      assetId: asset.id,
      variantKey: query.variantKey,
      ...(query.placementId ? { placementId: query.placementId } : {}),
      url: signed.url,
      expiresAt: signed.expiresAt,
    };
  }
}

function selectReadSource(
  asset: MediaAccessAsset,
  query: MediaAssetAccessQueryDto,
  options: { allowInactivePlacements: boolean },
) {
  if (query.placementId) {
    const placementSource = selectPlacementReadSource(
      asset,
      query.placementId,
      options,
    );
    if (placementSource) return placementSource;
  }
  return selectVariantReadSource(asset, query.variantKey, options);
}

function selectPlacementReadSource(
  asset: MediaAccessAsset,
  placementId: string,
  options: { allowInactivePlacements: boolean },
) {
  const assetPlacement = asset.placements.find(
    (placement) =>
      placement.id === placementId &&
      isReadablePlacementStatus(
        placement.status,
        options.allowInactivePlacements,
      ) &&
      !placement.deletedAt,
  );
  if (assetPlacement) {
    return {
      storageProvider: assetPlacement.storageProvider,
      bucket: assetPlacement.bucket,
      region: assetPlacement.region,
      objectKey: assetPlacement.objectKey,
      externalUrl: assetPlacement.externalUrl,
      contentType: asset.contentType,
    };
  }

  for (const variant of asset.variants) {
    if (
      variant.status === MediaAssetStatus.deleted ||
      (!options.allowInactivePlacements && variant.status === 'blocked') ||
      variant.deletedAt
    ) {
      continue;
    }
    const placement = variant.placements.find(
      (candidate) =>
        candidate.id === placementId &&
        isReadablePlacementStatus(
          candidate.status,
          options.allowInactivePlacements,
        ) &&
        !candidate.deletedAt,
    );
    if (!placement) continue;
    return {
      storageProvider: placement.storageProvider,
      bucket: placement.bucket,
      region: placement.region,
      objectKey: placement.objectKey,
      externalUrl: placement.externalUrl,
      contentType: variant.contentType ?? asset.contentType,
    };
  }

  return null;
}

function selectVariantReadSource(
  asset: MediaAccessAsset,
  variantKey: string,
  options: { allowInactivePlacements: boolean },
) {
  const variant = asset.variants.find(
    (candidate) =>
      candidate.variantKey === variantKey &&
      candidate.status !== 'deleted' &&
      (options.allowInactivePlacements || candidate.status !== 'blocked') &&
      !candidate.deletedAt,
  );
  const variantPlacement = pickPlacement(
    variant?.placements,
    options.allowInactivePlacements,
  );
  if (variantPlacement) {
    return {
      storageProvider: variantPlacement.storageProvider,
      bucket: variantPlacement.bucket,
      region: variantPlacement.region,
      objectKey: variantPlacement.objectKey,
      externalUrl: variantPlacement.externalUrl,
      contentType: variant?.contentType ?? asset.contentType,
    };
  }

  const assetPlacement = pickPlacement(
    asset.placements,
    options.allowInactivePlacements,
  );
  if (assetPlacement) {
    return {
      storageProvider: assetPlacement.storageProvider,
      bucket: assetPlacement.bucket,
      region: assetPlacement.region,
      objectKey: assetPlacement.objectKey,
      externalUrl: assetPlacement.externalUrl,
      contentType: asset.contentType,
    };
  }

  if (variantKey !== 'original') return null;
  return {
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    contentType: asset.contentType,
  };
}

function pickPlacement<T extends { status: string; deletedAt: Date | null }>(
  placements: T[] | undefined,
  allowInactive: boolean,
): T | null {
  const readable = (placements ?? [])
    .filter(
      (placement) =>
        !placement.deletedAt &&
        isReadablePlacementStatus(placement.status, allowInactive),
    )
    .sort(
      (a, b) =>
        placementStatusRank(a.status) - placementStatusRank(b.status) ||
        placementPriority(a) - placementPriority(b),
    );
  return readable[0] ?? null;
}

function isReadablePlacementStatus(
  status: string,
  allowInactive: boolean,
): boolean {
  if (status === MediaObjectPlacementStatus.active) return true;
  if (!allowInactive) return false;
  return (
    status === MediaObjectPlacementStatus.purging ||
    status === MediaObjectPlacementStatus.purged
  );
}

function placementStatusRank(status: string): number {
  if (status === MediaObjectPlacementStatus.active) return 0;
  if (status === MediaObjectPlacementStatus.purging) return 10;
  if (status === MediaObjectPlacementStatus.purged) return 20;
  return 100;
}

function placementPriority(value: object): number {
  return 'priority' in value && typeof value.priority === 'number'
    ? value.priority
    : 100;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

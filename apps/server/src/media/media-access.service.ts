import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVisibility,
  WorkspaceMemberRole,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { WorkspacePermissionService } from '../workspaces';
import type {
  MediaAssetAccessQueryDto,
  MediaAssetAccessResponseDto,
} from './dto';

@Injectable()
export class MediaAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetUrls: MediaAssetUrlResolverService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  async issueAccessUrl(
    userId: string,
    assetId: string,
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: {
        placements: {
          where: { deletedAt: null },
          orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
        },
        variants: {
          where: { deletedAt: null },
          include: {
            placements: {
              where: { deletedAt: null },
              orderBy: [
                { role: 'asc' },
                { priority: 'asc' },
                { createdAt: 'asc' },
              ],
            },
          },
        },
      },
    });
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'Media asset not found.',
      });
    }

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

    try {
      return {
        assetId,
        variantKey: query.variantKey,
        url: this.assetUrls.resolveVariant(asset, query.variantKey),
        expiresAt: null,
      };
    } catch {
      throw new NotFoundException({
        code: 'MEDIA_VARIANT_NOT_FOUND',
        message: 'Media asset variant is not available.',
      });
    }
  }

  private async requireAccess(
    userId: string,
    asset: {
      visibility: MediaAssetVisibility;
      createdByUserId: string | null;
      workspaceId: string | null;
    },
  ): Promise<void> {
    if (asset.visibility === MediaAssetVisibility.public) return;
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
}

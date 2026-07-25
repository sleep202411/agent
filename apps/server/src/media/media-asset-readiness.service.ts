import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  MediaAssetReadinessCapability,
  MediaAssetReadinessResult,
} from '@repo/shared';
import {
  MediaAssetStatus,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { WorkspacePermissionService } from '../workspaces';
import {
  MEDIA_ASSET_READINESS_ADAPTERS,
  type MediaAssetReadinessAdapter,
} from './media-asset-readiness.port';

@Injectable()
export class MediaAssetReadinessService {
  private readonly logger = new Logger(MediaAssetReadinessService.name);
  private readonly adapters: ReadonlyMap<
    MediaAssetReadinessCapability,
    MediaAssetReadinessAdapter
  >;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacePermissions: WorkspacePermissionService,
    @Inject(MEDIA_ASSET_READINESS_ADAPTERS)
    adapters: MediaAssetReadinessAdapter[],
  ) {
    const byCapability = new Map<
      MediaAssetReadinessCapability,
      MediaAssetReadinessAdapter
    >();
    for (const adapter of adapters) {
      if (byCapability.has(adapter.capability)) {
        throw new Error(
          `Duplicate media asset readiness adapter: ${adapter.capability}`,
        );
      }
      byCapability.set(adapter.capability, adapter);
    }
    this.adapters = byCapability;
  }

  async listStatusesForUser(
    userId: string,
    capability: MediaAssetReadinessCapability,
    assetIds: string[],
  ): Promise<MediaAssetReadinessResult[]> {
    const adapter = this.requireAdapter(capability);
    const ids = [...new Set(assetIds)].slice(0, 100);
    if (ids.length === 0) return [];

    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        OR: [
          { createdByUserId: userId },
          {
            workspace: {
              members: {
                some: {
                  userId,
                  status: WorkspaceMemberStatus.active,
                  removedAt: null,
                },
              },
            },
          },
        ],
      },
      select: { id: true, kind: true, status: true },
    });
    const eligibleIds = assets
      .filter(
        (asset) =>
          asset.status === MediaAssetStatus.ready &&
          adapter.supports(asset.kind),
      )
      .map((asset) => asset.id);
    if (eligibleIds.length === 0) return [];

    if (!adapter.isAvailable()) {
      const updatedAt = new Date().toISOString();
      return eligibleIds.map((assetId) => ({
        assetId,
        capability,
        status: 'unavailable',
        statusReason: null,
        updatedAt,
      }));
    }

    const existing = await adapter.list(eligibleIds);
    const byAssetId = new Map(
      existing.map((status) => [status.assetId, status]),
    );
    const updatedAt = new Date().toISOString();
    return eligibleIds.map(
      (assetId) =>
        byAssetId.get(assetId) ?? {
          assetId,
          capability,
          status: 'not_requested',
          statusReason: null,
          updatedAt,
        },
    );
  }

  async requestCheckForUser(
    userId: string,
    assetId: string,
    capability: MediaAssetReadinessCapability,
  ): Promise<MediaAssetReadinessResult> {
    const adapter = this.requireAdapter(capability);
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        deletedAt: null,
        OR: [
          { createdByUserId: userId },
          {
            workspace: {
              members: {
                some: {
                  userId,
                  status: WorkspaceMemberStatus.active,
                  removedAt: null,
                },
              },
            },
          },
        ],
      },
      select: { id: true, kind: true, status: true, workspaceId: true },
    });
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'Media asset was not found.',
      });
    }
    if (
      asset.status !== MediaAssetStatus.ready ||
      !adapter.supports(asset.kind)
    ) {
      throw new BadRequestException({
        code: 'MEDIA_ASSET_READINESS_UNSUPPORTED',
        message: `Capability "${capability}" does not support this media asset.`,
      });
    }
    if (asset.workspaceId) {
      await this.workspacePermissions.requireWorkspaceRole(
        userId,
        asset.workspaceId,
        WorkspaceMemberRole.editor,
      );
    }
    if (!adapter.isAvailable()) {
      throw this.unavailable(capability);
    }

    const status = await adapter.request(asset.id);
    if (!status) throw this.unavailable(capability);
    return status;
  }

  /**
   * Product-neutral lifecycle hook called after any durable media asset becomes
   * ready. Every adapter opts in independently, so upload/generation code never
   * imports a provider or capability constant.
   */
  async enqueueAutomaticChecks(assetId: string): Promise<void> {
    try {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          id: assetId,
          deletedAt: null,
          status: MediaAssetStatus.ready,
        },
        select: { kind: true },
      });
      if (!asset) return;

      const adapters = [...this.adapters.values()].filter(
        (adapter) =>
          adapter.autoEnqueue &&
          adapter.isAvailable() &&
          adapter.supports(asset.kind),
      );
      const results = await Promise.allSettled(
        adapters.map((adapter) => adapter.enqueue(assetId)),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') return;
        this.logger.warn(
          `automatic readiness check failed capability=${adapters[index]?.capability ?? 'unknown'} asset=${assetId}: ${this.errorMessage(result.reason)}`,
        );
      });
    } catch (error) {
      this.logger.warn(
        `automatic readiness dispatch failed asset=${assetId}: ${this.errorMessage(error)}`,
      );
    }
  }

  private requireAdapter(
    capability: MediaAssetReadinessCapability,
  ): MediaAssetReadinessAdapter {
    const adapter = this.adapters.get(capability);
    if (!adapter) throw this.unavailable(capability);
    return adapter;
  }

  private unavailable(
    capability: MediaAssetReadinessCapability,
  ): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'MEDIA_ASSET_READINESS_UNAVAILABLE',
      message: `Media asset readiness capability "${capability}" is unavailable in this deployment.`,
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

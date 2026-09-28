import {
  BadRequestException,
  ForbiddenException,
  GoneException,
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
import { MediaAssetStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import {
  MediaAccessService,
  type MediaAccessContext,
} from './media-access.service';
import {
  MEDIA_ASSET_READINESS_ADAPTERS,
  type MediaAssetReadinessAdapter,
} from './media-asset-readiness.port';

// Readiness consumes the same asset as playback and generation. Keep only the
// fields the canonical media policy needs; no separate ownership/role policy.
const READINESS_ASSET_SELECT = {
  id: true,
  kind: true,
  status: true,
  moderationStatus: true,
  visibility: true,
  createdByUserId: true,
  workspaceId: true,
  metadata: true,
} satisfies Prisma.MediaAssetSelect;

@Injectable()
export class MediaAssetReadinessService {
  private readonly logger = new Logger(MediaAssetReadinessService.name);
  private readonly adapters: ReadonlyMap<
    MediaAssetReadinessCapability,
    MediaAssetReadinessAdapter
  >;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAccess: MediaAccessService,
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
    context?: MediaAccessContext,
  ): Promise<MediaAssetReadinessResult[]> {
    const adapter = this.requireAdapter(capability);
    const ids = [...new Set(assetIds)].slice(0, 100);
    if (ids.length === 0) return [];

    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
      },
      select: READINESS_ASSET_SELECT,
    });
    const eligibleIds: string[] = [];
    const remaining: typeof assets = [];
    for (const asset of assets) {
      if (!adapter.supports(asset.kind)) continue;
      // In-memory gates + owner shortcut first — no queries for the common
      // "checking my own canvas uploads" case.
      if (this.mediaAccess.denialForUse(userId, asset)) continue;
      if (this.mediaAccess.ownsAsset(userId, asset)) {
        eligibleIds.push(asset.id);
        continue;
      }
      remaining.push(asset);
    }

    // One canvas-context check answers the whole shared-canvas batch: a single
    // document access check + a single snapshot containment fetch replaces a
    // per-asset walk of the canonical chain.
    if (remaining.length > 0 && context?.documentId) {
      try {
        const granted = await this.mediaAccess.canvasReferencedAssetIds(
          userId,
          context.documentId,
          remaining.map((asset) => asset.id),
        );
        for (let i = remaining.length - 1; i >= 0; i -= 1) {
          if (granted.has(remaining[i].id)) {
            eligibleIds.push(remaining[i].id);
            remaining.splice(i, 1);
          }
        }
      } catch (error) {
        // Typed document denials mean the context cannot widen anything — the
        // canonical chain below decides. Infrastructure failures fail loud.
        if (
          !(error instanceof ForbiddenException) &&
          !(error instanceof NotFoundException)
        ) {
          throw error;
        }
      }
    }

    for (const asset of remaining) {
      try {
        await this.mediaAccess.requireUseAccess(userId, asset, context);
        eligibleIds.push(asset.id);
      } catch (error) {
        // A mixed batch may include removed/inaccessible assets. Never turn
        // infrastructure failures into an apparently unchecked asset.
        if (
          !(error instanceof ForbiddenException) &&
          !(error instanceof GoneException) &&
          !(error instanceof NotFoundException)
        ) {
          throw error;
        }
      }
    }
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
    context?: MediaAccessContext,
  ): Promise<MediaAssetReadinessResult> {
    const adapter = this.requireAdapter(capability);
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        deletedAt: null,
      },
      select: READINESS_ASSET_SELECT,
    });
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'Media asset was not found.',
      });
    }
    await this.mediaAccess.requireUseAccess(userId, asset, context);
    if (!adapter.supports(asset.kind)) {
      throw new BadRequestException({
        code: 'MEDIA_ASSET_READINESS_UNSUPPORTED',
        message: `Capability "${capability}" does not support this media asset.`,
      });
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

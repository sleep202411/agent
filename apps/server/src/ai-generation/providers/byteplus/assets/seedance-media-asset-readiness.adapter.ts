import { Injectable } from '@nestjs/common';
import {
  MEDIA_ASSET_READINESS_CAPABILITY,
  type MediaAssetReadinessResult,
} from '@repo/shared';
import { MediaAssetKind } from '@prisma/client';
import type { MediaAssetReadinessAdapter } from '../../../../media/media-asset-readiness.port';
import { MediaAssetProviderSyncService } from './media-asset-provider-sync.service';

/**
 * Seedance/ModelArk implementation of the generic readiness port.
 *
 * All BytePlus-specific asset-group registration and polling remains in the
 * provider sync service; the rest of the product only sees a capability key
 * and the shared readiness lifecycle.
 */
@Injectable()
export class SeedanceMediaAssetReadinessAdapter implements MediaAssetReadinessAdapter {
  readonly capability = MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference;
  readonly autoEnqueue = true;

  constructor(private readonly providerAssets: MediaAssetProviderSyncService) {}

  supports(kind: MediaAssetKind): boolean {
    return kind === MediaAssetKind.image || kind === MediaAssetKind.video;
  }

  isAvailable(): boolean {
    return this.providerAssets.isEnabled();
  }

  async enqueue(assetId: string): Promise<void> {
    await this.providerAssets.enqueueAssetRegistration(assetId);
  }

  async request(assetId: string): Promise<MediaAssetReadinessResult | null> {
    const status = await this.providerAssets.requestAssetRegistration(assetId);
    return status ? this.toResult(status) : null;
  }

  async list(assetIds: string[]): Promise<MediaAssetReadinessResult[]> {
    const statuses = await this.providerAssets.listStatuses(assetIds);
    return statuses.map((status) => this.toResult(status));
  }

  private toResult(
    status: Awaited<
      ReturnType<MediaAssetProviderSyncService['listStatuses']>
    >[number],
  ): MediaAssetReadinessResult {
    return {
      ...status,
      capability: this.capability,
    };
  }
}

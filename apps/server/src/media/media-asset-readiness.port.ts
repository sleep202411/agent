import type {
  MediaAssetReadinessCapability,
  MediaAssetReadinessResult,
} from '@repo/shared';
import type { MediaAssetKind } from '@prisma/client';

export const MEDIA_ASSET_READINESS_ADAPTERS = Symbol(
  'MEDIA_ASSET_READINESS_ADAPTERS',
);

/**
 * Provider boundary for one concrete generation-readiness capability.
 * Media-domain authorization and eligibility checks stay outside adapters;
 * vendor registration, polling and recovery stay inside them.
 */
export interface MediaAssetReadinessAdapter {
  readonly capability: MediaAssetReadinessCapability;
  readonly autoEnqueue: boolean;
  supports(kind: MediaAssetKind): boolean;
  isAvailable(): boolean;
  enqueue(assetId: string): Promise<void>;
  request(assetId: string): Promise<MediaAssetReadinessResult | null>;
  list(assetIds: string[]): Promise<MediaAssetReadinessResult[]>;
}

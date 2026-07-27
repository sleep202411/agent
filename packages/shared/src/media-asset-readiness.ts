/**
 * A readiness capability answers one precise question: can this durable media
 * asset be consumed by a particular generation path?
 *
 * This is intentionally not a global "safe" flag. The same asset can be ready
 * for one provider/model family and unavailable for another.
 */
export const MEDIA_ASSET_READINESS_CAPABILITIES = ["seedance-aigc-reference"] as const;

export type MediaAssetReadinessCapability = (typeof MEDIA_ASSET_READINESS_CAPABILITIES)[number];

export const MEDIA_ASSET_READINESS_CAPABILITY = {
  seedanceAigcReference: "seedance-aigc-reference",
} as const satisfies Record<string, MediaAssetReadinessCapability>;

export const MEDIA_ASSET_READINESS_STATUSES = [
  "not_requested",
  "pending",
  "processing",
  "active",
  "failed",
  "disabled",
  "deleted",
  "unavailable",
] as const;

export type MediaAssetReadinessStatus = (typeof MEDIA_ASSET_READINESS_STATUSES)[number];

export interface MediaAssetReadinessResult {
  assetId: string;
  capability: MediaAssetReadinessCapability;
  status: MediaAssetReadinessStatus;
  statusReason?: string | null;
  updatedAt: string;
}

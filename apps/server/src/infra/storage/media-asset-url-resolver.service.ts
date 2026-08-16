import { Injectable } from '@nestjs/common';
import { HLS_VARIANT_KEY } from './media-asset-placement';

export interface ResolvableMediaAsset {
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  status?: string | null;
  moderationStatus?: string | null;
  deletedAt?: Date | null;
  placements?: ResolvableMediaObjectPlacement[];
  variants?: ResolvableMediaAssetVariant[];
}

export interface ResolvableMediaAssetVariant {
  variantKey: string;
  status?: string;
  contentType?: string;
  deletedAt?: Date | null;
  placements?: ResolvableMediaObjectPlacement[];
}

/**
 * Input to {@link MediaAssetUrlResolverService.resolvePublicUrl}. The three
 * moderation-gate fields (`status`, `moderationStatus`, `deletedAt`) are
 * REQUIRED — not optional — so a caller that forgets to SELECT them fails to
 * compile rather than silently emitting a blocked/deleted asset's URL.
 */
export interface GatedMediaAsset {
  id?: string;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  status: string | null;
  moderationStatus: string | null;
  deletedAt: Date | null;
  placements?: ResolvableMediaObjectPlacement[];
  variants?: ResolvableMediaAssetVariant[];
}

export interface ResolvableMediaObjectPlacement {
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  publicBaseUrl?: string | null;
  role?: string;
  status?: string;
  priority?: number;
  deletedAt?: Date | null;
}

/**
 * Converts durable media asset identity into a browser-fetchable URL.
 *
 * DB rows store provider/bucket/objectKey, never a hard-coded CDN URL.
 * This resolver is the only place that knows how each provider becomes
 * a public URL, so CDN moves and region splits stay config-only.
 */
@Injectable()
export class MediaAssetUrlResolverService {
  resolve(asset: ResolvableMediaAsset): string {
    assertAssetCanResolveUrl(asset);

    const placement = pickPlacement(asset.placements);
    if (placement) return this.resolvePlacement(placement);

    if (asset.storageProvider === 'external_url') {
      if (!asset.externalUrl) {
        throw new Error('external_url media asset is missing externalUrl');
      }
      return asset.externalUrl;
    }

    if (!asset.bucket || !asset.objectKey) {
      throw new Error(
        `media asset ${asset.storageProvider} is missing bucket/objectKey`,
      );
    }

    switch (asset.storageProvider) {
      case 'azure_blob':
        return this.azureBlobUrl(asset.bucket, asset.objectKey);
      case 'aliyun_oss':
        return this.aliyunOssUrl(asset.bucket, asset.objectKey, asset.region);
      case 's3_compatible':
        return this.s3CompatibleUrl(
          asset.bucket,
          asset.objectKey,
          asset.region,
        );
      default:
        throw new Error(
          `unsupported media storage provider: ${asset.storageProvider}`,
        );
    }
  }

  /**
   * The single entry point for emitting a media asset's PUBLIC direct URL in a
   * DTO. Returns null — never throws — when the asset must not be served:
   * deleted, not yet `ready`, moderation-`blocked`, or unresolvable (missing
   * bucket/key/region/config). This is the ONLY gate for `external_url` assets
   * (no object to physically take down), so the moderation block here is
   * load-bearing. Every product DTO that exposes an asset URL must go through
   * this; the required gate fields on {@link GatedMediaAsset} make a forgotten
   * SELECT a compile error.
   */
  resolvePublicUrl(asset: GatedMediaAsset): string | null {
    if (asset.deletedAt || asset.status === 'deleted') return null;
    if (asset.status != null && asset.status !== 'ready') return null;
    if (asset.moderationStatus === 'blocked') return null;
    try {
      return this.resolve(asset);
    } catch {
      return null;
    }
  }

  resolveVariant(asset: ResolvableMediaAsset, variantKey = 'original'): string {
    assertAssetCanResolveUrl(asset);

    const variant = asset.variants?.find(
      (candidate) =>
        candidate.variantKey === variantKey &&
        candidate.status !== 'deleted' &&
        candidate.status !== 'blocked' &&
        !candidate.deletedAt,
    );
    const placement = pickPlacement(variant?.placements);
    if (placement) return this.resolvePlacement(placement);
    if (variantKey === 'original') return this.resolve(asset);
    throw new Error(`media asset variant "${variantKey}" is not resolvable`);
  }

  resolvePlacement(placement: ResolvableMediaObjectPlacement): string {
    if (placement.storageProvider === 'external_url') {
      if (!placement.externalUrl) {
        throw new Error('external_url media placement is missing externalUrl');
      }
      return placement.externalUrl;
    }

    if (!placement.bucket || !placement.objectKey) {
      throw new Error(
        `media placement ${placement.storageProvider} is missing bucket/objectKey`,
      );
    }

    const publicBaseUrl = cleanBaseUrl(placement.publicBaseUrl);
    if (publicBaseUrl) {
      return `${publicBaseUrl}/${encodePath(placement.objectKey)}`;
    }

    switch (placement.storageProvider) {
      case 'azure_blob':
        return this.azureBlobUrl(placement.bucket, placement.objectKey);
      case 'aliyun_oss':
        return this.aliyunOssUrl(
          placement.bucket,
          placement.objectKey,
          placement.region,
        );
      case 's3_compatible':
        return this.s3CompatibleUrl(
          placement.bucket,
          placement.objectKey,
          placement.region,
        );
      default:
        throw new Error(
          `unsupported media storage provider: ${placement.storageProvider}`,
        );
    }
  }

  private azureBlobUrl(container: string, objectKey: string): string {
    const configured = cleanBaseUrl(
      process.env.MEDIA_PUBLIC_BASE_URL_AZURE_BLOB ??
        process.env.AZURE_BLOB_PUBLIC_BASE_URL,
    );
    if (configured) {
      return `${configured}/${encodePath(container)}/${encodePath(objectKey)}`;
    }

    const account =
      cleanSegment(process.env.AZURE_BLOB_ACCOUNT_NAME) ??
      accountNameFromConnectionString(process.env.AZURE_BLOB_CONNECTION_STRING);
    if (!account) {
      throw new Error(
        'AZURE_BLOB_ACCOUNT_NAME or AZURE_BLOB_CONNECTION_STRING is required to resolve Azure media URLs',
      );
    }
    return `https://${account}.blob.core.windows.net/${encodePath(container)}/${encodePath(objectKey)}`;
  }

  private aliyunOssUrl(
    bucket: string,
    objectKey: string,
    region: string | null,
  ): string {
    const configured = cleanBaseUrl(
      process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS,
    );
    if (configured) {
      // Aliyun OSS/CDN custom domains are normally bucket-root, so do
      // not append the bucket when this override is configured.
      return `${configured}/${encodePath(objectKey)}`;
    }
    if (!region) {
      throw new Error(
        'media asset region is required to resolve Aliyun OSS URLs without MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS',
      );
    }
    return `https://${bucket}.oss-${region}.aliyuncs.com/${encodePath(objectKey)}`;
  }

  private s3CompatibleUrl(
    bucket: string,
    objectKey: string,
    region: string | null,
  ): string {
    const configured = cleanBaseUrl(
      process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE,
    );
    if (configured) {
      return `${configured}/${encodePath(objectKey)}`;
    }
    if (!region) {
      throw new Error(
        'media asset region is required to resolve S3-compatible URLs without MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE',
      );
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodePath(objectKey)}`;
  }
}

/**
 * Module-level access to {@link MediaAssetUrlResolverService.resolvePublicUrl}
 * for callers that are plain functions (DTO mappers) and cannot inject the
 * service. The resolver is stateless (no constructor dependencies; reads only
 * env + its argument), so a shared instance is safe and keeps URL construction
 * a single source of truth — DTO mappers must NOT re-implement it.
 */
let sharedResolver: MediaAssetUrlResolverService | null = null;
export function resolveMediaPublicUrl(asset: GatedMediaAsset): string | null {
  sharedResolver ??= new MediaAssetUrlResolverService();
  return sharedResolver.resolvePublicUrl(asset);
}

/**
 * Public URL for one named variant (the frozen Build clip), or null when the
 * asset must not be served. Unlike {@link resolveMediaPlaybackUrl} this does
 * not substitute an HLS rendition — the caller already picked the variant.
 */
export function resolveMediaPublicVariantUrl(
  asset: GatedMediaAsset,
  variantKey: string,
): string | null {
  if (resolveMediaPublicUrl(asset) == null) return null;
  try {
    sharedResolver ??= new MediaAssetUrlResolverService();
    return sharedResolver.resolveVariant(asset, variantKey);
  } catch {
    return null;
  }
}

/**
 * Resolve the PLAYABLE rendition URL for a media asset: prefer a ready ABR-HLS
 * `stream` variant (`hls`), else the original. Applies the same moderation gate
 * as {@link resolveMediaPublicUrl} (returns `url: null` when the asset must not
 * be served). `contentType` is the HLS variant's type when serving HLS, else
 * `null` — callers fall back to the asset's own contentType. A query that does
 * not load `variants` (or an asset with no ready HLS) transparently yields the
 * original, so this is safe to use everywhere `resolveMediaPublicUrl` was.
 */
export function resolveMediaPlaybackUrl(asset: GatedMediaAsset): {
  url: string | null;
  contentType: string | null;
} {
  sharedResolver ??= new MediaAssetUrlResolverService();
  const original = sharedResolver.resolvePublicUrl(asset);
  if (original == null) return { url: null, contentType: null };

  const hls = asset.variants?.find(
    (v) =>
      v.variantKey === HLS_VARIANT_KEY && v.status === 'ready' && !v.deletedAt,
  );
  if (hls) {
    try {
      return {
        url: sharedResolver.resolveVariant(asset, HLS_VARIANT_KEY),
        contentType: hls.contentType ?? 'application/vnd.apple.mpegurl',
      };
    } catch {
      // HLS variant unresolvable (e.g. missing placement) — keep the original.
    }
  }
  return { url: original, contentType: null };
}

function assertAssetCanResolveUrl(asset: ResolvableMediaAsset): void {
  if (asset.deletedAt || asset.status === 'deleted') {
    throw new Error('media asset is deleted');
  }
  if (asset.moderationStatus === 'blocked') {
    throw new Error('media asset is blocked');
  }
}

function pickPlacement(
  placements: ResolvableMediaObjectPlacement[] | undefined,
): ResolvableMediaObjectPlacement | null {
  const active = (placements ?? [])
    .filter(
      (placement) =>
        !placement.deletedAt &&
        (placement.status == null || placement.status === 'active') &&
        (placement.role == null || placement.role === 'primary'),
    )
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  return active[0] ?? null;
}

function cleanBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || null;
}

function cleanSegment(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function accountNameFromConnectionString(
  value: string | undefined,
): string | null {
  if (!value) return null;
  const match = value.match(/(?:^|;)AccountName=([^;]+)/);
  return match?.[1] ?? null;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

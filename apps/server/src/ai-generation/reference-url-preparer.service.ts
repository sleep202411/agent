import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import { ORIGINAL_VARIANT_KEY } from '../infra/storage/media-asset-placement';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { ReferencePreparationError } from './provider-adapter';

/**
 * Rebinds durable MediaAsset references to their current public placement
 * immediately before provider submission.
 *
 * Canvas documents intentionally persist both `assetId` and a display URL.
 * The URL is only a cache: storage migrations, CDN changes, and takedowns can
 * make it stale while a document is still open. Provider requests therefore
 * resolve every media reference from `assetId` on every attempt, regardless
 * of its display URL.
 * Provider-native schemes such as `asset://` remain untouched for the owning
 * adapter to validate and prepare.
 */
@Injectable()
export class AiReferenceUrlPreparerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetUrls: MediaAssetUrlResolverService,
  ) {}

  async prepareReferences(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const assetIds = collectAssetIds(input);
    if (assetIds.length === 0) return input;

    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: assetIds } },
      include: {
        placements: true,
        // Providers must receive the asset's ORIGINAL bytes. Loading only the
        // original variant keeps derived variants (video poster, HLS) out of
        // the resolver's candidate set entirely.
        variants: {
          where: { variantKey: ORIGINAL_VARIANT_KEY, deletedAt: null },
          include: { placements: true },
        },
      },
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));

    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        rewriteValue(value, (reference) => {
          const assetId = stringValue(reference.assetId);
          if (!assetId || !shouldResolveUrl(reference.url)) return reference;

          const asset = byId.get(assetId);
          if (!asset) {
            throw unavailableReference(
              assetId,
              'The referenced asset no longer exists.',
            );
          }

          const url = this.assetUrls.resolvePublicUrl(asset);
          if (!url) {
            throw unavailableReference(
              assetId,
              'The referenced asset is not ready or has been restricted.',
            );
          }
          if (new URL(url).protocol !== 'https:') {
            throw storageUnavailableReference(assetId);
          }
          return { ...reference, url };
        }),
      ]),
    );
  }
}

function storageUnavailableReference(
  assetId: string,
): ReferencePreparationError {
  return new ReferencePreparationError({
    code: 'MEDIA_STORAGE_UNAVAILABLE',
    message: `Media asset ${assetId} is not available from provider-accessible HTTPS storage.`,
    userMessage:
      'Reference media storage is temporarily unavailable. Please try again.',
    retryable: true,
    createdAt: new Date().toISOString(),
  });
}

function collectAssetIds(input: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const value of Object.values(input)) {
    for (const reference of asReferenceList(value)) {
      const assetId = stringValue(reference.assetId);
      if (assetId && shouldResolveUrl(reference.url)) ids.add(assetId);
    }
  }
  return [...ids];
}

function rewriteValue(
  value: unknown,
  rewrite: (reference: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) =>
      isRecord(item) ? rewrite(item) : item,
    );
  }
  return isRecord(value) ? rewrite(value) : value;
}

function asReferenceList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function shouldResolveUrl(value: unknown): boolean {
  // ModelArk owns asset:// identities. All other display URLs are just caches
  // when a MediaAsset ID is present, including relative and blob previews.
  return !(typeof value === 'string' && value.startsWith('asset://'));
}

function unavailableReference(
  assetId: string,
  reason: string,
): ReferencePreparationError {
  return new ReferencePreparationError({
    code: 'MEDIA_ASSET_NOT_READY',
    message: `Media asset ${assetId} is unavailable: ${reason}`,
    userMessage:
      'A referenced asset is unavailable. Please try again or choose another asset.',
    retryable: false,
    createdAt: new Date().toISOString(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

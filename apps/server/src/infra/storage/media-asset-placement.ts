import {
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';

const ORIGINAL_VARIANT_KEY = 'original';
/** Playback variant key for the ABR-HLS rendition (the `resolveVariant(asset,
 *  'hls')` / playback resolver look this up). */
export const HLS_VARIANT_KEY = 'hls';
const HLS_CONTENT_TYPE = 'application/vnd.apple.mpegurl';

export interface EnsureOriginalMediaPlacementInput {
  assetId: string;
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl?: string | null;
  contentType: string;
  sizeBytes?: bigint | number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  checksumSha256?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function ensureOriginalMediaPlacement(
  client: Prisma.TransactionClient,
  input: EnsureOriginalMediaPlacementInput,
): Promise<{ variantId: string; placementId: string }> {
  assertPlacementShape(input);

  const variant = await client.mediaAssetVariant.upsert({
    where: {
      assetId_variantKey: {
        assetId: input.assetId,
        variantKey: ORIGINAL_VARIANT_KEY,
      },
    },
    create: {
      assetId: input.assetId,
      variantKey: ORIGINAL_VARIANT_KEY,
      kind: MediaAssetVariantKind.original,
      status: MediaAssetVariantStatus.ready,
      contentType: input.contentType,
      sizeBytes: normalizeBigInt(input.sizeBytes),
      width: input.width ?? null,
      height: input.height ?? null,
      durationSeconds: input.durationSeconds ?? null,
      checksumSha256: input.checksumSha256 ?? null,
      metadata: input.metadata ?? {},
    },
    update: {
      status: MediaAssetVariantStatus.ready,
      contentType: input.contentType,
      sizeBytes: normalizeBigInt(input.sizeBytes),
      width: input.width ?? null,
      height: input.height ?? null,
      durationSeconds: input.durationSeconds ?? null,
      checksumSha256: input.checksumSha256 ?? null,
      deletedAt: null,
      metadata: input.metadata ?? {},
    },
    select: { id: true },
  });

  const existingPlacement = await client.mediaObjectPlacement.findFirst({
    where: {
      variantId: variant.id,
      role: MediaObjectPlacementRole.primary,
      storageProvider: input.storageProvider,
      bucket: input.bucket,
      objectKey: input.objectKey,
      externalUrl: input.externalUrl ?? null,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (existingPlacement) {
    return { variantId: variant.id, placementId: existingPlacement.id };
  }

  try {
    const placement = await client.mediaObjectPlacement.create({
      data: {
        assetId: input.assetId,
        variantId: variant.id,
        role: MediaObjectPlacementRole.primary,
        status: MediaObjectPlacementStatus.active,
        storageProvider: input.storageProvider,
        bucket: input.bucket,
        region: input.region,
        objectKey: input.objectKey,
        externalUrl: input.externalUrl ?? null,
        priority: 0,
        metadata: {},
      },
      select: { id: true },
    });
    return { variantId: variant.id, placementId: placement.id };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    // The unique index (variantId, role, provider, bucket, objectKey) EXCLUDES
    // deletedAt, so the colliding row may be SOFT-DELETED (e.g. a prior
    // takedown/purge). Find it regardless of deletedAt and reactivate it, rather
    // than throwing when a deletedAt:null lookup finds nothing.
    const conflict = await client.mediaObjectPlacement.findFirstOrThrow({
      where: {
        variantId: variant.id,
        role: MediaObjectPlacementRole.primary,
        storageProvider: input.storageProvider,
        bucket: input.bucket,
        objectKey: input.objectKey,
      },
      select: { id: true, deletedAt: true, status: true },
    });
    if (
      conflict.deletedAt ||
      conflict.status !== MediaObjectPlacementStatus.active
    ) {
      await client.mediaObjectPlacement.update({
        where: { id: conflict.id },
        data: {
          deletedAt: null,
          status: MediaObjectPlacementStatus.active,
          region: input.region,
        },
      });
    }
    return { variantId: variant.id, placementId: conflict.id };
  }
}

export interface EnsureStreamVariantPlacementInput {
  assetId: string;
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  /** The produced HLS master playlist key, e.g. `hls/{assetId}/master.m3u8`. */
  objectKey: string;
  durationSeconds?: number | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Records the ABR-HLS rendition as a `stream` variant + primary placement
 * pointing at the master playlist. Mirrors {@link ensureOriginalMediaPlacement}
 * but for the `hls` variant key. Idempotent (re-transcode overwrites the same
 * `hls/{assetId}/` objects → same placement key → reused). The ORIGINAL variant
 * is left untouched, so playback falls back to the source mp4 if this variant
 * is ever missing/failed.
 */
export async function ensureStreamVariantPlacement(
  client: Prisma.TransactionClient,
  input: EnsureStreamVariantPlacementInput,
): Promise<{ variantId: string; placementId: string }> {
  if (!input.bucket || !input.objectKey) {
    throw new Error('hls stream placement requires bucket and objectKey');
  }

  const variant = await client.mediaAssetVariant.upsert({
    where: {
      assetId_variantKey: {
        assetId: input.assetId,
        variantKey: HLS_VARIANT_KEY,
      },
    },
    create: {
      assetId: input.assetId,
      variantKey: HLS_VARIANT_KEY,
      kind: MediaAssetVariantKind.stream,
      status: MediaAssetVariantStatus.ready,
      contentType: HLS_CONTENT_TYPE,
      durationSeconds: input.durationSeconds ?? null,
      metadata: input.metadata ?? {},
    },
    update: {
      kind: MediaAssetVariantKind.stream,
      status: MediaAssetVariantStatus.ready,
      contentType: HLS_CONTENT_TYPE,
      durationSeconds: input.durationSeconds ?? null,
      deletedAt: null,
      metadata: input.metadata ?? {},
    },
    select: { id: true },
  });

  const existingPlacement = await client.mediaObjectPlacement.findFirst({
    where: {
      variantId: variant.id,
      role: MediaObjectPlacementRole.primary,
      storageProvider: input.storageProvider,
      bucket: input.bucket,
      objectKey: input.objectKey,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (existingPlacement) {
    return { variantId: variant.id, placementId: existingPlacement.id };
  }

  try {
    const placement = await client.mediaObjectPlacement.create({
      data: {
        assetId: input.assetId,
        variantId: variant.id,
        role: MediaObjectPlacementRole.primary,
        status: MediaObjectPlacementStatus.active,
        storageProvider: input.storageProvider,
        bucket: input.bucket,
        region: input.region,
        objectKey: input.objectKey,
        priority: 0,
        metadata: {},
      },
      select: { id: true },
    });
    return { variantId: variant.id, placementId: placement.id };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    // The unique index (variantId, role, provider, bucket, objectKey) EXCLUDES
    // deletedAt, so the colliding row may be SOFT-DELETED (e.g. a prior
    // takedown/purge). Find it regardless of deletedAt and reactivate it, rather
    // than throwing when a deletedAt:null lookup finds nothing.
    const conflict = await client.mediaObjectPlacement.findFirstOrThrow({
      where: {
        variantId: variant.id,
        role: MediaObjectPlacementRole.primary,
        storageProvider: input.storageProvider,
        bucket: input.bucket,
        objectKey: input.objectKey,
      },
      select: { id: true, deletedAt: true, status: true },
    });
    if (
      conflict.deletedAt ||
      conflict.status !== MediaObjectPlacementStatus.active
    ) {
      await client.mediaObjectPlacement.update({
        where: { id: conflict.id },
        data: {
          deletedAt: null,
          status: MediaObjectPlacementStatus.active,
          region: input.region,
        },
      });
    }
    return { variantId: variant.id, placementId: conflict.id };
  }
}

/**
 * Marks the `hls` variant as `failed` (degenerate/short/truncated source, or a
 * transcode that yielded ≤1 segment) WITHOUT a placement, so it's visible in
 * admin yet never selected for playback (playback keeps the original mp4). The
 * episode query loads only `status: ready` variants, so a failed variant simply
 * doesn't appear on the playback DTO.
 */
export async function markStreamVariantFailed(
  client: Prisma.TransactionClient,
  assetId: string,
  metadata?: Prisma.InputJsonValue,
): Promise<{ variantId: string }> {
  const variant = await client.mediaAssetVariant.upsert({
    where: { assetId_variantKey: { assetId, variantKey: HLS_VARIANT_KEY } },
    create: {
      assetId,
      variantKey: HLS_VARIANT_KEY,
      kind: MediaAssetVariantKind.stream,
      status: MediaAssetVariantStatus.failed,
      contentType: HLS_CONTENT_TYPE,
      metadata: metadata ?? {},
    },
    update: {
      status: MediaAssetVariantStatus.failed,
      metadata: metadata ?? {},
    },
    select: { id: true },
  });
  // Retire any placement from a prior successful run so no `active` placement
  // lingers behind a now-`failed` variant (ledger hygiene; playback already
  // excludes it via the ready-variant filter).
  await client.mediaObjectPlacement.updateMany({
    where: { variantId: variant.id, deletedAt: null },
    data: { deletedAt: new Date(), status: MediaObjectPlacementStatus.deleted },
  });
  return { variantId: variant.id };
}

function assertPlacementShape(input: EnsureOriginalMediaPlacementInput): void {
  if (input.storageProvider === MediaStorageProvider.external_url) {
    if (!input.externalUrl) {
      throw new Error('external_url placement requires externalUrl');
    }
    return;
  }
  if (!input.bucket || !input.objectKey) {
    throw new Error(
      `${input.storageProvider} placement requires bucket and objectKey`,
    );
  }
}

function normalizeBigInt(value: bigint | number | null | undefined) {
  if (value == null) return null;
  return typeof value === 'bigint' ? value : BigInt(value);
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

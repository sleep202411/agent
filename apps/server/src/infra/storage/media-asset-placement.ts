import {
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';

const ORIGINAL_VARIANT_KEY = 'original';

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
    const placement = await client.mediaObjectPlacement.findFirstOrThrow({
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
    return { variantId: variant.id, placementId: placement.id };
  }
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

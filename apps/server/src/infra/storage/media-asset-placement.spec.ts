import {
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
} from '@prisma/client';
import { ensureOriginalMediaPlacement } from './media-asset-placement';

describe('ensureOriginalMediaPlacement', () => {
  it('upserts an original variant and creates the primary placement', async () => {
    type UpsertArg = {
      where: { assetId_variantKey: { assetId: string; variantKey: string } };
      create: { kind: MediaAssetVariantKind; status: MediaAssetVariantStatus };
    };
    type CreatePlacementArg = {
      data: {
        assetId: string;
        variantId: string;
        role: MediaObjectPlacementRole;
        status: MediaObjectPlacementStatus;
        storageProvider: MediaStorageProvider;
        bucket: string | null;
        objectKey: string | null;
      };
      select: { id: true };
    };
    const upsertVariant: jest.MockedFunction<
      (arg: UpsertArg) => Promise<{ id: string }>
    > = jest.fn().mockResolvedValue({ id: 'variant-1' });
    const createPlacement: jest.MockedFunction<
      (arg: CreatePlacementArg) => Promise<{ id: string }>
    > = jest.fn().mockResolvedValue({ id: 'placement-1' });
    const tx = {
      mediaAssetVariant: {
        upsert: upsertVariant,
      },
      mediaObjectPlacement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: createPlacement,
      },
    };

    const result = await ensureOriginalMediaPlacement(tx as never, {
      assetId: 'asset-1',
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'foundry-outputs',
      region: 'eastus2',
      objectKey: 'path/output.png',
      contentType: 'image/png',
      sizeBytes: 1234,
      width: 1024,
      height: 1024,
      checksumSha256: 'a'.repeat(64),
    });

    expect(result).toEqual({
      variantId: 'variant-1',
      placementId: 'placement-1',
    });
    const upsertArg = upsertVariant.mock.calls[0]?.[0];
    if (!upsertArg) throw new Error('upsert call missing');
    expect(upsertArg.where.assetId_variantKey).toEqual({
      assetId: 'asset-1',
      variantKey: 'original',
    });
    expect(upsertArg.create.kind).toBe(MediaAssetVariantKind.original);
    expect(upsertArg.create.status).toBe(MediaAssetVariantStatus.ready);

    const createArg = createPlacement.mock.calls[0]?.[0];
    if (!createArg) throw new Error('placement create call missing');
    expect(createArg.data).toMatchObject({
      assetId: 'asset-1',
      variantId: 'variant-1',
      role: MediaObjectPlacementRole.primary,
      status: MediaObjectPlacementStatus.active,
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'foundry-outputs',
      objectKey: 'path/output.png',
    });
    expect(createArg.select).toEqual({ id: true });
  });

  it('rejects non-external placements without bucket and object key', async () => {
    await expect(
      ensureOriginalMediaPlacement({} as never, {
        assetId: 'asset-1',
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: null,
        region: 'cn-hangzhou',
        objectKey: null,
        contentType: 'image/png',
      }),
    ).rejects.toThrow('requires bucket and objectKey');
  });
});

import { MediaAssetVisibility } from '@prisma/client';
import { AiReferenceUrlPreparerService } from './reference-url-preparer.service';

const ASSET_ID = '01900000-0000-7000-8000-000000000001';

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    storageProvider: 's3_compatible',
    workspaceId: '01900000-0000-7000-8000-000000000010',
    bucket: 'fizzdragon-media',
    region: 'auto',
    objectKey: 'media/reference.png',
    externalUrl: null,
    visibility: MediaAssetVisibility.private,
    status: 'ready',
    moderationStatus: 'unreviewed',
    deletedAt: null,
    placements: [
      {
        storageProvider: 's3_compatible',
        bucket: 'fizzdragon-media',
        region: 'auto',
        objectKey: 'media/reference.png',
        externalUrl: null,
        publicBaseUrl: 'https://r2.fizzdragon.com',
        role: 'primary',
        status: 'active',
        priority: 100,
        deletedAt: null,
      },
    ],
    ...overrides,
  };
}

function service(rows: ReturnType<typeof asset>[]) {
  const prisma = {
    mediaAsset: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const resolver = {
    resolvePublicUrl: jest.fn((row: ReturnType<typeof asset>) =>
      row.status === 'ready'
        ? 'https://r2.fizzdragon.com/media/reference.png'
        : null,
    ),
  };
  return new AiReferenceUrlPreparerService(prisma as never, resolver as never);
}

describe(AiReferenceUrlPreparerService.name, () => {
  it('rebinds a stale canvas URL to the current asset placement', async () => {
    const result = await service([asset()]).prepareReferences({
      referenceImages: [
        {
          assetId: ASSET_ID,
          url: 'http://obsolete-storage.invalid/reference.png',
        },
      ],
    });

    expect(result.referenceImages).toEqual([
      {
        assetId: ASSET_ID,
        url: 'https://r2.fizzdragon.com/media/reference.png',
      },
    ]);
  });

  it('preserves provider-native asset references for the adapter', async () => {
    const input = {
      referenceImages: [{ assetId: ASSET_ID, url: 'asset://provider-id' }],
    };

    await expect(service([]).prepareReferences(input)).resolves.toBe(input);
  });

  it('fails closed when a durable reference is no longer available', async () => {
    await expect(
      service([asset({ status: 'deleted' })]).prepareReferences({
        startFrame: { assetId: ASSET_ID },
      }),
    ).rejects.toMatchObject({
      jobError: { code: 'MEDIA_ASSET_NOT_READY', retryable: false },
    });
  });

  it('does not re-evaluate workspace authorization during execution', async () => {
    await expect(
      service([asset({ workspaceId: 'another-workspace' })]).prepareReferences({
        referenceImages: [{ assetId: ASSET_ID }],
      }),
    ).resolves.toMatchObject({
      referenceImages: [
        {
          assetId: ASSET_ID,
          url: 'https://r2.fizzdragon.com/media/reference.png',
        },
      ],
    });
  });
});

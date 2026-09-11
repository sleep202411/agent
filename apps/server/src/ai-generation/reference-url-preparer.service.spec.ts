import { MediaAssetVisibility } from '@prisma/client';
import { AiReferenceUrlPreparerService } from './reference-url-preparer.service';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { BytePlusReferencePreparerService } from './providers/byteplus/byteplus-reference-preparer.service';
import { mapBytePlusVideoProviderRequest } from './providers/byteplus/byteplus-request.mapper';
import type { BytePlusImageRuntimeConfig } from './providers/byteplus/byteplus-runtime';

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
  it.each([
    'http://obsolete-storage.invalid/reference.png',
    `/aurora/media/assets/${ASSET_ID}/content`,
    'blob:https://studio.fizzdragon.com/expired-preview',
    '',
    `https://studio.fizzdragon.com/aurora/media/assets/${ASSET_ID}/content`,
  ])(
    'rebinds canvas display URL %s to provider-accessible storage',
    async (url) => {
      const result = await service([asset()]).prepareReferences({
        referenceImages: [
          {
            assetId: ASSET_ID,
            url,
          },
        ],
      });

      expect(result.referenceImages).toEqual([
        {
          assetId: ASSET_ID,
          url: 'https://r2.fizzdragon.com/media/reference.png',
        },
      ]);
    },
  );

  it('resolves images, videos, audio and frames without losing reference identity', async () => {
    const ref = {
      assetId: ASSET_ID,
      refId: 'selected-ref',
      url: '/old-preview',
      durationSeconds: 4,
    };
    const result = await service([asset()]).prepareReferences({
      referenceImages: [ref],
      referenceVideos: [ref],
      referenceAudios: [ref],
      startFrame: ref,
      endFrame: ref,
    });
    const resolved = {
      ...ref,
      url: 'https://r2.fizzdragon.com/media/reference.png',
    };
    expect(result).toEqual({
      referenceImages: [resolved],
      referenceVideos: [resolved],
      referenceAudios: [resolved],
      startFrame: resolved,
      endFrame: resolved,
    });
    expect(ref.url).toBe('/old-preview');
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

// Verify the final wire payload using the real storage resolver and mapper.
describe('canvas preview to Seedance request transport', () => {
  it.each([false, true])(
    'keeps five images and two audios (registered mirror: %s)',
    async (registered) => {
      const imageIds = Array.from({ length: 5 }, (_, i) => `image-${i}`);
      const audioIds = ['audio-0', 'audio-1'];
      const prisma = {
        mediaAsset: {
          findMany: jest.fn().mockResolvedValue(
            [...imageIds, ...audioIds].map((id) =>
              asset({
                id,
                placements: [
                  {
                    ...asset().placements[0],
                    objectKey: `${id}.${id.startsWith('image') ? 'png' : 'mp3'}`,
                  },
                ],
              }),
            ),
          ),
        },
        aiProviderMediaAssetMirror: {
          findMany: jest.fn().mockResolvedValue(
            registered
              ? imageIds.map((id) => ({
                  mediaAssetId: id,
                  externalAssetId: `modelark-${id}`,
                }))
              : [],
          ),
        },
        aiProviderExternalAsset: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const references = (ids: string[]) =>
        ids.map((id) => ({
          assetId: id,
          refId: id,
          url: `https://studio.fizzdragon.com/aurora/media/assets/${id}/content`,
        }));
      const storageInput = await new AiReferenceUrlPreparerService(
        prisma as never,
        new MediaAssetUrlResolverService(),
      ).prepareReferences({
        referenceImages: references(imageIds),
        referenceAudios: references(audioIds),
      });
      const providerInput = await new BytePlusReferencePreparerService(
        prisma as never,
      ).prepareReferences(
        storageInput,
        'user',
        'project',
        'workspace',
        'modelark_asset_uri',
      );
      const payload = mapBytePlusVideoProviderRequest(
        { endpointId: 'seedance-endpoint' } as BytePlusImageRuntimeConfig,
        providerInput,
      );
      expect(payload.content).toEqual([
        ...imageIds.map((id) => ({
          type: 'image_url',
          role: 'reference_image',
          image_url: {
            url: registered
              ? `asset://modelark-${id}`
              : `https://r2.fizzdragon.com/${id}.png`,
          },
        })),
        ...audioIds.map((id) => ({
          type: 'audio_url',
          role: 'reference_audio',
          audio_url: { url: `https://r2.fizzdragon.com/${id}.mp3` },
        })),
      ]);
      expect(JSON.stringify(payload)).not.toContain('/aurora/');
      expect(JSON.stringify(payload)).not.toContain('studio.fizzdragon.com');
    },
  );
  it('rejects non-HTTPS storage instead of returning the preview URL', async () => {
    const row = asset({
      storageProvider: 'external_url',
      externalUrl: 'http://invalid-storage.test/image.png',
      placements: [],
    });
    const prisma = {
      mediaAsset: { findMany: jest.fn().mockResolvedValue([row]) },
    };
    await expect(
      new AiReferenceUrlPreparerService(
        prisma as never,
        new MediaAssetUrlResolverService(),
      ).prepareReferences({
        referenceImages: [
          {
            assetId: ASSET_ID,
            url: `/aurora/media/assets/${ASSET_ID}/content`,
          },
        ],
      }),
    ).rejects.toMatchObject({
      jobError: { code: 'MEDIA_STORAGE_UNAVAILABLE' },
    });
  });
});

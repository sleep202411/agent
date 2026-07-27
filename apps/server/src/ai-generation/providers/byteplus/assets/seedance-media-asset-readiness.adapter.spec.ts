import { MEDIA_ASSET_READINESS_CAPABILITY } from '@repo/shared';
import { AiProviderExternalAssetStatus, MediaAssetKind } from '@prisma/client';
import { SeedanceMediaAssetReadinessAdapter } from './seedance-media-asset-readiness.adapter';

describe('SeedanceMediaAssetReadinessAdapter', () => {
  const providerAssets = {
    isEnabled: jest.fn().mockReturnValue(true),
    enqueueAssetRegistration: jest.fn().mockResolvedValue('mirror-1'),
    requestAssetRegistration: jest.fn().mockResolvedValue({
      assetId: 'asset-1',
      status: AiProviderExternalAssetStatus.pending,
      statusReason: null,
      updatedAt: '2026-07-23T12:00:00.000Z',
    }),
    listStatuses: jest.fn().mockResolvedValue([]),
  };
  const adapter = new SeedanceMediaAssetReadinessAdapter(
    providerAssets as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('supports Seedance image and video references, but not audio', () => {
    expect(adapter.capability).toBe(
      MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference,
    );
    expect(adapter.supports(MediaAssetKind.image)).toBe(true);
    expect(adapter.supports(MediaAssetKind.video)).toBe(true);
    expect(adapter.supports(MediaAssetKind.audio)).toBe(false);
  });

  it('delegates a manual check to the provider sync service', async () => {
    await expect(adapter.request('asset-1')).resolves.toMatchObject({
      assetId: 'asset-1',
      capability: MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference,
      status: AiProviderExternalAssetStatus.pending,
    });
    expect(providerAssets.requestAssetRegistration).toHaveBeenCalledWith(
      'asset-1',
    );
  });
});

import {
  resolveMediaPlaybackUrl,
  type GatedMediaAsset,
  type ResolvableMediaAssetVariant,
} from './media-asset-url-resolver.service';

describe('resolveMediaPlaybackUrl', () => {
  const ORIG = process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
  beforeAll(() => {
    process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = 'https://media.fizzspace.cn';
  });
  afterAll(() => {
    if (ORIG === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    else process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = ORIG;
  });

  const MP4 = 'https://media.fizzspace.cn/media/cn/x.mp4';
  const HLS = 'https://media.fizzspace.cn/hls/abc/master.m3u8';

  function asset(overrides: Partial<GatedMediaAsset> = {}): GatedMediaAsset {
    return {
      storageProvider: 'aliyun_oss',
      bucket: 'fizzdragon-ai-outputs',
      region: 'cn-hangzhou',
      objectKey: 'media/cn/x.mp4',
      externalUrl: null,
      status: 'ready',
      moderationStatus: 'unreviewed',
      deletedAt: null,
      variants: [],
      ...overrides,
    };
  }

  function hlsVariant(
    overrides: Partial<ResolvableMediaAssetVariant> = {},
  ): ResolvableMediaAssetVariant {
    return {
      variantKey: 'hls',
      status: 'ready',
      contentType: 'application/vnd.apple.mpegurl',
      deletedAt: null,
      placements: [
        {
          storageProvider: 'aliyun_oss',
          bucket: 'fizzdragon-ai-outputs',
          region: 'cn-hangzhou',
          objectKey: 'hls/abc/master.m3u8',
          externalUrl: null,
          role: 'primary',
          status: 'active',
          priority: 0,
          deletedAt: null,
        },
      ],
      ...overrides,
    };
  }

  it('prefers a ready hls variant URL + its contentType', () => {
    const r = resolveMediaPlaybackUrl(asset({ variants: [hlsVariant()] }));
    expect(r.url).toBe(HLS);
    expect(r.contentType).toBe('application/vnd.apple.mpegurl');
  });

  it('falls back to the original mp4 when there is no hls variant', () => {
    const r = resolveMediaPlaybackUrl(asset({ variants: [] }));
    expect(r.url).toBe(MP4);
    expect(r.contentType).toBeNull();
  });

  it('ignores a non-ready (failed/pending) hls variant → mp4', () => {
    const r = resolveMediaPlaybackUrl(
      asset({ variants: [hlsVariant({ status: 'failed' })] }),
    );
    expect(r.url).toBe(MP4);
    expect(r.contentType).toBeNull();
  });

  it('never mislabels: an hls variant with no resolvable placement → mp4, contentType null', () => {
    const r = resolveMediaPlaybackUrl(
      asset({ variants: [hlsVariant({ placements: [] })] }),
    );
    expect(r.url).toBe(MP4);
    expect(r.contentType).toBeNull();
  });

  it('moderation/lifecycle gate holds even with a ready hls variant', () => {
    expect(
      resolveMediaPlaybackUrl(
        asset({ status: 'processing', variants: [hlsVariant()] }),
      ).url,
    ).toBeNull();
    expect(
      resolveMediaPlaybackUrl(
        asset({ moderationStatus: 'blocked', variants: [hlsVariant()] }),
      ).url,
    ).toBeNull();
    expect(
      resolveMediaPlaybackUrl(
        asset({ deletedAt: new Date(), variants: [hlsVariant()] }),
      ).url,
    ).toBeNull();
  });
});

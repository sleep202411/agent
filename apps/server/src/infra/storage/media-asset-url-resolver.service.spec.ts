import {
  resolveMediaPlaybackUrl,
  resolveMediaPublicVariantUrl,
  MediaAssetUrlResolverService,
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
  it('plays a ready rendition even when the original placement is unavailable', () => {
    const source = asset({
      bucket: null,
      objectKey: null,
      variants: [hlsVariant()],
    });
    expect(resolveMediaPlaybackUrl(source)).toEqual({
      url: HLS,
      contentType: 'application/vnd.apple.mpegurl',
    });
    expect(resolveMediaPublicVariantUrl(source, 'hls')).toBe(HLS);
  });

  it.each(['pending', 'processing', 'failed', 'blocked', 'deleted'])(
    'rejects a named %s rendition',
    (status) => {
      const source = asset({ variants: [hlsVariant({ status })] });
      expect(resolveMediaPublicVariantUrl(source, 'hls')).toBeNull();
    },
  );

  it('does not bypass an explicitly blocked original variant through the legacy URL', () => {
    const source = asset({
      variants: [hlsVariant({ variantKey: 'original', status: 'blocked' })],
    });
    expect(resolveMediaPublicVariantUrl(source, 'original')).toBeNull();
  });

  it('preserves legacy originals without variant records or status fields', () => {
    expect(resolveMediaPublicVariantUrl(asset(), 'original')).toBe(MP4);
    expect(
      new MediaAssetUrlResolverService().resolveVariant(
        asset({ variants: [hlsVariant({ status: undefined })] }),
        'hls',
      ),
    ).toBe(HLS);
  });

  it.each([
    { status: 'processing' },
    { status: 'deleted' },
    { moderationStatus: 'blocked' },
    { deletedAt: new Date() },
  ])(
    'keeps the asset eligibility gate when only a rendition is available: %o',
    (gate) => {
      const source = asset({
        ...gate,
        bucket: null,
        objectKey: null,
        variants: [hlsVariant()],
      });
      expect(resolveMediaPlaybackUrl(source)).toEqual({
        url: null,
        contentType: null,
      });
      expect(resolveMediaPublicVariantUrl(source, 'hls')).toBeNull();
    },
  );
});

import {
  resolveMediaPlaybackUrl,
  resolveMediaPublicUrl,
  resolveMediaPublicVariantUrl,
  MediaAssetUrlResolverService,
  type GatedMediaAsset,
  type ResolvableMediaAssetVariant,
} from './media-asset-url-resolver.service';

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

describe('asset-level resolve (original-bytes invariant)', () => {
  const ORIG = process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
  beforeAll(() => {
    process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = 'https://media.fizzspace.cn';
  });
  afterAll(() => {
    if (ORIG === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    else process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = ORIG;
  });

  const MP4 = 'https://media.fizzspace.cn/aliyun-bailian/x/0-8743de9bfc8b.mp4';
  const POSTER =
    'https://media.fizzspace.cn/posters/asset-1/916714d3214b5c7a0fd0.jpg';
  const resolver = new MediaAssetUrlResolverService();

  // Prisma shape: flat `placements` carries every variant's rows (relation is
  // assetId-only); each row knows its owning variantId.
  function placement(
    variantId: string | null,
    objectKey: string,
    priority = 0,
  ) {
    return {
      variantId,
      storageProvider: 'aliyun_oss',
      bucket: 'fizzdragon-media',
      region: 'cn-hangzhou',
      objectKey,
      externalUrl: null,
      publicBaseUrl: 'https://media.fizzspace.cn',
      role: 'primary',
      status: 'active',
      priority,
      deletedAt: null,
    };
  }

  function videoAsset(overrides: Partial<GatedMediaAsset> = {}) {
    return asset({
      objectKey: 'aliyun-bailian/x/0-8743de9bfc8b.mp4',
      variants: [
        {
          variantKey: 'original',
          status: 'ready',
          contentType: 'video/mp4',
          deletedAt: null,
          placements: [
            placement('v-original', 'aliyun-bailian/x/0-8743de9bfc8b.mp4'),
          ],
        },
      ],
      // Poster listed FIRST at the same priority — exactly the incident's
      // ambiguous sort; the original must win regardless of order.
      placements: [
        placement('v-poster', 'posters/asset-1/916714d3214b5c7a0fd0.jpg'),
        placement('v-hls', 'hls/asset-1/master.m3u8'),
        placement('v-original', 'aliyun-bailian/x/0-8743de9bfc8b.mp4'),
      ],
      ...overrides,
    });
  }

  it('resolves to the original bytes, never the poster or hls variant placement', () => {
    expect(resolver.resolve(videoAsset())).toBe(MP4);
    expect(resolveMediaPublicUrl(videoAsset())).toBe(MP4);
    expect(resolveMediaPublicUrl(videoAsset())).not.toBe(POSTER);
  });

  it('falls back to the asset storage identity when variants are not loaded', () => {
    expect(
      resolver.resolve(
        videoAsset({ variants: undefined, placements: undefined }),
      ),
    ).toBe(MP4);
  });

  it('never lets variant placements shadow the asset identity even without variants', () => {
    // Caller loaded only flat placements: every row is variant-scoped, so the
    // asset fields — the original object by definition — are the URL.
    expect(resolver.resolve(videoAsset({ variants: undefined }))).toBe(MP4);
  });

  it('still honors legacy variant-less asset-level placements (CDN moves)', () => {
    // Legacy shape: no variant records, placement rows without variantId.
    const moved = videoAsset({
      variants: [],
      placements: [placement(null, 'media/cn/x.mp4')],
    });
    expect(resolver.resolve(moved)).toBe(
      'https://media.fizzspace.cn/media/cn/x.mp4',
    );
  });

  it('keeps legacy behavior for hand-built placements without variantId', () => {
    const source = asset({
      placements: [placement(null, 'aliyun-bailian/x/0-8743de9bfc8b.mp4')],
    });
    expect(resolver.resolve(source)).toBe(MP4);
  });

  it('prefers the original variant placement over the (possibly stale) asset fields', () => {
    const relocated = videoAsset({
      bucket: 'old-bucket',
      objectKey: 'stale/old-location.mp4',
    });
    expect(resolver.resolve(relocated)).toBe(MP4);
    expect(relocated.objectKey).toBe('stale/old-location.mp4');
  });
});

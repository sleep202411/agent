import { GoneException, UnauthorizedException } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaStorageProvider,
  StoryBuildKind,
  StoryBuildStatus,
} from '@prisma/client';
import { StoryBuildService } from './story-build.service';
import { readStoryPoster } from './story-build-poster';
import { compileStoryExperienceManifest } from './story-experience-manifest-compiler';
import { InteractiveFilmReleaseSchema } from '@repo/shared/interactive-film-runtime';
jest.mock('./story-build-poster', () => ({
  readStoryPoster: jest.fn().mockResolvedValue(Buffer.from('jpeg')),
}));

const PROJECT_ID = '019f993d-aecc-7020-b59f-3fec0fb7bfc6';
const BUILD_ID = '019f60f4-b101-70d4-8000-00000000a001';
const ASSET_ID = '019f60f4-b101-70d4-8000-00000000b001';
const VARIANT_ID = '019f60f4-b101-70d4-8000-00000000b002';
const CHECKSUM = 'a'.repeat(64);
const SIGNED_URL = 'https://signed.example.test/video.mp4';

/**
 * A chapter Build's frozen media, as the delivery query returns it. The Build
 * is a subgraph and has no Build publication of its own — the game release
 * that listed the chapter is the only thing that can authorize anonymous
 * delivery, which is exactly what these tests pin.
 */
function frozenChapterAsset(
  gameReleaseChapters: {
    release: { status: string; mediaAuthorizationRevokedAt: Date | null };
  }[],
) {
  return {
    logicalKey: 'video:clip:p-s1',
    assetId: ASSET_ID,
    variantId: VARIANT_ID,
    checksumSha256: CHECKSUM,
    contentType: 'video/mp4',
    durationMs: 7_000,
    width: 1920,
    height: 1080,
    browserSafeMp4: true,
    sizeBytes: 7_000n,
    build: {
      status: StoryBuildStatus.ready,
      kind: StoryBuildKind.preview,
      scope: { kind: 'subgraph', entryNodeId: 'clip:p-s1' },
      runtimeSchemaVersion: 2,
      experiencePublication: null,
      experienceDraftRelease: null,
      gameReleaseChapters,
    },
    asset: {
      id: ASSET_ID,
      kind: MediaAssetKind.video,
      status: MediaAssetStatus.ready,
      moderationStatus: MediaAssetModerationStatus.approved,
      deletedAt: null,
      sizeBytes: 7_000n,
      storageProvider:
        MediaStorageProvider.external_url as MediaStorageProvider,
      bucket: null as string | null,
      region: null as string | null,
      objectKey: null as string | null,
      externalUrl: 'https://cdn.example.test/video.mp4' as string | null,
      contentType: 'video/mp4',
      placements: [],
    },
    variant: {
      id: VARIANT_ID,
      assetId: ASSET_ID,
      variantKey: 'original',
      status: MediaAssetVariantStatus.ready,
      checksumSha256: 'b'.repeat(64),
      contentType: 'video/mp4',
      durationMs: 7_000,
      width: 1920,
      height: 1080,
      sizeBytes: 7_000n,
      metadata: { browserSafeMp4: true },
      deletedAt: null,
      placements: [],
    },
  };
}

function frozenWholeAsset(experienceDraftRelease: { status: string } | null) {
  const frozen = frozenChapterAsset([]);
  return {
    ...frozen,
    build: {
      ...frozen.build,
      kind: StoryBuildKind.production,
      scope: { kind: 'full' },
      experienceDraftRelease,
    },
  };
}

function serviceFor(frozen: unknown) {
  const storage = {
    createReadUrl: jest.fn().mockResolvedValue({
      url: SIGNED_URL,
      expiresAt: null,
    }),
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: '019f60f4-b101-70d4-8000-000000000003' },
    }),
  };
  const communityAccess = {
    requireAssetAccess: jest.fn().mockRejectedValue(new Error('locked')),
  };
  const service = new StoryBuildService(
    {
      storyBuildAsset: { findFirst: jest.fn().mockResolvedValue(frozen) },
    } as never,
    permissions as never,
    storage as never,
    { assertHumanWriteAllowed: jest.fn() } as never,
    communityAccess as never,
  );
  return { service, permissions, storage, communityAccess };
}

describe('release-candidate media delivery', () => {
  it('serves only a first-frame image before unlock while keeping the video protected', async () => {
    const frozen = frozenWholeAsset({ status: 'confirmed' });
    const runtimeJson = compileStoryExperienceManifest({
      release: InteractiveFilmReleaseSchema.parse({
        schemaVersion: 2,
        channel: 'production',
        gameId: PROJECT_ID,
        releaseId: BUILD_ID,
        contentVersion: BUILD_ID,
        entryNodeId: 'paid',
        defaultLocale: 'en-US',
        locales: ['en-US'],
        media: [
          {
            assetId: ASSET_ID,
            kind: 'video',
            orientationPolicy: 'single-master',
            variants: {
              landscape: {
                sourceAssetId: ASSET_ID,
                sha256: CHECKSUM,
                src: `/aurora/story-projects/${PROJECT_ID}/builds/${BUILD_ID}/assets/${ASSET_ID}/variants/${VARIANT_ID}/content`,
                width: 1920,
                height: 1080,
                durationSeconds: 7,
              },
            },
          },
        ],
        nodes: [
          {
            nodeId: 'paid',
            communityPointPrice: 3,
            presentation: {
              kind: 'video',
              fit: 'cover',
              sequence: [
                {
                  clipId: 'clip',
                  assetId: ASSET_ID,
                  endBehavior: { behavior: 'advance' },
                },
              ],
            },
            exit: { kind: 'auto', nextNodeId: null },
          },
        ],
      }),
      metadata: { title: 'Paid' },
      experienceProfile: 'cinematic',
      mediaIdentities: [
        {
          runtimeAssetId: ASSET_ID,
          variantId: VARIANT_ID,
          mediaType: 'video/mp4',
        },
      ],
    }).manifest;
    expect(runtimeJson?.graph.nodes[0]?.access?.communityPointPrice).toBe(3);
    Object.assign(frozen.build, { runtimeJson });
    frozen.asset.storageProvider = MediaStorageProvider.aliyun_oss;
    frozen.asset.bucket = 'test';
    frozen.asset.region = 'test';
    frozen.asset.objectKey = 'paid.mp4';
    frozen.asset.externalUrl = null;
    const { service, communityAccess } = serviceFor(frozen);
    await expect(
      service.readBuildAssetPoster(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).resolves.toEqual(Buffer.from('jpeg'));
    expect(readStoryPoster).toHaveBeenCalledWith(
      `${BUILD_ID}:${ASSET_ID}:${VARIANT_ID}`,
      SIGNED_URL,
    );
    expect(communityAccess.requireAssetAccess).not.toHaveBeenCalled();
    await expect(
      service.issueBuildAssetReadUrl(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).rejects.toThrow('locked');
  });

  it('does not expose posters for private, removed, or externally hosted media', async () => {
    const privateMedia = serviceFor(frozenWholeAsset(null));
    await expect(
      privateMedia.service.readBuildAssetPoster(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const external = frozenWholeAsset({ status: 'confirmed' });
    await expect(
      serviceFor(external).service.readBuildAssetPoster(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).rejects.toThrow('managed storage');
    external.asset.deletedAt = new Date() as never;
    await expect(
      serviceFor(external).service.readBuildAssetPoster(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).rejects.toThrow();
  });
  it('keeps a whole production Build private without a candidate receipt', async () => {
    const { service } = serviceFor(frozenWholeAsset(null));

    await expect(
      service.issueBuildAssetReadUrl(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('serves a whole production Build anonymously once a candidate receipt exists', async () => {
    const { service } = serviceFor(frozenWholeAsset({ status: 'pending' }));

    await expect(
      service.issueBuildAssetReadUrl(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).resolves.toEqual({
      url: 'https://cdn.example.test/video.mp4',
      expiresAt: null,
    });
  });

  it('serves a chapter Build anonymously once a candidate receipt lists it', async () => {
    const { service, permissions, storage } = serviceFor(
      frozenChapterAsset([
        { release: { status: 'pending', mediaAuthorizationRevokedAt: null } },
      ]),
    );

    await expect(
      service.issueBuildAssetReadUrl(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).resolves.toEqual({
      url: 'https://cdn.example.test/video.mp4',
      expiresAt: null,
    });
    expect(permissions.requireProject).not.toHaveBeenCalled();
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });

  it('keeps unpublished preview media on a signed URL for a project reader', async () => {
    const { service, storage, permissions } = serviceFor(
      frozenChapterAsset([]),
    );

    await expect(
      service.issueBuildAssetReadUrl(
        { userId: 'user-1' } as never,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).resolves.toEqual({ url: SIGNED_URL, expiresAt: null });
    expect(permissions.requireProject).toHaveBeenCalled();
    expect(storage.createReadUrl).toHaveBeenCalled();
  });

  it('keeps a chapter Build private when its release was rejected', async () => {
    const { service } = serviceFor(
      frozenChapterAsset([
        {
          release: {
            status: 'rejected',
            mediaAuthorizationRevokedAt: new Date(),
          },
        },
      ]),
    );

    await expect(
      service.issueBuildAssetReadUrl(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('keeps an unpublished chapter Build private', async () => {
    const { service } = serviceFor(frozenChapterAsset([]));

    await expect(
      service.issueBuildAssetReadUrl(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('redirects a published OSS clip to the public media CDN, not a signed CNAME', async () => {
    const previous = process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = 'https://media.fizzspace.cn';
    const frozen = frozenChapterAsset([
      { release: { status: 'confirmed', mediaAuthorizationRevokedAt: null } },
    ]);
    frozen.asset.storageProvider = MediaStorageProvider.aliyun_oss;
    frozen.asset.bucket = 'fizzdragon-ai-outputs';
    frozen.asset.region = 'cn-hangzhou';
    frozen.asset.objectKey =
      'aliyun-bailian/2026/08/15/2259/01a00755-414a-78f7-ac78-c8dd32a1428b/0-64f6f0587e99.mp4';
    frozen.asset.externalUrl = null;
    const { service, storage } = serviceFor(frozen);

    try {
      await expect(
        service.issueBuildAssetReadUrl(
          undefined,
          PROJECT_ID,
          BUILD_ID,
          ASSET_ID,
          VARIANT_ID,
        ),
      ).resolves.toEqual({
        url: 'https://media.fizzspace.cn/aliyun-bailian/2026/08/15/2259/01a00755-414a-78f7-ac78-c8dd32a1428b/0-64f6f0587e99.mp4',
        expiresAt: null,
      });
      expect(storage.createReadUrl).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined)
        delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
      else process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = previous;
    }
  });
});

describe('adaptive playback (/playback)', () => {
  const MASTER = `https://media.fizzspace.cn/hls/${ASSET_ID}/master.m3u8`;
  const MP4_KEY = 'aliyun-bailian/2026/08/15/2259/clip.mp4';
  let previousBase: string | undefined;
  beforeAll(() => {
    previousBase = process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = 'https://media.fizzspace.cn';
  });
  afterAll(() => {
    if (previousBase === undefined)
      delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    else process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = previousBase;
  });

  function runtimeManifest(communityPointPrice?: number) {
    return compileStoryExperienceManifest({
      release: InteractiveFilmReleaseSchema.parse({
        schemaVersion: 2,
        channel: 'production',
        gameId: PROJECT_ID,
        releaseId: BUILD_ID,
        contentVersion: BUILD_ID,
        entryNodeId: 'scene',
        defaultLocale: 'en-US',
        locales: ['en-US'],
        media: [
          {
            assetId: ASSET_ID,
            kind: 'video',
            orientationPolicy: 'single-master',
            variants: {
              landscape: {
                sourceAssetId: ASSET_ID,
                sha256: CHECKSUM,
                src: `/aurora/story-projects/${PROJECT_ID}/builds/${BUILD_ID}/assets/${ASSET_ID}/variants/${VARIANT_ID}/content`,
                width: 1920,
                height: 1080,
                durationSeconds: 7,
              },
            },
          },
        ],
        nodes: [
          {
            nodeId: 'scene',
            ...(communityPointPrice ? { communityPointPrice } : {}),
            presentation: {
              kind: 'video',
              fit: 'cover',
              sequence: [
                {
                  clipId: 'clip',
                  assetId: ASSET_ID,
                  endBehavior: { behavior: 'advance' },
                },
              ],
            },
            exit: { kind: 'auto', nextNodeId: null },
          },
        ],
      }),
      metadata: { title: 'Playback' },
      experienceProfile: 'cinematic',
      mediaIdentities: [
        {
          runtimeAssetId: ASSET_ID,
          variantId: VARIANT_ID,
          mediaType: 'video/mp4',
        },
      ],
    }).manifest;
  }

  /** A published chapter clip on .cn OSS whose original is the frozen variant. */
  function publishedOssClip(
    options: {
      runtimeJson?: unknown;
      releases?: Parameters<typeof frozenChapterAsset>[0];
    } = {},
  ) {
    const frozen = frozenChapterAsset(
      options.releases ?? [
        { release: { status: 'confirmed', mediaAuthorizationRevokedAt: null } },
      ],
    );
    Object.assign(frozen.build, {
      runtimeJson:
        'runtimeJson' in options ? options.runtimeJson : runtimeManifest(),
    });
    frozen.asset.storageProvider = MediaStorageProvider.aliyun_oss;
    frozen.asset.bucket = 'fizzdragon-ai-outputs';
    frozen.asset.region = 'cn-hangzhou';
    frozen.asset.objectKey = MP4_KEY;
    frozen.asset.externalUrl = null;
    return frozen;
  }

  const READY_HLS = {
    id: 'hls-variant',
    assetId: ASSET_ID,
    variantKey: 'hls',
    status: MediaAssetVariantStatus.ready,
    contentType: 'application/vnd.apple.mpegurl',
    deletedAt: null,
    placements: [
      {
        id: 'hls-master',
        variantId: 'hls-variant',
        role: 'primary',
        status: 'active',
        priority: 0,
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'fizzdragon-ai-outputs',
        region: 'cn-hangzhou',
        objectKey: `hls/${ASSET_ID}/master.m3u8`,
        externalUrl: null,
        publicBaseUrl: null,
        deletedAt: null,
      },
    ],
  };

  function playbackService(frozen: unknown, hls: unknown = READY_HLS) {
    const findFirst = jest.fn().mockResolvedValue(frozen);
    const hlsLookup = jest.fn().mockResolvedValue(hls);
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: '019f60f4-b101-70d4-8000-000000000003' },
      }),
    };
    const communityAccess = { requireAssetAccess: jest.fn() };
    const storage = { createReadUrl: jest.fn() };
    const service = new StoryBuildService(
      {
        storyBuildAsset: { findFirst },
        mediaAssetVariant: { findFirst: hlsLookup },
      } as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
      communityAccess as never,
    );
    const playback = (user?: { userId: string }) =>
      service.resolveBuildAssetPlayback(
        user as never,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      );
    return {
      service,
      playback,
      findFirst,
      hlsLookup,
      permissions,
      communityAccess,
      storage,
    };
  }

  it('offers the ready HLS master of a published free OSS clip', async () => {
    const h = playbackService(publishedOssClip());

    await expect(h.playback()).resolves.toEqual({
      url: MASTER,
      contentType: 'application/vnd.apple.mpegurl',
    });
    expect(h.hlsLookup).toHaveBeenCalledWith({
      where: {
        assetId: ASSET_ID,
        variantKey: 'hls',
        status: MediaAssetVariantStatus.ready,
        deletedAt: null,
      },
      include: {
        placements: {
          where: { role: 'primary', status: 'active', deletedAt: null },
        },
      },
    });
  });

  it('keeps /content progressive even when an HLS output exists', async () => {
    const frozen = publishedOssClip();
    Object.assign(frozen.asset, { variants: [READY_HLS] });
    const h = playbackService(frozen);

    await expect(
      h.service.issueBuildAssetReadUrl(
        undefined,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).resolves.toEqual({
      url: `https://media.fizzspace.cn/${MP4_KEY}`,
      expiresAt: null,
    });
  });

  it('reads /content only from variant-less asset placements', async () => {
    const h = playbackService(publishedOssClip());

    await h.service.issueBuildAssetReadUrl(
      undefined,
      PROJECT_ID,
      BUILD_ID,
      ASSET_ID,
      VARIANT_ID,
    );

    const [query] = h.findFirst.mock.calls[0] as [
      { include: { asset: unknown } },
    ];
    expect(query.include.asset).toEqual({
      include: { placements: { where: { variantId: null } } },
    });
  });

  it('returns null for a paid Build without any entitlement or reader check', async () => {
    const h = playbackService(
      publishedOssClip({ runtimeJson: runtimeManifest(3) }),
    );

    await expect(h.playback({ userId: 'viewer' })).resolves.toBeNull();
    expect(h.communityAccess.requireAssetAccess).not.toHaveBeenCalled();
    expect(h.permissions.requireProject).not.toHaveBeenCalled();
    expect(h.hlsLookup).not.toHaveBeenCalled();
  });

  it('fails closed on a manifest that no longer parses', async () => {
    const h = playbackService(publishedOssClip({ runtimeJson: undefined }));

    await expect(h.playback()).resolves.toBeNull();
    expect(h.hlsLookup).not.toHaveBeenCalled();
  });

  it('returns null for an unpublished Build, even for a project reader', async () => {
    const h = playbackService(publishedOssClip({ releases: [] }));

    await expect(h.playback({ userId: 'reader' })).resolves.toBeNull();
    expect(h.permissions.requireProject).toHaveBeenCalledWith(
      'reader',
      PROJECT_ID,
      'story.read',
    );
    expect(h.hlsLookup).not.toHaveBeenCalled();
  });

  it('answers 401 for an unpublished Build with an anonymous viewer', async () => {
    const h = playbackService(publishedOssClip({ releases: [] }));

    await expect(h.playback()).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 410 for a moderation-blocked clip, like /content', async () => {
    const frozen = publishedOssClip();
    Object.assign(frozen.asset, {
      moderationStatus: MediaAssetModerationStatus.blocked,
    });
    const h = playbackService(frozen);

    await expect(h.playback()).rejects.toBeInstanceOf(GoneException);
    expect(h.hlsLookup).not.toHaveBeenCalled();
  });

  it('returns null for a frozen variant other than the original', async () => {
    const frozen = publishedOssClip();
    frozen.variant.variantKey = 'rendition-720p';
    const h = playbackService(frozen);

    await expect(h.playback()).resolves.toBeNull();
    expect(h.hlsLookup).not.toHaveBeenCalled();
  });

  it('returns null without a ready HLS output or its master placement', async () => {
    await expect(
      playbackService(publishedOssClip(), null).playback(),
    ).resolves.toBeNull();
    await expect(
      playbackService(publishedOssClip(), {
        ...READY_HLS,
        placements: [],
      }).playback(),
    ).resolves.toBeNull();
  });
});

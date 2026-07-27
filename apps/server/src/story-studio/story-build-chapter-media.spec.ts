import { UnauthorizedException } from '@nestjs/common';
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
      gameReleaseChapters,
    },
    asset: {
      id: ASSET_ID,
      kind: MediaAssetKind.video,
      status: MediaAssetStatus.ready,
      moderationStatus: MediaAssetModerationStatus.approved,
      deletedAt: null,
      sizeBytes: 7_000n,
      storageProvider: MediaStorageProvider.external_url,
      bucket: null,
      region: null,
      objectKey: null,
      externalUrl: 'https://cdn.example.test/video.mp4',
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

function serviceFor(frozen: ReturnType<typeof frozenChapterAsset>) {
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
  const service = new StoryBuildService(
    {
      storyBuildAsset: { findFirst: jest.fn().mockResolvedValue(frozen) },
    } as never,
    permissions as never,
    storage as never,
    { assertHumanWriteAllowed: jest.fn() } as never,
  );
  return { service, permissions };
}

describe('published chapter media delivery', () => {
  it('serves a chapter Build anonymously once a game release listed it', async () => {
    const { service, permissions } = serviceFor(
      frozenChapterAsset([
        { release: { status: 'confirmed', mediaAuthorizationRevokedAt: null } },
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
    ).resolves.toEqual({ url: SIGNED_URL, expiresAt: null });
    expect(permissions.requireProject).not.toHaveBeenCalled();
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
});

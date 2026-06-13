import {
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVisibility,
} from '@prisma/client';
import { MediaAccessService } from './media-access.service';

function readyAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-7111-9111-111111111111',
    status: MediaAssetStatus.ready,
    moderationStatus: MediaAssetModerationStatus.approved,
    visibility: MediaAssetVisibility.private,
    createdByUserId: 'user-1',
    workspaceId: null,
    storageProvider: 'azure_blob',
    bucket: 'foundry-outputs',
    region: 'eastus2',
    objectKey: 'path/output.png',
    externalUrl: null,
    contentType: 'application/octet-stream',
    placements: [],
    variants: [],
    ...overrides,
  };
}

describe('MediaAccessService', () => {
  it('issues an access URL for the owner', async () => {
    const prisma = {
      mediaAsset: { findFirst: jest.fn().mockResolvedValue(readyAsset()) },
    };
    const storageAccess = {
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://blob.example.com/a.png?sig=read',
        provider: 'azure_blob',
        bucket: 'foundry-outputs',
        objectKey: 'path/output.png',
        expiresAt: '2026-06-12T12:00:00.000Z',
      }),
    };
    const permissions = { requireWorkspaceRole: jest.fn() };
    const service = new MediaAccessService(
      prisma as never,
      storageAccess as never,
      permissions as never,
    );

    await expect(
      service.issueAccessUrl('user-1', '11111111-1111-7111-9111-111111111111', {
        variantKey: 'original',
      }),
    ).resolves.toEqual({
      assetId: '11111111-1111-7111-9111-111111111111',
      variantKey: 'original',
      url: 'https://blob.example.com/a.png?sig=read',
      expiresAt: '2026-06-12T12:00:00.000Z',
    });
    expect(storageAccess.createReadUrl).toHaveBeenCalledWith(
      {
        storageProvider: 'azure_blob',
        bucket: 'foundry-outputs',
        region: 'eastus2',
        objectKey: 'path/output.png',
        externalUrl: null,
        contentType: 'application/octet-stream',
      },
      {
        cacheControl: 'private, no-store',
        expiresInSeconds: 300,
      },
    );
  });

  it('rejects blocked assets before resolving a URL', async () => {
    const prisma = {
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue(
          readyAsset({
            moderationStatus: MediaAssetModerationStatus.blocked,
          }),
        ),
      },
    };
    const service = new MediaAccessService(
      prisma as never,
      { createReadUrl: jest.fn() } as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAccessUrl('user-1', '11111111-1111-7111-9111-111111111111', {
        variantKey: 'original',
      }),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects private assets for non-owner users without workspace access', async () => {
    const service = new MediaAccessService(
      {
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue(
            readyAsset({
              createdByUserId: 'owner-user',
              workspaceId: null,
            }),
          ),
        },
      } as never,
      { createReadUrl: jest.fn() } as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAccessUrl(
        'other-user',
        '11111111-1111-7111-9111-111111111111',
        {
          variantKey: 'original',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('issues an access URL for anonymous reads of public assets', async () => {
    const storageAccess = {
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://blob.example.com/public.png?sig=read',
        provider: 'azure_blob',
        bucket: 'foundry-outputs',
        objectKey: 'path/output.png',
        expiresAt: '2026-06-12T12:00:00.000Z',
      }),
    };
    const service = new MediaAccessService(
      {
        mediaAsset: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              readyAsset({ visibility: MediaAssetVisibility.public }),
            ),
        },
      } as never,
      storageAccess as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueBrowserAccessUrl(
        null,
        '11111111-1111-7111-9111-111111111111',
        {
          variantKey: 'original',
        },
      ),
    ).resolves.toMatchObject({
      url: 'https://blob.example.com/public.png?sig=read',
    });
  });

  it('requires authentication for anonymous reads of private assets', async () => {
    const service = new MediaAccessService(
      {
        mediaAsset: { findFirst: jest.fn().mockResolvedValue(readyAsset()) },
      } as never,
      { createReadUrl: jest.fn() } as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueBrowserAccessUrl(
        undefined,
        '11111111-1111-7111-9111-111111111111',
        {
          variantKey: 'original',
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns not found when the requested variant cannot be resolved', async () => {
    const service = new MediaAccessService(
      {
        mediaAsset: { findFirst: jest.fn().mockResolvedValue(readyAsset()) },
      } as never,
      { createReadUrl: jest.fn() } as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAccessUrl('user-1', '11111111-1111-7111-9111-111111111111', {
        variantKey: 'thumb_320w',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows admin evidence access for blocked ready assets', async () => {
    const storageAccess = {
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://blob.example.com/a.png?sig=admin-read',
        provider: 'azure_blob',
        bucket: 'foundry-outputs',
        objectKey: 'path/output.png',
        expiresAt: '2026-06-12T12:15:00.000Z',
      }),
    };
    const service = new MediaAccessService(
      {
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue(
            readyAsset({
              moderationStatus: MediaAssetModerationStatus.blocked,
            }),
          ),
        },
      } as never,
      storageAccess as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAdminAccessUrl('11111111-1111-7111-9111-111111111111', {
        variantKey: 'original',
      }),
    ).resolves.toEqual({
      assetId: '11111111-1111-7111-9111-111111111111',
      variantKey: 'original',
      url: 'https://blob.example.com/a.png?sig=admin-read',
      expiresAt: '2026-06-12T12:15:00.000Z',
    });
    expect(storageAccess.createReadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: 'path/output.png' }),
      {
        cacheControl: 'private, no-store',
        expiresInSeconds: 900,
      },
    );
  });

  it('issues a signed URL for an exact active placement', async () => {
    const storageAccess = {
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://blob.example.com/placement.png?sig=admin-read',
        provider: 'azure_blob',
        bucket: 'foundry-outputs',
        objectKey: 'placements/display.png',
        expiresAt: '2026-06-12T12:15:00.000Z',
      }),
    };
    const service = new MediaAccessService(
      {
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue(
            readyAsset({
              placements: [
                {
                  id: '22222222-2222-7222-9222-222222222222',
                  status: 'active',
                  deletedAt: null,
                  priority: 10,
                  storageProvider: 'azure_blob',
                  bucket: 'foundry-outputs',
                  region: 'eastus2',
                  objectKey: 'placements/display.png',
                  externalUrl: null,
                },
              ],
            }),
          ),
        },
      } as never,
      storageAccess as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAdminAccessUrl('11111111-1111-7111-9111-111111111111', {
        variantKey: 'original',
        placementId: '22222222-2222-7222-9222-222222222222',
      }),
    ).resolves.toEqual({
      assetId: '11111111-1111-7111-9111-111111111111',
      variantKey: 'original',
      placementId: '22222222-2222-7222-9222-222222222222',
      url: 'https://blob.example.com/placement.png?sig=admin-read',
      expiresAt: '2026-06-12T12:15:00.000Z',
    });
    expect(storageAccess.createReadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: 'placements/display.png' }),
      {
        cacheControl: 'private, no-store',
        expiresInSeconds: 900,
      },
    );
  });

  it('allows admin evidence access for purged placements after takedown', async () => {
    const storageAccess = {
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://blob.example.com/purged.png?sig=admin-read',
        provider: 'azure_blob',
        bucket: 'foundry-outputs',
        objectKey: 'placements/purged.png',
        expiresAt: '2026-06-12T12:15:00.000Z',
      }),
    };
    const service = new MediaAccessService(
      {
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue(
            readyAsset({
              moderationStatus: MediaAssetModerationStatus.blocked,
              placements: [
                {
                  id: '33333333-3333-7333-9333-333333333333',
                  status: 'purged',
                  deletedAt: null,
                  priority: 10,
                  storageProvider: 'azure_blob',
                  bucket: 'foundry-outputs',
                  region: 'eastus2',
                  objectKey: 'placements/purged.png',
                  externalUrl: null,
                },
              ],
            }),
          ),
        },
      } as never,
      storageAccess as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAdminAccessUrl('11111111-1111-7111-9111-111111111111', {
        variantKey: 'original',
        placementId: '33333333-3333-7333-9333-333333333333',
      }),
    ).resolves.toMatchObject({
      placementId: '33333333-3333-7333-9333-333333333333',
      url: 'https://blob.example.com/purged.png?sig=admin-read',
    });
    expect(storageAccess.createReadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: 'placements/purged.png' }),
      expect.objectContaining({ expiresInSeconds: 900 }),
    );
  });
});

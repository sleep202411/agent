import {
  ForbiddenException,
  GoneException,
  NotFoundException,
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
    const urls = {
      resolveVariant: jest
        .fn()
        .mockReturnValue('https://cdn.example.com/a.png'),
    };
    const permissions = { requireWorkspaceRole: jest.fn() };
    const service = new MediaAccessService(
      prisma as never,
      urls as never,
      permissions as never,
    );

    await expect(
      service.issueAccessUrl('user-1', '11111111-1111-7111-9111-111111111111', {
        variantKey: 'original',
      }),
    ).resolves.toEqual({
      assetId: '11111111-1111-7111-9111-111111111111',
      variantKey: 'original',
      url: 'https://cdn.example.com/a.png',
      expiresAt: null,
    });
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
      { resolveVariant: jest.fn() } as never,
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
      { resolveVariant: jest.fn() } as never,
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

  it('returns not found when the requested variant cannot be resolved', async () => {
    const service = new MediaAccessService(
      {
        mediaAsset: { findFirst: jest.fn().mockResolvedValue(readyAsset()) },
      } as never,
      {
        resolveVariant: jest.fn(() => {
          throw new Error('missing variant');
        }),
      } as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAccessUrl('user-1', '11111111-1111-7111-9111-111111111111', {
        variantKey: 'thumb_320w',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

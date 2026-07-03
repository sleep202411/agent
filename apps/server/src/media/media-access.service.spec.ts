import {
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CharacterStatus,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVisibility,
  WorkspaceMemberStatus,
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
        characterMedia: { findFirst: jest.fn().mockResolvedValue(null) },
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

  it('grants project members access to character reference media (cast grant)', async () => {
    // Reference-reaches-context: asset owned by someone else, workspace
    // membership denied, but the asset is attached to a character cast into
    // a project where the caller is an active ProjectMember.
    const characterMediaFindFirst = jest
      .fn<Promise<{ id: string } | null>, [unknown]>()
      .mockResolvedValue({ id: 'character-media-1' });
    const service = new MediaAccessService(
      {
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue(
            readyAsset({
              createdByUserId: 'owner-user',
              workspaceId: 'workspace-1',
            }),
          ),
        },
        characterMedia: { findFirst: characterMediaFindFirst },
      } as never,
      {
        createReadUrl: jest.fn().mockResolvedValue({
          url: 'https://blob.example.com/a.png?sig=read',
          expiresAt: '2026-06-12T12:00:00.000Z',
        }),
      } as never,
      {
        requireWorkspaceRole: jest.fn().mockRejectedValue(
          new ForbiddenException({
            code: 'WORKSPACE_ACCESS_DENIED',
            msg: 'You do not have access to this workspace.',
          }),
        ),
      } as never,
    );

    await expect(
      service.issueAccessUrl(
        'project-only-member',
        '11111111-1111-7111-9111-111111111111',
        { variantKey: 'original' },
      ),
    ).resolves.toMatchObject({
      url: 'https://blob.example.com/a.png?sig=read',
    });
    expect(characterMediaFindFirst).toHaveBeenCalledTimes(1);
    const grantQuery = characterMediaFindFirst.mock.calls[0]?.[0] as {
      where?: { mediaAssetId?: string };
    };
    expect(grantQuery?.where?.mediaAssetId).toBe(
      '11111111-1111-7111-9111-111111111111',
    );
  });

  it('grants workspace members access to character reference media (library grant)', async () => {
    // Workspace-library branch: the asset itself carries NO workspaceId (a
    // personal upload enrolled into the 演员池), so the plain workspace-role
    // grant never fires — but the asset is attached to a live character whose
    // home workspace has the caller as an active WorkspaceMember.
    const characterMediaFindFirst = jest
      .fn<Promise<{ id: string } | null>, [unknown]>()
      .mockResolvedValue({ id: 'character-media-2' });
    const requireWorkspaceRole = jest.fn();
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
        characterMedia: { findFirst: characterMediaFindFirst },
      } as never,
      {
        createReadUrl: jest.fn().mockResolvedValue({
          url: 'https://blob.example.com/b.png?sig=read',
          expiresAt: '2026-06-12T12:00:00.000Z',
        }),
      } as never,
      { requireWorkspaceRole } as never,
    );

    await expect(
      service.issueAccessUrl(
        'workspace-member',
        '11111111-1111-7111-9111-111111111111',
        { variantKey: 'original' },
      ),
    ).resolves.toMatchObject({
      url: 'https://blob.example.com/b.png?sig=read',
    });
    // No asset-level workspace to check — the grant came from the character.
    expect(requireWorkspaceRole).not.toHaveBeenCalled();
    expect(characterMediaFindFirst).toHaveBeenCalledTimes(1);
    const grantQuery = characterMediaFindFirst.mock.calls[0]?.[0] as {
      where?: {
        character?: {
          status?: unknown;
          OR?: Array<Record<string, unknown>>;
        };
      };
    };
    // Pin the semantics the mock hides: revoked characters never grant, and
    // the workspace branch admits only active, non-removed members.
    expect(grantQuery?.where?.character?.status).toEqual({
      not: CharacterStatus.revoked,
    });
    expect(grantQuery?.where?.character?.OR).toEqual(
      expect.arrayContaining([
        {
          workspace: {
            members: {
              some: {
                userId: 'workspace-member',
                status: WorkspaceMemberStatus.active,
                removedAt: null,
              },
            },
          },
        },
      ]),
    );
  });

  it('denies a removed workspace member the library grant', async () => {
    // The grant query's workspace branch requires status=active AND
    // removedAt=null, so a removed member matches no CharacterMedia row.
    const characterMediaFindFirst = jest
      .fn<Promise<{ id: string } | null>, [unknown]>()
      .mockResolvedValue(null);
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
        characterMedia: { findFirst: characterMediaFindFirst },
      } as never,
      { createReadUrl: jest.fn() } as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAccessUrl(
        'removed-member',
        '11111111-1111-7111-9111-111111111111',
        { variantKey: 'original' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const grantQuery = characterMediaFindFirst.mock.calls[0]?.[0] as {
      where?: { character?: { OR?: Array<Record<string, unknown>> } };
    };
    expect(grantQuery?.where?.character?.OR).toEqual(
      expect.arrayContaining([
        {
          workspace: {
            members: {
              some: {
                userId: 'removed-member',
                status: WorkspaceMemberStatus.active,
                removedAt: null,
              },
            },
          },
        },
      ]),
    );
  });

  it('denies the library grant when the character is revoked', async () => {
    // A revoked character is terminally withdrawn: the grant query filters
    // status != revoked, so no row matches even for active members.
    const characterMediaFindFirst = jest
      .fn<Promise<{ id: string } | null>, [unknown]>()
      .mockResolvedValue(null);
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
        characterMedia: { findFirst: characterMediaFindFirst },
      } as never,
      { createReadUrl: jest.fn() } as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );

    await expect(
      service.issueAccessUrl(
        'workspace-member',
        '11111111-1111-7111-9111-111111111111',
        { variantKey: 'original' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const grantQuery = characterMediaFindFirst.mock.calls[0]?.[0] as {
      where?: { character?: { deletedAt?: unknown; status?: unknown } };
    };
    expect(grantQuery?.where?.character?.deletedAt).toBeNull();
    expect(grantQuery?.where?.character?.status).toEqual({
      not: CharacterStatus.revoked,
    });
  });

  it('still rejects non-members when the asset has no cast grant', async () => {
    const service = new MediaAccessService(
      {
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue(
            readyAsset({
              createdByUserId: 'owner-user',
              workspaceId: 'workspace-1',
            }),
          ),
        },
        characterMedia: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never,
      { createReadUrl: jest.fn() } as never,
      {
        requireWorkspaceRole: jest.fn().mockRejectedValue(
          new ForbiddenException({
            code: 'WORKSPACE_ACCESS_DENIED',
            msg: 'You do not have access to this workspace.',
          }),
        ),
      } as never,
    );

    await expect(
      service.issueAccessUrl(
        'stranger',
        '11111111-1111-7111-9111-111111111111',
        { variantKey: 'original' },
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

describe('MediaAccessService pre-broadcast moderation gate', () => {
  const KEY = 'MEDIA_REQUIRE_MODERATION_APPROVAL';
  const ASSET_ID = '11111111-1111-7111-9111-111111111111';
  const saved = process.env[KEY];
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  function makeService(asset: Record<string, unknown>) {
    return new MediaAccessService(
      {
        mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
      } as never,
      {
        createReadUrl: jest.fn().mockResolvedValue({
          url: 'https://blob.example.com/x.png?sig=read',
          expiresAt: '2026-06-12T12:00:00.000Z',
        }),
      } as never,
      { requireWorkspaceRole: jest.fn() } as never,
    );
  }

  const pendingPublic = () =>
    readyAsset({
      visibility: MediaAssetVisibility.public,
      moderationStatus: MediaAssetModerationStatus.unreviewed,
      createdByUserId: 'owner',
    });

  it('withholds an unreviewed asset from a peer when approval is required', async () => {
    process.env[KEY] = 'true';
    await expect(
      makeService(pendingPublic()).issueBrowserAccessUrl('peer', ASSET_ID, {
        variantKey: 'original',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still serves the owner their own pending asset', async () => {
    process.env[KEY] = 'true';
    await expect(
      makeService(pendingPublic()).issueBrowserAccessUrl('owner', ASSET_ID, {
        variantKey: 'original',
      }),
    ).resolves.toMatchObject({
      url: 'https://blob.example.com/x.png?sig=read',
    });
  });

  it('serves a peer once the asset is approved', async () => {
    process.env[KEY] = 'true';
    await expect(
      makeService(
        readyAsset({
          visibility: MediaAssetVisibility.public,
          moderationStatus: MediaAssetModerationStatus.approved,
          createdByUserId: 'owner',
        }),
      ).issueBrowserAccessUrl('peer', ASSET_ID, { variantKey: 'original' }),
    ).resolves.toMatchObject({
      url: 'https://blob.example.com/x.png?sig=read',
    });
  });

  it('does not gate at all when approval is not required (default)', async () => {
    delete process.env[KEY];
    await expect(
      makeService(pendingPublic()).issueBrowserAccessUrl('peer', ASSET_ID, {
        variantKey: 'original',
      }),
    ).resolves.toMatchObject({
      url: 'https://blob.example.com/x.png?sig=read',
    });
  });
});

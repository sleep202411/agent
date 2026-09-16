/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions intentionally inspect mocked adapter methods by reference. */
import { ForbiddenException, GoneException } from '@nestjs/common';
import {
  MEDIA_ASSET_READINESS_CAPABILITY,
  type MediaAssetReadinessResult,
} from '@repo/shared';
import {
  MediaAssetKind,
  MediaAssetStatus,
  MediaAssetModerationStatus,
  MediaAssetVisibility,
  WorkspaceMemberRole,
} from '@prisma/client';
import type { MediaAssetReadinessAdapter } from './media-asset-readiness.port';
import { MediaAssetReadinessService } from './media-asset-readiness.service';
import { MediaAccessService } from './media-access.service';
import {
  MediaAssetReadinessCheckRequestSchema,
  MediaAssetReadinessStatusRequestSchema,
} from './dto';

const USER_ID = 'user-1';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000001';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000002';
const CAPABILITY = MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference;

function status(
  value: MediaAssetReadinessResult['status'],
): MediaAssetReadinessResult {
  return {
    assetId: ASSET_ID,
    capability: CAPABILITY,
    status: value,
    statusReason: null,
    updatedAt: '2026-07-23T12:00:00.000Z',
  };
}

function fixture() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ allowed: false }]),
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const mediaAccess = {
    requireUseAccess: jest.fn().mockResolvedValue(undefined),
    denialForUse: jest.fn().mockReturnValue(null),
    ownsAsset: jest.fn().mockReturnValue(false),
    canvasReferencedAssetIds: jest.fn().mockResolvedValue(new Set<string>()),
  };
  const adapter: MediaAssetReadinessAdapter = {
    capability: CAPABILITY,
    autoEnqueue: true,
    supports: jest.fn((kind: MediaAssetKind) => kind === MediaAssetKind.image),
    isAvailable: jest.fn(() => true),
    enqueue: jest.fn().mockResolvedValue(undefined),
    request: jest.fn().mockResolvedValue(status('pending')),
    list: jest.fn().mockResolvedValue([]),
  };
  const service = new MediaAssetReadinessService(
    prisma as never,
    mediaAccess as never,
    [adapter],
  );
  return { service, prisma, mediaAccess, adapter };
}

describe('MediaAssetReadinessService', () => {
  it('returns not_requested without mutating provider state on a status read', async () => {
    const f = fixture();
    f.prisma.mediaAsset.findMany.mockResolvedValue([
      {
        id: ASSET_ID,
        kind: MediaAssetKind.image,
        status: MediaAssetStatus.ready,
      },
    ]);

    await expect(
      f.service.listStatusesForUser(USER_ID, CAPABILITY, [ASSET_ID]),
    ).resolves.toMatchObject([
      {
        assetId: ASSET_ID,
        capability: CAPABILITY,
        status: 'not_requested',
      },
    ]);
    expect(f.adapter.list).toHaveBeenCalledWith([ASSET_ID]);
    expect(f.adapter.enqueue).not.toHaveBeenCalled();
  });

  it('returns an explicit unavailable status when the adapter is disabled', async () => {
    const f = fixture();
    jest.mocked(f.adapter.isAvailable).mockReturnValue(false);
    f.prisma.mediaAsset.findMany.mockResolvedValue([
      {
        id: ASSET_ID,
        kind: MediaAssetKind.image,
        status: MediaAssetStatus.ready,
      },
    ]);

    await expect(
      f.service.listStatusesForUser(USER_ID, CAPABILITY, [ASSET_ID]),
    ).resolves.toMatchObject([{ status: 'unavailable' }]);
    expect(f.adapter.list).not.toHaveBeenCalled();
  });

  it('requests a personal asset check through the selected capability adapter', async () => {
    const f = fixture();
    f.prisma.mediaAsset.findFirst.mockResolvedValue({
      id: ASSET_ID,
      kind: MediaAssetKind.image,
      status: MediaAssetStatus.ready,
      workspaceId: null,
    });

    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY),
    ).resolves.toMatchObject({
      assetId: ASSET_ID,
      capability: CAPABILITY,
      status: 'pending',
    });
    expect(f.adapter.request).toHaveBeenCalledWith(ASSET_ID);
  });

  it('uses the shared media policy and preserves its denial before contacting the provider', async () => {
    const f = fixture();
    f.prisma.mediaAsset.findFirst.mockResolvedValue({
      id: ASSET_ID,
      kind: MediaAssetKind.image,
      status: MediaAssetStatus.ready,
      workspaceId: WORKSPACE_ID,
    });
    f.mediaAccess.requireUseAccess.mockRejectedValue(
      new ForbiddenException({ code: 'MEDIA_ASSET_ACCESS_DENIED' }),
    );
    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_ASSET_ACCESS_DENIED' },
    });
    expect(f.adapter.request).not.toHaveBeenCalled();
  });

  it('rejects assets that the requested capability cannot consume', async () => {
    const f = fixture();
    f.prisma.mediaAsset.findFirst.mockResolvedValue({
      id: ASSET_ID,
      kind: MediaAssetKind.video,
      status: MediaAssetStatus.ready,
      workspaceId: null,
    });

    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_ASSET_READINESS_UNSUPPORTED' },
    });
    expect(f.adapter.request).not.toHaveBeenCalled();
  });

  it('fans durable assets out to every opted-in available adapter', async () => {
    const f = fixture();
    f.prisma.mediaAsset.findFirst.mockResolvedValue({
      kind: MediaAssetKind.image,
    });

    await expect(
      f.service.enqueueAutomaticChecks(ASSET_ID),
    ).resolves.toBeUndefined();
    expect(f.adapter.enqueue).toHaveBeenCalledWith(ASSET_ID);
  });

  it('does not dispatch automatic checks to adapters that cannot consume the asset kind', async () => {
    const f = fixture();
    f.prisma.mediaAsset.findFirst.mockResolvedValue({
      kind: MediaAssetKind.video,
    });

    await expect(
      f.service.enqueueAutomaticChecks(ASSET_ID),
    ).resolves.toBeUndefined();
    expect(f.adapter.enqueue).not.toHaveBeenCalled();
  });

  it('fails at construction when two adapters claim the same capability', () => {
    const f = fixture();

    expect(
      () =>
        new MediaAssetReadinessService(
          f.prisma as never,
          f.mediaAccess as never,
          [f.adapter, f.adapter],
        ),
    ).toThrow(`Duplicate media asset readiness adapter: ${CAPABILITY}`);
  });
});

// Exercise readiness against the real media policy, not a stubbed permission
// verdict: shared personal images must work for a canvas-only collaborator.
describe('readiness with canonical media access', () => {
  const DOCUMENT_ID = '0197f4a2-0800-7000-8000-000000000003';
  const context = { documentId: DOCUMENT_ID };

  function sharedFixture(overrides: Record<string, unknown> = {}) {
    const f = fixture();
    const asset = {
      id: ASSET_ID,
      kind: MediaAssetKind.image,
      status: MediaAssetStatus.ready,
      moderationStatus: MediaAssetModerationStatus.approved,
      visibility: MediaAssetVisibility.private,
      createdByUserId: 'teammate',
      workspaceId: null,
      metadata: {},
      ...overrides,
    };
    const prisma = {
      ...f.prisma,
      characterMedia: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma.mediaAsset.findFirst.mockResolvedValue(asset);
    prisma.mediaAsset.findMany.mockResolvedValue([asset]);
    const documents = {
      requireDocument: jest.fn().mockResolvedValue({
        contentSnapshot: { nodes: [{ data: { mediaAssetId: ASSET_ID } }] },
      }),
      requireDocumentRef: jest.fn().mockResolvedValue({ id: DOCUMENT_ID }),
      referencedAssetIds: jest.fn().mockResolvedValue(new Set([ASSET_ID])),
    };
    const workspaces = {
      requireWorkspaceRole: jest.fn().mockResolvedValue({}),
    };
    const access = new MediaAccessService(
      prisma as never,
      {} as never,
      workspaces as never,
      { canReadStudioReference: jest.fn().mockResolvedValue(false) } as never,
      documents as never,
    );
    const service = new MediaAssetReadinessService(prisma as never, access, [
      f.adapter,
    ]);
    return { ...f, service, prisma, documents, workspaces };
  }

  it('lists and checks another uploader’s personal asset through a readable canvas', async () => {
    const f = sharedFixture();
    await expect(
      f.service.listStatusesForUser(USER_ID, CAPABILITY, [ASSET_ID], context),
    ).resolves.toMatchObject([{ assetId: ASSET_ID, status: 'not_requested' }]);
    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY, context),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(f.documents.requireDocumentRef).toHaveBeenCalledWith(
      USER_ID,
      DOCUMENT_ID,
      'read',
    );
    // One canvas-context check per REQUEST, not per asset: the batch listing
    // and the single check each consult the snapshot exactly once.
    expect(f.documents.referencedAssetIds).toHaveBeenCalledTimes(2);
    expect(f.documents.referencedAssetIds).toHaveBeenCalledWith(DOCUMENT_ID, [
      ASSET_ID,
    ]);
    expect(f.workspaces.requireWorkspaceRole).not.toHaveBeenCalled();
    expect(f.prisma.mediaAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ASSET_ID, deletedAt: null },
      }),
    );
    expect(f.prisma.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [ASSET_ID] }, deletedAt: null },
      }),
    );
    expect(f.adapter.request).toHaveBeenCalledWith(ASSET_ID);
  });

  it('lets a workspace viewer check without requesting editor privileges', async () => {
    const f = sharedFixture({ workspaceId: WORKSPACE_ID });
    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(f.workspaces.requireWorkspaceRole).toHaveBeenCalledTimes(1);
    expect(f.workspaces.requireWorkspaceRole).toHaveBeenCalledWith(
      USER_ID,
      WORKSPACE_ID,
      WorkspaceMemberRole.viewer,
    );
  });

  it('uses canvas access for an asset from a different workspace', async () => {
    const f = sharedFixture({ workspaceId: WORKSPACE_ID });
    f.workspaces.requireWorkspaceRole.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY, context),
    ).resolves.toMatchObject({ status: 'pending' });
  });

  it('accepts public assets through the same policy', async () => {
    const f = sharedFixture({ visibility: MediaAssetVisibility.public });
    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(f.documents.requireDocumentRef).not.toHaveBeenCalled();
  });

  it('rechecks the canvas grant when a previously visible asset is checked', async () => {
    const f = sharedFixture();
    await expect(
      f.service.listStatusesForUser(USER_ID, CAPABILITY, [ASSET_ID], context),
    ).resolves.toMatchObject([{ status: 'not_requested' }]);
    f.documents.referencedAssetIds.mockResolvedValue(new Set<string>());
    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY, context),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.adapter.request).not.toHaveBeenCalled();
  });

  it.each(['no context', 'unreadable canvas', 'unreferenced asset'] as const)(
    'does not grant access for %s',
    async (scenario) => {
      const f = sharedFixture();
      if (scenario === 'unreadable canvas')
        f.documents.requireDocumentRef.mockRejectedValue(
          new ForbiddenException(),
        );
      if (scenario === 'unreferenced asset')
        f.documents.referencedAssetIds.mockResolvedValue(new Set<string>());
      const requestContext = scenario === 'no context' ? undefined : context;
      await expect(
        f.service.listStatusesForUser(
          USER_ID,
          CAPABILITY,
          [ASSET_ID],
          requestContext,
        ),
      ).resolves.toEqual([]);
      await expect(
        f.service.requestCheckForUser(
          USER_ID,
          ASSET_ID,
          CAPABILITY,
          requestContext,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.adapter.list).not.toHaveBeenCalled();
      expect(f.adapter.request).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: MediaAssetStatus.deleted },
    { moderationStatus: MediaAssetModerationStatus.blocked },
  ])('keeps lifecycle and moderation gates: %j', async (overrides) => {
    const f = sharedFixture(overrides);
    await expect(
      f.service.listStatusesForUser(USER_ID, CAPABILITY, [ASSET_ID], context),
    ).resolves.toEqual([]);
    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY, context),
    ).rejects.toBeInstanceOf(GoneException);
    expect(f.adapter.request).not.toHaveBeenCalled();
  });

  it('returns not-found only when the asset lookup is empty', async () => {
    const f = sharedFixture();
    f.prisma.mediaAsset.findFirst.mockResolvedValue(null);
    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY, context),
    ).rejects.toMatchObject({ response: { code: 'MEDIA_ASSET_NOT_FOUND' } });
    expect(f.adapter.request).not.toHaveBeenCalled();
  });

  it('does not swallow policy infrastructure failures as missing statuses', async () => {
    const f = sharedFixture();
    // The canvas-context probe is now the primary grant path — an
    // infrastructure fault there must surface, never read as "unchecked".
    f.documents.referencedAssetIds.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(
      f.service.listStatusesForUser(USER_ID, CAPABILITY, [ASSET_ID], context),
    ).rejects.toThrow('database unavailable');
  });

  it.each([
    MediaAssetReadinessCheckRequestSchema,
    MediaAssetReadinessStatusRequestSchema,
  ])(
    'preserves and validates canvas context at the HTTP boundary',
    (schema) => {
      const body = {
        capability: CAPABILITY,
        assetIds: [ASSET_ID],
        documentId: DOCUMENT_ID,
      };
      expect(schema.parse(body)).toMatchObject(context);
      expect(schema.safeParse({ ...body, documentId: 'invalid' }).success).toBe(
        false,
      );
    },
  );
});

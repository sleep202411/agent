/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions intentionally inspect mocked adapter methods by reference. */
import { ForbiddenException } from '@nestjs/common';
import {
  MEDIA_ASSET_READINESS_CAPABILITY,
  type MediaAssetReadinessResult,
} from '@repo/shared';
import {
  MediaAssetKind,
  MediaAssetStatus,
  WorkspaceMemberRole,
} from '@prisma/client';
import type { MediaAssetReadinessAdapter } from './media-asset-readiness.port';
import { MediaAssetReadinessService } from './media-asset-readiness.service';

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
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const workspacePermissions = {
    requireWorkspaceRole: jest.fn().mockResolvedValue({}),
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
    workspacePermissions as never,
    [adapter],
  );
  return { service, prisma, workspacePermissions, adapter };
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

  it('requires editor access before checking a workspace asset', async () => {
    const f = fixture();
    f.prisma.mediaAsset.findFirst.mockResolvedValue({
      id: ASSET_ID,
      kind: MediaAssetKind.image,
      status: MediaAssetStatus.ready,
      workspaceId: WORKSPACE_ID,
    });
    f.workspacePermissions.requireWorkspaceRole.mockRejectedValue(
      new ForbiddenException({ code: 'WORKSPACE_PERMISSION_DENIED' }),
    );

    await expect(
      f.service.requestCheckForUser(USER_ID, ASSET_ID, CAPABILITY),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_PERMISSION_DENIED' },
    });
    expect(f.workspacePermissions.requireWorkspaceRole).toHaveBeenCalledWith(
      USER_ID,
      WORKSPACE_ID,
      WorkspaceMemberRole.editor,
    );
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
          f.workspacePermissions as never,
          [f.adapter, f.adapter],
        ),
    ).toThrow(`Duplicate media asset readiness adapter: ${CAPABILITY}`);
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';
import type { ResolvableMediaObjectPlacement } from '../infra/storage/media-asset-url-resolver.service';
import { StoryProjectVideoLibraryService } from './story-project-video-library.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const OTHER_WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000099';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';

function createHarness(workspaceId = WORKSPACE_ID) {
  let response: unknown[] = [];
  let lastQuery: Prisma.MediaAssetFindManyArgs | null = null;
  const findMany = jest.fn((query: Prisma.MediaAssetFindManyArgs) => {
    lastQuery = query;
    return Promise.resolve(response);
  });
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { id: PROJECT_ID, workspaceId },
    }),
  };
  return {
    findMany,
    permissions,
    setRows: (rows: unknown[]) => {
      response = rows;
    },
    getQuery: (): Prisma.MediaAssetFindManyArgs => {
      if (!lastQuery) throw new Error('Expected mediaAsset.findMany to run.');
      return lastQuery;
    },
    service: new StoryProjectVideoLibraryService(
      { mediaAsset: { findMany } } as never,
      permissions as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    ),
  };
}

function videoAsset(id: string, createdAt: string) {
  return {
    id,
    kind: MediaAssetKind.video,
    storageProvider: MediaStorageProvider.external_url,
    workspaceId: WORKSPACE_ID,
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl: `https://cdn.example.test/${id}.mp4`,
    contentType: 'video/mp4',
    sizeBytes: BigInt(10_000),
    width: 1920,
    height: 1080,
    durationSeconds: 12,
    checksumSha256: `asset-${id}`,
    visibility: MediaAssetVisibility.public,
    status: MediaAssetStatus.ready,
    source: MediaAssetSource.ai_output,
    moderationStatus: MediaAssetModerationStatus.approved,
    moderationReason: null,
    moderatedByAdminId: null,
    moderatedAt: null,
    metadata: {},
    createdByUserId: USER.userId,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    deletedAt: null,
    placements: [] as ResolvableMediaObjectPlacement[],
    variants: [
      {
        id: `variant-${id}`,
        assetId: id,
        variantKey: 'original',
        kind: MediaAssetVariantKind.original,
        status: MediaAssetVariantStatus.ready,
        contentType: 'video/mp4',
        sizeBytes: BigInt(10_000),
        width: 1920,
        height: 1080,
        durationSeconds: 12,
        checksumSha256: `variant-${id}`,
        metadata: {},
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt),
        deletedAt: null,
        placements: [] as ResolvableMediaObjectPlacement[],
      },
    ],
  };
}

describe('StoryProjectVideoLibraryService', () => {
  it('requires story.read and hides a project from a mismatched workspace', async () => {
    const { service, permissions, findMany } =
      createHarness(OTHER_WORKSPACE_ID);

    await expect(
      service.list(USER as never, WORKSPACE_ID, PROJECT_ID, { limit: 30 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(permissions.requireProject).toHaveBeenCalledWith(
      USER.userId,
      PROJECT_ID,
      'story.read',
      { allowArchived: true },
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lists only reusable workspace videos with a ready original variant', async () => {
    const { service, setRows, getQuery } = createHarness();
    const newest = videoAsset(
      '0197f4a2-0800-7000-8000-000000000010',
      '2026-07-15T12:00:00.000Z',
    );
    setRows([newest]);

    await expect(
      service.list(USER as never, WORKSPACE_ID, PROJECT_ID, { limit: 30 }),
    ).resolves.toEqual({
      items: [
        {
          asset: {
            id: newest.id,
            kind: 'video',
            status: 'ready',
            moderationStatus: 'approved',
            contentType: 'video/mp4',
            width: 1920,
            height: 1080,
            durationSeconds: 12,
            checksumSha256: `asset-${newest.id}`,
            previewUrl: `https://cdn.example.test/${newest.id}.mp4`,
          },
          variantId: `variant-${newest.id}`,
          variantKey: 'original',
          contentType: 'video/mp4',
          width: 1920,
          height: 1080,
          durationSeconds: 12,
          checksumSha256: `variant-${newest.id}`,
          createdAt: '2026-07-15T12:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    const query = getQuery();
    expect(query.where).toEqual(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        kind: 'video',
        status: 'ready',
        deletedAt: null,
        moderationStatus: { not: 'blocked' },
        variants: {
          some: {
            variantKey: 'original',
            kind: 'original',
            status: 'ready',
            deletedAt: null,
            checksumSha256: { not: null },
          },
        },
      }),
    );
    expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(query.take).toBe(31);
  });

  it('resolves previewUrl from the exact original variant, never an HLS placement', async () => {
    const { service, setRows } = createHarness();
    const asset = videoAsset(
      '0197f4a2-0800-7000-8000-000000000015',
      '2026-07-15T12:00:00.000Z',
    );
    const originalPlacement = {
      storageProvider: 'external_url',
      bucket: null,
      region: null,
      objectKey: null,
      externalUrl: 'https://cdn.example.test/original.mp4',
      publicBaseUrl: null,
      role: 'primary',
      status: 'active',
      priority: 0,
      deletedAt: null,
    };
    const hlsPlacement = {
      ...originalPlacement,
      externalUrl: 'https://cdn.example.test/stream.m3u8',
    };
    asset.placements = [hlsPlacement, originalPlacement];
    asset.variants[0].placements = [originalPlacement];
    setRows([asset]);

    const page = await service.list(USER as never, WORKSPACE_ID, PROJECT_ID, {
      limit: 30,
    });

    expect(page.items[0]).toMatchObject({
      contentType: 'video/mp4',
      asset: {
        contentType: 'video/mp4',
        previewUrl: 'https://cdn.example.test/original.mp4',
      },
    });
  });

  it('uses a stable createdAt/id cursor without duplicating the boundary row', async () => {
    const first = createHarness();
    const rows = [
      videoAsset(
        '0197f4a2-0800-7000-8000-000000000020',
        '2026-07-15T12:00:00.000Z',
      ),
      videoAsset(
        '0197f4a2-0800-7000-8000-000000000019',
        '2026-07-15T11:00:00.000Z',
      ),
      videoAsset(
        '0197f4a2-0800-7000-8000-000000000018',
        '2026-07-15T10:00:00.000Z',
      ),
    ];
    first.setRows(rows);
    const firstPage = await first.service.list(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      { limit: 2 },
    );
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const second = createHarness();
    await second.service.list(USER as never, WORKSPACE_ID, PROJECT_ID, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    });
    const secondPageQuery = second.getQuery();
    expect(secondPageQuery.where?.OR).toEqual([
      { createdAt: { lt: new Date('2026-07-15T11:00:00.000Z') } },
      {
        createdAt: new Date('2026-07-15T11:00:00.000Z'),
        id: { lt: rows[1].id },
      },
    ]);
  });

  it('rejects malformed cursors before querying assets', async () => {
    const { service, findMany } = createHarness();

    await expect(
      service.list(USER as never, WORKSPACE_ID, PROJECT_ID, {
        limit: 30,
        cursor: 'not-a-cursor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects a crafted cursor with a non-UUID id before querying assets', async () => {
    const { service, findMany } = createHarness();
    const cursor = Buffer.from(
      JSON.stringify({
        version: 1,
        createdAt: '2026-07-15T12:00:00.000Z',
        id: 'not-a-uuid',
      }),
      'utf8',
    ).toString('base64url');

    await expect(
      service.list(USER as never, WORKSPACE_ID, PROJECT_ID, {
        limit: 30,
        cursor,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: 'STORY_VIDEO_LIBRARY_CURSOR_INVALID',
        message: 'The video library pagination cursor is invalid or expired.',
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});

import {
  CrewAssetAccessMode,
  CrewAssetNodeKind,
  CrewAssetNodeStatus,
  CrewAssetPermission,
  MediaAssetKind,
  MediaAssetStatus,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';
import { CrewAssetsService } from './assets.service';

const CREW_ID = 'crew-1';
const USER_ID = 'user-1';
const NODE_ID = '01910d50-4c88-7c78-92d4-16892c06a001';
const FOLDER_ID = '01910d50-4c88-7c78-92d4-16892c06a002';
const MEDIA_ID = '01910d50-4c88-7c78-92d4-16892c06a003';
const PROJECT_ID = '01910d50-4c88-7c78-92d4-16892c06a004';

function assetNode(overrides: Record<string, unknown> = {}) {
  return {
    id: NODE_ID,
    crewId: CREW_ID,
    parentId: null,
    kind: CrewAssetNodeKind.file,
    status: CrewAssetNodeStatus.active,
    accessMode: CrewAssetAccessMode.inherit,
    permissionVersion: 1,
    name: 'concept.png',
    mediaAssetId: MEDIA_ID,
    createdByUserId: USER_ID,
    updatedByUserId: USER_ID,
    trashedAt: null,
    trashedByUserId: null,
    createdAt: new Date('2026-07-29T09:00:00.000Z'),
    updatedAt: new Date('2026-07-29T09:00:00.000Z'),
    mediaAsset: {
      id: MEDIA_ID,
      kind: MediaAssetKind.image,
      contentType: 'image/png',
      sizeBytes: BigInt(2048),
      width: 1920,
      height: 1080,
      durationSeconds: null,
      status: MediaAssetStatus.ready,
      createdByUserId: USER_ID,
      metadata: {
        uploadKind: 'crew_asset_file',
        crewId: CREW_ID,
      },
    },
    favorites: [],
    ...overrides,
  };
}

function build() {
  const crewAssetNode = {
    findMany: jest.fn().mockImplementation(
      (args?: {
        where?: {
          parentId?: unknown;
          mediaAssetId?: unknown;
          id?: { notIn?: string[] };
        };
        select?: { mediaAssetId?: boolean };
      }) => {
        if (args?.where?.parentId || args?.where?.id?.notIn) {
          return Promise.resolve([]);
        }
        if (args?.select?.mediaAssetId) {
          return Promise.resolve([{ mediaAssetId: MEDIA_ID }]);
        }
        return Promise.resolve([assetNode()]);
      },
    ),
    findFirst: jest
      .fn()
      .mockImplementation((args?: { where?: { mediaAssetId?: string } }) =>
        args?.where?.mediaAssetId
          ? Promise.resolve(null)
          : Promise.resolve({
              id: NODE_ID,
              parentId: null,
              kind: CrewAssetNodeKind.file,
              trashedAt: null,
            }),
      ),
    findUnique: jest.fn().mockResolvedValue({ parentId: null }),
    findUniqueOrThrow: jest.fn().mockResolvedValue(assetNode()),
    create: jest.fn().mockResolvedValue(assetNode()),
    update: jest.fn().mockResolvedValue(assetNode()),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    delete: jest.fn().mockResolvedValue(assetNode()),
  };
  const prisma = {
    crew: {
      findFirst: jest.fn().mockResolvedValue({ studioWorkspaceId: 'ws-1' }),
    },
    storyProject: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    platformProject: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        workspace: { studioCrew: null },
        productionCrew: null,
        crewTaskCanvas: {
          crew: { id: CREW_ID, name: 'Production crew', logo: '/crew.png' },
        },
      }),
    },
    crewAssetNode: {
      ...crewAssetNode,
    },
    crewAssetFavorite: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue({
        id: MEDIA_ID,
        createdByUserId: USER_ID,
        metadata: {
          uploadKind: 'crew_asset_file',
          crewId: CREW_ID,
        },
      }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: MEDIA_ID,
          storageProvider: MediaStorageProvider.s3_compatible,
          bucket: 'crew-assets',
          region: 'auto',
          objectKey: 'media/global/crew-asset-file/user-1/file.png',
          externalUrl: null,
          metadata: {
            uploadKind: 'crew_asset_file',
            crewId: CREW_ID,
          },
          placements: [],
        },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaObjectPlacement: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaAssetVariant: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaAssetUsage: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockImplementation((query: Prisma.Sql) =>
        Promise.resolve(
          query.sql.includes('storage_limit_bytes')
            ? [{ total: 100000000000n, used: 0n, reserved: 0n, unknown: 0n }]
            : [],
        ),
      ),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (client: typeof prisma) => unknown) => callback(prisma),
  );
  const authorizationContext = {
    crewId: CREW_ID,
    memberId: 'crew-member-1',
    userId: USER_ID,
    isOwner: false,
    policyKeys: [],
    permissions: ['assets.view', 'assets.upload'],
  };
  const authorization = {
    require: jest.fn().mockResolvedValue(authorizationContext),
    resolve: jest.fn().mockResolvedValue(authorizationContext),
  };
  const workspacePermissions = {
    requireWorkspaceRole: jest.fn(),
    requireProjectRole: jest.fn(),
  };
  const access = {
    resolveNodePermission: jest
      .fn()
      .mockResolvedValue(CrewAssetPermission.edit),
    resolveNodesPermissions: jest.fn((_crewId: string, nodeIds: string[]) =>
      Promise.resolve(
        new Map(nodeIds.map((nodeId) => [nodeId, CrewAssetPermission.edit])),
      ),
    ),
    requireNodePermission: jest
      .fn()
      .mockResolvedValue(CrewAssetPermission.edit),
    requireContainerPermission: jest
      .fn()
      .mockResolvedValue(CrewAssetPermission.edit),
  };
  const selectedStorage = {
    isHealthy: jest.fn().mockResolvedValue(true),
    headObject: jest
      .fn()
      .mockResolvedValue({ exists: true, bucket: 'test', region: 'auto' }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const storageRegistry = {
    forProvider: jest.fn().mockReturnValue(selectedStorage),
  };
  const mediaStorage = {
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const conversations = {
    broadcastCrewAssetChange: jest.fn().mockResolvedValue(undefined),
  };
  return {
    prisma,
    workspacePermissions,
    authorization,
    access,
    storageRegistry,
    selectedStorage,
    mediaStorage,
    conversations,
    service: new CrewAssetsService(
      prisma as never,
      workspacePermissions as never,
      authorization as never,
      access as never,
      storageRegistry as never,
      mediaStorage as never,
      conversations as never,
    ),
  };
}

describe('CrewAssetsService', () => {
  it.each([
    ['trash', CrewAssetNodeKind.file],
    ['trash', CrewAssetNodeKind.folder],
    ['removePermanently', CrewAssetNodeKind.file],
    ['removePermanently', CrewAssetNodeKind.folder],
  ] as const)(
    'blocks %s for a contract-bearing %s before mutations',
    async (operation, kind) => {
      const t = build();
      t.prisma.crewAssetNode.findFirst.mockResolvedValueOnce({
        id: NODE_ID,
        parentId: null,
        kind,
        trashedAt: operation === 'trash' ? null : new Date(),
      });
      if (kind === CrewAssetNodeKind.folder) {
        t.prisma.crewAssetNode.findMany
          .mockResolvedValueOnce([{ id: FOLDER_ID }])
          .mockResolvedValueOnce([]);
      }
      t.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'retained-task' }]);
      await expect(
        t.service[operation](CREW_ID, USER_ID, NODE_ID),
      ).rejects.toMatchObject({
        response: { code: 'CREW_TASK_CONTRACT_LOCKED' },
      });
      expect(t.prisma.crewAssetNode.update).not.toHaveBeenCalled();
      expect(t.prisma.crewAssetNode.updateMany).not.toHaveBeenCalled();
      expect(t.prisma.crewAssetNode.delete).not.toHaveBeenCalled();
      expect(t.prisma.mediaAsset.updateMany).not.toHaveBeenCalled();
      expect(t.mediaStorage.deleteObject).not.toHaveBeenCalled();
    },
  );

  it('prefers the explicitly linked Studio crew over internal canvas ownership', async () => {
    const t = build();
    t.prisma.platformProject.findUnique.mockResolvedValue({
      workspace: {
        studioCrew: {
          id: CREW_ID,
          name: 'Linked Studio crew',
          logo: '/linked-crew.png',
        },
      },
      productionCrew: {
        id: 'internal-crew',
        name: 'Internal crew',
        logo: '/internal-crew.png',
      },
      crewTaskCanvas: null,
    });

    const result = await t.service.projectContext(PROJECT_ID, USER_ID);

    expect(t.authorization.require).toHaveBeenCalledWith(
      CREW_ID,
      USER_ID,
      'assets.view',
    );
    expect(result.crew).toEqual({
      id: CREW_ID,
      name: 'Linked Studio crew',
      logo: '/linked-crew.png',
    });
  });

  it('resolves the linked crew from a task canvas without trusting a client crew id', async () => {
    const t = build();

    const result = await t.service.projectContext(PROJECT_ID, USER_ID);

    expect(result.canSaveFromCanvas).toBe(false);
    expect(t.workspacePermissions.requireProjectRole).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'viewer',
    );
    expect(t.prisma.platformProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PROJECT_ID } }),
    );
    expect(t.authorization.require).toHaveBeenCalledWith(
      CREW_ID,
      USER_ID,
      'assets.view',
    );
    expect(result.crew).toEqual({
      id: CREW_ID,
      name: 'Production crew',
      logo: '/crew.png',
    });
  });

  it('lists live metadata with a protected media content URL', async () => {
    const t = build();

    const result = await t.service.list(CREW_ID, USER_ID, {
      source: 'all',
      sort: 'modified',
    });

    expect(t.authorization.require).toHaveBeenCalledWith(
      CREW_ID,
      USER_ID,
      'assets.view',
    );
    expect(result.items[0]).toMatchObject({
      id: NODE_ID,
      media: {
        id: MEDIA_ID,
        sizeBytes: 2048,
        previewUrl: `/aurora/media/assets/${MEDIA_ID}/content`,
      },
    });
    expect(t.prisma.crewAssetNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }),
    );
  });

  it('searches across folders while retaining per-node permissions', async () => {
    const t = build();
    await t.service.list(CREW_ID, USER_ID, {
      source: 'recent',
      sort: 'name',
      query: 'nested',
    });
    const call = (
      t.prisma.crewAssetNode.findMany.mock.calls as [
        { where: Record<string, unknown> },
      ][]
    ).at(-1)![0];
    expect(call.where).toMatchObject({
      crewId: CREW_ID,
      status: 'active',
      name: { contains: 'nested', mode: 'insensitive' },
    });
    expect(call.where.OR).toBeUndefined();
    expect(t.access.resolveNodesPermissions).toHaveBeenCalledWith(
      CREW_ID,
      [NODE_ID],
      USER_ID,
    );
  });

  it('returns a stable cursor without exposing an unbounded asset listing', async () => {
    const t = build();
    t.prisma.crewAssetNode.findMany.mockResolvedValueOnce([
      assetNode(),
      assetNode({ id: FOLDER_ID }),
    ]);

    const result = await t.service.list(CREW_ID, USER_ID, {
      source: 'all',
      sort: 'modified',
      limit: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe(NODE_ID);
    expect(t.prisma.crewAssetNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
  });

  it('returns the region storage target and role capabilities', async () => {
    const t = build();

    await expect(t.service.context(CREW_ID, USER_ID)).resolves.toMatchObject({
      provider: MediaStorageProvider.s3_compatible,
      storageAvailable: true,
      maxUploadBytes: 5 * 1024 * 1024 * 1024,
      accessModel: 'hierarchical_acl',
      isOwner: false,
      policyKeys: [],
      permissions: ['assets.view', 'assets.upload'],
      capabilities: {
        upload: true,
        deleteForever: false,
      },
    });
    expect(t.storageRegistry.forProvider).toHaveBeenCalledWith(
      MediaStorageProvider.s3_compatible,
    );
  });

  it('locates a chat attachment with its folder path for an asset deeplink', async () => {
    const t = build();
    t.prisma.crewAssetNode.findFirst
      .mockResolvedValueOnce(assetNode({ parentId: FOLDER_ID }))
      .mockResolvedValueOnce({
        id: FOLDER_ID,
        parentId: null,
        name: 'References',
      });

    const result = await t.service.locate(CREW_ID, USER_ID, NODE_ID);
    expect(result.node).toMatchObject({
      id: NODE_ID,
      name: 'concept.png',
    });
    expect(result.path).toEqual([{ id: FOLDER_ID, name: 'References' }]);
  });

  it('reports storage unavailable without breaking the asset center when a health probe fails', async () => {
    const t = build();
    t.selectedStorage.isHealthy.mockRejectedValueOnce(
      new Error('provider timeout'),
    );

    await expect(t.service.context(CREW_ID, USER_ID)).resolves.toMatchObject({
      provider: MediaStorageProvider.s3_compatible,
      storageAvailable: false,
    });
  });

  it('shows only top-level removed nodes in Trash', async () => {
    const t = build();

    await t.service.list(CREW_ID, USER_ID, {
      source: 'trash',
      sort: 'modified',
    });

    const [listArgs] = t.prisma.crewAssetNode.findMany.mock
      .calls[0] as unknown as [
      {
        where: {
          status: CrewAssetNodeStatus;
          OR: Array<
            | { parentId: null }
            | {
                parent: {
                  status: { not: CrewAssetNodeStatus };
                };
              }
          >;
        };
      },
    ];
    expect(listArgs.where).toMatchObject({
      status: CrewAssetNodeStatus.trashed,
      OR: [
        { parentId: null },
        {
          parent: {
            status: { not: CrewAssetNodeStatus.trashed },
          },
        },
      ],
    });
  });

  it('rejects attaching a media upload scoped to another crew', async () => {
    const t = build();
    t.prisma.mediaAsset.findFirst.mockResolvedValueOnce({
      id: MEDIA_ID,
      createdByUserId: USER_ID,
      metadata: {
        uploadKind: 'crew_asset_file',
        crewId: 'another-crew',
      },
    });

    await expect(
      t.service.attachFile(CREW_ID, USER_ID, {
        name: 'concept.png',
        parentId: null,
        mediaAssetId: MEDIA_ID,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CREW_ASSET_MEDIA_SCOPE_MISMATCH',
      },
    });
    expect(t.prisma.crewAssetNode.create).not.toHaveBeenCalled();
  });

  it('returns the existing node when an attach response is retried', async () => {
    const t = build();
    t.prisma.crewAssetNode.findFirst.mockResolvedValueOnce(assetNode());

    const result = await t.service.attachFile(CREW_ID, USER_ID, {
      name: 'concept.png',
      parentId: null,
      mediaAssetId: MEDIA_ID,
    });

    expect(result).toMatchObject({ id: NODE_ID, name: 'concept.png' });
    expect(t.prisma.mediaAsset.findFirst).not.toHaveBeenCalled();
    expect(t.prisma.crewAssetNode.create).not.toHaveBeenCalled();
  });

  it('allocates a copy name atomically when a sibling already uses the upload name', async () => {
    const t = build();
    t.prisma.crewAssetNode.create.mockImplementationOnce(
      (args: { data: { name: string } }) =>
        Promise.resolve(assetNode({ name: args.data.name })),
    );

    const result = await t.service.attachFile(CREW_ID, USER_ID, {
      name: 'concept.png',
      parentId: null,
      mediaAssetId: MEDIA_ID,
    });

    expect(result.name).toBe('concept (2).png');
    const [createArgs] = t.prisma.crewAssetNode.create.mock
      .calls[0] as unknown as [{ data: { name: string } }];
    expect(createArgs.data.name).toBe('concept (2).png');
    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('reclaims an unclaimed composer upload from storage and the media ledger', async () => {
    const t = build();
    t.prisma.mediaAsset.findFirst.mockResolvedValueOnce({
      id: MEDIA_ID,
      createdByUserId: USER_ID,
      storageProvider: MediaStorageProvider.s3_compatible,
      bucket: 'crew-assets',
      region: 'auto',
      objectKey: 'media/global/crew-asset-file/user-1/pending.png',
      externalUrl: null,
      metadata: {
        uploadKind: 'crew_asset_file',
        crewId: CREW_ID,
      },
      placements: [],
    });
    t.prisma.crewAssetNode.findFirst.mockResolvedValueOnce(null);

    await t.service.discardPendingUpload(CREW_ID, USER_ID, MEDIA_ID);

    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(4);
    expect(t.mediaStorage.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: 'media/global/crew-asset-file/user-1/pending.png',
      }),
    );
    const [update] = t.prisma.mediaAsset.updateMany.mock
      .calls[0] as unknown as [
      {
        where: { id: string; deletedAt: null };
        data: { status: MediaAssetStatus; deletedAt: Date };
      },
    ];
    expect(update).toMatchObject({
      where: { id: MEDIA_ID, deletedAt: null },
      data: { status: MediaAssetStatus.deleted },
    });
    expect(update.data.deletedAt).toBeInstanceOf(Date);
  });

  it('leaves a composer upload intact once a crew asset node has claimed it', async () => {
    const t = build();
    t.prisma.mediaAsset.findFirst.mockResolvedValueOnce({
      id: MEDIA_ID,
      createdByUserId: USER_ID,
      storageProvider: MediaStorageProvider.s3_compatible,
      bucket: 'crew-assets',
      region: 'auto',
      objectKey: 'media/global/crew-asset-file/user-1/claimed.png',
      externalUrl: null,
      metadata: {
        uploadKind: 'crew_asset_file',
        crewId: CREW_ID,
      },
      placements: [],
    });
    t.prisma.crewAssetNode.findFirst.mockResolvedValueOnce({ id: NODE_ID });

    await t.service.discardPendingUpload(CREW_ID, USER_ID, MEDIA_ID);

    expect(t.mediaStorage.deleteObject).not.toHaveBeenCalled();
    expect(t.prisma.mediaAsset.updateMany).not.toHaveBeenCalled();
  });

  it('re-checks the expiry cutoff under the upload lock before worker cleanup', async () => {
    const t = build();
    const createdBefore = new Date('2026-07-28T12:00:00.000Z');
    t.prisma.mediaAsset.findFirst.mockResolvedValueOnce(null);

    await expect(
      t.service.reclaimExpiredPendingUpload(MEDIA_ID, createdBefore),
    ).resolves.toBe(false);

    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const [lookup] = t.prisma.mediaAsset.findFirst.mock.calls[0] as unknown as [
      {
        where: {
          id: string;
          createdAt?: { lt: Date };
        };
      },
    ];
    expect(lookup.where).toMatchObject({
      id: MEDIA_ID,
      createdAt: { lt: createdBefore },
    });
  });

  it('prevents moving a folder into one of its descendants', async () => {
    const t = build();
    t.prisma.crewAssetNode.findFirst
      .mockResolvedValueOnce({
        id: NODE_ID,
        parentId: null,
        kind: CrewAssetNodeKind.folder,
      })
      .mockResolvedValueOnce({ id: FOLDER_ID });
    t.prisma.crewAssetNode.findUnique.mockResolvedValueOnce({
      parentId: NODE_ID,
    });

    await expect(
      t.service.update(CREW_ID, USER_ID, NODE_ID, {
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
        parentId: FOLDER_ID,
      }),
    ).rejects.toThrow('A folder cannot be moved into one of its descendants');
    expect(t.prisma.crewAssetNode.update).not.toHaveBeenCalled();
  });

  it('checks source edit and destination upload permissions before moving', async () => {
    const t = build();
    t.access.requireContainerPermission.mockRejectedValueOnce(
      new Error('Destination denied'),
    );
    await expect(
      t.service.update(CREW_ID, USER_ID, NODE_ID, {
        parentId: FOLDER_ID,
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
      }),
    ).rejects.toThrow('Destination denied');
    expect(t.access.requireNodePermission).toHaveBeenCalledWith(
      CREW_ID,
      NODE_ID,
      USER_ID,
      CrewAssetPermission.edit,
      t.prisma,
    );
    expect(t.access.requireContainerPermission).toHaveBeenCalledWith(
      CREW_ID,
      FOLDER_ID,
      USER_ID,
      CrewAssetPermission.upload,
      t.prisma,
    );
    expect(t.prisma.crewAssetNode.updateMany).not.toHaveBeenCalled();
  });
  it('reports a move name conflict without replacing the destination asset', async () => {
    const t = build();
    t.prisma.crewAssetNode.updateMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7',
      }),
    );
    await expect(
      t.service.update(CREW_ID, USER_ID, NODE_ID, {
        parentId: FOLDER_ID,
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
      }),
    ).rejects.toThrow();
    expect(t.prisma.crewAssetNode.delete).not.toHaveBeenCalled();
    expect(t.conversations.broadcastCrewAssetChange).not.toHaveBeenCalled();
  });
  it('cleans expired staging but preserves a confirmed final asset', async () => {
    const t = build();
    t.prisma.$queryRaw.mockResolvedValueOnce([
      { storage_key: 'media/global/crew-asset-file/a.png', crew_id: CREW_ID },
    ]);
    await t.service.cleanupUploadReservations();
    expect(t.selectedStorage.deleteObject).toHaveBeenCalledTimes(1);
    expect(t.selectedStorage.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: 'media/global/crew-asset-file/a.png',
      }),
    );
  });
  it('cleans staging and orphan final bytes after an expired failed upload', async () => {
    const t = build();
    t.prisma.$queryRaw.mockResolvedValueOnce([
      { storage_key: 'media/global/crew-asset-file/a.png', crew_id: CREW_ID },
    ]);
    t.prisma.mediaAsset.findFirst.mockResolvedValueOnce(null);
    await t.service.cleanupUploadReservations();
    expect(t.selectedStorage.deleteObject).toHaveBeenCalledTimes(2);
    expect(t.selectedStorage.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: 'media/global/crew-asset-final/a.png',
      }),
    );
  });

  it('updates asset metadata with optimistic concurrency and broadcasts it', async () => {
    const t = build();

    const result = await t.service.update(CREW_ID, USER_ID, NODE_ID, {
      expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
      name: 'approved-concept.png',
    });

    expect(t.prisma.crewAssetNode.updateMany).toHaveBeenCalledWith({
      where: {
        id: NODE_ID,
        crewId: CREW_ID,
        status: CrewAssetNodeStatus.active,
        updatedAt: new Date('2026-07-29T09:00:00.000Z'),
      },
      data: {
        name: 'approved-concept.png',
        updatedByUserId: USER_ID,
      },
    });
    expect(result.id).toBe(NODE_ID);
    expect(t.conversations.broadcastCrewAssetChange).toHaveBeenCalledWith(
      CREW_ID,
      NODE_ID,
      'updated',
      USER_ID,
    );
  });

  it('rejects a stale asset rename instead of overwriting a collaborator', async () => {
    const t = build();
    t.prisma.crewAssetNode.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      t.service.update(CREW_ID, USER_ID, NODE_ID, {
        expectedUpdatedAt: '2026-07-29T08:00:00.000Z',
        name: 'stale-name.png',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_ASSET_CONFLICT' },
    });
    expect(t.prisma.crewAssetNode.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(t.conversations.broadcastCrewAssetChange).not.toHaveBeenCalled();
  });

  it('retires unshared crew media before physically deleting its objects', async () => {
    const t = build();

    await t.service.removePermanently(CREW_ID, USER_ID, NODE_ID);

    expect(t.access.requireNodePermission).toHaveBeenCalledWith(
      CREW_ID,
      NODE_ID,
      USER_ID,
      CrewAssetPermission.manage,
      t.prisma,
    );
    expect(t.prisma.crewAssetNode.delete).toHaveBeenCalledWith({
      where: { id: NODE_ID },
    });
    expect(t.mediaStorage.deleteObject).toHaveBeenCalledWith({
      storageProvider: MediaStorageProvider.s3_compatible,
      bucket: 'crew-assets',
      region: 'auto',
      objectKey: 'media/global/crew-asset-file/user-1/file.png',
      externalUrl: null,
      metadata: {
        uploadKind: 'crew_asset_file',
        crewId: CREW_ID,
      },
      placements: [],
      id: MEDIA_ID,
    });
    const [mediaUpdate] = t.prisma.mediaAsset.updateMany.mock
      .calls[0] as unknown as [{ data: { status: MediaAssetStatus } }];
    expect(mediaUpdate.data.status).toBe(MediaAssetStatus.deleted);
  });

  it('keeps physical bytes when another crew node still references the media asset', async () => {
    const t = build();
    t.prisma.crewAssetNode.findMany
      .mockResolvedValueOnce([{ mediaAssetId: MEDIA_ID }])
      .mockResolvedValueOnce([{ mediaAssetId: MEDIA_ID }]);

    await t.service.removePermanently(CREW_ID, USER_ID, NODE_ID);

    expect(t.mediaStorage.deleteObject).not.toHaveBeenCalled();
    expect(t.prisma.mediaAsset.updateMany).not.toHaveBeenCalled();
    expect(t.prisma.crewAssetNode.delete).toHaveBeenCalled();
  });

  it('moves an active folder subtree to Trash with one operation timestamp', async () => {
    const t = build();
    t.prisma.crewAssetNode.findFirst.mockResolvedValueOnce({
      id: NODE_ID,
      parentId: null,
      kind: CrewAssetNodeKind.folder,
      trashedAt: null,
    });
    t.prisma.crewAssetNode.findMany
      .mockResolvedValueOnce([{ id: FOLDER_ID }])
      .mockResolvedValueOnce([]);

    await t.service.trash(CREW_ID, USER_ID, NODE_ID);

    const [descendantWrite] = t.prisma.crewAssetNode.updateMany.mock
      .calls[0] as unknown as [
      {
        where: {
          id: { in: string[] };
          crewId: string;
          status: CrewAssetNodeStatus;
        };
        data: { trashedAt: Date };
      },
    ];
    const [rootWrite] = t.prisma.crewAssetNode.update.mock
      .calls[0] as unknown as [{ data: { trashedAt: Date } }];
    expect(descendantWrite.where).toMatchObject({
      id: { in: [FOLDER_ID] },
      crewId: CREW_ID,
      status: CrewAssetNodeStatus.active,
    });
    expect(descendantWrite.data.trashedAt).toBe(rootWrite.data.trashedAt);
  });

  it('restores only descendants removed by the same folder-trash operation', async () => {
    const t = build();
    const trashedAt = new Date('2026-07-29T10:00:00.000Z');
    t.prisma.crewAssetNode.findFirst.mockResolvedValueOnce({
      id: NODE_ID,
      parentId: null,
      kind: CrewAssetNodeKind.folder,
      trashedAt,
    });
    t.prisma.crewAssetNode.findMany
      .mockResolvedValueOnce([{ id: FOLDER_ID }])
      .mockResolvedValueOnce([]);
    t.prisma.crewAssetNode.update.mockResolvedValueOnce(
      assetNode({
        kind: CrewAssetNodeKind.folder,
        mediaAssetId: null,
        mediaAsset: null,
      }),
    );

    await t.service.restore(CREW_ID, USER_ID, NODE_ID);

    expect(t.prisma.crewAssetNode.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [FOLDER_ID] },
        crewId: CREW_ID,
        status: CrewAssetNodeStatus.trashed,
        trashedAt,
      },
      data: {
        status: CrewAssetNodeStatus.active,
        trashedAt: null,
        trashedByUserId: null,
        updatedByUserId: USER_ID,
      },
    });
  });

  it('lists ready workspace media for crew-side Studio linking', async () => {
    const t = build();
    t.prisma.mediaAsset.findMany.mockResolvedValueOnce([
      {
        id: MEDIA_ID,
        kind: MediaAssetKind.image,
        contentType: 'image/png',
        createdAt: new Date('2026-09-24T00:00:00.000Z'),
        objectKey: 'media/ws/shot.png',
      },
    ]);

    await expect(
      t.service.listStudioMediaOptions(CREW_ID, USER_ID, {}),
    ).resolves.toEqual({
      workspaceId: 'ws-1',
      projects: [],
      items: [
        {
          id: MEDIA_ID,
          kind: MediaAssetKind.image,
          contentType: 'image/png',
          name: 'shot.png',
          previewUrl: `/aurora/media/assets/${MEDIA_ID}/content`,
          createdAt: '2026-09-24T00:00:00.000Z',
        },
      ],
    });
  });
});

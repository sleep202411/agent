import {
  CrewAssetAccessMode,
  CrewAssetNodeStatus,
  CrewAssetPermission,
} from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { CrewAssetAccessService } from './asset-access.service';

const CREW_ID = 'crew-1';
const USER_ID = 'member-1';
const ROOT_ID = '01910d50-4c88-7c78-92d4-16892c06a001';
const CHILD_ID = '01910d50-4c88-7c78-92d4-16892c06a002';

function build(role: 'admin' | 'finance' | 'member' | 'outsider' = 'member') {
  const nodes = new Map([
    [
      ROOT_ID,
      {
        id: ROOT_ID,
        parentId: null,
        accessMode: CrewAssetAccessMode.restricted,
      },
    ],
    [
      CHILD_ID,
      {
        id: CHILD_ID,
        parentId: ROOT_ID,
        accessMode: CrewAssetAccessMode.inherit,
      },
    ],
  ]);
  const grants = new Map<string, CrewAssetPermission>();
  const prisma = {
    crewAssetNode: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; status?: unknown } }) =>
          Promise.resolve(nodes.get(where.id) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in
            .map((id) => nodes.get(id))
            .filter((node) => node !== undefined),
        ),
      ),
    },
    crewAssetGrant: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { nodeId_userId: { nodeId: string; userId: string } };
        }) => {
          const key = `${where.nodeId_userId.nodeId}:${where.nodeId_userId.userId}`;
          const permission = grants.get(key);
          return Promise.resolve(permission ? { permission } : null);
        },
      ),
      findMany: jest.fn(
        ({ where }: { where: { nodeId: { in: string[] }; userId: string } }) =>
          Promise.resolve(
            where.nodeId.in.flatMap((nodeId) => {
              const permission = grants.get(`${nodeId}:${where.userId}`);
              return permission ? [{ nodeId, permission }] : [];
            }),
          ),
      ),
    },
  };
  const roles = { resolve: jest.fn().mockResolvedValue(role) };
  return {
    grants,
    prisma,
    roles,
    service: new CrewAssetAccessService(prisma as never, roles as never),
  };
}

describe('CrewAssetAccessService', () => {
  it('denies an inherited child when its restricted ancestor has no grant', async () => {
    const t = build();

    await expect(
      t.service.requireNodePermission(
        CREW_ID,
        CHILD_ID,
        USER_ID,
        CrewAssetPermission.view,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('inherits the explicit ancestor permission through the subtree', async () => {
    const t = build();
    t.grants.set(`${ROOT_ID}:${USER_ID}`, CrewAssetPermission.upload);

    await expect(
      t.service.resolveNodePermission(CREW_ID, CHILD_ID, USER_ID),
    ).resolves.toBe(CrewAssetPermission.upload);
    await expect(
      t.service.requireNodePermission(
        CREW_ID,
        CHILD_ID,
        USER_ID,
        CrewAssetPermission.edit,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'CREW_ASSET_PERMISSION_DENIED',
        requiredPermission: CrewAssetPermission.edit,
        actualPermission: CrewAssetPermission.upload,
      },
    });
  });

  it('batch-resolves a listing with one role lookup and shared lineage rounds', async () => {
    const t = build();
    t.grants.set(`${ROOT_ID}:${USER_ID}`, CrewAssetPermission.upload);

    await expect(
      t.service.resolveNodesPermissions(CREW_ID, [ROOT_ID, CHILD_ID], USER_ID),
    ).resolves.toEqual(
      new Map([
        [ROOT_ID, CrewAssetPermission.upload],
        [CHILD_ID, CrewAssetPermission.upload],
      ]),
    );
    expect(t.roles.resolve).toHaveBeenCalledTimes(1);
    expect(t.prisma.crewAssetGrant.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the crew owner as an emergency manager at every boundary', async () => {
    const t = build('admin');

    await expect(
      t.service.requireNodePermission(
        CREW_ID,
        CHILD_ID,
        USER_ID,
        CrewAssetPermission.manage,
      ),
    ).resolves.toBe(CrewAssetPermission.manage);
    expect(t.prisma.crewAssetNode.findFirst).not.toHaveBeenCalled();
  });

  it('accepts both active and trashed nodes while resolving permissions', async () => {
    const t = build();
    t.grants.set(`${ROOT_ID}:${USER_ID}`, CrewAssetPermission.view);

    await t.service.resolveNodePermission(CREW_ID, CHILD_ID, USER_ID);

    expect(t.prisma.crewAssetNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [CrewAssetNodeStatus.active, CrewAssetNodeStatus.trashed],
          },
        }),
      }),
    );
  });

  it('records an append-only before/after audit event in the permission transaction', async () => {
    const createdAt = new Date('2026-07-29T18:00:00.000Z');
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      crewAssetNode: {
        findFirst: jest.fn().mockResolvedValue({
          id: ROOT_ID,
          accessMode: CrewAssetAccessMode.inherit,
          permissionVersion: 3,
          grants: [],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          accessMode: CrewAssetAccessMode.restricted,
          permissionVersion: 4,
          grants: [
            {
              id: 'grant-1',
              userId: USER_ID,
              permission: CrewAssetPermission.view,
              grantedByUserId: 'owner-1',
              createdAt,
              updatedAt: createdAt,
            },
          ],
        }),
      },
      crewMember: { count: jest.fn().mockResolvedValue(1) },
      crewAssetGrant: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      crewAssetPermissionEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const roles = { resolve: jest.fn().mockResolvedValue('admin') };
    const service = new CrewAssetAccessService(prisma as never, roles as never);

    await service.setPermissions(CREW_ID, ROOT_ID, 'owner-1', {
      accessMode: CrewAssetAccessMode.restricted,
      expectedVersion: 3,
      grants: [{ userId: USER_ID, permission: CrewAssetPermission.view }],
    });

    expect(tx.crewAssetPermissionEvent.create).toHaveBeenCalledWith({
      data: {
        crewId: CREW_ID,
        nodeId: ROOT_ID,
        actorUserId: 'owner-1',
        action: 'permissions_updated',
        previousMode: CrewAssetAccessMode.inherit,
        nextMode: CrewAssetAccessMode.restricted,
        previousVersion: 3,
        nextVersion: 4,
        previousGrants: [],
        nextGrants: [{ userId: USER_ID, permission: CrewAssetPermission.view }],
      },
    });
  });
});

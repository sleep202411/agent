import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewAssetAccessMode,
  CrewAssetNodeStatus,
  CrewAssetPermission,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';

type Db = Prisma.TransactionClient | PrismaService;

const PERMISSION_RANK: Record<CrewAssetPermission, number> = {
  [CrewAssetPermission.view]: 10,
  [CrewAssetPermission.upload]: 30,
  [CrewAssetPermission.edit]: 50,
  [CrewAssetPermission.manage]: 100,
};

@Injectable()
export class CrewAssetAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
  ) {}

  async canReadStudioReference(userId: string, mediaAssetId: string) {
    const references = await this.prisma.crewAssetNode.findMany({
      where: {
        mediaAssetId,
        sharedFromStudio: true,
        status: 'active',
        crew: { deletedAt: null },
      },
      select: { id: true, crewId: true },
    });
    for (const reference of references) {
      if (
        await this.resolveNodePermission(reference.crewId, reference.id, userId)
      )
        return true;
    }
    return false;
  }

  // Workspace linking shares inherited library content for reading only.
  // Explicit Crew denials and restricted folder boundaries still take precedence.
  async canReadLinkedWorkspace(
    crewId: string,
    userId: string,
    db: Db = this.prisma,
  ) {
    return Boolean(
      await db.crew.findFirst({
        where: {
          id: crewId,
          deletedAt: null,
          studioWorkspace: {
            status: 'active',
            deletedAt: null,
            members: {
              some: {
                userId,
                status: 'active',
                removedAt: null,
                accessScope: 'workspace',
              },
            },
          },
        },
        select: { id: true },
      }),
    );
  }

  /**
   * Resolve the effective permission through every ACL boundary from the crew
   * root to the node. A restricted descendant cannot bypass a restricted
   * parent: the effective permission is the minimum explicit grant across all
   * boundaries. The crew owner always retains emergency manage access.
   */
  async resolveNodePermission(
    crewId: string,
    nodeId: string,
    userId: string,
    db: Db = this.prisma,
  ): Promise<CrewAssetPermission | null> {
    const context = await this.authorization.resolve(crewId, userId, db);
    if (!context?.permissions.includes('assets.view')) {
      if (context || !(await this.canReadLinkedWorkspace(crewId, userId, db)))
        return null;
      const permission = await this.resolveMemberNodePermission(
        crewId,
        nodeId,
        userId,
        db,
      );
      return permission ? CrewAssetPermission.view : null;
    }
    if (context.permissions.includes('assets.manage')) {
      return CrewAssetPermission.manage;
    }

    return this.resolveMemberNodePermission(crewId, nodeId, userId, db);
  }

  async requireNodesPermission(
    crewId: string,
    nodeIds: string[],
    userId: string,
    minimum: CrewAssetPermission,
    db: Db = this.prisma,
  ) {
    const uniqueIds = [...new Set(nodeIds)];
    if (uniqueIds.length === 0) return;
    const permissions = await this.resolveNodesPermissions(
      crewId,
      uniqueIds,
      userId,
      db,
    );
    for (const nodeId of uniqueIds) {
      const permission = permissions.get(nodeId) ?? null;
      if (
        permission == null ||
        PERMISSION_RANK[permission] < PERMISSION_RANK[minimum]
      ) {
        throw new ForbiddenException({
          code: 'CREW_ASSET_PERMISSION_DENIED',
          message: 'You do not have permission to access one or more assets.',
          requiredPermission: minimum,
          nodeId,
          actualPermission: permission,
        });
      }
    }
  }

  /**
   * Batch resolver for folder listings. It walks every requested lineage in
   * breadth-first database rounds, then loads all relevant grants at once.
   * That keeps a 100-item cloud-drive page at O(tree depth) queries instead
   * of O(items × depth), without weakening ancestor-boundary semantics.
   */
  async resolveNodesPermissions(
    crewId: string,
    nodeIds: string[],
    userId: string,
    db: Db = this.prisma,
  ): Promise<Map<string, CrewAssetPermission | null>> {
    const uniqueIds = [...new Set(nodeIds)];
    const context = await this.authorization.resolve(crewId, userId, db);
    if (context?.permissions.includes('assets.manage')) {
      return new Map(
        uniqueIds.map((nodeId) => [nodeId, CrewAssetPermission.manage]),
      );
    }
    const workspaceReader =
      !context && (await this.canReadLinkedWorkspace(crewId, userId, db));
    if (!context?.permissions.includes('assets.view') && !workspaceReader) {
      return new Map(uniqueIds.map((nodeId) => [nodeId, null]));
    }

    const states = new Map(
      uniqueIds.map((nodeId) => [
        nodeId,
        {
          cursor: nodeId as string | null,
          seen: new Set<string>(),
          lineage: [] as Array<{
            id: string;
            accessMode: CrewAssetAccessMode;
          }>,
          invalid: false,
        },
      ]),
    );
    for (let depth = 0; depth < 128; depth += 1) {
      const cursorIds = [
        ...new Set(
          [...states.values()]
            .map((state) => state.cursor)
            .filter((cursor): cursor is string => cursor !== null),
        ),
      ];
      if (cursorIds.length === 0) break;
      const nodes = await db.crewAssetNode.findMany({
        where: {
          id: { in: cursorIds },
          crewId,
          status: {
            in: [CrewAssetNodeStatus.active, CrewAssetNodeStatus.trashed],
          },
        },
        select: { id: true, parentId: true, accessMode: true },
      });
      const byId = new Map(nodes.map((node) => [node.id, node]));
      for (const state of states.values()) {
        if (!state.cursor) continue;
        const node = byId.get(state.cursor);
        if (!node || state.seen.has(node.id)) {
          state.invalid = true;
          state.cursor = null;
          continue;
        }
        state.seen.add(node.id);
        state.lineage.push({
          id: node.id,
          accessMode: node.accessMode,
        });
        state.cursor = node.parentId;
      }
    }
    if ([...states.values()].some((state) => state.cursor !== null)) {
      throw new ConflictException({
        code: 'CREW_ASSET_HIERARCHY_TOO_DEEP',
        message: 'Asset folder hierarchy exceeds the supported depth.',
      });
    }

    const restrictedIds = [
      ...new Set(
        [...states.values()].flatMap((state) =>
          state.lineage
            .filter(
              (node) => node.accessMode === CrewAssetAccessMode.restricted,
            )
            .map((node) => node.id),
        ),
      ),
    ];
    const grants =
      restrictedIds.length === 0
        ? []
        : await db.crewAssetGrant.findMany({
            where: { nodeId: { in: restrictedIds }, userId },
            select: { nodeId: true, permission: true },
          });
    const grantsByNode = new Map(
      grants.map((grant) => [grant.nodeId, grant.permission]),
    );
    return new Map<string, CrewAssetPermission | null>(
      [...states].map(
        ([nodeId, state]): [string, CrewAssetPermission | null] => {
          if (state.invalid) return [nodeId, null];
          let effective: CrewAssetPermission = workspaceReader
            ? CrewAssetPermission.view
            : CrewAssetPermission.edit;
          for (const node of state.lineage) {
            if (node.accessMode !== CrewAssetAccessMode.restricted) continue;
            const permission = grantsByNode.get(node.id);
            if (!permission) return [nodeId, null];
            if (PERMISSION_RANK[permission] < PERMISSION_RANK[effective]) {
              effective = permission;
            }
          }
          return [nodeId, effective];
        },
      ),
    );
  }

  private async resolveMemberNodePermission(
    crewId: string,
    nodeId: string,
    userId: string,
    db: Db,
  ): Promise<CrewAssetPermission | null> {
    const lineage = await this.loadLineage(crewId, nodeId, db);
    let effective: CrewAssetPermission = CrewAssetPermission.edit;
    for (const node of lineage) {
      if (node.accessMode !== CrewAssetAccessMode.restricted) continue;
      const grant = await db.crewAssetGrant.findUnique({
        where: { nodeId_userId: { nodeId: node.id, userId } },
        select: { permission: true },
      });
      if (!grant) return null;
      if (PERMISSION_RANK[grant.permission] < PERMISSION_RANK[effective]) {
        effective = grant.permission;
      }
    }
    return effective;
  }

  async requireNodePermission(
    crewId: string,
    nodeId: string,
    userId: string,
    minimum: CrewAssetPermission,
    db: Db = this.prisma,
  ) {
    const permission = await this.resolveNodePermission(
      crewId,
      nodeId,
      userId,
      db,
    );
    if (
      permission == null ||
      PERMISSION_RANK[permission] < PERMISSION_RANK[minimum]
    ) {
      throw new ForbiddenException({
        code: 'CREW_ASSET_PERMISSION_DENIED',
        message: 'You do not have permission to perform this asset action.',
        requiredPermission: minimum,
        actualPermission: permission,
      });
    }
    return permission;
  }

  async requireContainerPermission(
    crewId: string,
    parentId: string | null,
    userId: string,
    minimum: CrewAssetPermission,
    db: Db = this.prisma,
  ) {
    if (parentId) {
      return this.requireNodePermission(crewId, parentId, userId, minimum, db);
    }
    const context = await this.authorization.resolve(crewId, userId, db);
    const permission = context?.permissions.includes('assets.manage')
      ? CrewAssetPermission.manage
      : context?.permissions.includes('assets.upload')
        ? CrewAssetPermission.edit
        : context?.permissions.includes('assets.view')
          ? CrewAssetPermission.view
          : null;
    if (
      permission == null ||
      PERMISSION_RANK[permission] < PERMISSION_RANK[minimum]
    ) {
      throw new ForbiddenException({
        code: 'CREW_ASSET_PERMISSION_DENIED',
        message: 'You do not have permission to perform this asset action.',
        requiredPermission: minimum,
        actualPermission: permission,
      });
    }
    return permission;
  }

  async getPermissions(crewId: string, nodeId: string, userId: string) {
    const effectivePermission = await this.requireNodePermission(
      crewId,
      nodeId,
      userId,
      CrewAssetPermission.view,
    );
    const node = await this.prisma.crewAssetNode.findFirst({
      where: { id: nodeId, crewId },
      select: {
        id: true,
        accessMode: true,
        permissionVersion: true,
        grants: {
          select: {
            id: true,
            userId: true,
            permission: true,
            grantedByUserId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ permission: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!node) throw new NotFoundException('Asset node not found');
    return {
      accessMode: node.accessMode,
      permissionVersion: node.permissionVersion,
      effectivePermission,
      canManage:
        PERMISSION_RANK[effectivePermission] >=
        PERMISSION_RANK[CrewAssetPermission.manage],
      grants: node.grants.map((grant) => ({
        ...grant,
        createdAt: grant.createdAt.toISOString(),
        updatedAt: grant.updatedAt.toISOString(),
      })),
    };
  }

  async listPermissionEvents(crewId: string, nodeId: string, userId: string) {
    await this.requireNodePermission(
      crewId,
      nodeId,
      userId,
      CrewAssetPermission.manage,
    );
    const events = await this.prisma.crewAssetPermissionEvent.findMany({
      where: { crewId, nodeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    }));
  }

  async setPermissions(
    crewId: string,
    nodeId: string,
    userId: string,
    input: {
      accessMode: CrewAssetAccessMode;
      expectedVersion: number;
      grants: Array<{
        userId: string;
        permission: CrewAssetPermission;
      }>;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:asset-permissions:${nodeId}`})::bigint)
      `;
      const actorPermission = await this.requireNodePermission(
        crewId,
        nodeId,
        userId,
        CrewAssetPermission.manage,
        tx,
      );
      const node = await tx.crewAssetNode.findFirst({
        where: { id: nodeId, crewId },
        select: {
          id: true,
          accessMode: true,
          permissionVersion: true,
          grants: {
            select: { userId: true, permission: true },
            orderBy: { userId: 'asc' },
          },
        },
      });
      if (!node) throw new NotFoundException('Asset node not found');
      if (node.permissionVersion !== input.expectedVersion) {
        throw new ConflictException({
          code: 'CREW_ASSET_PERMISSION_VERSION_CONFLICT',
          message:
            'Asset permissions changed while you were editing them. Refresh before saving again.',
          expectedVersion: input.expectedVersion,
          currentVersion: node.permissionVersion,
        });
      }

      const deduped = new Map(
        input.grants.map((grant) => [grant.userId, grant.permission]),
      );
      if (input.accessMode === CrewAssetAccessMode.restricted) {
        const memberCount = await tx.crewMember.count({
          where: {
            crewId,
            userId: { in: [...deduped.keys()] },
            status: 'active',
          },
        });
        if (memberCount !== deduped.size) {
          throw new ForbiddenException({
            code: 'CREW_ASSET_GRANTEE_NOT_MEMBER',
            message: 'Every asset permission recipient must be a crew member.',
          });
        }
        const context = await this.authorization.requireMembership(
          crewId,
          userId,
          tx,
        );
        if (
          !context.permissions.includes('assets.manage') &&
          actorPermission === CrewAssetPermission.manage
        ) {
          deduped.set(userId, CrewAssetPermission.manage);
        }
      } else {
        deduped.clear();
      }

      const updated = await tx.crewAssetNode.updateMany({
        where: {
          id: nodeId,
          crewId,
          permissionVersion: input.expectedVersion,
        },
        data: {
          accessMode: input.accessMode,
          permissionVersion: { increment: 1 },
          updatedByUserId: userId,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'CREW_ASSET_PERMISSION_VERSION_CONFLICT',
          message:
            'Asset permissions changed while you were editing them. Refresh before saving again.',
        });
      }
      await tx.crewAssetGrant.deleteMany({ where: { nodeId } });
      if (deduped.size > 0) {
        await tx.crewAssetGrant.createMany({
          data: [...deduped].map(([granteeUserId, permission]) => ({
            nodeId,
            userId: granteeUserId,
            permission,
            grantedByUserId: userId,
          })),
        });
      }
      const nextGrants = [...deduped]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([granteeUserId, permission]) => ({
          userId: granteeUserId,
          permission,
        }));
      await tx.crewAssetPermissionEvent.create({
        data: {
          crewId,
          nodeId,
          actorUserId: userId,
          action: 'permissions_updated',
          previousMode: node.accessMode,
          nextMode: input.accessMode,
          previousVersion: node.permissionVersion,
          nextVersion: node.permissionVersion + 1,
          previousGrants: node.grants,
          nextGrants,
        },
      });
      return this.getPermissionsTx(crewId, nodeId, userId, tx);
    });
  }

  private async getPermissionsTx(
    crewId: string,
    nodeId: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    const effectivePermission = await this.requireNodePermission(
      crewId,
      nodeId,
      userId,
      CrewAssetPermission.view,
      tx,
    );
    const node = await tx.crewAssetNode.findUniqueOrThrow({
      where: { id: nodeId },
      select: {
        accessMode: true,
        permissionVersion: true,
        grants: {
          select: {
            id: true,
            userId: true,
            permission: true,
            grantedByUserId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ permission: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    return {
      accessMode: node.accessMode,
      permissionVersion: node.permissionVersion,
      effectivePermission,
      canManage:
        PERMISSION_RANK[effectivePermission] >=
        PERMISSION_RANK[CrewAssetPermission.manage],
      grants: node.grants.map((grant) => ({
        ...grant,
        createdAt: grant.createdAt.toISOString(),
        updatedAt: grant.updatedAt.toISOString(),
      })),
    };
  }

  private async loadLineage(crewId: string, nodeId: string, db: Db) {
    const lineage: Array<{
      id: string;
      parentId: string | null;
      accessMode: CrewAssetAccessMode;
    }> = [];
    let cursor: string | null = nodeId;
    for (let depth = 0; cursor && depth < 128; depth += 1) {
      const node: {
        id: string;
        parentId: string | null;
        accessMode: CrewAssetAccessMode;
      } | null = await db.crewAssetNode.findFirst({
        where: {
          id: cursor,
          crewId,
          status: {
            in: [CrewAssetNodeStatus.active, CrewAssetNodeStatus.trashed],
          },
        },
        select: { id: true, parentId: true, accessMode: true },
      });
      if (!node) throw new NotFoundException('Asset node not found');
      lineage.unshift(node);
      cursor = node.parentId;
    }
    if (cursor) {
      throw new ConflictException({
        code: 'CREW_ASSET_HIERARCHY_TOO_DEEP',
        message: 'Asset folder hierarchy is too deep.',
      });
    }
    return lineage;
  }
}

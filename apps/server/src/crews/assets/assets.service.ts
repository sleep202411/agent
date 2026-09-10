import { crewStorageUsage, lockCrewStorage } from './storage-quota';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewAssetPermission,
  CrewAssetNodeKind,
  CrewAssetNodeStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
  ProjectMemberRole,
  Prisma,
} from '@prisma/client';
import { CURRENT_CELL } from '../../common/region/current-cell';
import { ConversationsService } from '../../conversations/conversations.service';
import { PrismaService } from '../../infra/db/db.module';
import {
  CREW_ASSET_MAX_BYTES,
  crewAssetStorageProviderForCell,
} from '../../infra/storage/crew-asset-storage-policy';
import { MediaStorageAccessService } from '../../infra/storage/media-storage-access.service';
import { StorageProviderRegistry } from '../../infra/storage/storage-provider-registry.service';
import { WorkspacePermissionService } from '../../workspaces';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewAssetAccessService } from './asset-access.service';
import type {
  AttachCrewAssetFileInput,
  CreateCrewAssetFolderInput,
  ListCrewAssetsQuery,
  UpdateCrewAssetNodeInput,
} from './dto';
import { availableCrewAssetName } from './asset-name';
import { lockCrewAssetFolderNames, lockCrewAssetUploads } from './upload-lock';

const NODE_INCLUDE = {
  mediaAsset: {
    select: {
      id: true,
      kind: true,
      contentType: true,
      sizeBytes: true,
      width: true,
      height: true,
      durationSeconds: true,
      status: true,
      createdByUserId: true,
      metadata: true,
    },
  },
  favorites: {
    select: { userId: true },
  },
} satisfies Prisma.CrewAssetNodeInclude;

const PENDING_UPLOAD_SELECT = {
  id: true,
  createdAt: true,
  createdByUserId: true,
  storageProvider: true,
  bucket: true,
  region: true,
  objectKey: true,
  externalUrl: true,
  metadata: true,
  placements: {
    where: {
      deletedAt: null,
      status: { not: MediaObjectPlacementStatus.deleted },
    },
    select: {
      storageProvider: true,
      bucket: true,
      region: true,
      objectKey: true,
      externalUrl: true,
    },
  },
} satisfies Prisma.MediaAssetSelect;

type AssetNode = Prisma.CrewAssetNodeGetPayload<{
  include: typeof NODE_INCLUDE;
}>;

@Injectable()
export class CrewAssetsService {
  private readonly logger = new Logger(CrewAssetsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly authorization: CrewAuthorizationService,
    private readonly access: CrewAssetAccessService,
    private readonly storageRegistry: StorageProviderRegistry,
    private readonly mediaStorage: MediaStorageAccessService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Resolve the crew explicitly linked to a Studio project, or the crew whose
   * internal production/task canvas owns it. Project and crew permissions stay
   * independent so a link never broadens workspace access.
   */
  private async projectCrew(projectId: string, userId: string) {
    await this.workspacePermissions.requireProjectRole(
      userId,
      projectId,
      ProjectMemberRole.viewer,
    );
    const project = await this.prisma.platformProject.findUnique({
      where: { id: projectId },
      select: {
        studioCrew: { select: { id: true, name: true, logo: true } },
        productionCrew: { select: { id: true, name: true, logo: true } },
        crewTaskCanvas: {
          select: {
            crew: { select: { id: true, name: true, logo: true } },
          },
        },
      },
    });
    return (
      project?.studioCrew ??
      project?.productionCrew ??
      project?.crewTaskCanvas?.crew ??
      null
    );
  }

  async projectContext(projectId: string, userId: string) {
    const crew = await this.projectCrew(projectId, userId);
    if (!crew) return { crew: null, assetContext: null };
    return {
      crew,
      assetContext: await this.context(crew.id, userId),
    };
  }

  async listForProject(
    projectId: string,
    userId: string,
    query: ListCrewAssetsQuery,
  ) {
    const crew = await this.projectCrew(projectId, userId);
    if (!crew) {
      throw new NotFoundException({
        code: 'PROJECT_CREW_NOT_LINKED',
        message: 'This project is not linked to a crew.',
      });
    }
    return this.list(crew.id, userId, query);
  }

  async cleanupUploadReservations() {
    const rows = await this.prisma.$queryRaw<
      Array<{ storage_key: string; crew_id: string }>
    >`
      SELECT storage_key, crew_id FROM crew_upload_reservations WHERE expires_at < now() AND cleaned_at IS NULL ORDER BY expires_at LIMIT 50`;
    const storage = this.storageRegistry.forProvider(
      crewAssetStorageProviderForCell(CURRENT_CELL),
    );
    if (!storage) return;
    for (const row of rows) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await lockCrewStorage(tx, row.crew_id);
            const finalKey = row.storage_key.replace(
              '/crew-asset-file/',
              '/crew-asset-final/',
            );
            const asset = await tx.mediaAsset.findFirst({
              where: { objectKey: finalKey, deletedAt: null },
              select: { id: true },
            });
            for (const key of asset
              ? [row.storage_key]
              : [row.storage_key, finalKey]) {
              const head = await storage.headObject(key);
              if (head.exists)
                await storage.deleteObject({
                  storageKey: key,
                  bucket: head.bucket!,
                  region: head.region,
                });
            }
            await tx.$executeRaw`UPDATE crew_upload_reservations SET cleaned_at=now(), state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END WHERE storage_key=${row.storage_key}`;
          },
          { timeout: 30000 },
        );
      } catch (error) {
        this.logger.warn(
          `Crew reservation cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async context(crewId: string, userId: string) {
    const context = await this.authorization.require(
      crewId,
      userId,
      'assets.view',
    );
    const provider = crewAssetStorageProviderForCell(CURRENT_CELL);
    const storage = this.storageRegistry.forProvider(provider);
    let storageAvailable = false;
    try {
      storageAvailable = storage ? await storage.isHealthy() : false;
    } catch {
      // Readiness belongs in the response. A transient provider failure must
      // not turn the entire asset center into a 500/loading loop.
      storageAvailable = false;
    }
    return {
      cell: CURRENT_CELL,
      provider,
      storageAvailable,
      maxUploadBytes: CREW_ASSET_MAX_BYTES,
      storageUsage: await crewStorageUsage(this.prisma, crewId),
      accessModel: 'hierarchical_acl' as const,
      isOwner: context.isOwner,
      policyKeys: context.policyKeys,
      permissions: context.permissions,
      capabilities: {
        view: true,
        createFolder: context.permissions.includes('assets.upload'),
        upload: context.permissions.includes('assets.upload'),
        organize: context.permissions.includes('assets.upload'),
        trash: context.permissions.includes('assets.upload'),
        restore: context.permissions.includes('assets.upload'),
        deleteForever: context.permissions.includes('assets.manage'),
      },
    };
  }

  async list(crewId: string, userId: string, query: ListCrewAssetsQuery) {
    await this.authorization.require(crewId, userId, 'assets.view');
    if (query.source === 'all' && query.parentId) {
      await this.access.requireNodePermission(
        crewId,
        query.parentId,
        userId,
        CrewAssetPermission.view,
      );
    }

    const where: Prisma.CrewAssetNodeWhereInput = {
      crewId,
      status:
        query.source === 'trash'
          ? CrewAssetNodeStatus.trashed
          : CrewAssetNodeStatus.active,
      ...(query.source === 'trash'
        ? {
            OR: [
              { parentId: null },
              { parent: { status: { not: CrewAssetNodeStatus.trashed } } },
            ],
          }
        : {}),
      ...(query.source === 'all' ? { parentId: query.parentId ?? null } : {}),
      ...(query.source === 'favorites'
        ? { favorites: { some: { userId } } }
        : {}),
      ...(query.kind
        ? {
            kind:
              query.kind === 'folder'
                ? CrewAssetNodeKind.folder
                : CrewAssetNodeKind.file,
          }
        : {}),
      ...(query.query
        ? { name: { contains: query.query, mode: 'insensitive' } }
        : {}),
    };

    const orderBy: Prisma.CrewAssetNodeOrderByWithRelationInput[] = [
      { kind: 'asc' },
      query.sort === 'name'
        ? { name: 'asc' }
        : query.sort === 'size'
          ? { mediaAsset: { sizeBytes: 'desc' } }
          : { updatedAt: 'desc' },
      { id: 'asc' },
    ];
    const limit = query.limit ?? 100;
    const page = await this.prisma.crewAssetNode.findMany({
      where,
      include: {
        ...NODE_INCLUDE,
        favorites: { where: { userId }, select: { userId: true } },
      },
      orderBy,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = page.length > limit;
    const nodes = hasMore ? page.slice(0, limit) : page;

    const permissions = await this.access.resolveNodesPermissions(
      crewId,
      nodes.map((node) => node.id),
      userId,
    );
    const visibleNodes = nodes
      .map((node) => ({
        node,
        permission: permissions.get(node.id) ?? null,
      }))
      .filter(
        (
          item,
        ): item is {
          node: AssetNode;
          permission: CrewAssetPermission;
        } => item.permission !== null,
      );

    return {
      items: visibleNodes.map(({ node, permission }) =>
        this.toDto(node, userId, permission),
      ),
      parentId: query.source === 'all' ? (query.parentId ?? null) : null,
      source: query.source,
      nextCursor: hasMore ? (nodes.at(-1)?.id ?? null) : null,
    };
  }

  async listFolders(crewId: string, userId: string) {
    await this.authorization.require(crewId, userId, 'assets.view');
    const folders = await this.prisma.crewAssetNode.findMany({
      where: {
        crewId,
        kind: CrewAssetNodeKind.folder,
        status: CrewAssetNodeStatus.active,
      },
      select: { id: true, parentId: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const permissions = await this.access.resolveNodesPermissions(
      crewId,
      folders.map((folder) => folder.id),
      userId,
    );
    const visible = folders.map((folder) => ({
      ...folder,
      effectivePermission: permissions.get(folder.id) ?? null,
    }));
    return visible.filter((folder) => folder.effectivePermission !== null);
  }

  async locate(crewId: string, userId: string, nodeId: string) {
    const permission = await this.access.requireNodePermission(
      crewId,
      nodeId,
      userId,
      CrewAssetPermission.view,
    );
    const node = await this.prisma.crewAssetNode.findFirst({
      where: {
        id: nodeId,
        crewId,
        status: CrewAssetNodeStatus.active,
      },
      include: {
        ...NODE_INCLUDE,
        favorites: { where: { userId }, select: { userId: true } },
      },
    });
    if (!node) throw new NotFoundException('Asset node not found');

    const path: Array<{ id: string; name: string }> = [];
    let parentId = node.parentId;
    for (let depth = 0; parentId && depth < 128; depth += 1) {
      const parent = await this.prisma.crewAssetNode.findFirst({
        where: {
          id: parentId,
          crewId,
          kind: CrewAssetNodeKind.folder,
          status: CrewAssetNodeStatus.active,
        },
        select: { id: true, parentId: true, name: true },
      });
      if (!parent) {
        throw new NotFoundException('Asset folder path is unavailable');
      }
      path.unshift({ id: parent.id, name: parent.name });
      parentId = parent.parentId;
    }
    if (parentId) {
      throw new BadRequestException('Asset folder hierarchy is too deep');
    }
    return { node: this.toDto(node, userId, permission), path };
  }

  private async lockAssetTree(tx: Prisma.TransactionClient, crewId: string) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`crew:asset-tree:${crewId}`})::bigint)
    `;
  }

  async createFolder(
    crewId: string,
    userId: string,
    input: CreateCrewAssetFolderInput,
  ) {
    try {
      const dto = await this.prisma.$transaction(async (tx) => {
        await this.lockAssetTree(tx, crewId);
        await this.access.requireContainerPermission(
          crewId,
          input.parentId ?? null,
          userId,
          CrewAssetPermission.upload,
          tx,
        );
        await this.requireFolder(crewId, input.parentId ?? null, tx);
        const node = await tx.crewAssetNode.create({
          data: {
            crewId,
            parentId: input.parentId ?? null,
            kind: CrewAssetNodeKind.folder,
            name: input.name,
            createdByUserId: userId,
            updatedByUserId: userId,
          },
          include: NODE_INCLUDE,
        });
        const permission = await this.access.resolveNodePermission(
          crewId,
          node.id,
          userId,
          tx,
        );
        return this.toDto(node, userId, permission ?? CrewAssetPermission.edit);
      });
      await this.conversations.broadcastCrewAssetChange(
        crewId,
        dto.id,
        'created',
        userId,
      );
      return dto;
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async attachFile(
    crewId: string,
    userId: string,
    input: AttachCrewAssetFileInput,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await lockCrewAssetUploads(tx, [input.mediaAssetId]);
        await this.lockAssetTree(tx, crewId);
        await this.access.requireContainerPermission(
          crewId,
          input.parentId ?? null,
          userId,
          CrewAssetPermission.upload,
          tx,
        );
        const existing = await tx.crewAssetNode.findFirst({
          where: {
            mediaAssetId: input.mediaAssetId,
          },
          include: NODE_INCLUDE,
        });
        if (existing) {
          if (existing.crewId !== crewId) {
            throw new ForbiddenException({
              code: 'CREW_ASSET_MEDIA_SCOPE_MISMATCH',
              message:
                'The uploaded file is already attached outside this crew.',
            });
          }
          const permission = await this.access.requireNodePermission(
            crewId,
            existing.id,
            userId,
            CrewAssetPermission.view,
            tx,
          );
          return {
            dto: this.toDto(existing, userId, permission),
            created: false,
          };
        }

        await this.requireFolder(crewId, input.parentId ?? null, tx);
        const media = await tx.mediaAsset.findFirst({
          where: {
            id: input.mediaAssetId,
            status: MediaAssetStatus.ready,
            deletedAt: null,
          },
          select: { id: true, createdByUserId: true, metadata: true },
        });
        if (!media) throw new NotFoundException('Media asset not found');
        const metadata =
          media.metadata &&
          typeof media.metadata === 'object' &&
          !Array.isArray(media.metadata)
            ? media.metadata
            : {};
        if (
          media.createdByUserId !== userId ||
          metadata.crewId !== crewId ||
          metadata.uploadKind !== 'crew_asset_file'
        ) {
          throw new ForbiddenException({
            code: 'CREW_ASSET_MEDIA_SCOPE_MISMATCH',
            message: 'The uploaded file does not belong to this crew and user.',
          });
        }
        await lockCrewAssetFolderNames(tx, crewId, input.parentId ?? null);
        const siblingNames = await tx.crewAssetNode.findMany({
          where: {
            crewId,
            parentId: input.parentId ?? null,
            status: CrewAssetNodeStatus.active,
          },
          select: { name: true },
        });
        const name = availableCrewAssetName(
          input.name,
          new Set(siblingNames.map((node) => node.name.toLowerCase())),
        );
        const node = await tx.crewAssetNode.create({
          data: {
            crewId,
            parentId: input.parentId ?? null,
            kind: CrewAssetNodeKind.file,
            name,
            mediaAssetId: media.id,
            createdByUserId: userId,
            updatedByUserId: userId,
          },
          include: NODE_INCLUDE,
        });
        const permission = await this.access.resolveNodePermission(
          crewId,
          node.id,
          userId,
          tx,
        );
        return {
          dto: this.toDto(node, userId, permission ?? CrewAssetPermission.edit),
          created: true,
        };
      });
      if (result.created) {
        await this.conversations.broadcastCrewAssetChange(
          crewId,
          result.dto.id,
          'created',
          userId,
        );
      }
      return result.dto;
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  /**
   * Reclaims a confirmed upload that the composer never sent.
   *
   * This endpoint is deliberately idempotent. If the upload no longer exists
   * or another request already attached it to a CrewAssetNode, there is
   * nothing left to discard and the caller still receives 204.
   */
  async discardPendingUpload(
    crewId: string,
    userId: string,
    mediaAssetId: string,
  ): Promise<void> {
    await this.authorization.require(crewId, userId, 'assets.upload');
    await this.reclaimPendingUpload(mediaAssetId, {
      crewId,
      userId,
      createdBefore: null,
    });
  }

  /**
   * Worker-only recovery for a browser that disappeared before it could call
   * discard. The age guard is re-checked after taking the upload lock, not
   * trusted from the worker's discovery query.
   */
  async reclaimExpiredPendingUpload(
    mediaAssetId: string,
    createdBefore: Date,
  ): Promise<boolean> {
    return this.reclaimPendingUpload(mediaAssetId, {
      crewId: null,
      userId: null,
      createdBefore,
    });
  }

  private async reclaimPendingUpload(
    mediaAssetId: string,
    scope: {
      crewId: string | null;
      userId: string | null;
      createdBefore: Date | null;
    },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockCrewAssetUploads(tx, [mediaAssetId]);
      const media = await tx.mediaAsset.findFirst({
        where: {
          id: mediaAssetId,
          status: MediaAssetStatus.ready,
          deletedAt: null,
          ...(scope.createdBefore
            ? { createdAt: { lt: scope.createdBefore } }
            : {}),
        },
        select: PENDING_UPLOAD_SELECT,
      });
      if (!media) return false;
      const metadata = this.crewUploadMetadata(media.metadata);
      if (!metadata) return false;
      if (
        scope.crewId &&
        (media.createdByUserId !== scope.userId ||
          metadata.crewId !== scope.crewId)
      ) {
        throw new ForbiddenException({
          code: 'CREW_ASSET_MEDIA_SCOPE_MISMATCH',
          message: 'The uploaded file does not belong to this crew and user.',
        });
      }

      const claimed = await tx.crewAssetNode.findFirst({
        where: { mediaAssetId },
        select: { id: true },
      });
      if (claimed) return false;

      await this.deletePhysicalObjects([media]);
      const deletedAt = new Date();
      await tx.mediaObjectPlacement.updateMany({
        where: { assetId: mediaAssetId, deletedAt: null },
        data: {
          status: MediaObjectPlacementStatus.deleted,
          deletedAt,
        },
      });
      await tx.mediaAssetVariant.updateMany({
        where: { assetId: mediaAssetId, deletedAt: null },
        data: {
          status: MediaAssetVariantStatus.deleted,
          deletedAt,
        },
      });
      await tx.mediaAssetUsage.updateMany({
        where: { assetId: mediaAssetId, deletedAt: null },
        data: { deletedAt },
      });
      await tx.mediaAsset.updateMany({
        where: { id: mediaAssetId, deletedAt: null },
        data: {
          status: MediaAssetStatus.deleted,
          deletedAt,
        },
      });
      return true;
    });
  }

  async update(
    crewId: string,
    userId: string,
    nodeId: string,
    input: UpdateCrewAssetNodeInput,
  ) {
    try {
      const dto = await this.prisma.$transaction(async (tx) => {
        // Independent moves must inspect one serialized tree, or A→B and B→A
        // can both pass the descendant check and strand every descendant.
        await this.lockAssetTree(tx, crewId);
        const node = await this.requireNode(
          crewId,
          nodeId,
          CrewAssetNodeStatus.active,
          tx,
        );
        await this.access.requireNodePermission(
          crewId,
          nodeId,
          userId,
          CrewAssetPermission.edit,
          tx,
        );
        if (input.parentId === node.id) {
          throw new BadRequestException('A folder cannot contain itself');
        }
        if (input.parentId !== undefined) {
          await this.requireFolder(crewId, input.parentId, tx);
          await this.access.requireContainerPermission(
            crewId,
            input.parentId,
            userId,
            CrewAssetPermission.upload,
            tx,
          );
          if (
            node.kind === CrewAssetNodeKind.folder &&
            input.parentId &&
            (await this.isDescendant(node.id, input.parentId, tx))
          ) {
            throw new BadRequestException(
              'A folder cannot be moved into one of its descendants',
            );
          }
        }
        const changed = await tx.crewAssetNode.updateMany({
          where: {
            id: node.id,
            crewId,
            status: CrewAssetNodeStatus.active,
            updatedAt: new Date(input.expectedUpdatedAt),
          },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.parentId !== undefined
              ? { parentId: input.parentId }
              : {}),
            updatedByUserId: userId,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException({
            code: 'CREW_ASSET_CONFLICT',
            message:
              'This asset changed while you were editing it. Refresh and review the latest version before saving again.',
          });
        }
        const updated = await tx.crewAssetNode.findUniqueOrThrow({
          where: { id: node.id },
          include: NODE_INCLUDE,
        });
        const permission = await this.access.resolveNodePermission(
          crewId,
          nodeId,
          userId,
          tx,
        );
        return this.toDto(
          updated,
          userId,
          permission ?? CrewAssetPermission.edit,
        );
      });
      await this.conversations.broadcastCrewAssetChange(
        crewId,
        nodeId,
        'updated',
        userId,
      );
      return dto;
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async trash(crewId: string, userId: string, nodeId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockAssetTree(tx, crewId);
      const node = await this.requireNode(
        crewId,
        nodeId,
        CrewAssetNodeStatus.active,
        tx,
      );
      await this.access.requireNodePermission(
        crewId,
        nodeId,
        userId,
        CrewAssetPermission.edit,
        tx,
      );
      const trashedAt = new Date();
      const descendantIds =
        node.kind === CrewAssetNodeKind.folder
          ? await this.collectDescendantIds(tx, crewId, node.id)
          : [];
      if (descendantIds.length > 0) {
        await tx.crewAssetNode.updateMany({
          where: {
            id: { in: descendantIds },
            crewId,
            status: CrewAssetNodeStatus.active,
          },
          data: {
            status: CrewAssetNodeStatus.trashed,
            trashedAt,
            trashedByUserId: userId,
            updatedByUserId: userId,
          },
        });
      }
      await tx.crewAssetNode.update({
        where: { id: node.id },
        data: {
          status: CrewAssetNodeStatus.trashed,
          trashedAt,
          trashedByUserId: userId,
          updatedByUserId: userId,
        },
      });
    });
    await this.conversations.broadcastCrewAssetChange(
      crewId,
      nodeId,
      'trashed',
      userId,
    );
  }

  async restore(crewId: string, userId: string, nodeId: string) {
    try {
      const restored = await this.prisma.$transaction(async (tx) => {
        await this.lockAssetTree(tx, crewId);
        const node = await this.requireNode(
          crewId,
          nodeId,
          CrewAssetNodeStatus.trashed,
          tx,
        );
        const permission = await this.access.requireNodePermission(
          crewId,
          nodeId,
          userId,
          CrewAssetPermission.edit,
          tx,
        );
        // Restore ancestors first so an active asset never remains hidden in trash.
        await this.requireFolder(crewId, node.parentId, tx);
        const descendantIds =
          node.kind === CrewAssetNodeKind.folder
            ? await this.collectDescendantIds(tx, crewId, node.id)
            : [];
        if (descendantIds.length > 0) {
          await tx.crewAssetNode.updateMany({
            where: {
              id: { in: descendantIds },
              crewId,
              status: CrewAssetNodeStatus.trashed,
              trashedAt: node.trashedAt,
            },
            data: {
              status: CrewAssetNodeStatus.active,
              trashedAt: null,
              trashedByUserId: null,
              updatedByUserId: userId,
            },
          });
        }
        const restoredNode = await tx.crewAssetNode.update({
          where: { id: node.id },
          data: {
            status: CrewAssetNodeStatus.active,
            trashedAt: null,
            trashedByUserId: null,
            updatedByUserId: userId,
          },
          include: NODE_INCLUDE,
        });
        return this.toDto(restoredNode, userId, permission);
      });
      await this.conversations.broadcastCrewAssetChange(
        crewId,
        nodeId,
        'restored',
        userId,
      );
      return restored;
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async removePermanently(
    crewId: string,
    userId: string,
    nodeId: string,
  ): Promise<void> {
    const node = await this.requireNode(
      crewId,
      nodeId,
      CrewAssetNodeStatus.trashed,
    );
    await this.access.requireNodePermission(
      crewId,
      nodeId,
      userId,
      CrewAssetPermission.manage,
    );
    const descendantIds =
      node.kind === CrewAssetNodeKind.folder
        ? await this.collectDescendantIds(this.prisma, crewId, node.id)
        : [];
    const subtreeIds = [node.id, ...descendantIds];
    const linkedNodes = await this.prisma.crewAssetNode.findMany({
      where: { id: { in: subtreeIds }, crewId },
      select: { mediaAssetId: true },
    });
    const candidateMediaIds = Array.from(
      new Set(
        linkedNodes
          .map((linked) => linked.mediaAssetId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const referencedElsewhere =
      candidateMediaIds.length === 0
        ? []
        : await this.prisma.crewAssetNode.findMany({
            where: {
              mediaAssetId: { in: candidateMediaIds },
              id: { notIn: subtreeIds },
            },
            select: { mediaAssetId: true },
          });
    const retainedMediaIds = new Set(
      referencedElsewhere
        .map((linked) => linked.mediaAssetId)
        .filter((id): id is string => Boolean(id)),
    );
    const deletableMediaIds = candidateMediaIds.filter(
      (id) => !retainedMediaIds.has(id),
    );
    const mediaAssets =
      deletableMediaIds.length === 0
        ? []
        : await this.prisma.mediaAsset.findMany({
            where: { id: { in: deletableMediaIds }, deletedAt: null },
            select: {
              id: true,
              storageProvider: true,
              bucket: true,
              region: true,
              objectKey: true,
              externalUrl: true,
              metadata: true,
              placements: {
                where: {
                  deletedAt: null,
                  status: { not: MediaObjectPlacementStatus.deleted },
                },
                select: {
                  storageProvider: true,
                  bucket: true,
                  region: true,
                  objectKey: true,
                  externalUrl: true,
                },
              },
            },
          });
    const ownedAssets = mediaAssets.filter((asset) =>
      this.isCrewOwnedUpload(asset.metadata, crewId),
    );
    await this.deletePhysicalObjects(ownedAssets);

    const deletedAt = new Date();
    const ownedMediaIds = ownedAssets.map((asset) => asset.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.crewAssetNode.delete({ where: { id: node.id } });
      if (ownedMediaIds.length === 0) return;
      await tx.mediaObjectPlacement.updateMany({
        where: { assetId: { in: ownedMediaIds }, deletedAt: null },
        data: {
          status: MediaObjectPlacementStatus.deleted,
          deletedAt,
        },
      });
      await tx.mediaAssetVariant.updateMany({
        where: { assetId: { in: ownedMediaIds }, deletedAt: null },
        data: {
          status: MediaAssetVariantStatus.deleted,
          deletedAt,
        },
      });
      await tx.mediaAssetUsage.updateMany({
        where: { assetId: { in: ownedMediaIds }, deletedAt: null },
        data: { deletedAt },
      });
      await tx.mediaAsset.updateMany({
        where: { id: { in: ownedMediaIds }, deletedAt: null },
        data: {
          status: MediaAssetStatus.deleted,
          deletedAt,
        },
      });
    });
    await this.conversations.broadcastCrewAssetChange(
      crewId,
      node.id,
      'deleted',
      userId,
    );
  }

  async setPermissions(
    crewId: string,
    userId: string,
    nodeId: string,
    input: Parameters<CrewAssetAccessService['setPermissions']>[3],
  ) {
    const permissions = await this.access.setPermissions(
      crewId,
      nodeId,
      userId,
      input,
    );
    await this.conversations.broadcastCrewAssetChange(
      crewId,
      nodeId,
      'permissions_updated',
      userId,
    );
    return permissions;
  }

  async setFavorite(
    crewId: string,
    userId: string,
    nodeId: string,
    favorite: boolean,
  ) {
    await this.requireNode(crewId, nodeId);
    await this.access.requireNodePermission(
      crewId,
      nodeId,
      userId,
      CrewAssetPermission.view,
    );
    if (favorite) {
      await this.prisma.crewAssetFavorite.upsert({
        where: { nodeId_userId: { nodeId, userId } },
        create: { nodeId, userId },
        update: {},
      });
    } else {
      await this.prisma.crewAssetFavorite.deleteMany({
        where: { nodeId, userId },
      });
    }
    return { favorite };
  }

  private async requireFolder(
    crewId: string,
    folderId: string | null,
    client: Pick<Prisma.TransactionClient, 'crewAssetNode'> = this.prisma,
  ) {
    if (!folderId) return null;
    const folder = await client.crewAssetNode.findFirst({
      where: {
        id: folderId,
        crewId,
        kind: CrewAssetNodeKind.folder,
        status: CrewAssetNodeStatus.active,
      },
      select: { id: true },
    });
    if (!folder) throw new NotFoundException('Asset folder not found');
    return folder;
  }

  private async requireNode(
    crewId: string,
    nodeId: string,
    status: CrewAssetNodeStatus = CrewAssetNodeStatus.active,
    db: Pick<Prisma.TransactionClient, 'crewAssetNode'> = this.prisma,
  ) {
    const node = await db.crewAssetNode.findFirst({
      where: { id: nodeId, crewId, status },
      select: { id: true, parentId: true, kind: true, trashedAt: true },
    });
    if (!node) throw new NotFoundException('Asset node not found');
    return node;
  }

  private async collectDescendantIds(
    client: Pick<Prisma.TransactionClient, 'crewAssetNode'>,
    crewId: string,
    rootId: string,
  ): Promise<string[]> {
    const descendants: string[] = [];
    let frontier = [rootId];
    for (let depth = 0; frontier.length > 0 && depth < 128; depth += 1) {
      const children = await client.crewAssetNode.findMany({
        where: { crewId, parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((child) => child.id);
      descendants.push(...frontier);
    }
    if (frontier.length > 0) {
      throw new BadRequestException('Asset folder hierarchy is too deep');
    }
    return descendants;
  }

  private isCrewOwnedUpload(metadata: Prisma.JsonValue, crewId: string) {
    return this.crewUploadMetadata(metadata)?.crewId === crewId;
  }

  private crewUploadMetadata(
    metadata: Prisma.JsonValue,
  ): { crewId: string } | null {
    if (
      metadata == null ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      metadata.uploadKind !== 'crew_asset_file' ||
      typeof metadata.crewId !== 'string' ||
      metadata.crewId.length === 0
    ) {
      return null;
    }
    return { crewId: metadata.crewId };
  }

  private async deletePhysicalObjects(
    assets: Array<{
      storageProvider: MediaStorageProvider;
      bucket: string | null;
      region: string | null;
      objectKey: string | null;
      externalUrl: string | null;
      placements: Array<{
        storageProvider: MediaStorageProvider;
        bucket: string | null;
        region: string | null;
        objectKey: string | null;
        externalUrl: string | null;
      }>;
    }>,
  ) {
    const seen = new Set<string>();
    for (const asset of assets) {
      for (const object of [asset, ...asset.placements]) {
        if (
          object.storageProvider === MediaStorageProvider.external_url ||
          !object.bucket ||
          !object.objectKey
        ) {
          continue;
        }
        const key = [
          object.storageProvider,
          object.bucket,
          object.region ?? '',
          object.objectKey,
        ].join(':');
        if (seen.has(key)) continue;
        seen.add(key);
        await this.mediaStorage.deleteObject(object);
      }
    }
  }

  private async isDescendant(
    ancestorId: string,
    possibleDescendantId: string,
    db: Pick<Prisma.TransactionClient, 'crewAssetNode'> = this.prisma,
  ): Promise<boolean> {
    let cursor: string | null = possibleDescendantId;
    for (let depth = 0; cursor && depth < 128; depth += 1) {
      if (cursor === ancestorId) return true;
      const node: { parentId: string | null } | null =
        await db.crewAssetNode.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = node?.parentId ?? null;
    }
    if (cursor) {
      throw new BadRequestException(
        'Asset folder hierarchy is too deep or contains a cycle',
      );
    }
    return false;
  }

  private toDto(
    node: AssetNode,
    userId: string,
    effectivePermission: CrewAssetPermission,
  ) {
    return {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      kind: node.kind,
      status: node.status,
      accessMode: node.accessMode,
      permissionVersion: node.permissionVersion,
      effectivePermission,
      favorite: node.favorites.some((favorite) => favorite.userId === userId),
      createdByUserId: node.createdByUserId,
      updatedByUserId: node.updatedByUserId,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
      trashedAt: node.trashedAt?.toISOString() ?? null,
      media: node.mediaAsset
        ? {
            id: node.mediaAsset.id,
            kind: node.mediaAsset.kind,
            contentType: node.mediaAsset.contentType,
            sizeBytes:
              node.mediaAsset.sizeBytes == null
                ? null
                : Number(node.mediaAsset.sizeBytes),
            width: node.mediaAsset.width,
            height: node.mediaAsset.height,
            durationSeconds: node.mediaAsset.durationSeconds,
            previewUrl: `/aurora/media/assets/${node.mediaAsset.id}/content`,
          }
        : null,
    };
  }

  private mapWriteError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException(
        'An active file or folder with this name already exists here',
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

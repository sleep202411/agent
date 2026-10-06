import { crewStorageUsage, lockCrewStorage } from './storage-quota';
import { requireNoTaskContractReferences } from './task-contract-retention';
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
  WorkspaceMemberRole,
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
import { savedProjectMediaReferences } from './saved-project-media-references';
import { lockMediaAssetRetirement } from '../../media/media-asset-lifecycle-lock';

// Removing a library entry must not retire media used by another product.
// Keep historical references too: saved versions must remain recoverable.
const UNREFERENCED_CREW_MEDIA = {
  aiJobOutputs: { none: {} },
  certificateImages: { none: {} },
  ipCovers: { none: {} },
  ipLocalizationCovers: { none: {} },
  ipTrailers: { none: {} },
  ipEpisodeCovers: { none: {} },
  ipEpisodeMedia: { none: {} },
  ipEpisodeTrailers: { none: {} },
  ipLibraryAssets: { none: {} },
  ipDiscoveryImages: { none: {} },
  ipDiscoveryMobileImages: { none: {} },
  ipDiscoveryTrailerMedia: { none: {} },
  ipReportEvidence: { none: {} },
  channelVideoSubmissions: { none: {} },
  characterCovers: { none: {} },
  characterMedia: { none: {} },
  storyProjectCovers: { none: {} },
  storyReferenceVersions: { none: {} },
  storyBuildAssets: { none: {} },
  storyCandidateAssets: { none: {} },
  storyAssetSpecMediaVersions: { none: {} },
  storyStoryboardMediaVersions: { none: {} },
  linkedCrewAssetNodes: { none: {} },
  contentReviewRecords: { none: {} },
  usages: { none: { deletedAt: null } },
} satisfies Prisma.MediaAssetWhereInput;

const NODE_INCLUDE = {
  taskContracts: { select: { id: true }, take: 1 },
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
  linkedStudioMediaAsset: {
    select: { id: true, kind: true },
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
        studioCrew: {
          where: { deletedAt: null, studioWorkspaceId: null },
          select: { id: true, name: true, logo: true },
        },
        workspace: {
          select: {
            studioCrew: {
              where: { deletedAt: null },
              select: { id: true, name: true, logo: true },
            },
          },
        },
        productionCrew: {
          where: { deletedAt: null },
          select: { id: true, name: true, logo: true },
        },
        crewTaskCanvas: {
          where: { deletedAt: null, crew: { deletedAt: null } },
          select: {
            crew: { select: { id: true, name: true, logo: true } },
          },
        },
      },
    });
    return (
      project?.studioCrew ??
      project?.workspace?.studioCrew ??
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
      canSaveFromCanvas: Boolean(
        await this.prisma.platformProject.findFirst({
          where: {
            id: projectId,
            workspace: { studioCrew: { id: crew.id, deletedAt: null } },
          },
          select: { id: true },
        }),
      ),
      assetContext: (await this.authorization.resolve(crew.id, userId))
        ? await this.context(crew.id, userId)
        : {
            capabilities: {
              view: await this.access.canReadLinkedWorkspace(crew.id, userId),
            },
          },
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
    return this.list(crew.id, userId, query, true);
  }

  async saveFromCanvas(
    documentId: string,
    userId: string,
    mediaAssetId: string,
  ) {
    const document = await this.prisma.studioDocument.findFirst({
      where: {
        id: documentId,
        type: 'canvas',
        status: 'active',
        deletedAt: null,
      },
      select: { platformProjectId: true },
    });
    if (!document?.platformProjectId)
      throw new NotFoundException('Canvas project not found.');
    const projectId = document.platformProjectId;
    await this.workspacePermissions.requireProjectRole(
      userId,
      projectId,
      ProjectMemberRole.editor,
    );
    const crew = await this.projectCrew(projectId, userId);
    if (!crew)
      throw new NotFoundException(
        'Link a Crew to this workspace before saving assets.',
      );
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:studio-workspace:${crew.id}`})::bigint)`;
      await lockCrewAssetUploads(tx, [mediaAssetId]);
      await this.lockAssetTree(tx, crew.id);
      await this.workspacePermissions.requireProjectRole(
        userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
      const project = await tx.platformProject.findFirst({
        where: {
          id: projectId,
          status: 'active',
          deletedAt: null,
          workspace: {
            studioCrew: { id: crew.id, deletedAt: null },
            status: 'active',
            deletedAt: null,
          },
        },
        select: { id: true, name: true, workspaceId: true },
      });
      if (!project)
        throw new ConflictException(
          'The Crew workspace link changed. Refresh and try again.',
        );
      const actor = await this.authorization.resolve(crew.id, userId, tx);
      if (actor && !actor.permissions.includes('assets.upload'))
        throw new ForbiddenException('You cannot add Crew assets.');
      if (
        !actor &&
        !(await this.access.canReadLinkedWorkspace(crew.id, userId, tx))
      )
        throw new ForbiddenException('Workspace membership required.');
      await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${mediaAssetId}::uuid FOR UPDATE`;
      const media = await tx.mediaAsset.findFirst({
        where: {
          id: mediaAssetId,
          workspaceId: project.workspaceId,
          kind: { in: ['image', 'video'] },
          status: 'ready',
          deletedAt: null,
          moderationStatus: { not: 'blocked' },
        },
        select: { id: true, metadata: true, kind: true, createdByUserId: true },
      });
      if (!media)
        throw new ForbiddenException(
          'Only ready images and videos in this workspace can be saved to Crew.',
        );
      if (media.createdByUserId !== userId) {
        await this.workspacePermissions.requireWorkspaceRole(
          userId,
          project.workspaceId,
          WorkspaceMemberRole.editor,
          tx,
        );
      }
      const currentDocument = await tx.studioDocument.findFirst({
        where: {
          id: documentId,
          platformProjectId: projectId,
          workspaceId: project.workspaceId,
          type: 'canvas',
          status: 'active',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!currentDocument)
        throw new ConflictException(
          'The canvas changed. Refresh and try again.',
        );
      if (isPrivateStudioMedia(media.metadata))
        throw new ForbiddenException(
          'Private or Crew-managed media cannot be shared through this action.',
        );
      let folder = await tx.crewAssetNode.findFirst({
        where: { crewId: crew.id, sourceCanvasProjectId: projectId },
      });
      if (folder) {
        if (folder.status !== 'active')
          throw new ConflictException(
            'Restore the project folder in Crew before saving more assets.',
          );
        await this.access.requireNodePermission(
          crew.id,
          folder.id,
          userId,
          actor ? CrewAssetPermission.upload : CrewAssetPermission.view,
          tx,
        );
      } else {
        await lockCrewAssetFolderNames(tx, crew.id, null);
        const siblings = await tx.crewAssetNode.findMany({
          where: { crewId: crew.id, parentId: null, status: 'active' },
          select: { name: true },
        });
        folder = await tx.crewAssetNode.create({
          data: {
            crewId: crew.id,
            kind: 'folder',
            name: availableCrewAssetName(
              project.name,
              new Set(siblings.map((n) => n.name.toLowerCase())),
            ),
            sourceCanvasProjectId: projectId,
            createdByUserId: userId,
            updatedByUserId: userId,
          },
        });
      }
      const existing = await tx.crewAssetNode.findFirst({
        where: { crewId: crew.id, parentId: folder.id, mediaAssetId },
      });
      if (existing) {
        if (existing.status !== 'active')
          throw new ConflictException(
            'Restore this asset in Crew before saving it again.',
          );
        await this.access.requireNodePermission(
          crew.id,
          existing.id,
          userId,
          CrewAssetPermission.view,
          tx,
        );
        return { id: existing.id, folderName: folder.name, created: false };
      }
      const names = await tx.crewAssetNode.findMany({
        where: { crewId: crew.id, parentId: folder.id, status: 'active' },
        select: { name: true },
      });
      const node = await tx.crewAssetNode.create({
        data: {
          crewId: crew.id,
          parentId: folder.id,
          kind: 'file',
          sharedFromStudio: true,
          mediaAssetId,
          name: availableCrewAssetName(
            `${media.kind}-${mediaAssetId.slice(0, 8)}`,
            new Set(names.map((n) => n.name.toLowerCase())),
          ),
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      });
      await this.workspacePermissions.requireProjectRole(
        userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
      if (actor)
        await this.authorization.require(crew.id, userId, 'assets.upload', tx);
      await this.access.requireNodePermission(
        crew.id,
        folder.id,
        userId,
        actor ? CrewAssetPermission.upload : CrewAssetPermission.view,
        tx,
      );
      return { id: node.id, folderName: folder.name, created: true };
    });
    if (result.created)
      await this.conversations.broadcastCrewAssetChange(
        crew.id,
        result.id,
        'created',
        userId,
      );
    return result;
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
            // Registered final objects belong to the media lifecycle, even
            // after retirement. Its worker checks retained references and
            // retries physical deletion; reservations must not bypass it.
            const asset = await tx.mediaAsset.findFirst({
              where: { objectKey: finalKey },
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

  async list(
    crewId: string,
    userId: string,
    query: ListCrewAssetsQuery,
    fromProject = false,
  ) {
    const workspaceReader =
      fromProject &&
      !(await this.authorization.resolve(crewId, userId)) &&
      (await this.access.canReadLinkedWorkspace(crewId, userId));
    if (!workspaceReader)
      await this.authorization.require(crewId, userId, 'assets.view');
    if (workspaceReader && !['all', 'recent'].includes(query.source))
      throw new ForbiddenException(
        'Only active Crew assets are shared with Studio.',
      );
    if (query.source === 'all' && query.parentId) {
      await this.access.requireNodePermission(
        crewId,
        query.parentId,
        userId,
        CrewAssetPermission.view,
      );
    }

    // Delivery references keep their original ACL; the existing permission filter below
    // applies to referenced files exactly as it does to ordinary folder children.
    const deliveryAssets =
      query.source === 'all' && query.parentId
        ? await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT a.asset_node_id AS id FROM crew_task_delivery_assets a
          JOIN crew_task_delivery_folders f ON f.task_id = a.task_id AND f.crew_id = a.crew_id
          WHERE f.folder_id = ${query.parentId}::uuid AND f.crew_id = ${crewId}
        `
        : [];
    const where: Prisma.CrewAssetNodeWhereInput = {
      ...(fromProject
        ? {
            AND: [
              {
                OR: [
                  { kind: 'folder' },
                  {
                    mediaAsset: {
                      status: 'ready',
                      deletedAt: null,
                      moderationStatus: { not: 'blocked' },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
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
      ...(query.source === 'all'
        ? {
            OR: [
              { parentId: query.parentId ?? null },
              ...(deliveryAssets.length
                ? [{ id: { in: deliveryAssets.map((asset) => asset.id) } }]
                : []),
            ],
          }
        : {}),
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
    if (
      query.cursor &&
      !(await this.prisma.crewAssetNode.findFirst({
        where: { AND: [where, { id: query.cursor }] },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException({
        code: 'CREW_ASSET_CURSOR_INVALID',
        message:
          'The asset cursor is invalid for the current view. Restart from the first page.',
      });
    }
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
        select: { id: true, parentId: true, name: true, folderKey: true },
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
    const retired = await this.prisma.$transaction(async (tx) => {
      await lockCrewAssetUploads(tx, [mediaAssetId]);
      await lockMediaAssetRetirement(tx, [mediaAssetId]);
      const media = await tx.mediaAsset.findFirst({
        where: {
          ...UNREFERENCED_CREW_MEDIA,
          id: mediaAssetId,
          status: MediaAssetStatus.ready,
          deletedAt: null,
          ...(scope.createdBefore
            ? { createdAt: { lt: scope.createdBefore } }
            : {}),
        },
        select: PENDING_UPLOAD_SELECT,
      });
      if (!media) return null;
      const metadata = this.crewUploadMetadata(media.metadata);
      if (!metadata) return null;
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
      if (claimed) return null;

      if ((await savedProjectMediaReferences(tx, [media.id])).has(media.id))
        return null;
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
      await tx.$executeRaw`
        UPDATE media_assets
        SET metadata = jsonb_set(metadata, '{crewPhysicalDeletionPending}', 'true'::jsonb)
        WHERE id = ${media.id}::uuid
      `;
      return media;
    });
    if (!retired) return false;
    // Retire atomically before touching object storage. Rollbacks retain bytes;
    // crashes and storage failures leave a marker for the cleanup worker.
    try {
      await this.deletePhysicalObjects([retired]);
      await this.clearPhysicalDeletionPending(retired.id);
    } catch (error) {
      this.logger.warn(
        `Crew pending-upload cleanup deferred asset=${retired.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return true;
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
        // Contract files are read-only once attached, including their name and
        // location. Attachment takes this same tree lock, closing the race.
        await requireNoTaskContractReferences(tx, crewId, [node.id]);
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
      await requireNoTaskContractReferences(tx, crewId, [
        node.id,
        ...descendantIds,
      ]);
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
    const ownedAssets = await this.prisma.$transaction(async (tx) => {
      await this.lockAssetTree(tx, crewId);
      const node = await this.requireNode(
        crewId,
        nodeId,
        CrewAssetNodeStatus.trashed,
        tx,
      );
      await this.access.requireNodePermission(
        crewId,
        nodeId,
        userId,
        CrewAssetPermission.manage,
        tx,
      );
      const descendantIds =
        node.kind === CrewAssetNodeKind.folder
          ? await this.collectDescendantIds(tx, crewId, node.id)
          : [];
      const subtreeIds = [node.id, ...descendantIds];
      await requireNoTaskContractReferences(tx, crewId, subtreeIds);
      const linkedNodes = await tx.crewAssetNode.findMany({
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
      await lockMediaAssetRetirement(tx, candidateMediaIds);
      const referencedElsewhere =
        candidateMediaIds.length === 0
          ? []
          : await tx.crewAssetNode.findMany({
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
          : await tx.mediaAsset.findMany({
              where: {
                ...UNREFERENCED_CREW_MEDIA,
                id: { in: deletableMediaIds },
                deletedAt: null,
              },
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
      const documentReferences = await savedProjectMediaReferences(
        tx,
        mediaAssets.map((asset) => asset.id),
      );
      const ownedAssets = mediaAssets.filter(
        (asset) =>
          this.isCrewOwnedUpload(asset.metadata, crewId) &&
          !documentReferences.has(asset.id),
      );

      const deletedAt = new Date();
      const ownedMediaIds = ownedAssets.map((asset) => asset.id);
      try {
        await tx.crewAssetNode.delete({ where: { id: node.id } });
      } catch (error) {
        // Let the foreign key enforce retention atomically, including a
        // reference created concurrently or a linked descendant of a folder.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw new ConflictException({
            code: 'CREW_ASSET_IN_USE',
            message:
              'This file or folder contains assets still required by linked Crew records. Restore it from Trash to keep working with those assets.',
          });
        }
        throw error;
      }
      if (ownedMediaIds.length === 0) return [];
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
      await tx.$executeRaw`
        UPDATE media_assets
        SET metadata = jsonb_set(metadata, '{crewPhysicalDeletionPending}', 'true'::jsonb)
        WHERE id IN (${Prisma.join(ownedMediaIds.map((id) => Prisma.sql`${id}::uuid`))})
      `;
      return ownedAssets;
    });
    // Commit the locked tree decision before irreversible object-storage I/O.
    // The durable marker lets the cleanup worker resume after failures/crashes.
    for (const asset of ownedAssets) {
      try {
        await this.deletePhysicalObjects([asset]);
        await this.clearPhysicalDeletionPending(asset.id);
      } catch (error) {
        this.logger.warn(
          `Crew deleted-media cleanup deferred asset=${asset.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await this.conversations.broadcastCrewAssetChange(
      crewId,
      nodeId,
      'deleted',
      userId,
    );
  }

  async reclaimDeletedCrewUpload(mediaAssetId: string): Promise<void> {
    const media = await this.prisma.mediaAsset.findFirst({
      where: {
        ...UNREFERENCED_CREW_MEDIA,
        id: mediaAssetId,
        status: MediaAssetStatus.deleted,
        deletedAt: { not: null },
        metadata: { path: ['crewPhysicalDeletionPending'], equals: true },
        crewAssetNodes: { none: {} },
      },
      select: {
        ...PENDING_UPLOAD_SELECT,
        // Retired placements still identify objects that need deleting.
        placements: { select: PENDING_UPLOAD_SELECT.placements.select },
      },
    });
    if (!media || !this.crewUploadMetadata(media.metadata)) return;
    if (
      (await savedProjectMediaReferences(this.prisma, [media.id])).has(media.id)
    )
      return;
    await this.deletePhysicalObjects([media]);
    await this.clearPhysicalDeletionPending(media.id);
  }

  private async clearPhysicalDeletionPending(
    mediaAssetId: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE media_assets SET metadata = metadata - 'crewPhysicalDeletionPending'
      WHERE id = ${mediaAssetId}::uuid AND status = 'deleted'
    `;
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

  private async studioMediaScope(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
    source: { projectId?: string | null; storyProjectId?: string | null },
  ): Promise<Prisma.MediaAssetWhereInput> {
    if (source.projectId && source.storyProjectId) {
      throw new BadRequestException('Select one Studio source project.');
    }
    // Crew membership alone must not expose the entire linked workspace.
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      workspaceId,
      WorkspaceMemberRole.viewer,
      tx,
    );
    if (source.projectId) {
      const project = await tx.platformProject.findFirst({
        where: {
          id: source.projectId,
          workspaceId,
          deletedAt: null,
          status: 'active',
        },
        select: { id: true },
      });
      if (!project)
        throw new NotFoundException(
          'Studio project not found in the linked workspace.',
        );
    }
    if (source.storyProjectId) {
      const project = await tx.storyProject.findFirst({
        where: { id: source.storyProjectId, workspaceId, archivedAt: null },
        select: { id: true },
      });
      if (!project)
        throw new NotFoundException(
          'Story project not found in the linked workspace.',
        );
    }
    return {
      workspaceId,
      deletedAt: null,
      status: 'ready',
      kind: { in: ['image', 'video', 'audio'] },
      moderationStatus: { not: 'blocked' },
      ...(source.projectId
        ? { usages: { some: { projectId: source.projectId, deletedAt: null } } }
        : {}),
      ...(source.storyProjectId
        ? {
            storyCandidateAssets: {
              some: { storyProjectId: source.storyProjectId },
            },
          }
        : {}),
    };
  }

  async listStudioMediaOptions(
    crewId: string,
    userId: string,
    query: { projectId?: string; storyProjectId?: string },
  ) {
    await this.authorization.require(crewId, userId, 'assets.view');
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { studioWorkspaceId: true },
    });
    if (!crew?.studioWorkspaceId) {
      return { workspaceId: null, projects: [], items: [] };
    }
    const workspaceId = crew.studioWorkspaceId;
    const mediaWhere = await this.studioMediaScope(
      this.prisma,
      workspaceId,
      userId,
      query,
    );
    const [projects, storyProjects] = await Promise.all([
      this.prisma.platformProject.findMany({
        where: { workspaceId, deletedAt: null, status: 'active' },
        select: { id: true, name: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 100,
      }),
      this.prisma.storyProject.findMany({
        where: { workspaceId, archivedAt: null },
        select: { id: true, title: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 100,
      }),
    ]);
    const media = await this.prisma.mediaAsset.findMany({
      where: mediaWhere,
      select: {
        id: true,
        kind: true,
        contentType: true,
        createdAt: true,
        objectKey: true,
        metadata: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      workspaceId,
      projects: [
        ...projects.map((project) => ({
          id: project.id,
          name: project.name,
          kind: 'canvas' as const,
        })),
        ...storyProjects.map((project) => ({
          id: project.id,
          name: project.title,
          kind: 'story' as const,
        })),
      ],
      items: media
        .filter((row) => !isPrivateStudioMedia(row.metadata))
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          contentType: row.contentType,
          name: row.objectKey?.split('/').pop() || row.id,
          previewUrl: `/aurora/media/assets/${row.id}/content`,
          createdAt: row.createdAt.toISOString(),
        })),
    };
  }

  async linkStudioMedia(
    crewId: string,
    userId: string,
    input: {
      parentId?: string | null;
      mediaAssetIds: string[];
      projectId?: string | null;
      storyProjectId?: string | null;
    },
  ) {
    const parentId = input.parentId ?? null;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockAssetTree(tx, crewId);
      await this.access.requireContainerPermission(
        crewId,
        parentId,
        userId,
        CrewAssetPermission.upload,
        tx,
      );
      const crew = await tx.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: { studioWorkspaceId: true },
      });
      if (!crew?.studioWorkspaceId) {
        throw new ConflictException('Link a Studio workspace first.');
      }
      const mediaWhere = await this.studioMediaScope(
        tx,
        crew.studioWorkspaceId,
        userId,
        input,
      );
      const items: ReturnType<CrewAssetsService['toDto']>[] = [];
      for (const mediaAssetId of [...new Set(input.mediaAssetIds)]) {
        const media = await tx.mediaAsset.findFirst({
          where: {
            id: mediaAssetId,
            ...mediaWhere,
          },
          select: { id: true, objectKey: true, metadata: true },
        });
        if (!media || isPrivateStudioMedia(media.metadata)) {
          throw new ForbiddenException(
            'Only ready workspace media can be linked.',
          );
        }
        const existing = await tx.crewAssetNode.findFirst({
          where: {
            crewId,
            parentId,
            mediaAssetId,
            status: CrewAssetNodeStatus.active,
          },
        });
        if (existing) continue;
        const names = await tx.crewAssetNode.findMany({
          where: { crewId, parentId, status: CrewAssetNodeStatus.active },
          select: { name: true },
        });
        const node = await tx.crewAssetNode.create({
          data: {
            crewId,
            parentId,
            kind: CrewAssetNodeKind.file,
            sharedFromStudio: true,
            mediaAssetId,
            linkedStudioMediaAssetId: mediaAssetId,
            linkedProjectId: input.projectId ?? null,
            linkedStoryProjectId: input.storyProjectId ?? null,
            name: availableCrewAssetName(
              media.objectKey?.split('/').pop() || 'Studio asset',
              new Set(names.map((n) => n.name.toLowerCase())),
            ),
            createdByUserId: userId,
            updatedByUserId: userId,
          },
          include: NODE_INCLUDE,
        });
        items.push(this.toDto(node, userId, CrewAssetPermission.upload));
      }
      return items;
    });
    return { items: created };
  }

  async setStudioLink(
    crewId: string,
    userId: string,
    nodeId: string,
    input: {
      mediaAssetId: string | null;
      projectId?: string | null;
      storyProjectId?: string | null;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAssetTree(tx, crewId);
      await this.access.requireNodePermission(
        crewId,
        nodeId,
        userId,
        CrewAssetPermission.manage,
        tx,
      );
      const node = await tx.crewAssetNode.findFirst({
        where: { id: nodeId, crewId, status: CrewAssetNodeStatus.active },
      });
      if (!node || node.kind !== CrewAssetNodeKind.file) {
        throw new NotFoundException('Asset file not found.');
      }
      if (!input.mediaAssetId) {
        const updated = await tx.crewAssetNode.update({
          where: { id: nodeId },
          data: {
            linkedStudioMediaAssetId: null,
            linkedProjectId: null,
            linkedStoryProjectId: null,
            updatedByUserId: userId,
          },
          include: NODE_INCLUDE,
        });
        return this.toDto(updated, userId, CrewAssetPermission.manage);
      }
      const crew = await tx.crew.findFirst({
        where: { id: crewId, deletedAt: null },
        select: { studioWorkspaceId: true },
      });
      if (!crew?.studioWorkspaceId) {
        throw new ConflictException('Link a Studio workspace first.');
      }
      const mediaWhere = await this.studioMediaScope(
        tx,
        crew.studioWorkspaceId,
        userId,
        input,
      );
      const media = await tx.mediaAsset.findFirst({
        where: { id: input.mediaAssetId, ...mediaWhere },
        select: { id: true, metadata: true },
      });
      if (!media || isPrivateStudioMedia(media.metadata)) {
        throw new ForbiddenException(
          'Only ready workspace media can be linked.',
        );
      }
      const updated = await tx.crewAssetNode.update({
        where: { id: nodeId },
        data: {
          linkedStudioMediaAssetId: input.mediaAssetId,
          linkedProjectId: input.projectId ?? null,
          linkedStoryProjectId: input.storyProjectId ?? null,
          updatedByUserId: userId,
        },
        include: NODE_INCLUDE,
      });
      return this.toDto(updated, userId, CrewAssetPermission.manage);
    });
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
      contractLocked: Boolean(node.taskContracts?.length),
      folderKey: node.folderKey ?? null,
      linkedStudio: node.linkedStudioMediaAsset
        ? {
            mediaAssetId: node.linkedStudioMediaAsset.id,
            projectId: node.linkedProjectId,
            storyProjectId: node.linkedStoryProjectId,
            previewUrl: `/aurora/media/assets/${node.linkedStudioMediaAsset.id}/content`,
          }
        : null,
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

/** Studio sharing is not an alternative authorization route for private evidence. */
function isPrivateStudioMedia(metadata: Prisma.JsonValue | undefined): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return false;
  return (
    Boolean(metadata.crewId) ||
    [
      'crew_expense_receipt',
      'crew_dispute_evidence',
      'crew_agreement_archive',
    ].includes(
      typeof metadata.uploadKind === 'string' ? metadata.uploadKind : '',
    )
  );
}

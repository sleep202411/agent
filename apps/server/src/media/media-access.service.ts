import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CharacterMediaStatus,
  CharacterStatus,
  CrewAssetPermission,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaObjectPlacementStatus,
  PlatformProjectStatus,
  Prisma,
  ProjectMemberStatus,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import { WorkspacePermissionService } from '../workspaces';
import { CrewAssetAccessService } from '../crews/assets/asset-access.service';
import { StudioDocumentAccessService } from '../documents/studio-document-access.service';
import {
  ensureVideoPosterJob,
  VIDEO_POSTER_VARIANT_KEY,
} from '../infra/storage/media-video-poster';
import {
  isPeerViewable,
  requireModerationApproval,
} from './media-moderation-policy';
import type {
  MediaAssetAccessQueryDto,
  MediaAssetAccessResponseDto,
  MediaVideoPosterResponseDto,
} from './dto';

const USER_READ_URL_TTL_SECONDS = positiveInt(
  process.env.MEDIA_USER_READ_URL_TTL_SECONDS,
  5 * 60,
);
const ADMIN_READ_URL_TTL_SECONDS = positiveInt(
  process.env.MEDIA_ADMIN_READ_URL_TTL_SECONDS,
  15 * 60,
);
const USER_READ_CACHE_CONTROL = 'private, no-store';
const ADMIN_READ_CACHE_CONTROL = 'private, no-store';
const MEDIA_ACCESS_ASSET_INCLUDE = {
  placements: {
    where: { deletedAt: null },
    orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
  },
  variants: {
    where: { deletedAt: null },
    include: {
      placements: {
        where: { deletedAt: null },
        orderBy: [{ role: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
} satisfies Prisma.MediaAssetInclude;

type MediaAccessAsset = Prisma.MediaAssetGetPayload<{
  include: typeof MEDIA_ACCESS_ASSET_INCLUDE;
}>;

export type MediaAssetAccessSubject = Pick<
  MediaAccessAsset,
  | 'id'
  | 'visibility'
  | 'status'
  | 'moderationStatus'
  | 'createdByUserId'
  | 'workspaceId'
  | 'metadata'
>;

/**
 * Optional consumption context. `documentId` is the canvas edition of the
 * reference-reaches-context rule: an asset referenced by a Studio document is
 * viewable by anyone who can read that document, no matter how the asset got
 * there or whose personal scope it lives in.
 */
export interface MediaAccessContext {
  documentId?: string | null;
}

@Injectable()
export class MediaAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageAccess: MediaStorageAccessService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly crewAssetAccess: CrewAssetAccessService,
    private readonly documentAccess: StudioDocumentAccessService,
  ) {}

  async issueAccessUrl(
    userId: string,
    assetId: string,
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    return this.issueBrowserAccessUrl(userId, assetId, query);
  }

  async issueBrowserAccessUrl(
    userId: string | null | undefined,
    assetId: string,
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    const asset = await this.loadAsset(assetId);
    await this.requireUseAccess(userId, asset, {
      documentId: query.documentId,
    });

    return this.issueStorageUrl(asset, query, {
      allowInactivePlacements: false,
      cacheControl: USER_READ_CACHE_CONTROL,
      expiresInSeconds: USER_READ_URL_TTL_SECONDS,
    });
  }

  async issueVideoPosterUrl(
    userId: string | null | undefined,
    assetId: string,
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaVideoPosterResponseDto> {
    let asset = await this.loadAsset(assetId);
    await this.requireUseAccess(userId, asset, {
      documentId: query.documentId,
    });
    if (asset.kind !== 'video')
      throw new BadRequestException('A video asset is required.');
    const hasPoster = (candidate: MediaAccessAsset) =>
      candidate.variants.some(
        (variant) =>
          variant.variantKey === VIDEO_POSTER_VARIANT_KEY &&
          variant.status === 'ready' &&
          variant.placements.some(
            (placement) =>
              placement.role === 'primary' &&
              placement.status === 'active' &&
              !placement.deletedAt,
          ),
      );
    // Existing videos use the same durable job as new uploads. Polling must
    // not restart it, including a job that finishes during this read.
    const job = hasPoster(asset)
      ? null
      : await ensureVideoPosterJob(this.prisma, assetId);
    if (job?.status === 'completed') asset = await this.loadAsset(assetId);
    if (hasPoster(asset)) {
      const access = await this.issueStorageUrl(
        asset,
        { variantKey: VIDEO_POSTER_VARIANT_KEY },
        {
          allowInactivePlacements: false,
          cacheControl: USER_READ_CACHE_CONTROL,
          expiresInSeconds: USER_READ_URL_TTL_SECONDS,
        },
      );
      return { status: 'ready', url: access.url, expiresAt: access.expiresAt };
    }
    return job?.status === 'dead' || job?.status === 'completed'
      ? {
          status: 'failed',
          message: job.errorMessage ?? 'Video preview is unavailable.',
        }
      : { status: 'pending' };
  }

  /**
   * Canonical product-level authorization for consuming an asset.
   *
   * Browser playback, provider references, exports, and future media tools
   * must share this rule instead of inferring access from workspaceId alone.
   * In particular, a personal private asset has no workspaceId and is owned
   * through createdByUserId; workspace, Crew, and cast grants are evaluated by
   * the same policy used by the asset library.
   */
  async requireUseAccess(
    userId: string | null | undefined,
    asset: MediaAssetAccessSubject,
    context?: MediaAccessContext,
  ): Promise<void> {
    requireNonReceiptAsset(asset.metadata);
    if (
      asset.status === MediaAssetStatus.deleted ||
      asset.moderationStatus === MediaAssetModerationStatus.blocked
    ) {
      throw new GoneException({
        code: 'MEDIA_ASSET_UNAVAILABLE',
        message: 'Media asset is no longer available.',
      });
    }
    if (asset.status !== MediaAssetStatus.ready) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_READY',
        message: 'Media asset is not ready.',
      });
    }

    // Pre-broadcast moderation gate: when approval is required, peers (anyone who
    // is not the asset's owner) cannot view it until moderation approves it. The
    // owner always sees their own pending asset. No-op unless the policy is on.
    const isOwner = userId != null && asset.createdByUserId === userId;
    if (
      !isPeerViewable(
        asset.moderationStatus,
        isOwner,
        requireModerationApproval(),
      )
    ) {
      throw new ForbiddenException({
        code: 'MEDIA_ASSET_PENDING_MODERATION',
        message: 'Media asset is awaiting moderation approval.',
      });
    }

    try {
      await this.requireAccess(userId, asset);
    } catch (err) {
      // Ownership/membership denials (only) may be rescued by canvas context;
      // the moderation and lifecycle gates above are a different axis and
      // already threw. 401 (signed-out) and 404 pass through untouched.
      if (
        !(err instanceof ForbiddenException) ||
        userId == null ||
        !context?.documentId ||
        !(await this.hasCanvasReferenceAccess(
          userId,
          context.documentId,
          asset.id,
        ))
      ) {
        throw err;
      }
    }
  }

  async requireUseAccessById(
    userId: string,
    assetId: string,
    context?: MediaAccessContext,
  ): Promise<void> {
    const asset = await this.loadAsset(assetId);
    await this.requireUseAccess(userId, asset, context);
  }

  /**
   * Reference-reaches-context, canvas edition (matches the character-cast
   * grant below): whoever can read a Studio document may consume every asset
   * that document references. The document snapshot itself is the authority —
   * no side-table, no mint step; putting an asset on a canvas IS the act of
   * sharing it with the canvas's audience, and removing it ends the grant on
   * the next request. Containment is a full-UUID string check against the
   * snapshot JSON: asset ids are UUIDs, so a substring collision between two
   * distinct ids is impossible.
   */
  private async hasCanvasReferenceAccess(
    userId: string,
    documentId: string,
    assetId: string,
  ): Promise<boolean> {
    let snapshot: unknown;
    try {
      const document = await this.documentAccess.requireDocument(
        userId,
        documentId,
        'read',
      );
      snapshot = document.contentSnapshot;
    } catch {
      // Not readable (or gone) — the context cannot widen anything.
      return false;
    }
    if (snapshot == null) return false;
    return JSON.stringify(snapshot).includes(assetId);
  }

  async issueAdminAccessUrl(
    assetId: string,
    query: MediaAssetAccessQueryDto,
  ): Promise<MediaAssetAccessResponseDto> {
    const asset = await this.loadAsset(assetId);
    requireNonReceiptAsset(asset.metadata);
    if (asset.status === MediaAssetStatus.deleted || asset.deletedAt != null) {
      throw new GoneException({
        code: 'MEDIA_ASSET_UNAVAILABLE',
        message: 'Media asset is no longer available.',
      });
    }
    if (asset.status !== MediaAssetStatus.ready) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_READY',
        message: 'Media asset is not ready.',
      });
    }
    return this.issueStorageUrl(asset, query, {
      allowInactivePlacements: true,
      cacheControl: ADMIN_READ_CACHE_CONTROL,
      expiresInSeconds: ADMIN_READ_URL_TTL_SECONDS,
    });
  }

  private async hasStoryReferenceAccess(
    userId: string,
    assetId: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ allowed: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM story_project_media_references r
        JOIN story_projects p ON p.id = r.story_project_id
        JOIN workspaces w ON w.id = p.workspace_id
        WHERE r.asset_id = ${assetId}::uuid AND p.status = 'active'
          AND w.status = 'active' AND w.deleted_at IS NULL
          AND (
            EXISTS (SELECT 1 FROM story_project_members m WHERE m.story_project_id = p.id
              AND m.user_id = ${userId} AND m.status = 'active' AND m.removed_at IS NULL)
            OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id
              AND m.user_id = ${userId} AND m.status = 'active' AND m.removed_at IS NULL AND m.access_scope = 'workspace')
          )
      ) AS allowed
    `;
    return rows[0]?.allowed === true;
  }

  private async requireAccess(
    userId: string | null | undefined,
    asset: {
      id: string;
      visibility: MediaAssetVisibility;
      createdByUserId: string | null;
      workspaceId: string | null;
      metadata: Prisma.JsonValue;
    },
  ): Promise<void> {
    if (asset.visibility === MediaAssetVisibility.public) return;
    if (!userId) {
      throw new UnauthorizedException({
        code: 'MEDIA_ASSET_AUTH_REQUIRED',
        message: 'Sign in to access this media asset.',
      });
    }
    const crewId = crewAssetCrewId(asset.metadata);
    if (crewId) {
      const nodes = await this.prisma.crewAssetNode.findMany({
        where: { mediaAssetId: asset.id },
        select: { id: true, crewId: true },
      });
      // A just-confirmed upload is private to its creator until the attach
      // transaction claims it as a CrewAssetNode. Once claimed, the node ACL
      // is authoritative—even for the original uploader and former members.
      if (nodes.length === 0 && asset.createdByUserId === userId) {
        await this.crewAssetAccess.requireContainerPermission(
          crewId,
          null,
          userId,
          CrewAssetPermission.view,
        );
        return;
      }
      for (const node of nodes) {
        try {
          await this.crewAssetAccess.requireNodePermission(
            node.crewId,
            node.id,
            userId,
            CrewAssetPermission.view,
          );
          return;
        } catch (error) {
          if (
            error instanceof ForbiddenException ||
            error instanceof NotFoundException
          ) {
            continue;
          }
          throw error;
        }
      }
      throw new ForbiddenException({
        code: 'MEDIA_ASSET_ACCESS_DENIED',
        message: 'You do not have access to this crew asset.',
      });
    }
    if (asset.createdByUserId === userId) return;
    if (asset.workspaceId) {
      try {
        await this.workspacePermissions.requireWorkspaceRole(
          userId,
          asset.workspaceId,
          WorkspaceMemberRole.viewer,
        );
        return;
      } catch (err) {
        // Not a workspace member — fall through to the character-cast grant
        // (a project-only member never holds a workspace role).
        if (!(err instanceof ForbiddenException)) throw err;
      }
    }
    // Only explicit canvas-save references extend consumption to Crew members.
    if (await this.crewAssetAccess.canReadStudioReference(userId, asset.id))
      return;
    if (await this.hasCharacterReferenceAccess(userId, asset.id)) return;
    if (await this.hasStoryReferenceAccess(userId, asset.id)) return;
    throw new ForbiddenException({
      code: 'MEDIA_ASSET_ACCESS_DENIED',
      message: 'You do not have access to this media asset.',
    });
  }

  /**
   * Reference-reaches-context rule, two audiences per character grant:
   *  - CAST: a media asset attached to a character (CharacterMedia) that is
   *    CAST into a project is viewable by everyone who can see that
   *    project's context — including project-only members (ProjectMember)
   *    who hold no workspace role. The cast row is the explicit, audited
   *    act that extends the asset's audience to the project.
   *  - LIBRARY: an asset attached to a character belongs to the character's
   *    home-workspace 演员池, so every active WorkspaceMember of that
   *    workspace may render it — even when the underlying MediaAsset row
   *    carries no workspaceId (personal uploads enrolled into the library).
   * One indexed CharacterMedia query covers both branches. Narrowly scoped
   * to this exact join on purpose — this is NOT a generic ACL.
   */
  private async hasCharacterReferenceAccess(
    userId: string,
    assetId: string,
  ): Promise<boolean> {
    const grant = await this.prisma.characterMedia.findFirst({
      where: {
        mediaAssetId: assetId,
        status: CharacterMediaStatus.active,
        character: {
          deletedAt: null,
          status: { not: CharacterStatus.revoked },
          OR: [
            {
              castRows: {
                some: {
                  project: {
                    status: PlatformProjectStatus.active,
                    deletedAt: null,
                    members: {
                      some: {
                        userId,
                        status: ProjectMemberStatus.active,
                        removedAt: null,
                      },
                    },
                  },
                },
              },
            },
            {
              workspace: {
                members: {
                  some: {
                    userId,
                    status: WorkspaceMemberStatus.active,
                    removedAt: null,
                  },
                },
              },
            },
          ],
        },
      },
      select: { id: true },
    });
    return grant !== null;
  }

  private async loadAsset(assetId: string): Promise<MediaAccessAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      include: MEDIA_ACCESS_ASSET_INCLUDE,
    });
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'Media asset not found.',
      });
    }
    return asset;
  }

  private async issueStorageUrl(
    asset: MediaAccessAsset,
    query: MediaAssetAccessQueryDto,
    options: {
      allowInactivePlacements: boolean;
      cacheControl: string;
      expiresInSeconds: number;
    },
  ): Promise<MediaAssetAccessResponseDto> {
    const source = selectReadSource(asset, query, {
      allowInactivePlacements: options.allowInactivePlacements,
    });
    if (!source) {
      throw new NotFoundException({
        code: 'MEDIA_VARIANT_NOT_FOUND',
        message: 'Media asset object is not available.',
      });
    }
    const signed = await this.storageAccess.createReadUrl(source, {
      cacheControl: options.cacheControl,
      expiresInSeconds: options.expiresInSeconds,
    });
    return {
      assetId: asset.id,
      variantKey: query.variantKey,
      ...(query.placementId ? { placementId: query.placementId } : {}),
      url: signed.url,
      expiresAt: signed.expiresAt,
    };
  }
}

/** Expense evidence is readable only through its claim/revision authorization. */
function requireNonReceiptAsset(metadata: Prisma.JsonValue): void {
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    metadata.uploadKind === 'crew_expense_receipt'
  ) {
    throw new ForbiddenException({
      code: 'EXPENSE_RECEIPT_ACCESS_REQUIRED',
      message: 'Open this receipt through its expense claim.',
    });
  }
}

function crewAssetCrewId(metadata: Prisma.JsonValue): string | null {
  if (
    metadata !== null &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    typeof metadata.crewId === 'string' &&
    (metadata.uploadKind === 'crew_asset_file' ||
      metadata.uploadKind === 'crew_agreement_archive')
  ) {
    return metadata.crewId;
  }
  return null;
}

function selectReadSource(
  asset: MediaAccessAsset,
  query: MediaAssetAccessQueryDto,
  options: { allowInactivePlacements: boolean },
) {
  if (query.placementId) {
    const placementSource = selectPlacementReadSource(
      asset,
      query.placementId,
      options,
    );
    if (placementSource) return placementSource;
  }
  return selectVariantReadSource(asset, query.variantKey, options);
}

function selectPlacementReadSource(
  asset: MediaAccessAsset,
  placementId: string,
  options: { allowInactivePlacements: boolean },
) {
  const assetPlacement = asset.placements.find(
    (placement) =>
      placement.id === placementId &&
      isReadablePlacementStatus(
        placement.status,
        options.allowInactivePlacements,
      ) &&
      !placement.deletedAt,
  );
  if (assetPlacement) {
    return {
      storageProvider: assetPlacement.storageProvider,
      bucket: assetPlacement.bucket,
      region: assetPlacement.region,
      objectKey: assetPlacement.objectKey,
      externalUrl: assetPlacement.externalUrl,
      contentType: asset.contentType,
    };
  }

  for (const variant of asset.variants) {
    if (
      variant.status === MediaAssetStatus.deleted ||
      (!options.allowInactivePlacements && variant.status === 'blocked') ||
      variant.deletedAt
    ) {
      continue;
    }
    const placement = variant.placements.find(
      (candidate) =>
        candidate.id === placementId &&
        isReadablePlacementStatus(
          candidate.status,
          options.allowInactivePlacements,
        ) &&
        !candidate.deletedAt,
    );
    if (!placement) continue;
    return {
      storageProvider: placement.storageProvider,
      bucket: placement.bucket,
      region: placement.region,
      objectKey: placement.objectKey,
      externalUrl: placement.externalUrl,
      contentType: variant.contentType ?? asset.contentType,
    };
  }

  return null;
}

function selectVariantReadSource(
  asset: MediaAccessAsset,
  variantKey: string,
  options: { allowInactivePlacements: boolean },
) {
  const variant = asset.variants.find(
    (candidate) =>
      candidate.variantKey === variantKey &&
      candidate.status !== 'deleted' &&
      (options.allowInactivePlacements || candidate.status !== 'blocked') &&
      !candidate.deletedAt,
  );
  const variantPlacement = pickPlacement(
    variant?.placements,
    options.allowInactivePlacements,
  );
  if (variantPlacement) {
    return {
      storageProvider: variantPlacement.storageProvider,
      bucket: variantPlacement.bucket,
      region: variantPlacement.region,
      objectKey: variantPlacement.objectKey,
      externalUrl: variantPlacement.externalUrl,
      contentType: variant?.contentType ?? asset.contentType,
    };
  }

  const assetPlacement = pickPlacement(
    asset.placements,
    options.allowInactivePlacements,
  );
  if (assetPlacement) {
    return {
      storageProvider: assetPlacement.storageProvider,
      bucket: assetPlacement.bucket,
      region: assetPlacement.region,
      objectKey: assetPlacement.objectKey,
      externalUrl: assetPlacement.externalUrl,
      contentType: asset.contentType,
    };
  }

  if (variantKey !== 'original') return null;
  return {
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    contentType: asset.contentType,
  };
}

function pickPlacement<T extends { status: string; deletedAt: Date | null }>(
  placements: T[] | undefined,
  allowInactive: boolean,
): T | null {
  const readable = (placements ?? [])
    .filter(
      (placement) =>
        !placement.deletedAt &&
        isReadablePlacementStatus(placement.status, allowInactive),
    )
    .sort(
      (a, b) =>
        placementStatusRank(a.status) - placementStatusRank(b.status) ||
        placementPriority(a) - placementPriority(b),
    );
  return readable[0] ?? null;
}

function isReadablePlacementStatus(
  status: string,
  allowInactive: boolean,
): boolean {
  if (status === MediaObjectPlacementStatus.active) return true;
  if (!allowInactive) return false;
  return (
    status === MediaObjectPlacementStatus.purging ||
    status === MediaObjectPlacementStatus.purged
  );
}

function placementStatusRank(status: string): number {
  if (status === MediaObjectPlacementStatus.active) return 0;
  if (status === MediaObjectPlacementStatus.purging) return 10;
  if (status === MediaObjectPlacementStatus.purged) return 20;
  return 100;
}

function placementPriority(value: object): number {
  return 'priority' in value && typeof value.priority === 'number'
    ? value.priority
    : 100;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

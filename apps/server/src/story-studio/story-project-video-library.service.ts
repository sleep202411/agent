import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import {
  StoryUuidSchema,
  type CursorPageDto,
  type MediaAssetSummaryDto,
  type StoryProjectVideoLibraryItemDto,
  type StoryProjectVideoLibraryQuery,
} from './dto';
import { StoryPermissionService } from './story-permission.service';

const ORIGINAL_VARIANT_WHERE = {
  variantKey: 'original',
  kind: MediaAssetVariantKind.original,
  status: MediaAssetVariantStatus.ready,
  deletedAt: null,
  checksumSha256: { not: null },
} satisfies Prisma.MediaAssetVariantWhereInput;

const VIDEO_LIBRARY_ASSET_INCLUDE = {
  variants: {
    where: ORIGINAL_VARIANT_WHERE,
    take: 1,
    include: {
      placements: {
        where: {
          role: 'primary',
          status: 'active',
          deletedAt: null,
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
} satisfies Prisma.MediaAssetInclude;

type VideoLibraryAssetRow = Prisma.MediaAssetGetPayload<{
  include: typeof VIDEO_LIBRARY_ASSET_INCLUDE;
}>;

interface VideoLibraryCursor {
  version: 1;
  createdAt: string;
  id: string;
}

@Injectable()
export class StoryProjectVideoLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
  ) {}

  async list(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    query: StoryProjectVideoLibraryQuery,
  ): Promise<CursorPageDto<StoryProjectVideoLibraryItemDto>> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
      { allowArchived: true },
    );
    if (access.project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }

    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.prisma.mediaAsset.findMany({
      where: {
        workspaceId,
        kind: MediaAssetKind.video,
        status: MediaAssetStatus.ready,
        deletedAt: null,
        moderationStatus: { not: MediaAssetModerationStatus.blocked },
        variants: { some: ORIGINAL_VARIANT_WHERE },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: VIDEO_LIBRARY_ASSET_INCLUDE,
    });

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(toVideoLibraryItem),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              version: 1,
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }
}

function toVideoLibraryItem(
  row: VideoLibraryAssetRow,
): StoryProjectVideoLibraryItemDto {
  const variant = row.variants[0];
  if (!variant?.checksumSha256) {
    throw new InternalServerErrorException({
      code: 'STORY_VIDEO_LIBRARY_ASSET_INVALID',
      message: 'A reusable video is missing its ready original variant.',
    });
  }
  return {
    asset: toMediaAsset(row, variant),
    variantId: variant.id,
    variantKey: variant.variantKey,
    contentType: variant.contentType,
    width: variant.width,
    height: variant.height,
    durationSeconds: variant.durationSeconds,
    checksumSha256: variant.checksumSha256,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMediaAsset(
  row: VideoLibraryAssetRow,
  originalVariant: VideoLibraryAssetRow['variants'][number],
): MediaAssetSummaryDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    moderationStatus: row.moderationStatus,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    checksumSha256: row.checksumSha256,
    // MediaAsset.placements contains placements for every rendition. Supplying
    // only the selected original variant's placements prevents an HLS
    // placement from winning by priority while preserving the resolver's
    // moderation/status gate and durable-asset fallback.
    previewUrl: resolveMediaPublicUrl({
      ...row,
      placements: originalVariant.placements,
    }),
  };
}

function encodeCursor(cursor: VideoLibraryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): VideoLibraryCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
    if (isVideoLibraryCursor(parsed)) return parsed;
  } catch {
    // The public error deliberately does not expose cursor internals.
  }
  throw new BadRequestException({
    code: 'STORY_VIDEO_LIBRARY_CURSOR_INVALID',
    message: 'The video library pagination cursor is invalid or expired.',
  });
}

function isVideoLibraryCursor(value: unknown): value is VideoLibraryCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.id !== 'string' ||
    !StoryUuidSchema.safeParse(candidate.id).success
  ) {
    return false;
  }
  const date = new Date(candidate.createdAt);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === candidate.createdAt
  );
}

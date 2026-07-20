import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAssetStatus,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  Prisma,
  StoryVideoUploadStatus,
  type StoryVideoUploadSession,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import {
  type CompleteStoryProjectVideoUpload,
  type MediaAssetSummaryDto,
  type StoryProjectVideoLibraryItemDto,
  type StoryProjectVideoUploadFinalizeDto,
} from './dto';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

const ORIGINAL_VARIANT_BASE_WHERE = {
  variantKey: 'original',
  kind: MediaAssetVariantKind.original,
  deletedAt: null,
} satisfies Prisma.MediaAssetVariantWhereInput;

const ORIGINAL_VARIANT_WHERE = {
  ...ORIGINAL_VARIANT_BASE_WHERE,
  status: MediaAssetVariantStatus.ready,
  checksumSha256: { not: null },
} satisfies Prisma.MediaAssetVariantWhereInput;

const ORIGINAL_VARIANT_PLACEMENTS_INCLUDE = {
  placements: {
    where: {
      role: 'primary',
      status: 'active',
      deletedAt: null,
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.MediaAssetVariantInclude;

const VIDEO_LIBRARY_ASSET_INCLUDE = {
  variants: {
    where: ORIGINAL_VARIANT_WHERE,
    take: 1,
    include: ORIGINAL_VARIANT_PLACEMENTS_INCLUDE,
  },
} satisfies Prisma.MediaAssetInclude;

type VideoLibraryAssetRow = Prisma.MediaAssetGetPayload<{
  include: typeof VIDEO_LIBRARY_ASSET_INCLUDE;
}>;

@Injectable()
export class StoryProjectVideoLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async completeUpload(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: CompleteStoryProjectVideoUpload,
  ): Promise<StoryProjectVideoUploadFinalizeDto> {
    let session = await this.requireUploadSession(
      user,
      workspaceId,
      projectId,
      input.mediaAssetId,
    );
    session = await this.expireIfNeeded(session, projectId);
    if (session.status === StoryVideoUploadStatus.issued) {
      throw new ConflictException({
        code: 'STORY_VIDEO_UPLOAD_NOT_CONFIRMED',
        message: 'Confirm the uploaded object before starting finalization.',
      });
    }
    if (session.status === StoryVideoUploadStatus.confirmed) {
      session = await this.prisma.$transaction(async (tx) => {
        await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
        await tx.storyVideoUploadSession.updateMany({
          where: {
            id: session.id,
            storyProjectId: projectId,
            status: StoryVideoUploadStatus.confirmed,
          },
          data: {
            status: StoryVideoUploadStatus.queued,
            queuedAt: new Date(),
            nextAttemptAt: new Date(),
            reclaimAfter: null,
            errorCode: null,
            errorDetail: null,
          },
        });
        return tx.storyVideoUploadSession.findUniqueOrThrow({
          where: { id: session.id },
        });
      });
    }
    return this.toFinalizeDto(session);
  }

  async getUploadFinalize(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    mediaAssetId: string,
  ): Promise<StoryProjectVideoUploadFinalizeDto> {
    const session = effectiveUploadSessionForRead(
      await this.requireUploadSession(
        user,
        workspaceId,
        projectId,
        mediaAssetId,
        'story.read',
      ),
    );
    if (
      session.status === StoryVideoUploadStatus.issued ||
      session.status === StoryVideoUploadStatus.confirmed
    ) {
      throw new ConflictException({
        code: 'STORY_VIDEO_FINALIZE_NOT_STARTED',
        message: 'Video finalization has not started.',
      });
    }
    return this.toFinalizeDto(session);
  }

  async cancelUploadFinalize(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    mediaAssetId: string,
  ): Promise<StoryProjectVideoUploadFinalizeDto> {
    let session = await this.requireUploadSession(
      user,
      workspaceId,
      projectId,
      mediaAssetId,
    );
    if (session.status === StoryVideoUploadStatus.processing) {
      throw new ConflictException({
        code: 'STORY_VIDEO_FINALIZE_ALREADY_PROCESSING',
        message:
          'The video is already being finalized and cannot be cancelled.',
      });
    }
    if (
      session.status === StoryVideoUploadStatus.issued ||
      session.status === StoryVideoUploadStatus.confirmed ||
      session.status === StoryVideoUploadStatus.queued
    ) {
      const now = new Date();
      session = await this.prisma.$transaction(async (tx) => {
        await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
        const changed = await tx.storyVideoUploadSession.updateMany({
          where: {
            id: session.id,
            status: {
              in: [
                StoryVideoUploadStatus.issued,
                StoryVideoUploadStatus.confirmed,
                StoryVideoUploadStatus.queued,
              ],
            },
          },
          data: {
            status: StoryVideoUploadStatus.cancelled,
            cancelledAt: now,
            nextAttemptAt: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            reclaimAfter: stagingReclaimAfter(session.expiresAt, now),
            finalReclaimAfter: session.finalObjectKey ? now : null,
            errorCode: 'STORY_VIDEO_UPLOAD_CANCELLED',
            errorDetail: 'The Story video upload was cancelled.',
          },
        });
        if (changed.count > 0) {
          await tx.mediaAsset.updateMany({
            where: {
              id: session.mediaAssetId,
              status: MediaAssetStatus.uploading,
            },
            data: { status: MediaAssetStatus.failed },
          });
        }
        return tx.storyVideoUploadSession.findUniqueOrThrow({
          where: { id: session.id },
        });
      });
      if (session.status === StoryVideoUploadStatus.processing) {
        throw new ConflictException({
          code: 'STORY_VIDEO_FINALIZE_ALREADY_PROCESSING',
          message:
            'The video is already being finalized and cannot be cancelled.',
        });
      }
    }
    return this.toFinalizeDto(session);
  }

  private async requireUploadSession(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    mediaAssetId: string,
    capability: 'story.read' | 'story.generate' = 'story.generate',
  ) {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
    );
    if (access.project.workspaceId !== workspaceId) throw projectNotFound();
    const session = await this.prisma.storyVideoUploadSession.findUnique({
      where: { mediaAssetId },
    });
    if (
      !session ||
      session.storyProjectId !== projectId ||
      session.workspaceId !== workspaceId ||
      session.createdByUserId !== user.userId
    ) {
      throw uploadNotFound();
    }
    return session;
  }

  private async expireIfNeeded(
    session: StoryVideoUploadSession,
    projectId: string,
  ): Promise<StoryVideoUploadSession> {
    if (
      session.expiresAt > new Date() ||
      (session.status !== StoryVideoUploadStatus.issued &&
        session.status !== StoryVideoUploadStatus.confirmed)
    ) {
      return session;
    }
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      const changed = await tx.storyVideoUploadSession.updateMany({
        where: {
          id: session.id,
          status: {
            in: [
              StoryVideoUploadStatus.issued,
              StoryVideoUploadStatus.confirmed,
            ],
          },
          expiresAt: { lte: now },
        },
        data: {
          status: StoryVideoUploadStatus.expired,
          reclaimAfter: stagingReclaimAfter(session.expiresAt, now),
          errorCode: 'STORY_VIDEO_UPLOAD_EXPIRED',
          errorDetail: 'The upload URL expired before finalization.',
        },
      });
      if (changed.count > 0) {
        await tx.mediaAsset.updateMany({
          where: {
            id: session.mediaAssetId,
            status: MediaAssetStatus.uploading,
          },
          data: { status: MediaAssetStatus.failed },
        });
      }
      return tx.storyVideoUploadSession.findUniqueOrThrow({
        where: { id: session.id },
      });
    });
  }

  private async toFinalizeDto(session: {
    mediaAssetId: string;
    status: StoryVideoUploadStatus;
    errorCode: string | null;
    errorDetail: string | null;
  }): Promise<StoryProjectVideoUploadFinalizeDto> {
    if (session.status === StoryVideoUploadStatus.ready) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          id: session.mediaAssetId,
          status: MediaAssetStatus.ready,
          deletedAt: null,
        },
        include: VIDEO_LIBRARY_ASSET_INCLUDE,
      });
      if (!asset) {
        throw new InternalServerErrorException({
          code: 'STORY_VIDEO_FINALIZE_RESULT_MISSING',
          message: 'The finalized video asset is missing.',
        });
      }
      return {
        mediaAssetId: session.mediaAssetId,
        status: 'ready',
        pollAfterMs: null,
        item: toVideoLibraryItem(asset),
        error: null,
      };
    }
    if (
      session.status === StoryVideoUploadStatus.queued ||
      session.status === StoryVideoUploadStatus.processing
    ) {
      return {
        mediaAssetId: session.mediaAssetId,
        status: session.status,
        pollAfterMs: 1500,
        item: null,
        error: null,
      };
    }
    if (
      session.status === StoryVideoUploadStatus.failed ||
      session.status === StoryVideoUploadStatus.expired ||
      session.status === StoryVideoUploadStatus.cancelled
    ) {
      return {
        mediaAssetId: session.mediaAssetId,
        status: session.status,
        pollAfterMs: null,
        item: null,
        error: {
          code: session.errorCode ?? terminalDefaultError(session.status).code,
          message:
            session.errorDetail ?? terminalDefaultError(session.status).message,
        },
      };
    }
    throw new ConflictException({
      code: 'STORY_VIDEO_FINALIZE_NOT_STARTED',
      message: 'Video finalization has not started.',
    });
  }
}

/** Keep polling read-only; lifecycle persistence belongs to write commands/workers. */
function effectiveUploadSessionForRead(
  session: StoryVideoUploadSession,
): StoryVideoUploadSession {
  if (
    session.expiresAt > new Date() ||
    (session.status !== StoryVideoUploadStatus.issued &&
      session.status !== StoryVideoUploadStatus.confirmed)
  ) {
    return session;
  }
  return {
    ...session,
    status: StoryVideoUploadStatus.expired,
    errorCode: 'STORY_VIDEO_UPLOAD_EXPIRED',
    errorDetail: 'The upload URL expired before finalization.',
  };
}

function projectNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_PROJECT_NOT_FOUND',
    message: 'Story project not found.',
  });
}

function uploadNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_VIDEO_UPLOAD_NOT_FOUND',
    message: 'The uploaded video could not be found.',
  });
}

const STAGING_SIGNATURE_GRACE_MS = 5 * 60_000;

function stagingReclaimAfter(expiresAt: Date, now: Date): Date {
  return new Date(
    Math.max(now.getTime(), expiresAt.getTime() + STAGING_SIGNATURE_GRACE_MS),
  );
}

function terminalDefaultError(status: 'failed' | 'expired' | 'cancelled'): {
  code: string;
  message: string;
} {
  switch (status) {
    case 'expired':
      return {
        code: 'STORY_VIDEO_UPLOAD_EXPIRED',
        message: 'The Story video upload expired.',
      };
    case 'cancelled':
      return {
        code: 'STORY_VIDEO_UPLOAD_CANCELLED',
        message: 'The Story video upload was cancelled.',
      };
    case 'failed':
      return {
        code: 'STORY_VIDEO_FINALIZE_FAILED',
        message: 'The Story video could not be finalized.',
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

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
  Prisma,
  StoryVideoUploadStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CURRENT_CELL } from '../common/region/current-cell';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import { OutputStorageService } from '../infra/storage/storage.types';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../story-studio/story-project-write-guard.service';
import type {
  ConfirmUploadInputDto,
  ConfirmUploadResponseDto,
  CreateUploadUrlInputDto,
  CreateUploadUrlResponseDto,
} from './dto';
import {
  STORY_CLIP_VIDEO_CONTENT_TYPE,
  STORY_CLIP_VIDEO_MAX_BYTES,
} from './media-upload.policy';

const UUID = z.string().uuid();
const STORY_VIDEO_CONTENT_TYPES: Record<string, string> = {
  [STORY_CLIP_VIDEO_CONTENT_TYPE]: 'mp4',
};
const DEFAULT_MAX_ACTIVE_SESSIONS = 4;
const DEFAULT_MAX_RESERVED_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_FINALIZE_ATTEMPTS = 10;
const STAGING_SIGNATURE_GRACE_MS = 5 * 60_000;

const PROVIDER_TO_PRISMA: Record<string, MediaStorageProvider> = {
  azure_blob: MediaStorageProvider.azure_blob,
  aliyun_oss: MediaStorageProvider.aliyun_oss,
  s3_compatible: MediaStorageProvider.s3_compatible,
};

@Injectable()
export class StoryVideoUploadSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly outputStorage: OutputStorageService,
    private readonly storageAccess: MediaStorageAccessService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async issue(
    userId: string,
    workspaceId: string | undefined,
    input: CreateUploadUrlInputDto,
  ): Promise<CreateUploadUrlResponseDto> {
    const normalizedWorkspaceId = requireUuid(
      workspaceId,
      'WORKSPACE_HEADER_REQUIRED',
      'WORKSPACE_HEADER_INVALID',
      'x-fizz-workspace-id',
    );
    const projectId = requireUuid(
      typeof input.scope?.projectId === 'string'
        ? input.scope.projectId
        : undefined,
      'STORY_VIDEO_PROJECT_SCOPE_REQUIRED',
      'STORY_VIDEO_PROJECT_SCOPE_INVALID',
      'scope.projectId',
    );
    const access = await this.permissions.requireProject(
      userId,
      projectId,
      'story.generate',
    );
    if (access.project.workspaceId !== normalizedWorkspaceId) {
      throw projectNotFound();
    }

    const contentType = input.contentType.toLowerCase();
    const extension = STORY_VIDEO_CONTENT_TYPES[contentType];
    if (!extension) {
      throw new BadRequestException({
        code: 'MEDIA_CONTENT_TYPE_NOT_ALLOWED',
        message: `content-type "${input.contentType}" is not allowed for story_clip_video`,
      });
    }
    if (input.sizeBytes > STORY_CLIP_VIDEO_MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'MEDIA_FILE_TOO_LARGE',
        message: `file too large for story_clip_video (max ${STORY_CLIP_VIDEO_MAX_BYTES} bytes)`,
      });
    }

    const sessionId = randomUUID();
    const mediaAssetId = randomUUID();
    const stagingObjectKey = `media/${CURRENT_CELL}/story-clip-staging/${normalizedWorkspaceId}/${sessionId}.${extension}`;
    const signed = await this.outputStorage.createUploadUrl({
      storageKey: stagingObjectKey,
      contentType,
      maxBytes: STORY_CLIP_VIDEO_MAX_BYTES,
      expiresInSeconds: 3600,
    });
    const provider = PROVIDER_TO_PRISMA[signed.provider];
    if (!provider) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_PROVIDER_UNMAPPED',
        message: `storage provider "${signed.provider}" has no MediaAsset mapping`,
      });
    }
    const expiresAt = new Date(signed.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_INVALID_EXPIRY',
        message: 'media storage returned an invalid upload URL expiry',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-video-upload-quota:${normalizedWorkspaceId}:${userId}`})::bigint
        )
      `;
      const now = new Date();
      // Expiring abandoned reservations is system lifecycle cleanup. It may
      // span the user's Workspace projects and is intentionally independent
      // of the new human reservation fenced above.
      const expired = await tx.storyVideoUploadSession.findMany({
        where: {
          createdByUserId: userId,
          workspaceId: normalizedWorkspaceId,
          status: {
            in: [
              StoryVideoUploadStatus.issued,
              StoryVideoUploadStatus.confirmed,
            ],
          },
          expiresAt: { lte: now },
        },
        select: { id: true, mediaAssetId: true },
      });
      if (expired.length > 0) {
        for (const row of expired) {
          const changed = await tx.storyVideoUploadSession.updateMany({
            where: {
              id: row.id,
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
              reclaimAfter: new Date(
                now.getTime() + STAGING_SIGNATURE_GRACE_MS,
              ),
              errorCode: 'STORY_VIDEO_UPLOAD_EXPIRED',
              errorDetail: 'The upload URL expired before finalization.',
              leaseOwner: null,
              leaseAcquiredAt: null,
              leaseExpiresAt: null,
            },
          });
          if (changed.count > 0) {
            await tx.mediaAsset.updateMany({
              where: {
                id: row.mediaAssetId,
                status: MediaAssetStatus.uploading,
              },
              data: { status: MediaAssetStatus.failed },
            });
          }
        }
      }

      const activeCount = await tx.storyVideoUploadSession.count({
        where: {
          createdByUserId: userId,
          workspaceId: normalizedWorkspaceId,
          OR: activeReservationWhere(now),
        },
      });
      const maxActive = positiveIntEnv(
        'STORY_VIDEO_UPLOAD_MAX_ACTIVE_SESSIONS_PER_USER',
        DEFAULT_MAX_ACTIVE_SESSIONS,
      );
      if (activeCount >= maxActive) {
        throw new ConflictException({
          code: 'STORY_VIDEO_UPLOAD_CONCURRENCY_QUOTA_EXCEEDED',
          message: `At most ${maxActive} Story video uploads may be active at once.`,
        });
      }

      const reserved = await tx.storyVideoUploadSession.aggregate({
        where: {
          createdByUserId: userId,
          workspaceId: normalizedWorkspaceId,
          OR: activeReservationWhere(now),
        },
        _sum: { declaredSizeBytes: true },
      });
      const maxReservedBytes = positiveIntEnv(
        'STORY_VIDEO_UPLOAD_MAX_RESERVED_BYTES_PER_USER',
        DEFAULT_MAX_RESERVED_BYTES,
      );
      if (
        (reserved._sum.declaredSizeBytes ?? 0n) + BigInt(input.sizeBytes) >
        BigInt(maxReservedBytes)
      ) {
        throw new PayloadTooLargeException({
          code: 'STORY_VIDEO_UPLOAD_RESERVED_BYTES_QUOTA_EXCEEDED',
          message: `Active Story video uploads may reserve at most ${maxReservedBytes} bytes.`,
        });
      }

      await tx.mediaAsset.create({
        data: {
          id: mediaAssetId,
          kind: MediaAssetKind.video,
          storageProvider: provider,
          workspaceId: normalizedWorkspaceId,
          bucket: signed.bucket,
          region: signed.region,
          objectKey: stagingObjectKey,
          contentType,
          sizeBytes: BigInt(input.sizeBytes),
          visibility: MediaAssetVisibility.private,
          status: MediaAssetStatus.uploading,
          source: MediaAssetSource.user_upload,
          createdByUserId: userId,
          metadata: {
            uploadKind: 'story_clip_video',
            uploadSessionId: sessionId,
            storyProjectId: projectId,
            storagePhase: 'staging',
          },
        },
      });
      await tx.storyVideoUploadSession.create({
        data: {
          id: sessionId,
          storyProjectId: projectId,
          workspaceId: normalizedWorkspaceId,
          mediaAssetId,
          createdByUserId: userId,
          storageProvider: provider,
          bucket: signed.bucket,
          region: signed.region,
          stagingObjectKey,
          contentType,
          declaredSizeBytes: BigInt(input.sizeBytes),
          expiresAt,
          reclaimAfter: new Date(
            expiresAt.getTime() + STAGING_SIGNATURE_GRACE_MS,
          ),
          maxAttempts: positiveIntEnv(
            'STORY_VIDEO_UPLOAD_MAX_FINALIZE_ATTEMPTS',
            DEFAULT_MAX_FINALIZE_ATTEMPTS,
          ),
        },
      });
    });

    return {
      uploadUrl: signed.url,
      method: signed.method,
      headers: signed.headers,
      storageKey: stagingObjectKey,
      provider: signed.provider,
      expiresAt: signed.expiresAt,
      uploadSessionId: sessionId,
      mediaAssetId,
    };
  }

  async confirm(
    userId: string,
    workspaceId: string | undefined,
    input: ConfirmUploadInputDto,
  ): Promise<ConfirmUploadResponseDto> {
    const normalizedWorkspaceId = requireUuid(
      workspaceId,
      'WORKSPACE_HEADER_REQUIRED',
      'WORKSPACE_HEADER_INVALID',
      'x-fizz-workspace-id',
    );
    const uploadSessionId = requireUuid(
      input.uploadSessionId,
      'STORY_VIDEO_UPLOAD_SESSION_REQUIRED',
      'STORY_VIDEO_UPLOAD_SESSION_INVALID',
      'uploadSessionId',
    );
    const session = await this.prisma.storyVideoUploadSession.findFirst({
      where: {
        id: uploadSessionId,
        createdByUserId: userId,
        workspaceId: normalizedWorkspaceId,
      },
      include: { mediaAsset: true },
    });
    if (!session) throw uploadSessionNotFound();
    const access = await this.permissions.requireProject(
      userId,
      session.storyProjectId,
      'story.generate',
    );
    if (access.project.workspaceId !== normalizedWorkspaceId) {
      throw projectNotFound();
    }
    if (session.stagingObjectKey !== input.storageKey) {
      throw new ForbiddenException({
        code: 'STORY_VIDEO_UPLOAD_STORAGE_KEY_MISMATCH',
        message: 'storageKey does not belong to this upload session.',
      });
    }
    if (session.status !== StoryVideoUploadStatus.issued) {
      return this.confirmedResponse(session);
    }
    if (session.expiresAt <= new Date()) {
      await this.expireSession(
        session.id,
        session.mediaAssetId,
        session.expiresAt,
        session.storyProjectId,
      );
      throw new ConflictException({
        code: 'STORY_VIDEO_UPLOAD_EXPIRED',
        message: 'The upload URL expired before confirmation.',
      });
    }

    const head = await this.storageAccess.headObject({
      storageProvider: session.storageProvider,
      bucket: session.bucket,
      region: session.region,
      objectKey: session.stagingObjectKey,
      externalUrl: null,
      contentType: session.contentType,
    });
    if (!head.exists) {
      throw new NotFoundException({
        code: 'MEDIA_OBJECT_NOT_FOUND',
        message: 'no uploaded object exists at storageKey',
      });
    }
    const actualSize = head.sizeBytes;
    if (
      actualSize === undefined ||
      !Number.isSafeInteger(actualSize) ||
      actualSize <= 0 ||
      actualSize > STORY_CLIP_VIDEO_MAX_BYTES
    ) {
      throw new PayloadTooLargeException({
        code: 'STORY_VIDEO_UPLOAD_SIZE_INVALID',
        message: `The uploaded video must be between 1 and ${STORY_CLIP_VIDEO_MAX_BYTES} bytes.`,
      });
    }
    if (BigInt(actualSize) !== session.declaredSizeBytes) {
      throw new UnprocessableEntityException({
        code: 'STORY_VIDEO_UPLOAD_SIZE_MISMATCH',
        message: `The stored video size differs from the declared upload size (${session.declaredSizeBytes.toString()} expected, ${actualSize} received).`,
      });
    }
    const actualContentType = head.contentType?.toLowerCase();
    if (
      !actualContentType ||
      !STORY_VIDEO_CONTENT_TYPES[actualContentType] ||
      actualContentType !== session.contentType.toLowerCase()
    ) {
      throw new UnprocessableEntityException({
        code: 'STORY_VIDEO_UPLOAD_CONTENT_TYPE_MISMATCH',
        message:
          'The stored object content type does not match the upload session.',
      });
    }

    const confirmed = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, session.storyProjectId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-video-upload-session:${session.id}`})::bigint
        )
      `;
      const locked = await tx.storyVideoUploadSession.findUnique({
        where: { id: session.id },
        include: { mediaAsset: true },
      });
      if (!locked || locked.createdByUserId !== userId) {
        throw uploadSessionNotFound();
      }
      if (locked.status !== StoryVideoUploadStatus.issued) return locked;
      if (locked.expiresAt <= new Date()) {
        const now = new Date();
        const expiredSession = await tx.storyVideoUploadSession.update({
          where: { id: locked.id },
          data: {
            status: StoryVideoUploadStatus.expired,
            reclaimAfter: new Date(
              Math.max(
                now.getTime(),
                locked.expiresAt.getTime() + STAGING_SIGNATURE_GRACE_MS,
              ),
            ),
            errorCode: 'STORY_VIDEO_UPLOAD_EXPIRED',
            errorDetail: 'The upload URL expired before confirmation.',
          },
          include: { mediaAsset: true },
        });
        await tx.mediaAsset.update({
          where: { id: locked.mediaAssetId },
          data: { status: MediaAssetStatus.failed },
        });
        return expiredSession;
      }
      await tx.mediaAsset.update({
        where: { id: locked.mediaAssetId },
        data: {
          sizeBytes: BigInt(actualSize),
          contentType: actualContentType,
        },
      });
      return tx.storyVideoUploadSession.update({
        where: { id: locked.id },
        data: {
          status: StoryVideoUploadStatus.confirmed,
          actualSizeBytes: BigInt(actualSize),
          contentType: actualContentType,
          confirmedAt: new Date(),
          errorCode: null,
          errorDetail: null,
        },
        include: { mediaAsset: true },
      });
    });
    return this.confirmedResponse(confirmed);
  }

  private confirmedResponse(session: {
    id: string;
    mediaAssetId: string;
    stagingObjectKey: string;
    finalObjectKey: string | null;
    storageProvider: MediaStorageProvider;
    status: StoryVideoUploadStatus;
  }): ConfirmUploadResponseDto {
    if (session.status === StoryVideoUploadStatus.expired) {
      throw new ConflictException({
        code: 'STORY_VIDEO_UPLOAD_EXPIRED',
        message: 'The upload session has expired.',
      });
    }
    if (
      session.status === StoryVideoUploadStatus.failed ||
      session.status === StoryVideoUploadStatus.cancelled
    ) {
      throw new ConflictException({
        code: 'STORY_VIDEO_UPLOAD_NOT_CONFIRMABLE',
        message: `The upload session is ${session.status}.`,
      });
    }
    return {
      mediaAssetId: session.mediaAssetId,
      variantId: null,
      uploadSessionId: session.id,
      storageKey: session.finalObjectKey ?? session.stagingObjectKey,
      provider: prismaProviderToId(session.storageProvider),
      url: null,
    };
  }

  private async expireSession(
    sessionId: string,
    mediaAssetId: string,
    expiresAt: Date,
    projectId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-video-upload-session:${sessionId}`})::bigint
        )
      `;
      const session = await tx.storyVideoUploadSession.findUnique({
        where: { id: sessionId },
        select: { status: true, mediaAssetId: true },
      });
      if (
        !session ||
        session.status !== StoryVideoUploadStatus.issued ||
        session.mediaAssetId !== mediaAssetId
      ) {
        return;
      }
      await tx.storyVideoUploadSession.update({
        where: { id: sessionId },
        data: {
          status: StoryVideoUploadStatus.expired,
          reclaimAfter: new Date(
            Math.max(
              now.getTime(),
              expiresAt.getTime() + STAGING_SIGNATURE_GRACE_MS,
            ),
          ),
          errorCode: 'STORY_VIDEO_UPLOAD_EXPIRED',
          errorDetail: 'The upload URL expired before confirmation.',
        },
      });
      await tx.mediaAsset.updateMany({
        where: { id: mediaAssetId, status: MediaAssetStatus.uploading },
        data: { status: MediaAssetStatus.failed },
      });
    });
  }
}

function activeReservationWhere(
  now: Date,
): Prisma.StoryVideoUploadSessionWhereInput[] {
  return [
    {
      status: {
        in: [StoryVideoUploadStatus.queued, StoryVideoUploadStatus.processing],
      },
    },
    {
      status: {
        in: [StoryVideoUploadStatus.issued, StoryVideoUploadStatus.confirmed],
      },
      expiresAt: { gt: now },
    },
  ];
}

function requireUuid(
  value: string | undefined,
  missingCode: string,
  invalidCode: string,
  label: string,
): string {
  if (!value?.trim()) {
    throw new BadRequestException({
      code: missingCode,
      message: `${label} is required for story_clip_video uploads.`,
    });
  }
  const parsed = UUID.safeParse(value.trim());
  if (!parsed.success) {
    throw new BadRequestException({
      code: invalidCode,
      message: `${label} must be a valid UUID.`,
    });
  }
  return parsed.data;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function projectNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_PROJECT_NOT_FOUND',
    message: 'Story project not found.',
  });
}

function uploadSessionNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_VIDEO_UPLOAD_NOT_FOUND',
    message: 'The Story video upload session could not be found.',
  });
}

function prismaProviderToId(
  provider: MediaStorageProvider,
): 'azure_blob' | 'aliyun_oss' | 's3_compatible' {
  switch (provider) {
    case MediaStorageProvider.azure_blob:
      return 'azure_blob';
    case MediaStorageProvider.aliyun_oss:
      return 'aliyun_oss';
    case MediaStorageProvider.s3_compatible:
      return 's3_compatible';
    case MediaStorageProvider.external_url:
      throw new ServiceUnavailableException({
        code: 'MEDIA_PROVIDER_UNMAPPED',
        message: 'external_url cannot back a Story video upload session',
      });
  }
}

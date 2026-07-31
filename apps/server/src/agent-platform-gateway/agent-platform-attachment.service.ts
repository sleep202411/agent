import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgentDocumentAnalysisJobStatus,
  AgentPlatformAttachmentIngestJobStatus,
  AgentPlatformAttachmentKind,
  AgentPlatformAttachmentStatus,
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';

import type { AuthUser } from '../auth';
import {
  parsePersistedStorySourceMaterialIndex,
  projectStorySourceMaterial,
} from '../agent-domain-gateway/story-source-material-index';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import {
  AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES,
  AGENT_ATTACHMENT_DOCUMENT_MEDIA_TYPES,
  AGENT_ATTACHMENT_IMAGE_MAX_BYTES,
  AGENT_ATTACHMENT_MODEL_FILE_MEDIA_TYPES,
} from './agent-platform-attachment-document';
import { AgentPlatformAttachmentIngestService } from './agent-platform-attachment-ingest.service';
import {
  AGENT_ATTACHMENT_MEDIA_ASSET_SELECT,
  PUBLIC_ATTACHMENT_SELECT,
  type AgentAttachmentMediaAssetRow,
  type PublicAttachmentRow,
  parseAttachmentFailure,
  toAttachmentSummary,
} from './agent-platform-attachment.persistence';
import {
  AgentAttachmentResolveRequestSchema,
  type AgentAttachmentRegisterRequest,
  type AgentAttachmentResolveRequest,
  type AgentAttachmentResolveResponse,
  type AgentAttachmentRevokeRequest,
  type AgentAttachmentStatusRequest,
  type AgentAttachmentSummary,
} from './agent-platform-attachment.dto';
import { AgentPlatformConversationService } from './agent-platform-conversation.service';
import { AgentPlatformGatewayConfigService } from './agent-platform-gateway.config';

const IMAGE_UPLOAD_KIND = 'agent_attachment_image';
const DOCUMENT_UPLOAD_KIND = 'agent_attachment_document';
const IMAGE_FINAL_SEGMENT = '/agent-attachment-image-final/';
const DOCUMENT_SEGMENT = '/agent-attachment-document/';
const MODEL_READ_URL_TTL_SECONDS = 5 * 60;
const ACTIVE_INGEST_JOB_STATUSES =
  new Set<AgentPlatformAttachmentIngestJobStatus>([
    AgentPlatformAttachmentIngestJobStatus.queued,
    AgentPlatformAttachmentIngestJobStatus.leased,
    AgentPlatformAttachmentIngestJobStatus.retry_wait,
  ]);

@Injectable()
export class AgentPlatformAttachmentService {
  readonly #config: AgentPlatformGatewayConfigService['values'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: AgentPlatformConversationService,
    private readonly storage: MediaStorageAccessService,
    private readonly ingest: AgentPlatformAttachmentIngestService,
    config: AgentPlatformGatewayConfigService,
  ) {
    this.#config = config.values;
  }

  async register(
    user: AuthUser,
    request: AgentAttachmentRegisterRequest,
  ): Promise<AgentAttachmentSummary> {
    const authorized = await this.conversations.authorizeExisting(user, {
      schemaVersion: 'agent-session-grant-request/v1',
      conversationId: request.conversationId,
      locale: request.locale,
    });
    const result = await this.prisma.$transaction(async (transaction) => {
      await lock(
        transaction,
        `agent-attachment:${request.conversationId}:${request.mediaAssetId}`,
      );
      const asset = await transaction.mediaAsset.findUnique({
        where: { id: request.mediaAssetId },
        select: AGENT_ATTACHMENT_MEDIA_ASSET_SELECT,
      });
      if (!asset) throw attachmentAssetNotFound();
      const kind = assertRegistrableAsset(
        asset,
        user.userId,
        authorized.context,
      );
      const existing = await transaction.agentPlatformAttachment.findUnique({
        where: {
          conversationId_mediaAssetId: {
            conversationId: request.conversationId,
            mediaAssetId: request.mediaAssetId,
          },
        },
        select: PUBLIC_ATTACHMENT_SELECT,
      });
      if (existing) {
        assertAttachmentIdentity(existing, asset, request, user.userId, kind);
        return this.reopenOrReuse(transaction, existing, request.locale);
      }

      const fileName = normalizeFileName(request.fileName);
      if (kind === AgentPlatformAttachmentKind.model_file) {
        if (!asset.checksumSha256) throw unsupportedAsset();
        const readyAt = new Date();
        return transaction.agentPlatformAttachment.create({
          data: {
            conversationId: request.conversationId,
            mediaAssetId: asset.id,
            ownerActorId: user.userId,
            kind,
            status: AgentPlatformAttachmentStatus.ready,
            fileName,
            mediaType: asset.contentType,
            locale: request.locale,
            sizeBytes: requiredSize(asset),
            contentHash: asset.checksumSha256,
            createdAt: readyAt,
            updatedAt: readyAt,
            readyAt,
          },
          select: PUBLIC_ATTACHMENT_SELECT,
        });
      }

      return transaction.agentPlatformAttachment.create({
        data: {
          conversationId: request.conversationId,
          mediaAssetId: asset.id,
          ownerActorId: user.userId,
          kind,
          status: AgentPlatformAttachmentStatus.processing,
          fileName,
          mediaType: asset.contentType,
          locale: request.locale,
          sizeBytes: requiredSize(asset),
          ingestJob: {
            create: {
              maxAttempts: this.#config.attachmentProcessingMaxAttempts,
            },
          },
        },
        select: PUBLIC_ATTACHMENT_SELECT,
      });
    });

    if (
      result.kind === AgentPlatformAttachmentKind.document_text &&
      result.status === AgentPlatformAttachmentStatus.processing
    ) {
      void this.ingest.wake();
    }
    return toAttachmentSummary(result);
  }

  async status(
    user: AuthUser,
    request: AgentAttachmentStatusRequest,
  ): Promise<AgentAttachmentSummary> {
    await this.conversations.authorizeExisting(user, {
      schemaVersion: 'agent-session-grant-request/v1',
      conversationId: request.conversationId,
      locale: request.locale,
    });
    const attachment = await this.prisma.agentPlatformAttachment.findFirst({
      where: {
        id: request.attachmentId,
        conversationId: request.conversationId,
        ownerActorId: user.userId,
      },
      select: PUBLIC_ATTACHMENT_SELECT,
    });
    if (!attachment) throw attachmentNotFound();
    return toAttachmentSummary(attachment);
  }

  async revoke(
    user: AuthUser,
    request: AgentAttachmentRevokeRequest,
  ): Promise<AgentAttachmentSummary> {
    await this.conversations.authorizeExisting(user, {
      schemaVersion: 'agent-session-grant-request/v1',
      conversationId: request.conversationId,
      locale: request.locale,
    });
    return this.prisma.$transaction(async (transaction) => {
      await lock(transaction, `agent-attachment:${request.attachmentId}`);
      const attachment = await transaction.agentPlatformAttachment.findFirst({
        where: {
          id: request.attachmentId,
          conversationId: request.conversationId,
          ownerActorId: user.userId,
        },
        select: PUBLIC_ATTACHMENT_SELECT,
      });
      if (!attachment) throw attachmentNotFound();
      if (attachment.status === AgentPlatformAttachmentStatus.revoked) {
        return toAttachmentSummary(attachment);
      }
      const now = new Date();
      await transaction.agentPlatformAttachmentIngestJob.updateMany({
        where: {
          attachmentId: attachment.id,
          status: {
            in: [
              AgentPlatformAttachmentIngestJobStatus.queued,
              AgentPlatformAttachmentIngestJobStatus.leased,
              AgentPlatformAttachmentIngestJobStatus.retry_wait,
            ],
          },
        },
        data: {
          status: AgentPlatformAttachmentIngestJobStatus.cancelled,
          leaseToken: null,
          leaseUntil: null,
          completedAt: now,
          stage: 'cancelled',
        },
      });
      await transaction.agentDocumentAnalysisJob.updateMany({
        where: {
          attachmentId: attachment.id,
          status: {
            in: [
              AgentDocumentAnalysisJobStatus.queued,
              AgentDocumentAnalysisJobStatus.dispatching,
              AgentDocumentAnalysisJobStatus.running,
              AgentDocumentAnalysisJobStatus.reducing,
            ],
          },
        },
        data: {
          status: AgentDocumentAnalysisJobStatus.cancelled,
          dispatchLeaseToken: null,
          dispatchLeaseUntil: null,
          completedAt: now,
          stage: 'cancelled',
        },
      });
      const revoked = await transaction.agentPlatformAttachment.update({
        where: { id: attachment.id },
        data: {
          status: AgentPlatformAttachmentStatus.revoked,
          revokedAt: now,
        },
        select: PUBLIC_ATTACHMENT_SELECT,
      });
      return toAttachmentSummary(revoked);
    });
  }

  async resolveForModel(
    rawRequest: unknown,
  ): Promise<AgentAttachmentResolveResponse> {
    const request = AgentAttachmentResolveRequestSchema.parse(rawRequest);
    const authorized = await this.conversations.authorizeExisting(
      {
        userId: request.actor.id,
        nickName: request.actor.displayName,
      },
      {
        schemaVersion: 'agent-session-grant-request/v1',
        conversationId: request.scope.conversationId,
        locale: request.locale,
      },
    );
    assertResolveScope(request, authorized.context);

    const attachments = await this.prisma.agentPlatformAttachment.findMany({
      where: {
        id: { in: request.attachmentIds },
        conversationId: request.scope.conversationId,
        ownerActorId: request.actor.id,
      },
      select: {
        ...PUBLIC_ATTACHMENT_SELECT,
        mediaAsset: { select: AGENT_ATTACHMENT_MEDIA_ASSET_SELECT },
      },
    });
    if (attachments.length !== request.attachmentIds.length) {
      throw attachmentNotFound();
    }
    const byId = new Map(attachments.map((item) => [item.id, item]));
    const resolved: AgentAttachmentResolveResponse['attachments'] = [];
    for (const attachmentId of request.attachmentIds) {
      const attachment = byId.get(attachmentId);
      if (!attachment) throw attachmentNotFound();
      assertResolvableAttachment(attachment);
      if (attachment.kind === AgentPlatformAttachmentKind.document_text) {
        if (
          !attachment.documentText ||
          !attachment.contentHash ||
          attachment.documentCharCount === null
        ) {
          throw attachmentUnavailable();
        }
        resolved.push({
          id: attachment.id,
          kind: 'document',
          fileName: attachment.fileName,
          mediaType: attachment.mediaType as
            | 'text/plain'
            | 'text/markdown'
            | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            | 'application/pdf',
          projection: projectStorySourceMaterial(
            requirePersistedSourceIndex(attachment),
            attachment.documentText,
          ),
        });
        continue;
      }
      const signed = await this.storage.createReadUrl(attachment.mediaAsset, {
        expiresInSeconds: MODEL_READ_URL_TTL_SECONDS,
        cacheControl: 'private, no-store',
      });
      if (
        signed.bucket !== attachment.mediaAsset.bucket ||
        signed.objectKey !== attachment.mediaAsset.objectKey
      ) {
        throw storageIdentityMismatch();
      }
      resolved.push({
        id: attachment.id,
        kind: 'file',
        fileName: attachment.fileName,
        mediaType: attachment.mediaType as
          | 'image/jpeg'
          | 'image/png'
          | 'image/webp',
        url: signed.url,
        expiresAt: signed.expiresAt,
      });
    }
    return {
      schemaVersion: 'agent-attachment-resolve-result/v1',
      attachments: resolved,
    };
  }

  private async reopenOrReuse(
    transaction: Prisma.TransactionClient,
    existing: PublicAttachmentRow,
    locale: string,
  ): Promise<PublicAttachmentRow> {
    if (
      (existing.status === AgentPlatformAttachmentStatus.ready ||
        existing.status === AgentPlatformAttachmentStatus.revoked) &&
      existing.readyAt &&
      existing.contentHash
    ) {
      return transaction.agentPlatformAttachment.update({
        where: { id: existing.id },
        data: {
          status: AgentPlatformAttachmentStatus.ready,
          locale,
          revokedAt: null,
          error: Prisma.DbNull,
        },
        select: PUBLIC_ATTACHMENT_SELECT,
      });
    }
    const previousFailure = parseAttachmentFailure(existing.error);
    if (
      existing.status === AgentPlatformAttachmentStatus.failed &&
      previousFailure &&
      !previousFailure.retryable
    ) {
      throw new UnprocessableEntityException(previousFailure);
    }
    const job = existing.ingestJob;
    if (
      existing.status === AgentPlatformAttachmentStatus.processing &&
      job &&
      ACTIVE_INGEST_JOB_STATUSES.has(job.status)
    ) {
      return existing;
    }
    if (job?.status === AgentPlatformAttachmentIngestJobStatus.succeeded) {
      throw new ServiceUnavailableException({
        code: 'AGENT_ATTACHMENT_LIFECYCLE_CORRUPT',
        message:
          'The attachment ingest lifecycle is inconsistent with its public status.',
        retryable: false,
      });
    }
    const now = new Date();
    return transaction.agentPlatformAttachment.update({
      where: { id: existing.id },
      data: {
        status: AgentPlatformAttachmentStatus.processing,
        locale,
        readyAt: null,
        revokedAt: null,
        error: Prisma.DbNull,
        documentText: null,
        documentCharCount: null,
        documentPageCount: null,
        contentHash: null,
        documentIndex: Prisma.DbNull,
        documentIndexVersion: null,
        ingestJob: {
          upsert: {
            create: {
              maxAttempts: this.#config.attachmentProcessingMaxAttempts,
            },
            update: {
              status: AgentPlatformAttachmentIngestJobStatus.queued,
              attemptCount: 0,
              maxAttempts: this.#config.attachmentProcessingMaxAttempts,
              stage: 'queued',
              progress: 0,
              availableAt: now,
              leaseToken: null,
              leaseUntil: null,
              lastHeartbeatAt: null,
              error: Prisma.DbNull,
              completedAt: null,
              deadLetteredAt: null,
            },
          },
        },
      },
      select: PUBLIC_ATTACHMENT_SELECT,
    });
  }
}

function assertRegistrableAsset(
  asset: AgentAttachmentMediaAssetRow,
  actorId: string,
  context: {
    surface: 'story-studio' | 'crew-management';
    scope:
      | { kind: 'story-project'; workspaceId: string; projectId: string }
      | { kind: 'crew'; crewId: string };
  },
): AgentPlatformAttachmentKind {
  if (
    asset.deletedAt ||
    asset.createdByUserId !== actorId ||
    asset.source !== MediaAssetSource.user_upload ||
    asset.storageProvider === MediaStorageProvider.external_url
  ) {
    throw attachmentAssetNotFound();
  }
  if (
    context.surface === 'story-studio' &&
    context.scope.kind === 'story-project' &&
    asset.workspaceId !== context.scope.workspaceId
  ) {
    throw attachmentAssetNotFound();
  }
  if (asset.status !== MediaAssetStatus.ready) {
    throw new ConflictException({
      code: 'AGENT_ATTACHMENT_ASSET_NOT_READY',
      message: 'The uploaded attachment has not finished processing.',
      retryable: true,
    });
  }
  if (
    asset.moderationStatus === MediaAssetModerationStatus.flagged ||
    asset.moderationStatus === MediaAssetModerationStatus.blocked
  ) {
    throw new ForbiddenException({
      code: 'AGENT_ATTACHMENT_ASSET_MODERATION_RESTRICTED',
      message: 'The uploaded attachment is restricted by media safety review.',
      retryable: false,
    });
  }
  const uploadKind = jsonStringProperty(asset.metadata, 'uploadKind');
  if (asset.kind === MediaAssetKind.image) {
    const valid =
      uploadKind === IMAGE_UPLOAD_KIND &&
      asset.objectKey?.includes(IMAGE_FINAL_SEGMENT) &&
      (AGENT_ATTACHMENT_MODEL_FILE_MEDIA_TYPES as readonly string[]).includes(
        asset.contentType,
      ) &&
      requiredSize(asset) <= BigInt(AGENT_ATTACHMENT_IMAGE_MAX_BYTES) &&
      asset.width !== null &&
      asset.width > 0 &&
      asset.height !== null &&
      asset.height > 0 &&
      !!asset.checksumSha256 &&
      /^[a-f0-9]{64}$/u.test(asset.checksumSha256);
    if (!valid) throw unsupportedAsset();
    return AgentPlatformAttachmentKind.model_file;
  }

  const validDocument =
    asset.kind === MediaAssetKind.document &&
    uploadKind === DOCUMENT_UPLOAD_KIND &&
    asset.objectKey?.includes(DOCUMENT_SEGMENT) &&
    (AGENT_ATTACHMENT_DOCUMENT_MEDIA_TYPES as readonly string[]).includes(
      asset.contentType,
    ) &&
    requiredSize(asset) <= BigInt(AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES);
  if (!validDocument) throw unsupportedAsset();
  return AgentPlatformAttachmentKind.document_text;
}

function assertAttachmentIdentity(
  existing: PublicAttachmentRow,
  asset: AgentAttachmentMediaAssetRow,
  request: AgentAttachmentRegisterRequest,
  actorId: string,
  kind: AgentPlatformAttachmentKind,
): void {
  if (
    existing.ownerActorId !== actorId ||
    existing.conversationId !== request.conversationId ||
    existing.mediaAssetId !== asset.id ||
    existing.kind !== kind ||
    existing.mediaType !== asset.contentType ||
    existing.sizeBytes !== requiredSize(asset)
  ) {
    throw new ServiceUnavailableException({
      code: 'AGENT_ATTACHMENT_IDENTITY_CORRUPT',
      message: 'The attachment registry contains an inconsistent identity.',
      retryable: false,
    });
  }
}

function assertResolveScope(
  request: AgentAttachmentResolveRequest,
  context: {
    sessionName: string;
    surface: 'story-studio' | 'crew-management';
    scope:
      | { kind: 'story-project'; workspaceId: string; projectId: string }
      | { kind: 'crew'; crewId: string };
  },
): void {
  const same =
    request.scope.sessionName === context.sessionName &&
    request.scope.surface === context.surface &&
    request.scope.kind === context.scope.kind &&
    (request.scope.kind === 'story-project' &&
    context.scope.kind === 'story-project'
      ? request.scope.workspaceId === context.scope.workspaceId &&
        request.scope.projectId === context.scope.projectId
      : request.scope.kind === 'crew' && context.scope.kind === 'crew'
        ? request.scope.crewId === context.scope.crewId
        : false);
  if (!same) {
    throw new ForbiddenException({
      code: 'AGENT_ATTACHMENT_SCOPE_MISMATCH',
      message: 'The attachment request does not match the conversation scope.',
      retryable: false,
    });
  }
}

function assertResolvableAttachment(
  attachment: PublicAttachmentRow & {
    mediaAsset: AgentAttachmentMediaAssetRow;
  },
): void {
  if (
    attachment.status !== AgentPlatformAttachmentStatus.ready ||
    attachment.revokedAt ||
    !attachment.readyAt ||
    !attachment.contentHash ||
    attachment.mediaAsset.status !== MediaAssetStatus.ready ||
    attachment.mediaAsset.deletedAt ||
    attachment.mediaAsset.createdByUserId !== attachment.ownerActorId ||
    attachment.mediaAsset.moderationStatus ===
      MediaAssetModerationStatus.flagged ||
    attachment.mediaAsset.moderationStatus ===
      MediaAssetModerationStatus.blocked
  ) {
    throw attachmentUnavailable();
  }
}

function requirePersistedSourceIndex(attachment: PublicAttachmentRow) {
  if (!attachment.contentHash || attachment.documentCharCount === null) {
    throw attachmentUnavailable();
  }
  try {
    return parsePersistedStorySourceMaterialIndex({
      value: attachment.documentIndex,
      schemaVersion: attachment.documentIndexVersion,
      expectedContentHash: attachment.contentHash,
      expectedCharacterCount: attachment.documentCharCount,
    });
  } catch {
    throw new ConflictException({
      code: 'AGENT_ATTACHMENT_SOURCE_INDEX_INVALID',
      message:
        'The source attachment index is missing or inconsistent. Re-register the attachment before using it.',
      retryable: false,
    });
  }
}

function requiredSize(asset: AgentAttachmentMediaAssetRow): bigint {
  if (!asset.sizeBytes || asset.sizeBytes <= 0n) throw unsupportedAsset();
  return asset.sizeBytes;
}

function jsonStringProperty(
  value: Prisma.JsonValue,
  property: string,
): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value[property];
  return typeof candidate === 'string' ? candidate : null;
}

function normalizeFileName(value: string): string {
  return value.trim().normalize('NFC');
}

async function lock(
  transaction: Prisma.TransactionClient,
  identity: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))
  `;
}

function attachmentAssetNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AGENT_ATTACHMENT_ASSET_NOT_FOUND',
    message: 'The uploaded attachment is not available in this scope.',
  });
}

function attachmentNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AGENT_ATTACHMENT_NOT_FOUND',
    message: 'Agent attachment not found.',
  });
}

function attachmentUnavailable(): ConflictException {
  return new ConflictException({
    code: 'AGENT_ATTACHMENT_NOT_READY',
    message: 'The attachment is not ready for model input.',
    retryable: true,
  });
}

function unsupportedAsset(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'AGENT_ATTACHMENT_ASSET_UNSUPPORTED',
    message:
      'Only verified Agent Platform JPEG, PNG, WebP, PDF, UTF-8 text, Markdown, and DOCX uploads are supported.',
    retryable: false,
  });
}

function storageIdentityMismatch(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'AGENT_ATTACHMENT_STORAGE_IDENTITY_MISMATCH',
    message: 'Media storage returned a different attachment identity.',
    retryable: true,
  });
}

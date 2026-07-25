import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaStorageProvider,
  Prisma,
  StudioAgentArtifactCleanupReason,
  StudioAgentArtifactCleanupStatus,
  StudioAgentArtifactKind,
  StudioAgentArtifactStatus,
  StudioAgentMessageRole,
} from '@prisma/client';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentMessagePart,
} from '@repo/shared/studio-agent';
import type {
  StudioAgentDeleteAttachmentResult,
  StudioAgentRegisterAttachmentRequest,
  StudioAgentRegisterAttachmentResult,
} from '@repo/shared/studio-agent-api';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { StudioAgentConfigService } from './studio-agent.config';
import {
  STUDIO_AGENT_DOCUMENT_MEDIA_TYPES,
  StudioAgentDocumentService,
  type StudioAgentDocumentProjection,
} from './studio-agent-document.service';
import { toStudioAgentThread } from './studio-agent.mapper';
import { StudioAgentScopeAuthorizer } from './studio-agent.scope';

type TransactionClient = Prisma.TransactionClient;
type StudioAgentAttachmentMessagePart = Extract<
  StudioAgentMessagePart,
  { type: 'attachment' }
>;

const STUDIO_AGENT_IMAGE_UPLOAD_KIND = 'studio_agent_image';
const STUDIO_AGENT_IMAGE_FINAL_SEGMENT = '/studio-agent-image-final/';
const STUDIO_AGENT_DOCUMENT_UPLOAD_KIND = 'studio_agent_document';
const STUDIO_AGENT_DOCUMENT_SEGMENT = '/studio-agent-document/';
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const SCENARIO_ATTACHMENT_MEDIA_TYPES = new Map<string, ReadonlySet<string>>([
  [
    'story.studio.assistant',
    new Set([
      ...SUPPORTED_IMAGE_MEDIA_TYPES,
      ...STUDIO_AGENT_DOCUMENT_MEDIA_TYPES,
    ]),
  ],
]);

interface CanonicalMediaAsset {
  id: string;
  workspaceId: string | null;
  kind: MediaAssetKind;
  status: MediaAssetStatus;
  source: MediaAssetSource;
  moderationStatus: MediaAssetModerationStatus;
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType: string;
  sizeBytes: bigint | null;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
  metadata: Prisma.JsonValue;
  createdByUserId: string | null;
  deletedAt: Date | null;
}

/** Minimal fair FIFO async semaphore bounding in-flight operations. */
class AsyncSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, Math.floor(permits));
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }
}

/**
 * Owns the browser-upload → thread artifact boundary.
 *
 * Media storage remains authoritative for bytes and StudioAgentArtifact is the
 * only id exposed in a message. Registration and binding are deliberately
 * separate: a composer may upload/remove files repeatedly without creating
 * phantom messages, while a submitted message atomically claims each artifact
 * exactly once.
 */
@Injectable()
export class StudioAgentArtifactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: StudioAgentScopeAuthorizer,
    private readonly config: StudioAgentConfigService,
    private readonly documents: StudioAgentDocumentService,
  ) {}

  // Bounds concurrent document parses per pod. Each parse spins up a worker
  // thread and buffers up to the bounded download into memory, so without this
  // fence a burst of registrations (one authenticated user can fan out many)
  // could exhaust threads and heap. globalConcurrency is the per-pod ceiling.
  private documentParseGate: AsyncSemaphore | null = null;

  private get documentParse(): AsyncSemaphore {
    return (this.documentParseGate ??= new AsyncSemaphore(
      this.config.value.documentIngest.globalConcurrency,
    ));
  }

  async register(
    user: AuthUser,
    threadId: string,
    request: StudioAgentRegisterAttachmentRequest,
  ): Promise<StudioAgentRegisterAttachmentResult> {
    const authorizedThread = await this.requireAuthorizedThread(user, threadId);

    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "studio_agent_threads"
        WHERE "id" = ${threadId}::uuid
          AND "owner_actor_id" = ${user.userId}
          AND "status" = 'active'
        FOR SHARE
      `;
      const thread = await tx.studioAgentThread.findFirst({
        where: {
          id: threadId,
          ownerActorId: user.userId,
          status: 'active',
        },
        select: { id: true, workspaceId: true },
      });
      if (!thread || thread.workspaceId !== authorizedThread.workspaceId) {
        throw threadNotFound();
      }

      await tx.$queryRaw`
        SELECT "id"
        FROM "media_assets"
        WHERE "id" = ${request.mediaAssetId}::uuid
        FOR SHARE
      `;
      const asset = await tx.mediaAsset.findUnique({
        where: { id: request.mediaAssetId },
        select: MEDIA_ASSET_SELECT,
      });
      this.assertRegistrableAsset(asset, user.userId, thread.workspaceId);
      this.assertScenarioMediaType(
        authorizedThread.scenarioId,
        asset.contentType,
      );

      // Serialize the natural identity before read/create. The unique index is
      // the final invariant; this advisory lock lets us return an accurate
      // `created` bit without catch-and-requery races.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`studio-agent-artifact:${threadId}:${request.mediaAssetId}`})::bigint
        )
      `;
      const existing = await tx.studioAgentArtifact.findUnique({
        where: {
          threadId_mediaAssetId: {
            threadId,
            mediaAssetId: request.mediaAssetId,
          },
        },
        select: {
          id: true,
          threadId: true,
          messageId: true,
          createdByActorId: true,
          kind: true,
          status: true,
          cleanupStatus: true,
          name: true,
          error: true,
          ingestAttemptCount: true,
        },
      });
      if (existing) {
        this.assertOwnedArtifact(existing, user.userId, threadId);
        if (existing.status === StudioAgentArtifactStatus.ready) {
          return registrationResult(existing, asset, false);
        }
        if (existing.status === StudioAgentArtifactStatus.pending) {
          return registrationResult(existing, asset, false);
        }
        const failure = parsePersistedArtifactError(existing.error);
        // A parser that keeps crashing (OOM, timeout, corrupt input) reports a
        // "retryable" failure every time. Without a ceiling one client could
        // re-register a poison document indefinitely and keep a parse slot
        // busy; cap the total attempts and then fail closed as non-retryable.
        if (
          !failure.retryable ||
          existing.ingestAttemptCount >=
            this.config.value.documentIngest.maxAttempts
        ) {
          throw persistedArtifactException(failure);
        }
        const reclaimed = await tx.studioAgentArtifact.updateMany({
          where: {
            id: existing.id,
            status: StudioAgentArtifactStatus.failed,
            cleanupStatus: StudioAgentArtifactCleanupStatus.active,
          },
          data: {
            status: StudioAgentArtifactStatus.pending,
            value: Prisma.DbNull,
            contentHash: null,
            readyAt: null,
            error: Prisma.DbNull,
            ingestAttemptCount: { increment: 1 },
          },
        });
        if (reclaimed.count !== 1) {
          throw attachmentProcessingConflict();
        }
        return {
          extract: true as const,
          artifactId: existing.id,
          asset,
          fileName: existing.name,
          created: false,
        };
      }

      const artifact = await tx.studioAgentArtifact.create({
        data: {
          threadId,
          createdByActorId: user.userId,
          kind:
            asset.kind === MediaAssetKind.document
              ? StudioAgentArtifactKind.document
              : StudioAgentArtifactKind.media,
          status:
            asset.kind === MediaAssetKind.document
              ? StudioAgentArtifactStatus.pending
              : StudioAgentArtifactStatus.ready,
          name: request.fileName.trim(),
          mediaAssetId: asset.id,
          value: Prisma.DbNull,
          contentHash: null,
          readyAt: asset.kind === MediaAssetKind.document ? null : new Date(),
          error: Prisma.DbNull,
          // Documents parse once on this request; the counter caps how many
          // times a repeatedly-failing parse may be reclaimed.
          ingestAttemptCount: asset.kind === MediaAssetKind.document ? 1 : 0,
          cleanupStatus: StudioAgentArtifactCleanupStatus.active,
          cleanupExpiresAt: new Date(
            Date.now() + this.config.value.attachmentCleanup.ttlMs,
          ),
        },
        select: {
          id: true,
          threadId: true,
          messageId: true,
          createdByActorId: true,
          kind: true,
          status: true,
          cleanupStatus: true,
          name: true,
          error: true,
        },
      });
      return asset.kind === MediaAssetKind.document
        ? {
            extract: true as const,
            artifactId: artifact.id,
            asset,
            fileName: artifact.name,
            created: true,
          }
        : registrationResult(artifact, asset, true);
    });
    if (!('extract' in claim)) return claim;

    let projection: StudioAgentDocumentProjection;
    try {
      projection = await this.documentParse.run(() =>
        this.documents.extract(claim.asset, claim.fileName),
      );
    } catch (cause: unknown) {
      await this.finalizeDocumentFailure(claim.artifactId, cause);
      throw cause;
    }
    return this.finalizeDocumentReady(claim, projection);
  }

  private async finalizeDocumentReady(
    claim: {
      artifactId: string;
      asset: CanonicalMediaAsset;
      fileName: string;
      created: boolean;
    },
    projection: StudioAgentDocumentProjection,
  ): Promise<StudioAgentRegisterAttachmentResult> {
    const readyAt = new Date();
    const updated = await this.prisma.studioAgentArtifact.updateMany({
      where: {
        id: claim.artifactId,
        status: StudioAgentArtifactStatus.pending,
        cleanupStatus: StudioAgentArtifactCleanupStatus.active,
      },
      data: {
        status: StudioAgentArtifactStatus.ready,
        value: projection as unknown as Prisma.InputJsonValue,
        contentHash: projection.source.sha256,
        readyAt,
        error: Prisma.DbNull,
      },
    });
    if (updated.count !== 1) {
      return this.resolveDocumentFinalizationConflict(
        claim.artifactId,
        claim.asset,
      );
    }
    return registrationResult(
      {
        id: claim.artifactId,
        name: claim.fileName,
        status: StudioAgentArtifactStatus.ready,
      },
      claim.asset,
      claim.created,
    );
  }

  private async finalizeDocumentFailure(
    artifactId: string,
    cause: unknown,
  ): Promise<void> {
    const error = persistedArtifactError(cause);
    await this.prisma.studioAgentArtifact.updateMany({
      where: {
        id: artifactId,
        status: StudioAgentArtifactStatus.pending,
        cleanupStatus: StudioAgentArtifactCleanupStatus.active,
      },
      data: {
        status: StudioAgentArtifactStatus.failed,
        value: Prisma.DbNull,
        contentHash: null,
        readyAt: null,
        error: error as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async resolveDocumentFinalizationConflict(
    artifactId: string,
    asset: CanonicalMediaAsset,
  ): Promise<StudioAgentRegisterAttachmentResult> {
    const artifact = await this.prisma.studioAgentArtifact.findUnique({
      where: { id: artifactId },
      select: {
        id: true,
        threadId: true,
        createdByActorId: true,
        kind: true,
        status: true,
        cleanupStatus: true,
        name: true,
        error: true,
      },
    });
    if (artifact?.status === StudioAgentArtifactStatus.ready) {
      return registrationResult(artifact, asset, false);
    }
    if (artifact?.status === StudioAgentArtifactStatus.failed) {
      throw persistedArtifactException(
        parsePersistedArtifactError(artifact.error),
      );
    }
    throw attachmentProcessingConflict();
  }

  /**
   * Durably abandons an unbound composer attachment. Storage deletion is
   * asynchronous: after this transaction commits, the cleanup worker owns
   * retries across process and storage-provider failures.
   */
  async deleteUnbound(
    user: AuthUser,
    threadId: string,
    artifactId: string,
  ): Promise<StudioAgentDeleteAttachmentResult> {
    await this.requireAuthorizedThread(user, threadId);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "studio_agent_artifacts"
        WHERE "id" = ${artifactId}::uuid
          AND "thread_id" = ${threadId}::uuid
        FOR UPDATE
      `;
      const artifact = await tx.studioAgentArtifact.findFirst({
        where: {
          id: artifactId,
          threadId,
          createdByActorId: user.userId,
        },
        select: {
          id: true,
          messageId: true,
          runId: true,
          actionId: true,
          cleanupStatus: true,
        },
      });
      if (!artifact) {
        throw new NotFoundException({
          code: 'STUDIO_AGENT_ATTACHMENT_NOT_FOUND',
          message: 'The attachment does not belong to this agent conversation.',
        });
      }
      if (
        artifact.messageId !== null ||
        artifact.runId !== null ||
        artifact.actionId !== null
      ) {
        throw new ConflictException({
          code: 'STUDIO_AGENT_ATTACHMENT_ALREADY_BOUND',
          message: 'A submitted attachment cannot be deleted from its message.',
        });
      }
      if (artifact.cleanupStatus === StudioAgentArtifactCleanupStatus.cleaned) {
        return {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          attachmentId: artifact.id,
          cleanupStatus: 'cleaned',
        };
      }

      // A leased cleanup is already durable and must not have its lease
      // revoked underneath another pod. Every other non-terminal state,
      // including dead-letter, can be safely (re)scheduled by the owner.
      if (artifact.cleanupStatus !== StudioAgentArtifactCleanupStatus.leased) {
        await tx.studioAgentArtifact.update({
          where: { id: artifact.id },
          data: {
            cleanupStatus: StudioAgentArtifactCleanupStatus.scheduled,
            cleanupReason: StudioAgentArtifactCleanupReason.user_abandoned,
            cleanupRequestedAt: now,
            cleanupNextAttemptAt: now,
            cleanupLeaseToken: null,
            cleanupLeaseOwner: null,
            cleanupLeaseAcquiredAt: null,
            cleanupLeaseExpiresAt: null,
            cleanupCompletedAt: null,
            cleanupLastErrorCode: null,
            cleanupLastErrorDetail: null,
            ...(artifact.cleanupStatus ===
            StudioAgentArtifactCleanupStatus.dead_letter
              ? { cleanupAttemptCount: 0 }
              : {}),
          },
        });
      }

      return {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        attachmentId: artifact.id,
        cleanupStatus: 'scheduled',
      };
    });
  }

  /**
   * Must run inside the same transaction that creates the user message.
   * Locks artifact rows in UUID order, validates canonical metadata, and binds
   * them one-way to `messageId`. An attachment cannot be replayed into another
   * message, another thread, or by another actor.
   */
  async bindMessageAttachmentsInTransaction(
    tx: TransactionClient,
    input: {
      actorId: string;
      threadId: string;
      messageId: string;
      parts: readonly StudioAgentMessagePart[];
    },
  ): Promise<void> {
    const attachments = input.parts.filter(
      (part): part is StudioAgentAttachmentMessagePart =>
        part.type === 'attachment',
    );
    if (attachments.length === 0) {
      return;
    }

    const attachmentIds = attachments
      .map((attachment) => attachment.attachmentId)
      .sort();
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new BadRequestException({
        code: 'STUDIO_AGENT_ATTACHMENT_DUPLICATE',
        message: 'A message cannot include the same attachment more than once.',
      });
    }

    await tx.$queryRaw`
      SELECT "id"
      FROM "studio_agent_artifacts"
      WHERE "thread_id" = ${input.threadId}::uuid
        AND "id" IN (${Prisma.join(
          attachmentIds.map(
            (attachmentId) => Prisma.sql`${attachmentId}::uuid`,
          ),
        )})
      ORDER BY "id"
      FOR UPDATE
    `;

    const [thread, message, artifacts] = await Promise.all([
      tx.studioAgentThread.findFirst({
        where: {
          id: input.threadId,
          ownerActorId: input.actorId,
          status: 'active',
        },
        select: { id: true, workspaceId: true, scenarioId: true },
      }),
      tx.studioAgentMessage.findFirst({
        where: {
          id: input.messageId,
          threadId: input.threadId,
          role: StudioAgentMessageRole.user,
        },
        select: { id: true },
      }),
      tx.studioAgentArtifact.findMany({
        where: {
          threadId: input.threadId,
          id: { in: attachmentIds },
        },
        select: {
          id: true,
          threadId: true,
          messageId: true,
          createdByActorId: true,
          kind: true,
          status: true,
          cleanupStatus: true,
          name: true,
          mediaAsset: { select: MEDIA_ASSET_SELECT },
        },
      }),
    ]);
    if (!thread) {
      throw threadNotFound();
    }
    if (!message) {
      throw new ConflictException({
        code: 'STUDIO_AGENT_ATTACHMENT_MESSAGE_NOT_FOUND',
        message:
          'Attachments can only be bound to the user message being submitted.',
      });
    }
    if (artifacts.length !== attachmentIds.length) {
      throw new NotFoundException({
        code: 'STUDIO_AGENT_ATTACHMENT_NOT_FOUND',
        message:
          'One or more attachments do not belong to this agent conversation.',
      });
    }

    const byId = new Map(
      artifacts.map((artifact) => [artifact.id, artifact] as const),
    );
    for (const attachment of attachments) {
      const artifact = byId.get(attachment.attachmentId);
      if (!artifact) {
        throw new NotFoundException({
          code: 'STUDIO_AGENT_ATTACHMENT_NOT_FOUND',
          message:
            'One or more attachments do not belong to this agent conversation.',
        });
      }
      this.assertOwnedReadyArtifact(artifact, input.actorId, input.threadId);
      if (
        artifact.messageId !== null &&
        artifact.messageId !== input.messageId
      ) {
        throw new ConflictException({
          code: 'STUDIO_AGENT_ATTACHMENT_ALREADY_BOUND',
          message: 'An attachment can only be submitted in one message.',
        });
      }
      this.assertRegistrableAsset(
        artifact.mediaAsset,
        input.actorId,
        thread.workspaceId,
      );
      this.assertScenarioMediaType(
        thread.scenarioId,
        artifact.mediaAsset.contentType,
      );
      const canonical = toAttachmentPart(artifact, artifact.mediaAsset);
      if (!attachmentPartsEqual(attachment, canonical)) {
        throw new BadRequestException({
          code: 'STUDIO_AGENT_ATTACHMENT_METADATA_MISMATCH',
          message:
            'Attachment metadata does not match the registered server record.',
        });
      }
    }

    const unboundIds = artifacts
      .filter((artifact) => artifact.messageId === null)
      .map((artifact) => artifact.id);
    if (unboundIds.length === 0) {
      return;
    }
    const bound = await tx.studioAgentArtifact.updateMany({
      where: {
        threadId: input.threadId,
        id: { in: unboundIds },
        messageId: null,
        cleanupStatus: StudioAgentArtifactCleanupStatus.active,
      },
      data: {
        messageId: input.messageId,
        cleanupExpiresAt: null,
      },
    });
    if (bound.count !== unboundIds.length) {
      throw new ConflictException({
        code: 'STUDIO_AGENT_ATTACHMENT_BIND_CONFLICT',
        message:
          'An attachment changed while the message was being submitted. Retry the message.',
      });
    }
  }

  private async requireAuthorizedThread(user: AuthUser, threadId: string) {
    const thread = await this.prisma.studioAgentThread.findFirst({
      where: {
        id: threadId,
        ownerActorId: user.userId,
        status: 'active',
      },
    });
    if (!thread) {
      throw threadNotFound();
    }
    const canonical = toStudioAgentThread(thread);
    await this.scopes.authorize(
      user.userId,
      canonical.surfaceId,
      canonical.scenario,
      canonical.scope,
    );
    return thread;
  }

  private assertOwnedReadyArtifact(
    artifact: {
      threadId: string;
      createdByActorId: string;
      kind: StudioAgentArtifactKind;
      status: StudioAgentArtifactStatus;
      cleanupStatus: StudioAgentArtifactCleanupStatus;
    },
    actorId: string,
    threadId: string,
  ): void {
    this.assertOwnedArtifact(artifact, actorId, threadId);
    if (artifact.status !== StudioAgentArtifactStatus.ready) {
      throw attachmentProcessingConflict();
    }
  }

  private assertOwnedArtifact(
    artifact: {
      threadId: string;
      createdByActorId: string;
      kind: StudioAgentArtifactKind;
      cleanupStatus: StudioAgentArtifactCleanupStatus;
    },
    actorId: string,
    threadId: string,
  ): void {
    if (
      artifact.threadId !== threadId ||
      artifact.createdByActorId !== actorId
    ) {
      throw new NotFoundException({
        code: 'STUDIO_AGENT_ATTACHMENT_NOT_FOUND',
        message: 'The attachment does not belong to this agent conversation.',
      });
    }
    if (
      (artifact.kind !== StudioAgentArtifactKind.media &&
        artifact.kind !== StudioAgentArtifactKind.document) ||
      artifact.cleanupStatus !== StudioAgentArtifactCleanupStatus.active
    ) {
      throw attachmentProcessingConflict();
    }
  }

  private assertRegistrableAsset(
    asset: CanonicalMediaAsset | null,
    actorId: string,
    workspaceId: string,
  ): asserts asset is CanonicalMediaAsset {
    if (
      !asset ||
      asset.deletedAt !== null ||
      asset.createdByUserId !== actorId ||
      asset.workspaceId !== workspaceId
    ) {
      // Deliberately do not reveal cross-user or cross-workspace asset
      // existence.
      throw new NotFoundException({
        code: 'STUDIO_AGENT_ATTACHMENT_ASSET_NOT_FOUND',
        message: 'The uploaded image is not available in this workspace.',
      });
    }
    if (asset.status !== MediaAssetStatus.ready) {
      throw new ConflictException({
        code: 'STUDIO_AGENT_ATTACHMENT_ASSET_NOT_READY',
        message: 'The uploaded image has not finished processing.',
      });
    }
    if (
      asset.moderationStatus === MediaAssetModerationStatus.flagged ||
      asset.moderationStatus === MediaAssetModerationStatus.blocked
    ) {
      throw new ForbiddenException({
        code: 'STUDIO_AGENT_ATTACHMENT_ASSET_MODERATION_RESTRICTED',
        message: 'The uploaded image is restricted by media safety review.',
      });
    }

    const metadataUploadKind = jsonStringProperty(asset.metadata, 'uploadKind');
    const imageReady =
      asset.kind === MediaAssetKind.image &&
      asset.source === MediaAssetSource.user_upload &&
      asset.storageProvider !== MediaStorageProvider.external_url &&
      !!asset.objectKey?.includes(STUDIO_AGENT_IMAGE_FINAL_SEGMENT) &&
      metadataUploadKind === STUDIO_AGENT_IMAGE_UPLOAD_KIND &&
      SUPPORTED_IMAGE_MEDIA_TYPES.has(asset.contentType) &&
      asset.sizeBytes !== null &&
      asset.sizeBytes > 0n &&
      asset.sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER) &&
      asset.width !== null &&
      asset.width > 0 &&
      asset.height !== null &&
      asset.height > 0 &&
      !!asset.checksumSha256 &&
      /^[a-f0-9]{64}$/.test(asset.checksumSha256);
    const documentReady =
      asset.kind === MediaAssetKind.document &&
      asset.source === MediaAssetSource.user_upload &&
      asset.storageProvider !== MediaStorageProvider.external_url &&
      !!asset.objectKey?.includes(STUDIO_AGENT_DOCUMENT_SEGMENT) &&
      metadataUploadKind === STUDIO_AGENT_DOCUMENT_UPLOAD_KIND &&
      (STUDIO_AGENT_DOCUMENT_MEDIA_TYPES as readonly string[]).includes(
        asset.contentType,
      ) &&
      asset.sizeBytes !== null &&
      asset.sizeBytes > 0n &&
      asset.sizeBytes <= 10n * 1024n * 1024n;
    if (!imageReady && !documentReady) {
      throw new UnprocessableEntityException({
        code: 'STUDIO_AGENT_ATTACHMENT_ASSET_UNSUPPORTED',
        message:
          'Only server-verified Studio Agent images and supported document uploads can be attached.',
      });
    }
  }

  private assertScenarioMediaType(scenarioId: string, mediaType: string): void {
    if (!SCENARIO_ATTACHMENT_MEDIA_TYPES.get(scenarioId)?.has(mediaType)) {
      throw new UnprocessableEntityException({
        code: 'STUDIO_AGENT_ATTACHMENT_SCENARIO_UNSUPPORTED',
        message: `This Studio Agent does not accept ${mediaType} attachments.`,
      });
    }
  }
}

const MEDIA_ASSET_SELECT = {
  id: true,
  workspaceId: true,
  kind: true,
  status: true,
  source: true,
  moderationStatus: true,
  storageProvider: true,
  bucket: true,
  region: true,
  objectKey: true,
  externalUrl: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  checksumSha256: true,
  metadata: true,
  createdByUserId: true,
  deletedAt: true,
} satisfies Prisma.MediaAssetSelect;

function toAttachmentPart(
  artifact: {
    id: string;
    name: string;
    status: StudioAgentArtifactStatus;
  },
  asset: CanonicalMediaAsset,
): StudioAgentAttachmentMessagePart {
  if (
    asset.sizeBytes === null ||
    asset.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new ConflictException({
      code: 'STUDIO_AGENT_ATTACHMENT_NOT_READY',
      message: 'The attachment is not ready to submit.',
    });
  }
  return {
    type: 'attachment',
    attachmentId: artifact.id,
    fileName: artifact.name,
    mediaType: asset.contentType,
    sizeBytes: Number(asset.sizeBytes),
    status:
      artifact.status === StudioAgentArtifactStatus.pending
        ? 'processing'
        : artifact.status === StudioAgentArtifactStatus.failed
          ? 'failed'
          : 'ready',
  };
}

function registrationResult(
  artifact: {
    id: string;
    name: string;
    status: StudioAgentArtifactStatus;
  },
  asset: CanonicalMediaAsset,
  created: boolean,
): StudioAgentRegisterAttachmentResult {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    attachment: toAttachmentPart(artifact, asset),
    created,
  };
}

function attachmentPartsEqual(
  submitted: StudioAgentAttachmentMessagePart,
  canonical: StudioAgentAttachmentMessagePart,
): boolean {
  return (
    submitted.attachmentId === canonical.attachmentId &&
    submitted.fileName === canonical.fileName &&
    submitted.mediaType === canonical.mediaType &&
    submitted.sizeBytes === canonical.sizeBytes &&
    submitted.status === canonical.status
  );
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

function threadNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STUDIO_AGENT_THREAD_NOT_FOUND',
    message: 'Agent conversation not found.',
  });
}

interface PersistedArtifactError {
  code: string;
  message: string;
  retryable: boolean;
  details: null;
}

function persistedArtifactError(cause: unknown): PersistedArtifactError {
  if (cause instanceof Error) {
    const response =
      cause instanceof HttpException ? cause.getResponse() : null;
    const detail =
      response !== null && typeof response === 'object'
        ? (response as Record<string, unknown>)
        : {};
    return {
      code:
        typeof detail.code === 'string'
          ? detail.code.slice(0, 96)
          : 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED',
      message:
        typeof detail.message === 'string'
          ? detail.message.slice(0, 8_000)
          : cause.message.slice(0, 8_000),
      retryable:
        cause instanceof HttpException
          ? cause.getStatus() === 429 || cause.getStatus() >= 500
          : true,
      details: null,
    };
  }
  return {
    code: 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED',
    message: String(cause).slice(0, 8_000),
    retryable: true,
    details: null,
  };
}

function parsePersistedArtifactError(
  value: Prisma.JsonValue,
): PersistedArtifactError {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const code = value.code;
    const message = value.message;
    const retryable = value.retryable;
    if (
      typeof code === 'string' &&
      typeof message === 'string' &&
      typeof retryable === 'boolean'
    ) {
      return {
        code: code.slice(0, 96),
        message: message.slice(0, 8_000),
        retryable,
        details: null,
      };
    }
  }
  return {
    code: 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED',
    message: 'The document could not be processed.',
    retryable: false,
    details: null,
  };
}

function persistedArtifactException(
  error: PersistedArtifactError,
): HttpException {
  const response = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
  return error.retryable
    ? new ConflictException(response)
    : new UnprocessableEntityException(response);
}

function attachmentProcessingConflict(): ConflictException {
  return new ConflictException({
    code: 'STUDIO_AGENT_ATTACHMENT_NOT_READY',
    message: 'The attachment is still processing.',
    retryable: true,
  });
}

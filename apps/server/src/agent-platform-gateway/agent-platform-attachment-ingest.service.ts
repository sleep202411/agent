import {
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  AgentDocumentAnalysisJobStatus,
  AgentPlatformAttachmentIngestJobStatus,
  AgentPlatformAttachmentStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION } from '../agent-domain-gateway/story-source-material-index';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import {
  AGENT_ATTACHMENT_MEDIA_ASSET_SELECT,
  AGENT_DOCUMENT_ANALYSIS_VERSION,
  displayableAttachmentFailure,
  documentAnalysisTotalUnits,
  type AgentAttachmentFailure,
} from './agent-platform-attachment.persistence';
import { AgentPlatformAttachmentParser } from './agent-platform-attachment-parser';
import { AgentPlatformDocumentAnalysisDispatcherService } from './agent-platform-document-analysis-dispatcher.service';
import { AgentPlatformGatewayConfigService } from './agent-platform-gateway.config';

const MAX_BATCHES_PER_DRAIN = 8;
const SIGNED_DOWNLOAD_TTL_SECONDS = 10 * 60;
const RESTARTABLE_ANALYSIS_STATUSES = new Set<AgentDocumentAnalysisJobStatus>([
  AgentDocumentAnalysisJobStatus.failed,
  AgentDocumentAnalysisJobStatus.dead_lettered,
  AgentDocumentAnalysisJobStatus.cancelled,
]);

type IngestClaim = Readonly<{
  jobId: string;
  attachmentId: string;
  leaseToken: string;
  attemptCount: number;
  maxAttempts: number;
}>;

type CandidateRow = Readonly<{
  id: string;
  attachment_id: string;
  attempt_count: number;
  max_attempts: number;
}>;

export type AgentAttachmentIngestMetrics = Readonly<{
  claims: number;
  succeeded: number;
  retryScheduled: number;
  deadLettered: number;
  cancelled: number;
  drainFailures: number;
  activeWorkers: number;
  lastSuccessfulDrainAt: string | null;
}>;

@Injectable()
export class AgentPlatformAttachmentIngestService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  readonly #logger = new Logger(AgentPlatformAttachmentIngestService.name);
  readonly #config: AgentPlatformGatewayConfigService['values'];
  #timer: NodeJS.Timeout | null = null;
  #drain: Promise<void> | null = null;
  #drainRequested = false;
  #stopping = false;
  #consecutiveDrainFailures = 0;
  #lastSuccessfulDrainAt: Date | null = null;
  #activeWorkers = 0;
  #claims = 0;
  #succeeded = 0;
  #retryScheduled = 0;
  #deadLettered = 0;
  #cancelled = 0;
  #drainFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageAccessService,
    private readonly parser: AgentPlatformAttachmentParser,
    private readonly analyses: AgentPlatformDocumentAnalysisDispatcherService,
    config: AgentPlatformGatewayConfigService,
  ) {
    this.#config = config.values;
  }

  onApplicationBootstrap(): void {
    this.#timer = setInterval(() => {
      void this.wake();
    }, this.#config.attachmentIngestIntervalMs);
    this.#timer.unref();
    void this.wake();
  }

  async onModuleDestroy(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#drain;
  }

  async wake(): Promise<void> {
    if (this.#stopping) return;
    this.#drainRequested = true;
    if (this.#drain) return this.#drain;
    const drain = this.runRequestedDrains();
    const tracked = drain
      .catch((error: unknown) => {
        this.#consecutiveDrainFailures += 1;
        this.#drainFailures += 1;
        this.#logger.error(
          'Agent attachment ingest drain failed',
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        if (this.#drain === tracked) this.#drain = null;
      });
    this.#drain = tracked;
    return tracked;
  }

  metrics(): AgentAttachmentIngestMetrics {
    return {
      claims: this.#claims,
      succeeded: this.#succeeded,
      retryScheduled: this.#retryScheduled,
      deadLettered: this.#deadLettered,
      cancelled: this.#cancelled,
      drainFailures: this.#drainFailures,
      activeWorkers: this.#activeWorkers,
      lastSuccessfulDrainAt: this.#lastSuccessfulDrainAt?.toISOString() ?? null,
    };
  }

  async isReady(): Promise<boolean> {
    if (this.#stopping) return false;
    const staleAfterMs = Math.max(
      5_000,
      this.#config.attachmentIngestIntervalMs * 6,
    );
    if (
      this.#consecutiveDrainFailures >= 3 &&
      (!this.#lastSuccessfulDrainAt ||
        Date.now() - this.#lastSuccessfulDrainAt.getTime() > staleAfterMs)
    ) {
      return false;
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async runRequestedDrains(): Promise<void> {
    while (this.#drainRequested && !this.#stopping) {
      this.#drainRequested = false;
      const mayHaveMore = await this.runBoundedDrain();
      this.#consecutiveDrainFailures = 0;
      this.#lastSuccessfulDrainAt = new Date();
      if (mayHaveMore) {
        this.#drainRequested = true;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  private async runBoundedDrain(): Promise<boolean> {
    await this.deadLetterExhaustedClaims();
    for (
      let batch = 0;
      batch < MAX_BATCHES_PER_DRAIN && !this.#stopping;
      batch += 1
    ) {
      const claims = await this.claimDue(
        this.#config.attachmentIngestBatchSize,
      );
      if (claims.length === 0) return false;
      this.#claims += claims.length;
      await Promise.all(claims.map((claim) => this.process(claim)));
      if (claims.length < this.#config.attachmentIngestBatchSize) return false;
    }
    return !this.#stopping;
  }

  private claimDue(limit: number): Promise<IngestClaim[]> {
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<CandidateRow[]>`
        SELECT
          "id",
          "attachment_id",
          "attempt_count",
          "max_attempts"
        FROM "agent_platform_attachment_ingest_jobs"
        WHERE
          (
            (
              "status" IN (
                'queued'::"AgentPlatformAttachmentIngestJobStatus",
                'retry_wait'::"AgentPlatformAttachmentIngestJobStatus"
              )
              AND "available_at" <= CURRENT_TIMESTAMP
            )
            OR
            (
              "status" = 'leased'::"AgentPlatformAttachmentIngestJobStatus"
              AND "lease_until" <= CURRENT_TIMESTAMP
            )
          )
          AND "attempt_count" < "max_attempts"
        ORDER BY "available_at" ASC, "created_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `;
      const claims: IngestClaim[] = [];
      for (const candidate of candidates) {
        const leaseToken = randomUUID();
        const attemptCount = candidate.attempt_count + 1;
        await transaction.$executeRaw`
          UPDATE "agent_platform_attachment_ingest_jobs"
          SET
            "status" = 'leased'::"AgentPlatformAttachmentIngestJobStatus",
            "attempt_count" = ${attemptCount},
            "stage" = 'claimed',
            "progress" = 5,
            "lease_token" = ${leaseToken}::uuid,
            "lease_until" =
              CURRENT_TIMESTAMP
              + (${this.#config.attachmentProcessingLeaseMs} * INTERVAL '1 millisecond'),
            "last_heartbeat_at" = CURRENT_TIMESTAMP,
            "error" = NULL,
            "completed_at" = NULL,
            "dead_lettered_at" = NULL,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${candidate.id}::uuid
        `;
        claims.push({
          jobId: candidate.id,
          attachmentId: candidate.attachment_id,
          leaseToken,
          attemptCount,
          maxAttempts: candidate.max_attempts,
        });
      }
      return claims;
    });
  }

  private async process(claim: IngestClaim): Promise<void> {
    this.#activeWorkers += 1;
    const heartbeat = setInterval(
      () => {
        void this.heartbeat(claim, 'extracting', 40);
      },
      Math.max(1_000, Math.floor(this.#config.attachmentProcessingLeaseMs / 3)),
    );
    heartbeat.unref();
    try {
      const record =
        await this.prisma.agentPlatformAttachmentIngestJob.findUnique({
          where: { id: claim.jobId },
          select: {
            status: true,
            leaseToken: true,
            attachment: {
              select: {
                id: true,
                status: true,
                fileName: true,
                mediaType: true,
                sizeBytes: true,
                mediaAsset: {
                  select: AGENT_ATTACHMENT_MEDIA_ASSET_SELECT,
                },
              },
            },
          },
        });
      if (
        !record ||
        record.status !== AgentPlatformAttachmentIngestJobStatus.leased ||
        record.leaseToken !== claim.leaseToken
      ) {
        return;
      }
      if (record.attachment.status === AgentPlatformAttachmentStatus.revoked) {
        await this.cancelClaim(claim);
        return;
      }
      const expectedSizeBytes = Number(record.attachment.sizeBytes);
      if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0) {
        throw new PayloadTooLargeException({
          code: 'AGENT_ATTACHMENT_DOCUMENT_FILE_TOO_LARGE',
          message: 'The document size cannot be processed safely.',
          retryable: false,
        });
      }
      await this.heartbeat(claim, 'signing_download', 10);
      const signed = await this.createReadUrl(record.attachment.mediaAsset);
      const result = await this.parser.ingest({
        fileName: record.attachment.fileName,
        declaredMediaType: record.attachment.mediaType,
        downloadUrl: signed.url,
        expectedSizeBytes,
      });
      await this.heartbeat(claim, 'persisting_index', 90);
      const finalized = await this.finalize(claim, result);
      if (finalized) {
        this.#succeeded += 1;
        void this.analyses.wake();
        this.#logger.log({
          event: 'agent.attachment.ingest.succeeded',
          attachmentId: claim.attachmentId,
          attempt: claim.attemptCount,
          chunks: result.sourceIndex.chunks.length,
          characters: result.projection.charCount,
        });
      }
    } catch (error) {
      await this.recordFailure(claim, displayableAttachmentFailure(error));
    } finally {
      clearInterval(heartbeat);
      this.#activeWorkers -= 1;
    }
  }

  private async createReadUrl(
    asset: Parameters<MediaStorageAccessService['createReadUrl']>[0],
  ) {
    let signed: Awaited<ReturnType<MediaStorageAccessService['createReadUrl']>>;
    try {
      signed = await this.storage.createReadUrl(asset, {
        expiresInSeconds: SIGNED_DOWNLOAD_TTL_SECONDS,
        cacheControl: 'private, no-store',
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'AGENT_ATTACHMENT_STORAGE_UNAVAILABLE',
        message:
          'The uploaded attachment could not be read from media storage.',
        retryable: true,
      });
    }
    if (
      signed.bucket !== asset.bucket ||
      signed.objectKey !== asset.objectKey
    ) {
      throw new ServiceUnavailableException({
        code: 'AGENT_ATTACHMENT_STORAGE_IDENTITY_MISMATCH',
        message: 'Media storage returned a different attachment identity.',
        retryable: true,
      });
    }
    return signed;
  }

  private async finalize(
    claim: IngestClaim,
    result: Awaited<ReturnType<AgentPlatformAttachmentParser['ingest']>>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const fenced = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "agent_platform_attachment_ingest_jobs"
        WHERE
          "id" = ${claim.jobId}::uuid
          AND "status" = 'leased'::"AgentPlatformAttachmentIngestJobStatus"
          AND "lease_token" = ${claim.leaseToken}::uuid
          AND "lease_until" > CURRENT_TIMESTAMP
        FOR UPDATE
      `;
      if (fenced.length !== 1) return false;
      const attachments = await transaction.$queryRaw<
        Array<{ id: string; status: AgentPlatformAttachmentStatus }>
      >`
        SELECT "id", "status"
        FROM "agent_platform_attachments"
        WHERE "id" = ${claim.attachmentId}::uuid
        FOR UPDATE
      `;
      const attachment = attachments[0];
      if (
        !attachment ||
        attachment.status === AgentPlatformAttachmentStatus.revoked
      ) {
        await transaction.agentPlatformAttachmentIngestJob.update({
          where: { id: claim.jobId },
          data: {
            status: AgentPlatformAttachmentIngestJobStatus.cancelled,
            stage: 'cancelled',
            leaseToken: null,
            leaseUntil: null,
            completedAt: new Date(),
          },
        });
        return false;
      }
      const now = new Date();
      await transaction.agentPlatformAttachment.update({
        where: { id: claim.attachmentId },
        data: {
          status: AgentPlatformAttachmentStatus.ready,
          contentHash: result.projection.contentHash,
          documentText: result.projection.text,
          documentCharCount: result.projection.charCount,
          documentPageCount: result.projection.pageCount,
          documentIndex:
            result.sourceIndex as unknown as Prisma.InputJsonObject,
          documentIndexVersion: STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
          error: Prisma.DbNull,
          readyAt: now,
          revokedAt: null,
        },
      });
      const analysis = await transaction.agentDocumentAnalysisJob.findUnique({
        where: {
          attachmentId_analysisVersion_sourceContentHash: {
            attachmentId: claim.attachmentId,
            analysisVersion: AGENT_DOCUMENT_ANALYSIS_VERSION,
            sourceContentHash: result.projection.contentHash,
          },
        },
      });
      const totalUnits = documentAnalysisTotalUnits(
        result.sourceIndex.chunks.length,
      );
      if (!analysis) {
        await transaction.agentDocumentAnalysisJob.create({
          data: {
            attachmentId: claim.attachmentId,
            analysisVersion: AGENT_DOCUMENT_ANALYSIS_VERSION,
            sourceContentHash: result.projection.contentHash,
            totalUnits,
          },
        });
      } else if (RESTARTABLE_ANALYSIS_STATUSES.has(analysis.status)) {
        await transaction.agentDocumentAnalysisJob.update({
          where: { id: analysis.id },
          data: {
            status: AgentDocumentAnalysisJobStatus.queued,
            temporalWorkflowId: null,
            dispatchAttemptCount: 0,
            nextDispatchAt: now,
            dispatchLeaseToken: null,
            dispatchLeaseUntil: null,
            stage: 'queued',
            completedUnits: 0,
            totalUnits,
            error: Prisma.DbNull,
            startedAt: null,
            completedAt: null,
            deadLetteredAt: null,
          },
        });
      }
      await transaction.agentPlatformAttachmentIngestJob.update({
        where: { id: claim.jobId },
        data: {
          status: AgentPlatformAttachmentIngestJobStatus.succeeded,
          stage: 'ready',
          progress: 100,
          leaseToken: null,
          leaseUntil: null,
          lastHeartbeatAt: now,
          error: Prisma.DbNull,
          completedAt: now,
          deadLetteredAt: null,
        },
      });
      return true;
    });
  }

  private async recordFailure(
    claim: IngestClaim,
    failure: AgentAttachmentFailure,
  ): Promise<void> {
    const retry = failure.retryable && claim.attemptCount < claim.maxAttempts;
    const delayMs = retryBackoffMs(claim.jobId, claim.attemptCount);
    const recorded = await this.prisma.$transaction(async (transaction) => {
      const fenced = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "agent_platform_attachment_ingest_jobs"
        WHERE
          "id" = ${claim.jobId}::uuid
          AND "status" = 'leased'::"AgentPlatformAttachmentIngestJobStatus"
          AND "lease_token" = ${claim.leaseToken}::uuid
        FOR UPDATE
      `;
      if (fenced.length !== 1) return false;
      if (retry) {
        await transaction.$executeRaw`
          UPDATE "agent_platform_attachment_ingest_jobs"
          SET
            "status" = 'retry_wait'::"AgentPlatformAttachmentIngestJobStatus",
            "stage" = 'retry_wait',
            "progress" = 0,
            "available_at" =
              CURRENT_TIMESTAMP + (${delayMs} * INTERVAL '1 millisecond'),
            "lease_token" = NULL,
            "lease_until" = NULL,
            "error" = ${JSON.stringify(failure)}::jsonb,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${claim.jobId}::uuid
        `;
        return true;
      }
      const terminalFailure = failure.retryable
        ? {
            code: 'AGENT_ATTACHMENT_PROCESSING_EXHAUSTED',
            message:
              'Automatic document processing exhausted its retry budget. Retry the attachment when the dependency has recovered.',
            retryable: true,
          }
        : failure;
      const now = new Date();
      await transaction.agentPlatformAttachmentIngestJob.update({
        where: { id: claim.jobId },
        data: {
          status: AgentPlatformAttachmentIngestJobStatus.dead_lettered,
          stage: 'dead_lettered',
          leaseToken: null,
          leaseUntil: null,
          error: terminalFailure as unknown as Prisma.InputJsonObject,
          completedAt: now,
          deadLetteredAt: now,
        },
      });
      await transaction.agentPlatformAttachment.updateMany({
        where: {
          id: claim.attachmentId,
          status: AgentPlatformAttachmentStatus.processing,
        },
        data: {
          status: AgentPlatformAttachmentStatus.failed,
          error: terminalFailure as unknown as Prisma.InputJsonObject,
        },
      });
      return true;
    });
    if (!recorded) return;
    if (retry) {
      this.#retryScheduled += 1;
      this.#logger.warn({
        event: 'agent.attachment.ingest.retry_scheduled',
        attachmentId: claim.attachmentId,
        attempt: claim.attemptCount,
        nextDelayMs: delayMs,
        code: failure.code,
      });
      return;
    }
    this.#deadLettered += 1;
    this.#logger.error({
      event: 'agent.attachment.ingest.dead_lettered',
      attachmentId: claim.attachmentId,
      attempt: claim.attemptCount,
      code: failure.code,
    });
  }

  private async cancelClaim(claim: IngestClaim): Promise<void> {
    const updated =
      await this.prisma.agentPlatformAttachmentIngestJob.updateMany({
        where: {
          id: claim.jobId,
          status: AgentPlatformAttachmentIngestJobStatus.leased,
          leaseToken: claim.leaseToken,
        },
        data: {
          status: AgentPlatformAttachmentIngestJobStatus.cancelled,
          stage: 'cancelled',
          leaseToken: null,
          leaseUntil: null,
          completedAt: new Date(),
        },
      });
    if (updated.count === 1) this.#cancelled += 1;
  }

  private async heartbeat(
    claim: IngestClaim,
    stage: string,
    progress: number,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "agent_platform_attachment_ingest_jobs"
      SET
        "stage" = ${stage},
        "progress" = ${progress},
        "lease_until" =
          CURRENT_TIMESTAMP
          + (${this.#config.attachmentProcessingLeaseMs} * INTERVAL '1 millisecond'),
        "last_heartbeat_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE
        "id" = ${claim.jobId}::uuid
        AND "status" = 'leased'::"AgentPlatformAttachmentIngestJobStatus"
        AND "lease_token" = ${claim.leaseToken}::uuid
    `;
  }

  private async deadLetterExhaustedClaims(): Promise<void> {
    const failure = {
      code: 'AGENT_ATTACHMENT_PROCESSING_EXHAUSTED',
      message:
        'Automatic document processing stopped after repeated worker interruptions. Retry the attachment when the dependency has recovered.',
      retryable: true,
    } satisfies AgentAttachmentFailure;
    await this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<CandidateRow[]>`
        SELECT
          "id",
          "attachment_id",
          "attempt_count",
          "max_attempts"
        FROM "agent_platform_attachment_ingest_jobs"
        WHERE
          (
            (
              "status" IN (
                'queued'::"AgentPlatformAttachmentIngestJobStatus",
                'retry_wait'::"AgentPlatformAttachmentIngestJobStatus"
              )
              AND "available_at" <= CURRENT_TIMESTAMP
            )
            OR
            (
              "status" = 'leased'::"AgentPlatformAttachmentIngestJobStatus"
              AND "lease_until" <= CURRENT_TIMESTAMP
            )
          )
          AND "attempt_count" >= "max_attempts"
        ORDER BY "created_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${this.#config.attachmentIngestBatchSize}
      `;
      if (candidates.length === 0) return;
      const now = new Date();
      for (const candidate of candidates) {
        await transaction.agentPlatformAttachmentIngestJob.update({
          where: { id: candidate.id },
          data: {
            status: AgentPlatformAttachmentIngestJobStatus.dead_lettered,
            stage: 'dead_lettered',
            leaseToken: null,
            leaseUntil: null,
            error: failure,
            completedAt: now,
            deadLetteredAt: now,
          },
        });
        await transaction.agentPlatformAttachment.updateMany({
          where: {
            id: candidate.attachment_id,
            status: AgentPlatformAttachmentStatus.processing,
          },
          data: {
            status: AgentPlatformAttachmentStatus.failed,
            error: failure,
          },
        });
      }
      this.#deadLettered += candidates.length;
    });
  }
}

function retryBackoffMs(jobId: string, attempt: number): number {
  const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  const stableJitter =
    Number.parseInt(jobId.replaceAll('-', '').slice(-4), 16) / 0xffff;
  return Math.round(base * (0.8 + stableJitter * 0.4));
}

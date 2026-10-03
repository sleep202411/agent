/**
 * Postgres-backed jobs repository (Prisma).
 *
 * Public surface matches the in-memory store it replaced so call sites
 * in AiGenerationService / AiGenerationWorkerService barely changed. Translation
 * between the canonical `AiJob` shape (ISO date strings) and
 * Prisma's `Date` columns lives in `toDomain` / `toRow` / `patchToRow`.
 *
 * Outputs are written via `upsert` so a redrive after a partial write
 * (DB row created, upload completed, app crashed before final commit)
 * is idempotent — same outputIndex resolves to the same row.
 */
import { Injectable } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetUsageRole,
  MediaAssetUsageSurface,
  MediaAssetVisibility,
  MediaStorageProvider,
  Prisma,
} from '@prisma/client';
import type {
  AiJobAttempt as AiJobAttemptRow,
  AiAttemptStatus as AiAttemptStatusRow,
  AiEventOutbox as AiEventOutboxRow,
  AiJob as AiJobRow,
  AiJobOutput as AiJobOutputRow,
  AiProviderTraceEvent as AiProviderTraceEventRow,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { newShortId } from '../common/id';
import { ensureOriginalMediaPlacement } from '../infra/storage/media-asset-placement';
import type { StorageProviderId } from '../infra/storage/storage.types';
import type {
  AiEtaConfidence,
  AiJobStatus,
  AiJob,
  AiJobError,
  AiJobLog,
  AiJobMetrics,
  AiJobOutput,
  AiJobStage,
  AiJobType,
  AiRoutingSnapshot,
} from './types';
import type { ProviderAsyncOperationContext } from './provider-adapter';

export interface AiJobListOptions {
  ids?: string[];
  idempotencyKey?: string;
  documentBlockId?: string;
  userId: string;
  workspaceId?: string;
  projectId?: string;
  storyProjectId?: string;
  documentId?: string;
  sourceSurface?: string;
  includeCollaboratorJobs?: boolean;
  type?: AiJobType;
  limit?: number;
}

export type ReserveQueuedJobResult =
  | { kind: 'existing'; job: AiJob }
  | { kind: 'queued_limit'; limit: number }
  | {
      kind: 'campaign_limit';
      campaignId: string;
      scope: 'user' | 'campaign';
      limit: number;
    }
  | { kind: 'created'; job: AiJob; repositioned: AiJob[] };

export interface ReserveQueuedJobOptions {
  userId: string;
  modelId: string;
  idempotencyKey: string;
  queueName: AiJob['queueName'];
  type: AiJobType;
  limitSubject: AiJobLimitSubject;
  perSubjectQueued: number | null;
  campaignLimit?: {
    campaignId: string;
    perUserLimit?: number;
    totalLimit?: number;
  };
  beforeCreate?: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>;
  /**
   * Product-plane rows that own an AI job may be inserted here after the
   * canonical AiJob row exists, but before the reservation transaction
   * commits. This is deliberately distinct from `beforeCreate`: product-plane
   * foreign keys to the job require the canonical row to exist first.
   */
  afterCreate?: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>;
  buildJob: (queuePosition: number) => AiJob;
}

export interface CancelActiveJobOptions {
  observedJob: AiJob;
  patch: Partial<AiJob>;
  /**
   * Product-plane owners may establish their own serialization barrier before
   * the AiJob cancellation is claimed. The callback and the conditional
   * AiJob transition commit in one transaction; it must never perform network
   * I/O.
   */
  beforeCancel?: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>;
  /**
   * Runs only when the authoritative AiJob outcome is `cancelled`, after that
   * outcome is known and before the transaction commits. Product owners use
   * this to make their visible terminal state share the same acceptance point.
   */
  afterCancel?: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>;
}

export interface AiJobLimitSubject {
  type: 'user' | 'workspace';
  id: string;
}

export type ClaimQueuedJobResult =
  | { kind: 'claimed'; job: AiJob; repositioned: AiJob[] }
  | { kind: 'missing' }
  | { kind: 'not_queued'; job: AiJob }
  | {
      kind: 'running_limit';
      scope: 'subject' | 'type';
      limit: number;
      running: number;
      type: AiJobType;
    };

export interface ClaimQueuedJobOptions {
  jobId: string;
  limitSubject: AiJobLimitSubject;
  perSubjectRunning: number | null;
  perTypeRunning: number | null;
  now: string;
}

export interface RecordAiJobAttemptInput {
  status: AiAttemptStatusRow;
  providerStatus?: number | null;
  providerRequestId?: string | null;
  providerEndpoint?: string | null;
  queuePosition?: number | null;
  providerRequest?: Record<string, unknown> | null;
  providerRequestHeaders?: Record<string, unknown> | null;
  providerResponse?: unknown;
  providerResponseHeaders?: Record<string, unknown> | null;
  providerLogs?: unknown;
  costAccounting?: Record<string, unknown> | null;
  pricingSnapshot?: Record<string, unknown> | null;
  profitAccounting?: Record<string, unknown> | null;
  timing?: Record<string, unknown> | null;
  rawStatus?: unknown;
  error?: AiJobError | null;
  runDurationMs?: number | null;
  submittedAt?: string | null;
  executionStartedAt?: string | null;
  firstByteAt?: string | null;
  completedAt?: string | null;
}

export interface RecordAiCostLedgerEntryInput {
  attemptId?: string | null;
  providerBindingId?: string | null;
  entryType:
    | 'reservation'
    | 'charge'
    | 'refund'
    | 'provider_cost'
    | 'adjustment';
  currency: string;
  amount: number;
  internalCredits?: number | null;
  providerCostUsd?: number | null;
  listPriceCredits?: number | null;
  marginUsd?: number | null;
  pricingSnapshot?: Record<string, unknown> | null;
  idempotencyKey: string;
  source: string;
  metadata?: Record<string, unknown> | null;
}

export interface RecordAiProviderTraceEventInput {
  attemptId?: string | null;
  provider?: string | null;
  endpointId?: string | null;
  providerRequestId?: string | null;
  eventType: string;
  source: string;
  confidence: string;
  occurredAt?: string | null;
  offsetMs?: number | null;
  durationMs?: number | null;
  title?: string | null;
  description?: string | null;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}

export interface CreateAiOutputAssetInput {
  type: AiJobType;
  url: string;
  storageProvider: StorageProviderId;
  bucket: string;
  region: string | null;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  durationSeconds?: number;
  videoMetadata?: {
    videoCodec: string;
    audioCodecs: string[];
    browserSafeMp4: boolean;
  };
  audioMetadata?: {
    audioCodec: string;
    sampleRate: number;
    channels: number;
  };
  checksumSha256: string;
  outputIndex: number;
  contentHash: string;
  safetyFlags?: Record<string, unknown>;
}

/**
 * Thrown by `repository.update(id, patch, expectedVersion)` when the
 * row's current `version` no longer matches what the caller saw.
 * Callers should re-read and decide whether to retry, merge, or skip.
 */
export class OptimisticLockError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly expectedVersion: number,
  ) {
    super(
      `Optimistic lock failed on AiJob ${jobId} (expected version ${expectedVersion})`,
    );
    this.name = 'OptimisticLockError';
  }
}

type AiJobOutputAssetRow = {
  status: MediaAssetStatus;
  moderationStatus: MediaAssetModerationStatus;
  deletedAt: Date | null;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
};
type AiJobOutputWithAssetRow = AiJobOutputRow & {
  asset: AiJobOutputAssetRow | null;
};
type JobWithOutputs = AiJobRow & { outputs: AiJobOutputWithAssetRow[] };
type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AiGenerationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urlResolver: MediaAssetUrlResolverService,
  ) {}

  /**
   * `findById` and friends hide soft-deleted rows by default. Pass
   * `{ includeDeleted: true }` for admin / debug paths that need the
   * tombstone — never expose those to end users.
   */
  async findById(
    id: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<AiJob | null> {
    const row = await this.prisma.aiJob.findFirst({
      where: { id, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
      include: { outputs: this.outputsInclude(opts.includeDeleted) },
    });
    return row ? this.toDomain(row) : null;
  }

  private async findByIdWith(
    client: DbClient,
    id: string,
  ): Promise<AiJob | null> {
    const row = await client.aiJob.findFirst({
      where: { id, deletedAt: null },
      include: { outputs: this.outputsInclude(false) },
    });
    return row ? this.toDomain(row) : null;
  }

  async findRetryForJob(
    userId: string,
    retryOfJobId: string,
  ): Promise<AiJob | null> {
    const row = await this.prisma.aiJob.findFirst({
      where: { userId, retryOfJobId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { outputs: this.outputsInclude(false) },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByIdempotency(
    userId: string,
    modelId: string,
    idempotencyKey: string,
  ): Promise<AiJob | null> {
    // Active-row idempotency is enforced by a partial unique index
    // (`deleted_at IS NULL`) in migration SQL. We mirror that predicate
    // here so soft-deleted tombstones never shadow a re-submission.
    const row = await this.prisma.aiJob.findFirst({
      where: { userId, modelId, idempotencyKey, deletedAt: null },
      include: { outputs: this.outputsInclude(false) },
    });
    return row ? this.toDomain(row) : null;
  }

  /**
   * Atomically reserves one queued backlog slot for the entitlement subject.
   * Running concurrency is claimed later by workers so submissions can wait
   * instead of being rejected just because the current plan is busy.
   */
  async reserveQueuedJob(
    options: ReserveQueuedJobOptions,
  ): Promise<ReserveQueuedJobResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockKeysWith(tx, [
        `ai-generation:user:${options.userId}`,
        limitSubjectLockKey(options.limitSubject),
      ]);

      const existing = await this.findByIdempotencyWith(
        tx,
        options.userId,
        options.modelId,
        options.idempotencyKey,
      );
      if (existing) return { kind: 'existing', job: existing };

      if (options.campaignLimit) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`ai-generation:campaign:${options.campaignLimit.campaignId}`})::bigint)
        `;

        const perUserLimit = options.campaignLimit.perUserLimit;
        if (perUserLimit != null) {
          const userCampaignCount = await this.countAcceptedCampaignJobsWith(
            tx,
            options.campaignLimit.campaignId,
            options.userId,
          );
          if (userCampaignCount >= perUserLimit) {
            return {
              kind: 'campaign_limit',
              campaignId: options.campaignLimit.campaignId,
              scope: 'user',
              limit: perUserLimit,
            };
          }
        }

        const totalLimit = options.campaignLimit.totalLimit;
        if (totalLimit != null) {
          const campaignCount = await this.countAcceptedCampaignJobsWith(
            tx,
            options.campaignLimit.campaignId,
          );
          if (campaignCount >= totalLimit) {
            return {
              kind: 'campaign_limit',
              campaignId: options.campaignLimit.campaignId,
              scope: 'campaign',
              limit: totalLimit,
            };
          }
        }
      }

      const active = await this.activeForSubjectWith(tx, options.limitSubject);
      const queuedTotal = active.filter(
        (job) => job.status === 'in_queue',
      ).length;

      if (
        options.perSubjectQueued != null &&
        queuedTotal >= options.perSubjectQueued
      ) {
        return { kind: 'queued_limit', limit: options.perSubjectQueued };
      }

      const queuePosition = (
        await this.waitingInQueueWith(tx, options.queueName)
      ).length;
      const job = options.buildJob(queuePosition);
      await options.beforeCreate?.(tx, job);
      await tx.aiJob.create({ data: this.toRow(job) });
      await options.afterCreate?.(tx, job);
      const repositioned = await this.recomputeQueuePositionsWith(
        tx,
        options.queueName,
      );
      return { kind: 'created', job, repositioned };
    });
  }

  async recordUnknownAcceptance(jobId: string): Promise<boolean> {
    const result = await this.prisma.aiJob.updateMany({
      where: {
        id: jobId,
        status: 'in_progress',
        providerJobId: null,
        deletedAt: null,
      },
      data: {
        error: {
          code: 'WORKER_CRASHED',
          message:
            'Worker interrupted before provider acceptance could be confirmed. Reconcile provider records before retry or refund.',
          userMessage:
            'Generation status needs review. Your task has been preserved; do not submit it again.',
          retryable: false,
          createdAt: new Date().toISOString(),
        },
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async claimQueuedJob(
    options: ClaimQueuedJobOptions,
  ): Promise<ClaimQueuedJobResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockKeysWith(tx, [limitSubjectLockKey(options.limitSubject)]);

      const row = await tx.aiJob.findFirst({
        where: { id: options.jobId, deletedAt: null },
        include: { outputs: this.outputsInclude(false) },
      });
      if (!row) return { kind: 'missing' };

      const job = this.toDomain(row);
      if (job.status !== 'in_queue') return { kind: 'not_queued', job };

      const active = await this.activeForSubjectWith(tx, options.limitSubject);
      const running = active.filter(
        (candidate) =>
          candidate.id !== job.id && candidate.status === 'in_progress',
      );
      const runningSameType = running.filter(
        (candidate) => candidate.type === job.type,
      );

      if (
        options.perSubjectRunning != null &&
        running.length >= options.perSubjectRunning
      ) {
        return {
          kind: 'running_limit',
          scope: 'subject',
          limit: options.perSubjectRunning,
          running: running.length,
          type: job.type,
        };
      }
      if (
        options.perTypeRunning != null &&
        runningSameType.length >= options.perTypeRunning
      ) {
        return {
          kind: 'running_limit',
          scope: 'type',
          limit: options.perTypeRunning,
          running: runningSameType.length,
          type: job.type,
        };
      }

      const data = this.patchToRow({
        status: 'in_progress',
        stage: 'calling_provider',
        startedAt: options.now,
        queuePosition: null,
        progress: 0,
        logs: [
          ...job.logs,
          {
            time: options.now,
            stage: 'calling_provider',
            message: 'Picked up by worker.',
          },
        ],
      });
      // The claim write must itself be the barrier, not just the read above:
      // `cancelIfActive` commits out-of-band from this transaction, so the job
      // can turn 'cancelled' between the read and this write. An unconditional
      // update would stomp that committed terminal state back to in_progress —
      // the job would run to completion and be delivered while the cancel had
      // already released (refunded) the wallet hold. Conditioning on
      // status = 'in_queue' makes any committed terminal transition win.
      const claimWrite = await tx.aiJob.updateMany({
        where: { id: job.id, status: 'in_queue' },
        data: { ...data, version: { increment: 1 } },
      });
      if (claimWrite.count === 0) {
        const current = await this.findByIdWith(tx, job.id);
        if (!current) return { kind: 'missing' };
        return { kind: 'not_queued', job: current };
      }
      const claimed = (await this.findByIdWith(tx, job.id)) ?? job;
      const repositioned = await this.recomputeQueuePositionsWith(
        tx,
        job.queueName,
      );
      return { kind: 'claimed', job: claimed, repositioned };
    });
  }

  async save(job: AiJob): Promise<AiJob> {
    const data = this.toRow(job);
    await this.prisma.aiJob.upsert({
      where: { id: job.id },
      create: data,
      update: data,
    });
    if (job.outputs.length > 0) await this.replaceOutputs(job.id, job.outputs);
    return job;
  }

  /**
   * Update a job. If `expectedVersion` is provided, the update is
   * conditioned on `WHERE id = ? AND version = ?` and bumps `version`
   * atomically; if nothing matched the call throws `OptimisticLockError`
   * (some other writer got there first; caller should re-read).
   *
   * Without `expectedVersion` the update is an unconditional overwrite
   * — fine for paths that already hold an external lock (BullMQ
   * processor holds the job exclusively), or for callers that don't
   * care about the race.
   *
   * Returns `null` if the row doesn't exist (or was soft-deleted in
   * the unconditional path).
   */
  async update(
    id: string,
    patch: Partial<AiJob>,
    expectedVersion?: number,
  ): Promise<AiJob | null> {
    const data = this.patchToRow(patch);
    if (expectedVersion != null) {
      const result = await this.prisma.aiJob.updateMany({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) {
        // Distinguish "missing" from "stale": one quick read tells us.
        const exists = await this.prisma.aiJob.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!exists) return null;
        throw new OptimisticLockError(id, expectedVersion);
      }
    } else {
      try {
        await this.prisma.aiJob.update({
          where: { id },
          data: { ...data, version: { increment: 1 } },
        });
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('Record to update not found')
        ) {
          return null;
        }
        throw err;
      }
    }
    if (patch.outputs) await this.replaceOutputs(id, patch.outputs);
    return this.findById(id);
  }

  /**
   * Claim a running job's terminal completion atomically:
   * `UPDATE ... WHERE id = ? AND status = 'in_progress'`. Returns the fresh
   * row if THIS call won the transition, or `null` if the job already left
   * in_progress — i.e. a user cancel (issued out-of-band from the API, not
   * through the BullMQ processor) got there first. The caller MUST treat null
   * as "someone else owns the outcome" and discard: this is the barrier that
   * stops a cancelled job from being delivered, and stops us from settling a
   * hold the cancel path already released.
   */
  async completeIfRunning(
    id: string,
    patch: Partial<AiJob>,
  ): Promise<AiJob | null> {
    const data = this.patchToRow(patch);
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.aiJob.updateMany({
        where: { id, status: 'in_progress' },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) return null;

      // The terminal state and its outputs are one fact. Keeping these writes
      // in the same transaction prevents a process crash from leaving a
      // `completed` AiJob whose output rows (and output usage ledger) were
      // never committed. Product-plane completion observers can therefore
      // safely treat a completed job as having its durable outputs present.
      if (patch.outputs) {
        await this.replaceOutputsWith(tx, id, patch.outputs);
      }
      return this.findByIdWith(tx, id);
    });
  }

  /**
   * Requeue a retryable failure atomically, but ONLY if the job is still
   * running (`WHERE id = ? AND status = 'in_progress'`). Returns the fresh row
   * if the requeue applied, or `null` if the job already left in_progress — a
   * user cancel refunded and terminated it out-of-band. Treating null as
   * "don't re-enqueue" is what stops a cancelled+refunded job from being
   * resurrected to in_queue and re-run into a free (unsettleable) generation.
   */
  async requeueIfRunning(
    id: string,
    patch: Partial<AiJob>,
  ): Promise<AiJob | null> {
    const data = this.patchToRow(patch);
    const result = await this.prisma.aiJob.updateMany({
      where: { id, status: 'in_progress' },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    if (patch.outputs) await this.replaceOutputs(id, patch.outputs);
    return this.findById(id);
  }

  /** Ignore progress from a terminal job or an obsolete provider attempt. */
  async updateProgressIfRunning(
    job: Pick<AiJob, 'id' | 'attempt' | 'providerJobId'>,
    patch: Pick<
      Partial<AiJob>,
      'stage' | 'progress' | 'providerStartedAt' | 'logs'
    >,
  ): Promise<AiJob | null> {
    const data = this.patchToRow(patch);
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.aiJob.updateMany({
        where: {
          id: job.id,
          status: 'in_progress',
          deletedAt: null,
          attempt: job.attempt,
          providerJobId: job.providerJobId ?? null,
        },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) return null;
      return this.findByIdWith(tx, job.id);
    });
  }

  /** A late provider error must not overwrite a terminal outcome. */
  async failIfActive(id: string, patch: Partial<AiJob>): Promise<AiJob | null> {
    const data = this.patchToRow({
      ...patch,
      status: 'failed',
      stage: 'failed',
    });
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.aiJob.updateMany({
        where: { id, status: { in: ['created', 'in_queue', 'in_progress'] } },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) return null;
      return this.findByIdWith(tx, id);
    });
  }

  /**
   * Claim a cancellation atomically: only transitions a job that is still in a
   * cancellable (non-terminal) state. Returns the fresh row if THIS call won,
   * or `null` if the job already reached a terminal state (e.g. the worker
   * completed it first). The caller must release the hold / provider slot ONLY
   * when this returns non-null, so a cancel that lost the race can never refund
   * an already-charged, delivered job.
   */
  async cancelIfActive(
    id: string,
    options: CancelActiveJobOptions,
  ): Promise<AiJob | null> {
    if (options.observedJob.id !== id) {
      throw new Error('AiJob cancellation observation does not match job id.');
    }
    const data = this.patchToRow(options.patch);
    return this.prisma.$transaction(async (tx) => {
      // The hook deliberately runs before touching the AiJob row. Story-owned
      // jobs use it to lock the permanent project write-state first, giving
      // Agent apply and human cancellation one globally consistent lock order.
      // The conditional UPDATE below remains the terminal-outcome race winner.
      if (options.beforeCancel) {
        await options.beforeCancel(tx, options.observedJob);
      }

      const result = await tx.aiJob.updateMany({
        where: { id, status: { in: ['created', 'in_queue', 'in_progress'] } },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) {
        const winner = await this.findByIdWith(tx, id);
        if (winner?.status === 'cancelled' && options.afterCancel) {
          await options.afterCancel(tx, winner);
        }
        return null;
      }
      if (options.patch.outputs) {
        throw new Error(
          'AiJob cancellation cannot replace outputs inside the cancellation claim.',
        );
      }
      const cancelled = await this.findByIdWith(tx, id);
      if (!cancelled) {
        throw new Error(
          'Cancelled AiJob disappeared before transaction commit.',
        );
      }
      if (options.afterCancel) await options.afterCancel(tx, cancelled);
      return cancelled;
    });
  }

  async recordAttempt(
    job: Pick<AiJob, 'id' | 'attempt'>,
    input: RecordAiJobAttemptInput,
  ): Promise<AiJobAttemptRow> {
    const existing = await this.prisma.aiJobAttempt.findFirst({
      where: { jobId: job.id, attemptNumber: job.attempt },
    });
    const data = this.toAttemptRow(job, input);
    if (existing) {
      return this.prisma.aiJobAttempt.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.aiJobAttempt.create({
      data: {
        ...data,
        id: newShortId(),
        jobId: job.id,
        attemptNumber: job.attempt,
        startedAt: new Date(),
      } as Prisma.AiJobAttemptUncheckedCreateInput,
    });
  }

  async findProviderAttemptContext(
    job: Pick<AiJob, 'id' | 'attempt'>,
  ): Promise<ProviderAsyncOperationContext | undefined> {
    const row = await this.prisma.aiJobAttempt.findFirst({
      where: { jobId: job.id, attemptNumber: job.attempt },
      select: {
        providerEndpoint: true,
        providerRequestId: true,
        providerRequest: true,
        providerResponse: true,
        providerResponseHeaders: true,
        rawStatus: true,
      },
    });
    if (!row) return undefined;
    return {
      providerEndpoint: row.providerEndpoint,
      providerRequestId: row.providerRequestId,
      providerRequest: jsonRecordOrNull(row.providerRequest),
      providerResponse: row.providerResponse,
      providerResponseHeaders: stringRecordOrNull(row.providerResponseHeaders),
      rawStatus: row.rawStatus,
    };
  }

  async recordCostLedgerEntry(
    job: Pick<AiJob, 'id' | 'userId' | 'workspaceId'>,
    input: RecordAiCostLedgerEntryInput,
  ) {
    const data: Prisma.AiCostLedgerEntryUncheckedCreateInput = {
      jobId: job.id,
      attemptId: input.attemptId ?? null,
      providerBindingId: input.providerBindingId ?? null,
      userId: job.userId,
      workspaceId: job.workspaceId ?? null,
      entryType: input.entryType,
      currency: input.currency,
      amount: input.amount,
      internalCredits: input.internalCredits ?? null,
      providerCostUsd: input.providerCostUsd ?? null,
      listPriceCredits: input.listPriceCredits ?? null,
      marginUsd: input.marginUsd ?? null,
      pricingSnapshot:
        (input.pricingSnapshot as Prisma.InputJsonValue | undefined) ?? {},
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? {},
    };
    return await this.prisma.aiCostLedgerEntry.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: data,
      update: {
        attemptId: data.attemptId,
        providerBindingId: data.providerBindingId,
        currency: data.currency,
        amount: data.amount,
        internalCredits: data.internalCredits,
        providerCostUsd: data.providerCostUsd,
        listPriceCredits: data.listPriceCredits,
        marginUsd: data.marginUsd,
        pricingSnapshot: data.pricingSnapshot,
        source: data.source,
        metadata: data.metadata,
      },
    });
  }

  async recordProviderTraceEvent(
    job: Pick<AiJob, 'id' | 'provider' | 'deployment' | 'createdAt'>,
    input: RecordAiProviderTraceEventInput,
  ): Promise<AiProviderTraceEventRow> {
    const occurredAt = parseDateOrNow(input.occurredAt);
    const offsetMs =
      input.offsetMs ?? elapsedMsFromIso(job.createdAt, occurredAt);
    const idempotencyKey =
      input.idempotencyKey ??
      [
        'ai_trace',
        job.id,
        input.source,
        input.eventType,
        input.providerRequestId ?? '',
        occurredAt.toISOString(),
      ].join(':');

    const data: Prisma.AiProviderTraceEventUncheckedCreateInput = {
      jobId: job.id,
      attemptId: input.attemptId ?? null,
      provider: input.provider?.trim() || job.provider,
      endpointId: input.endpointId?.trim() || job.deployment,
      providerRequestId: input.providerRequestId?.trim() || null,
      eventType: input.eventType,
      source: input.source,
      confidence: input.confidence,
      occurredAt,
      offsetMs,
      durationMs: input.durationMs ?? null,
      title: input.title ?? null,
      description: input.description ?? null,
      payload: (input.payload as Prisma.InputJsonValue | undefined) ?? {},
      idempotencyKey,
    };

    try {
      return await this.prisma.aiProviderTraceEvent.create({ data });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return this.prisma.aiProviderTraceEvent.findUniqueOrThrow({
          where: { idempotencyKey },
        });
      }
      throw err;
    }
  }

  async recordProviderTraceEvents(
    job: Pick<AiJob, 'id' | 'provider' | 'deployment' | 'createdAt'>,
    events: RecordAiProviderTraceEventInput[],
  ): Promise<void> {
    for (const event of events) {
      await this.recordProviderTraceEvent(job, event);
    }
  }

  async createAiOutputAsset(
    job: Pick<
      AiJob,
      | 'id'
      | 'userId'
      | 'workspaceId'
      | 'provider'
      | 'modelId'
      | 'deployment'
      | 'canonicalModelId'
      | 'providerBindingId'
    >,
    input: CreateAiOutputAssetInput,
  ): Promise<string> {
    const storageProvider = input.storageProvider as MediaStorageProvider;
    const metadata: Prisma.InputJsonObject = {
      aiJobId: job.id,
      provider: job.provider,
      modelId: job.modelId,
      deployment: job.deployment,
      canonicalModelId: job.canonicalModelId,
      providerBindingId: job.providerBindingId,
      outputIndex: input.outputIndex,
      safetyFlags: (input.safetyFlags ?? null) as Prisma.InputJsonValue | null,
      videoProbe: (input.videoMetadata ?? null) as Prisma.InputJsonValue | null,
      audioProbe: (input.audioMetadata ?? null) as Prisma.InputJsonValue | null,
    };

    const existing = await this.prisma.mediaAsset.findFirst({
      where: {
        storageProvider,
        bucket: input.bucket,
        objectKey: input.objectKey,
        deletedAt: null,
      },
      select: {
        id: true,
        storageProvider: true,
        bucket: true,
        region: true,
        objectKey: true,
        externalUrl: true,
        contentType: true,
        sizeBytes: true,
        width: true,
        height: true,
        durationSeconds: true,
        checksumSha256: true,
      },
    });
    if (existing) {
      await this.prisma.$transaction((tx) =>
        ensureOriginalMediaPlacement(tx, {
          assetId: existing.id,
          storageProvider: existing.storageProvider,
          bucket: existing.bucket,
          region: existing.region,
          objectKey: existing.objectKey,
          externalUrl: existing.externalUrl,
          contentType: existing.contentType,
          sizeBytes: existing.sizeBytes,
          width: existing.width,
          height: existing.height,
          durationMs: input.durationMs ?? null,
          durationSeconds: existing.durationSeconds,
          checksumSha256: existing.checksumSha256,
          metadata,
        }),
      );
      return existing.id;
    }

    const data: Prisma.MediaAssetUncheckedCreateInput = {
      kind:
        input.type === 'video'
          ? MediaAssetKind.video
          : input.type === 'audio'
            ? MediaAssetKind.audio
            : MediaAssetKind.image,
      storageProvider,
      bucket: input.bucket,
      region: input.region,
      objectKey: input.objectKey,
      externalUrl: null,
      contentType: input.contentType,
      sizeBytes: BigInt(input.sizeBytes),
      width: input.width ?? null,
      height: input.height ?? null,
      durationSeconds: input.durationSeconds ?? null,
      checksumSha256: input.checksumSha256,
      visibility: MediaAssetVisibility.private,
      status: MediaAssetStatus.ready,
      source: MediaAssetSource.ai_output,
      moderationStatus: MediaAssetModerationStatus.unreviewed,
      workspaceId: job.workspaceId ?? null,
      createdByUserId: job.userId,
      metadata: metadata as Prisma.InputJsonValue,
    };

    try {
      const asset = await this.prisma.$transaction(async (tx) => {
        const created = await tx.mediaAsset.create({
          data,
          select: { id: true },
        });
        await ensureOriginalMediaPlacement(tx, {
          assetId: created.id,
          storageProvider,
          bucket: input.bucket,
          region: input.region,
          objectKey: input.objectKey,
          externalUrl: null,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          width: input.width ?? null,
          height: input.height ?? null,
          durationMs: input.durationMs ?? null,
          durationSeconds: input.durationSeconds ?? null,
          checksumSha256: input.checksumSha256,
          metadata,
        });
        return created;
      });
      return asset.id;
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          storageProvider,
          bucket: input.bucket,
          objectKey: input.objectKey,
          deletedAt: null,
        },
        select: {
          id: true,
          storageProvider: true,
          bucket: true,
          region: true,
          objectKey: true,
          externalUrl: true,
          contentType: true,
          sizeBytes: true,
          width: true,
          height: true,
          durationSeconds: true,
          checksumSha256: true,
        },
      });
      if (asset) {
        await this.prisma.$transaction((tx) =>
          ensureOriginalMediaPlacement(tx, {
            assetId: asset.id,
            storageProvider: asset.storageProvider,
            bucket: asset.bucket,
            region: asset.region,
            objectKey: asset.objectKey,
            externalUrl: asset.externalUrl,
            contentType: asset.contentType,
            sizeBytes: asset.sizeBytes,
            width: asset.width,
            height: asset.height,
            durationMs: input.durationMs ?? null,
            durationSeconds: asset.durationSeconds,
            checksumSha256: asset.checksumSha256,
            metadata,
          }),
        );
        return asset.id;
      }
      throw err;
    }
  }

  async listForUser(options: AiJobListOptions): Promise<AiJob[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const rows = await this.prisma.aiJob.findMany({
      where: {
        ...(options.includeCollaboratorJobs ? {} : { userId: options.userId }),
        ...(options.ids ? { id: { in: options.ids } } : {}),
        ...(options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
        ...(options.documentBlockId
          ? { documentBlockId: options.documentBlockId }
          : {}),
        deletedAt: null,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(options.storyProjectId
          ? { storyProjectId: options.storyProjectId }
          : {}),
        ...(options.documentId ? { documentId: options.documentId } : {}),
        ...(options.sourceSurface
          ? { sourceSurface: options.sourceSurface }
          : {}),
        ...(options.type ? { type: options.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { outputs: this.outputsInclude(false) },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async activeForUser(userId: string): Promise<AiJob[]> {
    return this.activeForUserWith(this.prisma, userId);
  }

  /**
   * Non-terminal jobs whose FROZEN referenceSnapshot references `characterId`
   * (the pre-expansion `{role:'character', characterId}` binding), optionally
   * scoped to one project. Drives per-project / global likeness revocation
   * cancellation (design v2 §5). The projectId filter narrows the scan; the
   * in-app snapshot filter is exact (referenceSnapshot is a JSON array).
   */
  async activeReferencingCharacter(
    characterId: string,
    projectId?: string,
  ): Promise<AiJob[]> {
    const rows = await this.prisma.aiJob.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['completed', 'failed', 'cancelled', 'expired'] },
        ...(projectId ? { projectId } : {}),
      },
      include: { outputs: this.outputsInclude(false) },
    });
    return rows
      .map((r) => this.toDomain(r))
      .filter((job) =>
        referenceSnapshotReferencesCharacter(
          job.referenceSnapshot,
          characterId,
        ),
      );
  }

  /**
   * ALL jobs (with outputs) whose FROZEN referenceSnapshot references
   * `characterId`, newest first, optionally scoped to one project. Drives the
   * subject's likeness-output visibility + takedown (design v2 §6) — a
   * completeness-critical read (the NCII takedown must reach EVERY output), so
   * the characterId predicate is pushed into the DB (jsonb containment) and
   * there is NO recency cap. The in-app filter stays as an exactness net
   * (jsonb `@>` matches the object subset; the JS check confirms it).
   */
  async referencingCharacterWithOutputs(
    characterId: string,
    opts: { projectId?: string } = {},
  ): Promise<AiJob[]> {
    const rows = await this.prisma.aiJob.findMany({
      where: {
        deletedAt: null,
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        // referenceSnapshot is a JSON array of {role, characterId} — jsonb
        // containment narrows to rows that actually reference the character.
        referenceSnapshot: {
          array_contains: [{ role: 'character', characterId }],
        },
      },
      include: { outputs: this.outputsInclude(false) },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .map((r) => this.toDomain(r))
      .filter((job) =>
        referenceSnapshotReferencesCharacter(
          job.referenceSnapshot,
          characterId,
        ),
      );
  }

  private async activeForUserWith(
    client: DbClient,
    userId: string,
  ): Promise<AiJob[]> {
    const rows = await client.aiJob.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { notIn: ['completed', 'failed', 'cancelled', 'expired'] },
      },
      include: { outputs: this.outputsInclude(false) },
    });
    return rows.map((r) => this.toDomain(r));
  }

  private async activeForSubjectWith(
    client: DbClient,
    subject: AiJobLimitSubject,
  ): Promise<AiJob[]> {
    const rows = await client.aiJob.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['completed', 'failed', 'cancelled', 'expired'] },
        ...(subject.type === 'workspace'
          ? { workspaceId: subject.id }
          : { userId: subject.id }),
      },
      include: { outputs: this.outputsInclude(false) },
    });
    return rows.map((r) => this.toDomain(r));
  }

  private async lockKeysWith(
    client: Prisma.TransactionClient,
    keys: string[],
  ): Promise<void> {
    for (const key of [...new Set(keys)].sort()) {
      await client.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)
      `;
    }
  }

  private countAcceptedCampaignJobsWith(
    client: DbClient,
    campaignId: string,
    userId?: string,
  ): Promise<number> {
    return client.aiJob.count({
      where: {
        ...(userId ? { userId } : {}),
        deletedAt: null,
        status: { notIn: ['failed', 'cancelled', 'expired'] },
        routingSnapshot: {
          path: ['policy', 'quota', 'campaignId'],
          equals: campaignId,
        },
      },
    });
  }

  async waitingInQueue(queueName: AiJob['queueName']): Promise<AiJob[]> {
    return this.waitingInQueueWith(this.prisma, queueName);
  }

  private async waitingInQueueWith(
    client: DbClient,
    queueName: AiJob['queueName'],
  ): Promise<AiJob[]> {
    const rows = await client.aiJob.findMany({
      where: { queueName, status: 'in_queue', deletedAt: null },
      orderBy: [{ queuedAt: 'asc' }, { createdAt: 'asc' }],
      include: { outputs: this.outputsInclude(false) },
    });
    return rows.map((r) => this.toDomain(r));
  }

  /**
   * Recompute queuePosition for every waiting job in this queue and
   * return the rows whose position actually changed. Callers fan out
   * a Web PubSub push for each so users sitting at "#4 in line" see
   * themselves move up as people ahead finish.
   */
  async recomputeQueuePositions(
    queueName: AiJob['queueName'],
  ): Promise<AiJob[]> {
    return this.recomputeQueuePositionsWith(this.prisma, queueName);
  }

  private async recomputeQueuePositionsWith(
    client: DbClient,
    queueName: AiJob['queueName'],
  ): Promise<AiJob[]> {
    const waiting = await this.waitingInQueueWith(client, queueName);
    const changed: AiJob[] = [];
    const now = new Date();
    for (let i = 0; i < waiting.length; i += 1) {
      const job = waiting[i];
      if (job.queuePosition === i) continue;
      await client.aiJob.update({
        where: { id: job.id },
        data: { queuePosition: i, updatedAt: now },
      });
      changed.push({ ...job, queuePosition: i, updatedAt: now.toISOString() });
    }
    return changed;
  }

  private async findByIdempotencyWith(
    client: DbClient,
    userId: string,
    modelId: string,
    idempotencyKey: string,
  ): Promise<AiJob | null> {
    const row = await client.aiJob.findFirst({
      where: { userId, modelId, idempotencyKey, deletedAt: null },
      include: { outputs: this.outputsInclude(false) },
    });
    return row ? this.toDomain(row) : null;
  }

  // ─── hydration helpers ────────────────────────────────────────

  /**
   * Standard `outputs` include clause — filters out soft-deleted
   * output rows unless explicitly requested.
   */
  private outputsInclude(includeDeleted: boolean | undefined) {
    return {
      where: includeDeleted
        ? undefined
        : {
            deletedAt: null,
            OR: [
              { assetId: null },
              {
                asset: {
                  is: {
                    deletedAt: null,
                    status: MediaAssetStatus.ready,
                    moderationStatus: {
                      not: MediaAssetModerationStatus.blocked,
                    },
                  },
                },
              },
            ],
          },
      include: {
        asset: {
          select: {
            status: true,
            moderationStatus: true,
            deletedAt: true,
            // Storage identity so outputToDomain can resolve the public CDN URL
            // instead of trusting the possibly-stale/non-CDN url column captured
            // at upload time.
            storageProvider: true,
            bucket: true,
            region: true,
            objectKey: true,
            externalUrl: true,
          },
        },
      },
      orderBy: { outputIndex: 'asc' as const },
    };
  }

  private toDomain(row: JobWithOutputs): AiJob {
    return {
      id: row.id,
      userId: row.userId,
      entitlementSnapshot:
        (row.entitlementSnapshot as AiJob['entitlementSnapshot']) ?? undefined,
      type: row.type,
      provider: row.provider,
      modelId: row.modelId,
      deployment: row.deployment,
      canonicalModelId: row.canonicalModelId,
      providerBindingId: row.providerBindingId,
      schemaVersion: row.schemaVersion,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      storyProjectId: row.storyProjectId,
      billingSubjectType: row.billingSubjectType ?? undefined,
      billingSubjectId: row.billingSubjectId ?? undefined,
      documentId: row.documentId,
      documentBlockId: row.documentBlockId,
      sourceSurface: row.sourceSurface,
      outputStorageProvider: row.outputStorageProvider,
      status: row.status as AiJobStatus,
      stage: row.stage as AiJobStage,
      input: row.input as Record<string, unknown>,
      normalizedInput: row.normalizedInput as Record<string, unknown>,
      routingSnapshot:
        (row.routingSnapshot as AiRoutingSnapshot | null) ?? undefined,
      prompt: row.prompt,
      promptDocument:
        (row.promptDocument as AiJob['promptDocument'] | null) ?? undefined,
      promptDisplayText: row.promptDisplayText ?? undefined,
      promptSearchText: row.promptSearchText ?? undefined,
      compiledPrompt: row.compiledPrompt ?? undefined,
      referenceSnapshot:
        (row.referenceSnapshot as AiJob['referenceSnapshot'] | null) ??
        undefined,
      styleSnapshot:
        (row.styleSnapshot as AiJob['styleSnapshot'] | null) ?? undefined,
      skillSnapshot:
        (row.skillSnapshot as AiJob['skillSnapshot'] | null) ?? undefined,
      idempotencyKey: row.idempotencyKey,
      providerJobId: row.providerJobId ?? undefined,
      outputs: row.outputs.map((o) => this.outputToDomain(o)),
      error: (row.error as AiJobError | null) ?? undefined,
      logs: row.logs as unknown as AiJobLog[],
      queueName: row.queueName as AiJob['queueName'],
      queuePosition: row.queuePosition,
      progress: row.progress,
      estimatedWaitSeconds: row.estimatedWaitSeconds,
      estimatedRunSeconds: row.estimatedRunSeconds,
      estimatedTotalSeconds: row.estimatedTotalSeconds,
      etaConfidence: (row.etaConfidence as AiEtaConfidence | null) ?? undefined,
      attempt: row.attempt,
      retryOfJobId: row.retryOfJobId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      queuedAt: row.queuedAt?.toISOString(),
      startedAt: row.startedAt?.toISOString(),
      providerSubmittedAt: row.providerSubmittedAt?.toISOString(),
      providerStartedAt: row.providerStartedAt?.toISOString(),
      providerCompletedAt: row.providerCompletedAt?.toISOString(),
      outputFetchedAt: row.outputFetchedAt?.toISOString(),
      ossUploadedAt: row.ossUploadedAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      metrics: row.metrics as unknown as AiJobMetrics,
    };
  }

  private outputToDomain(row: AiJobOutputWithAssetRow): AiJobOutput {
    const accessUrl = row.assetId ? mediaContentUrl(row.assetId) : undefined;
    return {
      id: row.id,
      assetId: row.assetId ?? undefined,
      type: row.type,
      // Public direct CDN URL, resolved from the asset's storage identity so a
      // stale/non-CDN url column captured at upload time doesn't force clients
      // onto the /content redirect; fall back to the stored url when there's no
      // resolvable asset. Blocked objects are made unreachable at the storage
      // layer by the moderation takedown, so no per-read indirection.
      url:
        (row.asset ? this.urlResolver.resolvePublicUrl(row.asset) : null) ??
        row.url,
      accessUrl,
      storagePath: row.storagePath,
      contentHash: row.contentHash ?? undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      durationSeconds: row.durationSeconds ?? undefined,
      mimeType: row.mimeType ?? undefined,
      bytes: row.bytes ?? undefined,
      seed: row.seed ?? undefined,
      safetyFlags:
        (row.safetyFlags as Record<string, unknown> | null) ?? undefined,
      provenance:
        (row.provenance as Record<string, unknown> | null) ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toRow(job: AiJob): Prisma.AiJobUncheckedCreateInput {
    return {
      id: job.id,
      userId: job.userId,
      entitlementSnapshot:
        (job.entitlementSnapshot as Prisma.InputJsonValue | undefined) ??
        Prisma.DbNull,
      type: job.type,
      provider: job.provider,
      modelId: job.modelId,
      deployment: job.deployment,
      canonicalModelId: job.canonicalModelId ?? null,
      providerBindingId: job.providerBindingId ?? null,
      schemaVersion: job.schemaVersion,
      workspaceId: job.workspaceId ?? null,
      projectId: job.projectId ?? null,
      storyProjectId: job.storyProjectId ?? null,
      billingSubjectType: job.billingSubjectType ?? null,
      billingSubjectId: job.billingSubjectId ?? null,
      documentId: job.documentId ?? null,
      documentBlockId: job.documentBlockId ?? null,
      sourceSurface: job.sourceSurface ?? null,
      outputStorageProvider: job.outputStorageProvider ?? null,
      status: job.status,
      stage: job.stage,
      queueName: job.queueName,
      prompt: job.prompt,
      promptDocument:
        (job.promptDocument as Prisma.InputJsonValue | undefined) ??
        Prisma.DbNull,
      promptDisplayText: job.promptDisplayText ?? null,
      promptSearchText: job.promptSearchText ?? null,
      compiledPrompt: job.compiledPrompt ?? null,
      referenceSnapshot:
        (job.referenceSnapshot as Prisma.InputJsonValue | undefined) ??
        Prisma.DbNull,
      styleSnapshot:
        (job.styleSnapshot as Prisma.InputJsonValue | undefined) ??
        Prisma.DbNull,
      skillSnapshot:
        (job.skillSnapshot as Prisma.InputJsonValue | undefined) ??
        Prisma.DbNull,
      idempotencyKey: job.idempotencyKey,
      input: job.input as Prisma.InputJsonValue,
      normalizedInput: job.normalizedInput as Prisma.InputJsonValue,
      routingSnapshot:
        (job.routingSnapshot as Prisma.InputJsonValue | undefined) ??
        Prisma.DbNull,
      error: (job.error as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
      logs: job.logs as unknown as Prisma.InputJsonValue,
      metrics: job.metrics as unknown as Prisma.InputJsonValue,
      queuePosition: job.queuePosition ?? null,
      progress: job.progress ?? null,
      estimatedWaitSeconds: job.estimatedWaitSeconds ?? null,
      estimatedRunSeconds: job.estimatedRunSeconds ?? null,
      estimatedTotalSeconds: job.estimatedTotalSeconds ?? null,
      etaConfidence: job.etaConfidence ?? null,
      attempt: job.attempt,
      retryOfJobId: job.retryOfJobId ?? null,
      providerJobId: job.providerJobId ?? null,
      createdAt: new Date(job.createdAt),
      queuedAt: job.queuedAt ? new Date(job.queuedAt) : null,
      startedAt: job.startedAt ? new Date(job.startedAt) : null,
      providerSubmittedAt: job.providerSubmittedAt
        ? new Date(job.providerSubmittedAt)
        : null,
      providerStartedAt: job.providerStartedAt
        ? new Date(job.providerStartedAt)
        : null,
      providerCompletedAt: job.providerCompletedAt
        ? new Date(job.providerCompletedAt)
        : null,
      outputFetchedAt: job.outputFetchedAt
        ? new Date(job.outputFetchedAt)
        : null,
      ossUploadedAt: job.ossUploadedAt ? new Date(job.ossUploadedAt) : null,
      completedAt: job.completedAt ? new Date(job.completedAt) : null,
      updatedAt: new Date(job.updatedAt),
    };
  }

  private patchToRow(patch: Partial<AiJob>): Prisma.AiJobUncheckedUpdateInput {
    const out: Prisma.AiJobUncheckedUpdateInput = {};
    const dateKeys = new Set([
      'createdAt',
      'queuedAt',
      'startedAt',
      'providerSubmittedAt',
      'providerStartedAt',
      'providerCompletedAt',
      'outputFetchedAt',
      'ossUploadedAt',
      'completedAt',
    ]);
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'outputs') continue;
      if (key === 'updatedAt') continue; // Prisma @updatedAt handles it
      if (dateKeys.has(key)) {
        (out as Record<string, unknown>)[key] = value
          ? new Date(value as string)
          : null;
        continue;
      }
      if (value === undefined) continue;
      if (
        key === 'input' ||
        key === 'normalizedInput' ||
        key === 'promptDocument' ||
        key === 'referenceSnapshot' ||
        key === 'styleSnapshot' ||
        key === 'skillSnapshot' ||
        key === 'entitlementSnapshot' ||
        key === 'routingSnapshot' ||
        key === 'logs' ||
        key === 'metrics'
      ) {
        (out as Record<string, unknown>)[key] =
          value === null ? Prisma.DbNull : value;
        continue;
      }
      if (key === 'error') {
        (out as Record<string, unknown>)[key] =
          value === null ? Prisma.DbNull : value;
        continue;
      }
      (out as Record<string, unknown>)[key] = value;
    }
    return out;
  }

  private toAttemptRow(
    job: Pick<AiJob, 'id' | 'attempt'>,
    input: RecordAiJobAttemptInput,
  ): Prisma.AiJobAttemptUncheckedUpdateInput {
    void job;
    const out: Prisma.AiJobAttemptUncheckedUpdateInput = {
      status: input.status,
    };
    setIfPresent(out, 'providerStatus', input.providerStatus);
    setIfPresent(out, 'providerRequestId', input.providerRequestId);
    setIfPresent(out, 'providerEndpoint', input.providerEndpoint);
    setIfPresent(out, 'queuePosition', input.queuePosition);
    setJsonIfPresent(out, 'providerRequest', input.providerRequest);
    setJsonIfPresent(
      out,
      'providerRequestHeaders',
      input.providerRequestHeaders,
    );
    setJsonIfPresent(out, 'providerResponse', input.providerResponse);
    setJsonIfPresent(
      out,
      'providerResponseHeaders',
      input.providerResponseHeaders,
    );
    setJsonIfPresent(out, 'providerLogs', input.providerLogs);
    setJsonIfPresent(out, 'costAccounting', input.costAccounting);
    setJsonIfPresent(out, 'pricingSnapshot', input.pricingSnapshot);
    setJsonIfPresent(out, 'profitAccounting', input.profitAccounting);
    setJsonIfPresent(out, 'timing', input.timing);
    setJsonIfPresent(out, 'rawStatus', input.rawStatus);
    setJsonIfPresent(out, 'error', input.error);
    setIfPresent(out, 'runDurationMs', input.runDurationMs);
    setDateIfPresent(out, 'submittedAt', input.submittedAt);
    setDateIfPresent(out, 'executionStartedAt', input.executionStartedAt);
    setDateIfPresent(out, 'firstByteAt', input.firstByteAt);
    setDateIfPresent(out, 'completedAt', input.completedAt);
    return out;
  }

  private async replaceOutputs(
    jobId: string,
    outputs: AiJobOutput[],
  ): Promise<void> {
    // Two-step: delete + insert in a transaction. Prisma doesn't have
    // a true "replace child collection" primitive, so we do it
    // atomically to avoid a partial state if the worker crashes mid-write.
    await this.prisma.$transaction((tx) =>
      this.replaceOutputsWith(tx, jobId, outputs),
    );
  }

  private async replaceOutputsWith(
    tx: Prisma.TransactionClient,
    jobId: string,
    outputs: AiJobOutput[],
  ): Promise<void> {
    const job = await tx.aiJob.findUnique({
      where: { id: jobId },
      select: {
        userId: true,
        workspaceId: true,
        projectId: true,
        sourceSurface: true,
      },
    });
    const outputRows = outputs.map((o, idx) => ({
      id: o.id || newShortId(),
      jobId,
      assetId: o.assetId ?? null,
      type: o.type,
      url: o.url,
      storagePath: o.storagePath,
      contentHash: o.contentHash ?? null,
      width: o.width ?? null,
      height: o.height ?? null,
      durationSeconds: o.durationSeconds ?? null,
      mimeType: o.mimeType ?? null,
      bytes: o.bytes ?? null,
      outputIndex: idx,
      seed: o.seed ?? null,
      safetyFlags:
        (o.safetyFlags as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
      provenance:
        (o.provenance as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
      createdAt: new Date(o.createdAt),
    }));
    const assetIds = [
      ...new Set(
        outputRows
          .map((row) => row.assetId)
          .filter((assetId): assetId is string => Boolean(assetId)),
      ),
    ];
    const variants =
      assetIds.length > 0
        ? await tx.mediaAssetVariant.findMany({
            where: { assetId: { in: assetIds }, variantKey: 'original' },
            select: { id: true, assetId: true },
          })
        : [];
    const variantByAssetId = new Map(
      variants.map((variant) => [variant.assetId, variant.id]),
    );

    await tx.mediaAssetUsage.deleteMany({
      where: {
        aiJobId: jobId,
        role: MediaAssetUsageRole.output,
      },
    });
    await tx.aiJobOutput.deleteMany({ where: { jobId } });
    if (outputRows.length > 0) {
      await tx.aiJobOutput.createMany({ data: outputRows });
    }
    const usageRows = outputRows
      .filter((row) => row.assetId)
      .map((row) => ({
        assetId: row.assetId!,
        variantId: variantByAssetId.get(row.assetId!) ?? null,
        userId: job?.userId ?? null,
        workspaceId: job?.workspaceId ?? null,
        projectId: job?.projectId ?? null,
        aiJobId: jobId,
        aiJobOutputId: row.id,
        surface: usageSurfaceForSourceSurface(job?.sourceSurface),
        sourceSurface: job?.sourceSurface ?? null,
        role: MediaAssetUsageRole.output,
        idempotencyKey: `ai-output:${jobId}:${row.id}`,
        metadata: {
          outputIndex: row.outputIndex,
          type: row.type,
          contentHash: row.contentHash,
        } satisfies Prisma.InputJsonObject,
      }));
    if (usageRows.length > 0) {
      await tx.mediaAssetUsage.createMany({ data: usageRows });
    }
  }

  /**
   * Reference usage ledger: one row per media asset a job consumed as a
   * reference (plain uploads AND expanded character media). Mirrors the
   * output usage writes above — same surface derivation, same
   * `idempotencyKey` uniqueness — but uses `skipDuplicates` instead of
   * delete-and-recreate because references are frozen at submit (a retry
   * is a NEW job, so re-submits land distinct rows).
   */
  async recordReferenceUsage(
    job: Pick<
      AiJob,
      'id' | 'userId' | 'workspaceId' | 'projectId' | 'sourceSurface'
    >,
    references: Array<{
      assetId: string;
      refId: string;
      kind: string;
      characterId?: string;
    }>,
  ): Promise<void> {
    const byAssetId = new Map(
      references.map((reference) => [reference.assetId, reference]),
    );
    if (byAssetId.size === 0) return;
    const assetIds = [...byAssetId.keys()];
    const variants = await this.prisma.mediaAssetVariant.findMany({
      where: { assetId: { in: assetIds }, variantKey: 'original' },
      select: { id: true, assetId: true },
    });
    const variantByAssetId = new Map(
      variants.map((variant) => [variant.assetId, variant.id]),
    );
    await this.prisma.mediaAssetUsage.createMany({
      data: [...byAssetId.values()].map((reference) => ({
        assetId: reference.assetId,
        variantId: variantByAssetId.get(reference.assetId) ?? null,
        userId: job.userId,
        workspaceId: job.workspaceId ?? null,
        projectId: job.projectId ?? null,
        aiJobId: job.id,
        surface: usageSurfaceForSourceSurface(job.sourceSurface),
        sourceSurface: job.sourceSurface ?? null,
        role: MediaAssetUsageRole.reference,
        idempotencyKey: `ai-reference:${job.id}:${reference.assetId}`,
        metadata: {
          refId: reference.refId,
          kind: reference.kind,
          ...(reference.characterId
            ? { characterId: reference.characterId }
            : {}),
        } satisfies Prisma.InputJsonObject,
      })),
      skipDuplicates: true,
    });
  }
}

function mediaContentUrl(assetId: string): string {
  return `/aurora/media/assets/${encodeURIComponent(assetId)}/content?variantKey=original`;
}

function usageSurfaceForSourceSurface(
  sourceSurface: string | null | undefined,
): MediaAssetUsageSurface {
  if (sourceSurface?.includes('canvas')) return MediaAssetUsageSurface.canvas;
  if (sourceSurface?.includes('project')) return MediaAssetUsageSurface.project;
  return MediaAssetUsageSurface.standalone_generation;
}

function setIfPresent(
  out: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  out[key] = value;
}

function setDateIfPresent(
  out: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  out[key] = value ? new Date(value) : null;
}

function setJsonIfPresent(
  out: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  out[key] = value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function jsonRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringRecordOrNull(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

// Re-export Prisma row types so other repo-adjacent code can use them
// without import gymnastics.
function parseDateOrNow(value: string | null | undefined): Date {
  if (!value) return new Date();
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return new Date();
  return new Date(time);
}

function elapsedMsFromIso(start: string | undefined, end: Date): number | null {
  if (!start) return null;
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) return null;
  return Math.max(0, end.getTime() - startMs);
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

function limitSubjectLockKey(subject: AiJobLimitSubject): string {
  return `ai-generation:limit:${subject.type}:${subject.id}`;
}

/** True iff the frozen reference snapshot has a character binding for `id`. */
function referenceSnapshotReferencesCharacter(
  snapshot: unknown,
  characterId: string,
): boolean {
  if (!Array.isArray(snapshot)) return false;
  return snapshot.some(
    (entry) =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      (entry as { characterId?: unknown }).characterId === characterId,
  );
}

export type {
  AiJobAttemptRow,
  AiEventOutboxRow,
  AiJobRow,
  AiJobOutputRow,
  AiProviderTraceEventRow,
};

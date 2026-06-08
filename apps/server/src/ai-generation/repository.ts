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
import { Prisma } from '@prisma/client';
import type {
  AiJobAttempt as AiJobAttemptRow,
  AiAttemptStatus as AiAttemptStatusRow,
  AiEventOutbox as AiEventOutboxRow,
  AiJob as AiJobRow,
  AiJobOutput as AiJobOutputRow,
  AiProviderTraceEvent as AiProviderTraceEventRow,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { newShortId } from '../common/id';
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
  userId: string;
  workspaceId?: string;
  projectId?: string;
  documentId?: string;
  includeCollaboratorJobs?: boolean;
  type?: AiJobType;
  limit?: number;
}

export type ReserveQueuedJobResult =
  | { kind: 'existing'; job: AiJob }
  | { kind: 'queued_limit'; limit: number }
  | { kind: 'running_limit'; limit: number; type: AiJobType }
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
  perUserQueued: number;
  perUserRunning: number;
  campaignLimit?: {
    campaignId: string;
    perUserLimit?: number;
    totalLimit?: number;
  };
  beforeCreate?: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>;
  buildJob: (queuePosition: number) => AiJob;
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

type JobWithOutputs = AiJobRow & { outputs: AiJobOutputRow[] };
type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AiGenerationRepository {
  constructor(private readonly prisma: PrismaService) {}

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
   * Atomically reserves a queue slot for one user.
   *
   * Submit concurrency cannot rely on "read active jobs, then insert"
   * outside a transaction: two browser tabs with different idempotency
   * keys can both observe zero active jobs and overrun per-user limits.
   * A user-scoped Postgres advisory transaction lock serializes that
   * critical section while staying pod-safe.
   */
  async reserveQueuedJob(
    options: ReserveQueuedJobOptions,
  ): Promise<ReserveQueuedJobResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ai-generation:user:${options.userId}`})::bigint)
      `;

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

      const active = await this.activeForUserWith(tx, options.userId);
      const activeSameType = active.filter((job) => job.type === options.type);
      const queuedTotal = active.filter(
        (job) => job.status === 'in_queue',
      ).length;
      const runningSameType = activeSameType.filter(
        (job) => job.status === 'in_progress',
      ).length;

      if (queuedTotal >= options.perUserQueued) {
        return { kind: 'queued_limit', limit: options.perUserQueued };
      }
      if (runningSameType >= options.perUserRunning) {
        return {
          kind: 'running_limit',
          limit: options.perUserRunning,
          type: options.type,
        };
      }

      const queuePosition = (
        await this.waitingInQueueWith(tx, options.queueName)
      ).length;
      const job = options.buildJob(queuePosition);
      await options.beforeCreate?.(tx, job);
      await tx.aiJob.create({ data: this.toRow(job) });
      const repositioned = await this.recomputeQueuePositionsWith(
        tx,
        options.queueName,
      );
      return { kind: 'created', job, repositioned };
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

  async listForUser(options: AiJobListOptions): Promise<AiJob[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const rows = await this.prisma.aiJob.findMany({
      where: {
        ...(options.includeCollaboratorJobs ? {} : { userId: options.userId }),
        deletedAt: null,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(options.documentId ? { documentId: options.documentId } : {}),
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
      where: includeDeleted ? undefined : { deletedAt: null },
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
      documentId: row.documentId,
      documentBlockId: row.documentBlockId,
      sourceSurface: row.sourceSurface,
      status: row.status as AiJobStatus,
      stage: row.stage as AiJobStage,
      input: row.input as Record<string, unknown>,
      normalizedInput: row.normalizedInput as Record<string, unknown>,
      routingSnapshot:
        (row.routingSnapshot as AiRoutingSnapshot | null) ?? undefined,
      prompt: row.prompt,
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

  private outputToDomain(row: AiJobOutputRow): AiJobOutput {
    return {
      id: row.id,
      type: row.type,
      url: row.url,
      storagePath: row.storagePath,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      durationSeconds: row.durationSeconds ?? undefined,
      mimeType: row.mimeType ?? undefined,
      bytes: row.bytes ?? undefined,
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
      documentId: job.documentId ?? null,
      documentBlockId: job.documentBlockId ?? null,
      sourceSurface: job.sourceSurface ?? null,
      status: job.status,
      stage: job.stage,
      queueName: job.queueName,
      prompt: job.prompt,
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
    await this.prisma.$transaction([
      this.prisma.aiJobOutput.deleteMany({ where: { jobId } }),
      ...(outputs.length > 0
        ? [
            this.prisma.aiJobOutput.createMany({
              data: outputs.map((o, idx) => ({
                id: o.id || newShortId(),
                jobId,
                type: o.type,
                url: o.url,
                storagePath: o.storagePath,
                width: o.width ?? null,
                height: o.height ?? null,
                durationSeconds: o.durationSeconds ?? null,
                mimeType: o.mimeType ?? null,
                bytes: o.bytes ?? null,
                outputIndex: idx,
                createdAt: new Date(o.createdAt),
              })),
            }),
          ]
        : []),
    ]);
  }
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

export type {
  AiJobAttemptRow,
  AiEventOutboxRow,
  AiJobRow,
  AiJobOutputRow,
  AiProviderTraceEventRow,
};

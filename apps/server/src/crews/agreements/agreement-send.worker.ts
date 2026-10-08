import { hostname } from 'node:os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  CrewAgreementArchiveJobStatus,
  CrewAgreementSendJobStatus,
  CrewAgreementStatus,
  Prisma,
  type CrewAgreement,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { backgroundTasksEnabled } from '../../common/background-tasks';
import { NotificationService } from '../../notification';
import {
  BoldSignAgreementProvider,
  type BoldSignAgreementDocument,
} from './boldsign-agreement.provider';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 10;
const LOCK_TTL_MS = 2 * 60 * 1_000;
const MAX_ATTEMPTS = 10;
const BACKOFFS_MS = [
  2_000,
  10_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];
const WORKER_ID = `${hostname()}-${process.pid}`;

type ClaimedSendJob = Prisma.CrewAgreementSendJobGetPayload<{
  include: { agreement: true };
}>;

/**
 * Durable BoldSign dispatch boundary.
 *
 * Sending is intentionally outside the invitation-acceptance transaction.
 * Before every attempt we reconcile by the stable BoldSign label written by
 * the provider adapter; this closes the ambiguous "provider accepted but our
 * HTTP response was lost" window without creating duplicate documents.
 */
@Injectable()
export class CrewAgreementSendWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CrewAgreementSendWorker.name);
  private readonly pollIntervalMs = positiveIntegerEnv(
    'CREW_AGREEMENT_SEND_POLL_MS',
    DEFAULT_POLL_INTERVAL_MS,
  );
  private readonly batchSize = positiveIntegerEnv(
    'CREW_AGREEMENT_SEND_BATCH_SIZE',
    DEFAULT_BATCH_SIZE,
  );
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: BoldSignAgreementProvider,
    private readonly notifications: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped || this.timer) return;
    if (!this.provider.isEnabled()) {
      this.logger.log('Crew agreement send worker disabled');
      return;
    }
    this.timer = setInterval(
      () => this.runScheduledDrain(),
      this.pollIntervalMs,
    );
    this.timer.unref?.();
    this.runScheduledDrain();
    this.logger.log(
      `Crew agreement send worker running every ${this.pollIntervalMs}ms (worker=${WORKER_ID})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      await this.draining;
    } catch (error) {
      this.logger.warn(
        `Crew agreement send worker stopped with an unfinished dispatch: ${errorMessage(error)}`,
      );
    }
  }

  private runScheduledDrain(): void {
    void this.drainOnce().catch((error: unknown) => {
      this.logger.error(
        `crew agreement send drain failed: ${errorMessage(error)}`,
      );
    });
  }

  /** Public for deterministic readiness checks and focused tests. */
  async drainOnce(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped) return;
    if (this.draining) return this.draining;
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    for (let sent = 0; sent < this.batchSize; sent += 1) {
      if (this.stopped) return;
      // Do not consume later jobs' leases while waiting on the provider.
      const [job] = await this.claim(1);
      // A claim already in flight may finish during shutdown. Leave its lease
      // recoverable instead of starting another external provider operation.
      if (!job || this.stopped) break;
      await this.dispatchOne(job);
    }
  }

  private async claim(batch: number): Promise<ClaimedSendJob[]> {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - LOCK_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const eligible = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM crew_agreement_send_jobs
        WHERE (
          status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
          AND (locked_at IS NULL OR locked_at < ${lockExpiry})
        ) OR (
          status = 'processing'
          AND locked_at < ${lockExpiry}
        )
        ORDER BY created_at ASC
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
      `);
      if (eligible.length === 0) return [];

      const ids = eligible.map((row) => row.id);
      await tx.crewAgreementSendJob.updateMany({
        where: { id: { in: ids } },
        data: {
          status: CrewAgreementSendJobStatus.processing,
          lockedAt: now,
          lockedBy: WORKER_ID,
        },
      });
      return tx.crewAgreementSendJob.findMany({
        where: {
          id: { in: ids },
          status: CrewAgreementSendJobStatus.processing,
          lockedAt: now,
          lockedBy: WORKER_ID,
        },
        include: { agreement: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private async dispatchOne(job: ClaimedSendJob): Promise<void> {
    try {
      if (
        job.agreement.providerDocumentId ||
        !isDispatchable(job.agreement.status)
      ) {
        await this.acknowledge(job);
        return;
      }
      const recovered = await this.provider.findDocumentForAgreement(
        job.agreementId,
      );
      const document =
        recovered ??
        ({
          documentId: await this.provider.sendFromTemplate({
            agreementId: job.agreement.id,
            title: job.agreement.title,
            signerName: job.agreement.signerName,
            signerEmail: job.agreement.signerEmail,
          }),
          // The API only acknowledges asynchronous document creation. Sent
          // is applied later by the verified webhook.
          status: null,
        } satisfies BoldSignAgreementDocument);

      await this.complete(job, document);
      this.logger.log(
        `Dispatched crew agreement agreement=${job.agreementId} recovered=${Boolean(recovered)}`,
      );
    } catch (error) {
      await this.recordFailure(job, error);
    }
  }

  private async complete(
    job: ClaimedSendJob,
    document: BoldSignAgreementDocument,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT id
                   FROM crew_agreements
                   WHERE id = ${job.agreementId}::uuid
                   FOR UPDATE`,
      );
      const current = await tx.crewAgreement.findUniqueOrThrow({
        where: { id: job.agreementId },
      });
      if (
        current.providerDocumentId &&
        current.providerDocumentId !== document.documentId
      ) {
        throw new Error(
          `Agreement ${current.id} is already linked to another BoldSign document`,
        );
      }
      // A verified webhook can win the race between BoldSign accepting the
      // request and this worker persisting the response. Its provider status
      // and terminal timestamps are authoritative; only acknowledge the job.
      if (current.providerDocumentId) {
        const acknowledged = await tx.crewAgreementSendJob.updateMany({
          where: ownedLease(job),
          data: {
            status: CrewAgreementSendJobStatus.completed,
            completedAt: new Date(),
            nextAttemptAt: null,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
          },
        });
        if (acknowledged.count !== 1) {
          throw new Error(`Agreement send lease was lost for job ${job.id}`);
        }
        return;
      }
      const providerStatus = document.status?.trim() || 'Processing';
      const resolved = document.status
        ? statusFromProvider(document.status)
        : CrewAgreementStatus.sending;
      const status = isDispatchable(current.status) ? resolved : current.status;
      const now = new Date();
      const updated = await tx.crewAgreement.update({
        where: { id: current.id },
        data: {
          providerDocumentId: document.documentId,
          providerStatus: providerStatus.slice(0, 64),
          status,
          lastSyncedAt: now,
          ...(status === CrewAgreementStatus.sent && !current.sentAt
            ? { sentAt: now }
            : {}),
          ...(status === CrewAgreementStatus.signed && !current.signedAt
            ? { signedAt: now }
            : {}),
        },
      });
      if (status === CrewAgreementStatus.signed) {
        await tx.crewAgreementArchiveJob.upsert({
          where: { agreementId: updated.id },
          create: { agreementId: updated.id },
          update: {
            status: CrewAgreementArchiveJobStatus.pending,
            nextAttemptAt: null,
          },
        });
      }
      const acknowledged = await tx.crewAgreementSendJob.updateMany({
        where: ownedLease(job),
        data: {
          status: CrewAgreementSendJobStatus.completed,
          completedAt: now,
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      if (acknowledged.count !== 1) {
        throw new Error(`Agreement send lease was lost for job ${job.id}`);
      }
      await this.notifyRecoveredStatus(updated, current.status, tx);
    });
  }

  private async acknowledge(job: ClaimedSendJob): Promise<void> {
    const acknowledged = await this.prisma.crewAgreementSendJob.updateMany({
      where: ownedLease(job),
      data: {
        status: CrewAgreementSendJobStatus.completed,
        completedAt: new Date(),
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
    if (acknowledged.count !== 1) {
      this.logger.warn(`Agreement send lease was lost for job ${job.id}`);
    }
  }

  private async recordFailure(
    job: ClaimedSendJob,
    error: unknown,
  ): Promise<void> {
    const attempt = job.attempt + 1;
    const terminal = attempt >= MAX_ATTEMPTS;
    const message = errorMessage(error).slice(0, 4_000);
    const nextAttemptAt = terminal
      ? null
      : new Date(
          Date.now() +
            BACKOFFS_MS[Math.min(attempt - 1, BACKOFFS_MS.length - 1)],
        );
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.crewAgreementSendJob.updateMany({
        where: ownedLease(job),
        data: {
          status: terminal
            ? CrewAgreementSendJobStatus.failed
            : CrewAgreementSendJobStatus.pending,
          attempt,
          nextAttemptAt,
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        },
      });
      if (updated.count !== 1) return;
      if (terminal) {
        await tx.crewAgreement.updateMany({
          where: {
            id: job.agreementId,
            providerDocumentId: null,
            status: {
              in: [
                CrewAgreementStatus.draft,
                CrewAgreementStatus.sending,
                CrewAgreementStatus.failed,
              ],
            },
          },
          data: {
            status: CrewAgreementStatus.failed,
            providerStatus: 'DispatchFailed',
            lastSyncedAt: new Date(),
          },
        });
      }
    });
    this.logger.warn(
      `Crew agreement dispatch failed agreement=${job.agreementId} attempt=${attempt}/${MAX_ATTEMPTS}: ${message}`,
    );
  }

  private async notifyRecoveredStatus(
    agreement: CrewAgreement,
    previousStatus: CrewAgreementStatus,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (agreement.status === previousStatus) return;
    if (agreement.status === CrewAgreementStatus.sent) {
      await this.notifications.send(
        {
          userId: agreement.memberUserId,
          type: 'crew.agreement.sent',
          title: agreement.title,
          body: 'A crew agreement was sent to your email for signature.',
          meta: {
            crewId: agreement.crewId,
            agreementId: agreement.id,
            agreementTitle: agreement.title,
            status: agreement.status,
            deeplink: `/crews/${agreement.crewId}/workspace?tab=members&agreement=${agreement.id}`,
          },
          idempotencyKey: `crew.agreement.sent:${agreement.id}`,
        },
        tx,
      );
      return;
    }
    if (agreement.status !== CrewAgreementStatus.signed) return;
    const recipients = new Set([
      agreement.memberUserId,
      agreement.createdByUserId,
    ]);
    await Promise.all(
      [...recipients].map((userId) =>
        this.notifications.send(
          {
            userId,
            type: 'crew.agreement.updated',
            title: agreement.title,
            body: 'The crew agreement has been fully signed.',
            meta: {
              crewId: agreement.crewId,
              agreementId: agreement.id,
              agreementTitle: agreement.title,
              status: agreement.status,
              deeplink: `/crews/${agreement.crewId}/workspace?tab=members&agreement=${agreement.id}`,
            },
            idempotencyKey: `crew.agreement.status:${agreement.id}:${agreement.status}:${userId}`,
          },
          tx,
        ),
      ),
    );
  }
}

function ownedLease(
  job: ClaimedSendJob,
): Prisma.CrewAgreementSendJobWhereInput {
  return {
    id: job.id,
    status: CrewAgreementSendJobStatus.processing,
    lockedAt: job.lockedAt,
    lockedBy: WORKER_ID,
  };
}

function isDispatchable(status: CrewAgreementStatus): boolean {
  return (
    status === CrewAgreementStatus.draft ||
    status === CrewAgreementStatus.sending ||
    status === CrewAgreementStatus.failed
  );
}

function statusFromProvider(status: string): CrewAgreementStatus {
  switch (status.trim().toLowerCase()) {
    case 'completed':
      return CrewAgreementStatus.signed;
    case 'declined':
      return CrewAgreementStatus.declined;
    case 'expired':
      return CrewAgreementStatus.expired;
    case 'revoked':
      return CrewAgreementStatus.voided;
    case 'sendfailed':
    case 'deliveryfailed':
      return CrewAgreementStatus.failed;
    default:
      return CrewAgreementStatus.sent;
  }
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AgentDocumentAnalysisJobStatus, Prisma } from '@prisma/client';
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import type { AgentLongDocumentWorkflowInput } from '@repo/shared/agent-platform';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../infra/db/db.module';
import { AgentPlatformGatewayConfigService } from './agent-platform-gateway.config';

const WORKFLOW_TYPE = 'agentLongDocumentAnalysisWorkflow';
const MAX_BATCHES_PER_DRAIN = 8;

type DispatchCandidate = Readonly<{
  id: string;
  dispatch_attempt_count: number;
}>;

type DispatchClaim = Readonly<{
  jobId: string;
  workflowId: string;
  leaseToken: string;
  attempt: number;
}>;

@Injectable()
export class AgentPlatformDocumentAnalysisDispatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  readonly #logger = new Logger(
    AgentPlatformDocumentAnalysisDispatcherService.name,
  );
  readonly #config: AgentPlatformGatewayConfigService['values'];
  #connection: Connection | null = null;
  #client: Client | null = null;
  #connecting: Promise<void> | null = null;
  #timer: NodeJS.Timeout | null = null;
  #drain: Promise<void> | null = null;
  #drainRequested = false;
  #stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    config: AgentPlatformGatewayConfigService,
  ) {
    this.#config = config.values;
  }

  onApplicationBootstrap(): void {
    this.#timer = setInterval(() => {
      void this.wake();
    }, this.#config.documentAnalysisDispatchIntervalMs);
    this.#timer.unref();
    void this.wake();
  }

  async onModuleDestroy(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#drain;
    await this.#connecting?.catch(() => undefined);
    const connection = this.#connection;
    this.#connection = null;
    this.#client = null;
    await connection?.close();
  }

  async wake(): Promise<void> {
    if (this.#stopping) return;
    this.#drainRequested = true;
    if (this.#drain) return this.#drain;
    const drain = this.runRequestedDrains();
    const tracked = drain
      .catch((error: unknown) => {
        this.#logger.error(
          'Long-document Temporal dispatch drain failed',
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        if (this.#drain === tracked) this.#drain = null;
      });
    this.#drain = tracked;
    return tracked;
  }

  async isReady(): Promise<boolean> {
    if (this.#stopping) return false;
    try {
      await this.ensureConnected();
      await this.#connection!.ensureConnected();
      return true;
    } catch {
      return false;
    }
  }

  private async runRequestedDrains(): Promise<void> {
    while (this.#drainRequested && !this.#stopping) {
      this.#drainRequested = false;
      await this.deadLetterExhausted();
      const mayHaveMore = await this.runBoundedDrain();
      if (mayHaveMore) {
        this.#drainRequested = true;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  private async runBoundedDrain(): Promise<boolean> {
    for (
      let batch = 0;
      batch < MAX_BATCHES_PER_DRAIN && !this.#stopping;
      batch += 1
    ) {
      const claims = await this.claimDue(
        this.#config.documentAnalysisDispatchConcurrency,
      );
      if (claims.length === 0) return false;
      await Promise.all(claims.map((claim) => this.dispatch(claim)));
      if (claims.length < this.#config.documentAnalysisDispatchConcurrency) {
        return false;
      }
    }
    return !this.#stopping;
  }

  /**
   * Claims queued work, leases expired mid-dispatch, runs whose Worker is
   * gone, and terminal failures the Workflow itself labelled retryable. A
   * Worker lost mid-analysis otherwise leaves the row in `running` with
   * nothing to recover it, and the user watches "processing" forever.
   *
   * A retryable `failed` row is recoverable for the same reason a lost run is:
   * every section it did finish is a durable artifact, so the redelivered run
   * reads them back out of the manifest and resumes instead of paying for them
   * twice. Without this branch those checkpoints are orphaned forever.
   *
   * Staleness is measured on `updated_at`, never `started_at`: the analysis
   * Workflow writes stage/completed_units as it maps, so a live job never goes
   * stale however long the document takes, whereas markDispatched() resets
   * `started_at` and would make a healthy long analysis look repeatedly
   * reclaimable until the attempt budget dead-lettered it. The threshold
   * therefore only has to exceed the gap between two progress writes.
   *
   * Re-dispatch cannot double-run: the Workflow id is deterministic and the
   * reuse policy is ALLOW_DUPLICATE_FAILED_ONLY, so a Workflow that is really
   * still alive rejects the start and dispatch() swallows that rejection.
   */
  private claimDue(limit: number): Promise<DispatchClaim[]> {
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<DispatchCandidate[]>`
        SELECT "id", "dispatch_attempt_count"
        FROM "agent_document_analysis_jobs"
        WHERE
          (
            (
              "status" = 'queued'::"AgentDocumentAnalysisJobStatus"
              AND "next_dispatch_at" <= CURRENT_TIMESTAMP
            )
            OR
            (
              "status" = 'dispatching'::"AgentDocumentAnalysisJobStatus"
              AND "dispatch_lease_until" <= CURRENT_TIMESTAMP
            )
            OR
            (
              -- Abandoned run; see claimDue's comment for why "updated_at".
              "status" = 'running'::"AgentDocumentAnalysisJobStatus"
              AND "updated_at" <=
                CURRENT_TIMESTAMP - make_interval(
                  secs => ${this.#config.documentAnalysisStaleRunSeconds}
                )
            )
            OR
            (
              -- Recoverable terminal failure; fail() set "next_dispatch_at".
              "status" = 'failed'::"AgentDocumentAnalysisJobStatus"
              AND "error" ->> 'retryable' = 'true'
              AND "next_dispatch_at" <= CURRENT_TIMESTAMP
            )
          )
          AND "dispatch_attempt_count" <
            ${this.#config.documentAnalysisDispatchMaxAttempts}
        ORDER BY "next_dispatch_at" ASC, "created_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `;
      const claims: DispatchClaim[] = [];
      for (const candidate of candidates) {
        const leaseToken = randomUUID();
        const workflowId = `agent-document-analysis:${candidate.id}`;
        const attempt = candidate.dispatch_attempt_count + 1;
        await transaction.$executeRaw`
          UPDATE "agent_document_analysis_jobs"
          SET
            "status" = 'dispatching'::"AgentDocumentAnalysisJobStatus",
            "temporal_workflow_id" = ${workflowId},
            "dispatch_attempt_count" = ${attempt},
            "dispatch_lease_token" = ${leaseToken}::uuid,
            "dispatch_lease_until" =
              CURRENT_TIMESTAMP
              + (${this.#config.documentAnalysisDispatchLeaseMs} * INTERVAL '1 millisecond'),
            "stage" = 'dispatching',
            "error" = NULL,
            -- A reclaimed failure carries a completion timestamp, and the
            -- lifecycle check constraint forbids one on an in-flight row.
            "completed_at" = NULL,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${candidate.id}::uuid
        `;
        claims.push({
          jobId: candidate.id,
          workflowId,
          leaseToken,
          attempt,
        });
      }
      return claims;
    });
  }

  private async dispatch(claim: DispatchClaim): Promise<void> {
    try {
      await this.ensureConnected();
      const input: AgentLongDocumentWorkflowInput = {
        schemaVersion: 'agent-long-document-analysis-workflow/v1',
        jobId: claim.jobId,
      };
      try {
        await this.#client!.workflow.start(WORKFLOW_TYPE, {
          taskQueue: this.#config.temporal.documentTaskQueue,
          workflowId: claim.workflowId,
          workflowIdReusePolicy:
            WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
          workflowTaskTimeout: '10 seconds',
          args: [input],
          memo: {
            schemaVersion: input.schemaVersion,
            jobId: claim.jobId,
          },
        });
      } catch (error) {
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          throw error;
        }
      }
      await this.markDispatched(claim);
    } catch (error) {
      await this.recordDispatchFailure(claim, error);
    }
  }

  private async markDispatched(claim: DispatchClaim): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.agentDocumentAnalysisJob.updateMany({
      where: {
        id: claim.jobId,
        status: AgentDocumentAnalysisJobStatus.dispatching,
        dispatchLeaseToken: claim.leaseToken,
      },
      data: {
        status: AgentDocumentAnalysisJobStatus.running,
        stage: 'queued_for_worker',
        startedAt: now,
        dispatchLeaseToken: null,
        dispatchLeaseUntil: null,
        error: Prisma.DbNull,
      },
    });
    if (updated.count === 1) {
      this.#logger.log({
        event: 'agent.document_analysis.dispatched',
        jobId: claim.jobId,
        workflowId: claim.workflowId,
        attempt: claim.attempt,
      });
      return;
    }
    const current = await this.prisma.agentDocumentAnalysisJob.findUnique({
      where: { id: claim.jobId },
      select: { temporalWorkflowId: true, status: true },
    });
    const acceptedStatuses = new Set<AgentDocumentAnalysisJobStatus>([
      AgentDocumentAnalysisJobStatus.running,
      AgentDocumentAnalysisJobStatus.reducing,
      AgentDocumentAnalysisJobStatus.succeeded,
    ]);
    if (
      current?.temporalWorkflowId !== claim.workflowId ||
      !acceptedStatuses.has(current.status)
    ) {
      throw new Error(
        `Document analysis ${claim.jobId} lost its dispatch fence.`,
      );
    }
  }

  private async recordDispatchFailure(
    claim: DispatchClaim,
    error: unknown,
  ): Promise<void> {
    const retry =
      claim.attempt < this.#config.documentAnalysisDispatchMaxAttempts;
    const failure = {
      code: retry
        ? 'AGENT_DOCUMENT_ANALYSIS_DISPATCH_DEFERRED'
        : 'AGENT_DOCUMENT_ANALYSIS_DISPATCH_EXHAUSTED',
      message: retry
        ? 'Document analysis is waiting for the durable workflow runtime to recover.'
        : 'Document analysis could not start after exhausting its dispatch retry budget.',
      retryable: retry,
    };
    const delayMs = dispatchBackoffMs(claim.jobId, claim.attempt);
    await this.prisma.$transaction(async (transaction) => {
      const fenced = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "agent_document_analysis_jobs"
        WHERE
          "id" = ${claim.jobId}::uuid
          AND "status" = 'dispatching'::"AgentDocumentAnalysisJobStatus"
          AND "dispatch_lease_token" = ${claim.leaseToken}::uuid
        FOR UPDATE
      `;
      if (fenced.length !== 1) return;
      if (retry) {
        await transaction.$executeRaw`
          UPDATE "agent_document_analysis_jobs"
          SET
            "status" = 'queued'::"AgentDocumentAnalysisJobStatus",
            "next_dispatch_at" =
              CURRENT_TIMESTAMP + (${delayMs} * INTERVAL '1 millisecond'),
            "dispatch_lease_token" = NULL,
            "dispatch_lease_until" = NULL,
            "stage" = 'dispatch_retry_wait',
            "error" = ${JSON.stringify(failure)}::jsonb,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${claim.jobId}::uuid
        `;
        return;
      }
      const now = new Date();
      await transaction.agentDocumentAnalysisJob.update({
        where: { id: claim.jobId },
        data: {
          status: AgentDocumentAnalysisJobStatus.dead_lettered,
          dispatchLeaseToken: null,
          dispatchLeaseUntil: null,
          stage: 'dead_lettered',
          error: failure,
          completedAt: now,
          deadLetteredAt: now,
        },
      });
    });
    this.#logger.warn({
      event: retry
        ? 'agent.document_analysis.dispatch_retry_scheduled'
        : 'agent.document_analysis.dispatch_dead_lettered',
      jobId: claim.jobId,
      attempt: claim.attempt,
      delayMs: retry ? delayMs : undefined,
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }

  /**
   * Terminalizes work whose redelivery budget is gone.
   *
   * A retryable failure is included: once it can no longer be re-dispatched it
   * is not retryable any more, and leaving the row advertising `retryable:
   * true` promises the product a recovery nothing will ever perform.
   */
  private async deadLetterExhausted(): Promise<void> {
    const now = new Date();
    const failure = {
      code: 'AGENT_DOCUMENT_ANALYSIS_DISPATCH_EXHAUSTED',
      message:
        'Document analysis stopped after exhausting its redelivery budget.',
      retryable: false,
    };
    await this.prisma.$executeRaw`
      UPDATE "agent_document_analysis_jobs"
      SET
        "status" = 'dead_lettered'::"AgentDocumentAnalysisJobStatus",
        "dispatch_lease_token" = NULL,
        "dispatch_lease_until" = NULL,
        "stage" = 'dead_lettered',
        "error" = ${JSON.stringify(failure)}::jsonb,
        "completed_at" = ${now},
        "dead_lettered_at" = ${now},
        "updated_at" = CURRENT_TIMESTAMP
      WHERE
        (
          (
            "status" = 'queued'::"AgentDocumentAnalysisJobStatus"
            AND "next_dispatch_at" <= CURRENT_TIMESTAMP
          )
          OR
          (
            "status" = 'dispatching'::"AgentDocumentAnalysisJobStatus"
            AND "dispatch_lease_until" <= CURRENT_TIMESTAMP
          )
          OR
          (
            "status" = 'failed'::"AgentDocumentAnalysisJobStatus"
            AND "error" ->> 'retryable' = 'true'
            AND "next_dispatch_at" <= CURRENT_TIMESTAMP
          )
        )
        AND "dispatch_attempt_count" >=
          ${this.#config.documentAnalysisDispatchMaxAttempts}
    `;
  }

  private async ensureConnected(): Promise<void> {
    if (this.#client && this.#connection) return;
    if (this.#connecting) return this.#connecting;
    const connect = this.connect();
    const tracked = connect.finally(() => {
      if (this.#connecting === tracked) this.#connecting = null;
    });
    this.#connecting = tracked;
    return tracked;
  }

  private async connect(): Promise<void> {
    const fromEnvironment = loadClientConnectConfig({ disableFile: true });
    if (
      fromEnvironment.connectionOptions.address !==
      this.#config.temporal.address
    ) {
      throw new Error('Temporal address configuration is inconsistent.');
    }
    if (
      fromEnvironment.namespace &&
      fromEnvironment.namespace !== this.#config.temporal.namespace
    ) {
      throw new Error('Temporal namespace configuration is inconsistent.');
    }
    const connection = await Connection.connect(
      fromEnvironment.connectionOptions,
    );
    if (this.#stopping) {
      await connection.close();
      return;
    }
    this.#connection = connection;
    this.#client = new Client({
      connection,
      namespace: this.#config.temporal.namespace,
    });
  }
}

function dispatchBackoffMs(jobId: string, attempt: number): number {
  const base = Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  const stableJitter =
    Number.parseInt(jobId.replaceAll('-', '').slice(-4), 16) / 0xffff;
  return Math.round(base * (0.8 + stableJitter * 0.4));
}

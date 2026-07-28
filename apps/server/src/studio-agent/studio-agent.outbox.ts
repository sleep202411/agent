import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  Prisma,
  StudioAgentCommandStatus,
  type StudioAgentCommandType,
} from '@prisma/client';
import { StudioAgentErrorSchema } from '@repo/shared/studio-agent';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../infra/db/db.module';
import { StudioAgentConfigService } from './studio-agent.config';
import { StudioAgentRunTerminalService } from './studio-agent-run-terminal.service';
import { StudioAgentTemporalTransport } from './studio-agent.temporal';

interface ClaimedCommand {
  id: string;
  threadId: string;
  runId: string;
  workflowId: string;
  type: StudioAgentCommandType;
  payload: Prisma.JsonValue;
  leaseToken: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: Date;
}

const MAX_RETRY_DELAY_MS = 5 * 60_000;

/**
 * Transactional outbox dispatcher.
 *
 * Multi-pod claims are protected by SKIP LOCKED, a DB lease, and per-workflow
 * head-of-line eligibility. Different workflows dispatch concurrently, while
 * commands for one workflow are delivered in durable creation order. Dispatch
 * remains deliberately at-least-once; workflow IDs, signal identities, and
 * the runtime's inbox make every command idempotent across ambiguous network
 * failures.
 */
@Injectable()
export class StudioAgentCommandOutboxDispatcher
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(StudioAgentCommandOutboxDispatcher.name);
  private readonly workerId = `studio-agent-outbox:${hostname()}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: StudioAgentConfigService,
    private readonly transport: StudioAgentTemporalTransport,
    private readonly runTerminal: StudioAgentRunTerminalService,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.config.value.commandPollIntervalMs;
    this.timer = setInterval(() => void this.drainOnce(), interval);
    this.timer.unref?.();
    void this.drainOnce();
    this.logger.log(
      `Studio Agent command outbox running every ${interval}ms (${this.workerId})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining;
  }

  async drainOnce(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drainClaimed().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drainClaimed(): Promise<void> {
    const commands = (await this.claim()).slice().sort(compareClaimedCommands);
    const byWorkflow = new Map<string, ClaimedCommand[]>();
    for (const command of commands) {
      const workflowCommands = byWorkflow.get(command.workflowId);
      if (workflowCommands) {
        workflowCommands.push(command);
      } else {
        byWorkflow.set(command.workflowId, [command]);
      }
    }
    await Promise.all(
      [...byWorkflow.values()].map(async (workflowCommands) => {
        for (const command of workflowCommands) {
          await this.dispatchOne(command);
        }
      }),
    );
  }

  private async claim(): Promise<ClaimedCommand[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + this.config.value.commandLeaseMs,
    );
    const leaseToken = randomUUID();
    return this.prisma.$queryRaw<ClaimedCommand[]>`
      WITH candidates AS (
        SELECT command."id"
        FROM "studio_agent_command_outbox" AS command
        INNER JOIN "studio_agent_runs" AS run
          ON run."id" = command."run_id"
        WHERE command."status" = 'pending'
          AND command."next_attempt_at" <= ${now}
          AND (
            command."lease_expires_at" IS NULL
            OR command."lease_expires_at" <= ${now}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "studio_agent_command_outbox" AS predecessor
            INNER JOIN "studio_agent_runs" AS predecessor_run
              ON predecessor_run."id" = predecessor."run_id"
            WHERE predecessor."status" = 'pending'
              AND predecessor_run."workflow_id" = run."workflow_id"
              AND (
                predecessor."created_at",
                predecessor."id"
              ) < (
                command."created_at",
                command."id"
              )
          )
        ORDER BY command."next_attempt_at", command."created_at", command."id"
        FOR UPDATE OF command SKIP LOCKED
        LIMIT ${this.config.value.commandBatchSize}
      )
      UPDATE "studio_agent_command_outbox" AS command
      SET
        "attempt_count" = command."attempt_count" + 1,
        "lease_token" = ${leaseToken}::uuid,
        "lease_owner" = ${this.workerId},
        "lease_acquired_at" = ${now},
        "lease_expires_at" = ${leaseExpiresAt},
        "updated_at" = ${now}
      FROM candidates, "studio_agent_runs" AS run
      WHERE command."id" = candidates."id"
        AND run."id" = command."run_id"
      RETURNING
        command."id",
        command."thread_id" AS "threadId",
        command."run_id" AS "runId",
        run."workflow_id" AS "workflowId",
        command."type",
        command."payload",
        command."lease_token" AS "leaseToken",
        command."attempt_count" AS "attemptCount",
        command."max_attempts" AS "maxAttempts",
        command."created_at" AS "createdAt"
    `;
  }

  private async dispatchOne(command: ClaimedCommand): Promise<void> {
    try {
      await this.transport.dispatch({
        workflowId: command.workflowId,
        type: command.type,
        payload: command.payload,
      });
      await this.markDispatched(command);
    } catch (error) {
      await this.recordFailure(command, error);
    }
  }

  private async markDispatched(command: ClaimedCommand): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.studioAgentCommandOutbox.updateMany({
      where: {
        id: command.id,
        status: StudioAgentCommandStatus.pending,
        leaseToken: command.leaseToken,
        leaseOwner: this.workerId,
      },
      data: {
        status: StudioAgentCommandStatus.dispatched,
        dispatchedAt: now,
        leaseToken: null,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
      },
    });
    if (updated.count !== 1) {
      this.logger.warn(
        `Lost command lease before dispatch commit command=${command.id}`,
      );
    }
  }

  private async recordFailure(
    command: ClaimedCommand,
    cause: unknown,
  ): Promise<void> {
    const error = normalizeError(cause);
    if (command.attemptCount < command.maxAttempts) {
      const retryAt = new Date(Date.now() + retryDelayMs(command.attemptCount));
      await this.prisma.studioAgentCommandOutbox.updateMany({
        where: {
          id: command.id,
          status: StudioAgentCommandStatus.pending,
          leaseToken: command.leaseToken,
          leaseOwner: this.workerId,
        },
        data: {
          nextAttemptAt: retryAt,
          leaseToken: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          lastErrorCode: error.code,
          lastErrorDetail: error.message,
        },
      });
      this.logger.warn(
        `Studio Agent command retry scheduled command=${command.id} attempt=${command.attemptCount}/${command.maxAttempts} code=${error.code}`,
      );
      return;
    }

    await this.deadLetter(command, error);
    this.logger.error(
      `Studio Agent command dead-lettered command=${command.id} run=${command.runId} code=${error.code}`,
    );
  }

  private async deadLetter(
    command: ClaimedCommand,
    error: ReturnType<typeof normalizeError>,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      await transaction.$queryRaw`
        SELECT "id"
          FROM "studio_agent_threads"
         WHERE "id" = ${command.threadId}::uuid
         FOR UPDATE
      `;
      const commandUpdate =
        await transaction.studioAgentCommandOutbox.updateMany({
          where: {
            id: command.id,
            status: StudioAgentCommandStatus.pending,
            leaseToken: command.leaseToken,
            leaseOwner: this.workerId,
          },
          data: {
            status: StudioAgentCommandStatus.dead_letter,
            deadLetteredAt: now,
            leaseToken: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            lastErrorCode: error.code,
            lastErrorDetail: error.message,
          },
        });
      if (commandUpdate.count !== 1) return;

      const commandRun = await transaction.studioAgentRun.findUnique({
        where: { id: command.runId },
      });
      if (
        !commandRun ||
        commandRun.status === 'succeeded' ||
        commandRun.status === 'failed' ||
        commandRun.status === 'cancelled'
      ) {
        // A delayed signal/cancel may outlive the workflow it targeted. The
        // command remains dead-lettered for operational evidence, but a stale
        // command for an already-terminal child must never fail its still-live
        // root run.
        return;
      }
      const run =
        commandRun.parentRunId === null
          ? commandRun
          : await transaction.studioAgentRun.findUnique({
              where: { id: commandRun.rootRunId },
            });
      if (
        !run ||
        run.status === 'succeeded' ||
        run.status === 'failed' ||
        run.status === 'cancelled'
      ) {
        return;
      }

      const terminalError = StudioAgentErrorSchema.parse({
        ...error,
        retryable: false,
      });
      await this.runTerminal.terminalizeInTransaction(
        transaction,
        run,
        {
          status: 'failed',
          error: terminalError,
          reason: terminalError.message,
        },
        now,
      );
    });
  }
}

function compareClaimedCommands(
  left: ClaimedCommand,
  right: ClaimedCommand,
): number {
  const createdAtDifference =
    left.createdAt.getTime() - right.createdAt.getTime();
  return createdAtDifference || left.id.localeCompare(right.id);
}

export function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1));
  return Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** exponent);
}

function normalizeError(error: unknown) {
  const source = error instanceof Error ? error : new Error(String(error));
  return StudioAgentErrorSchema.parse({
    code: 'runtime_command_delivery_failed',
    message: source.message.slice(0, 8_000),
    retryable: true,
    details: {
      errorName: source.name,
    },
  });
}

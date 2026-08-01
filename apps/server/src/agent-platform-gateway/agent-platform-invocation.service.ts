import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AgentPlatformInvocationAttemptStatus as StoredAttemptStatus,
  AgentPlatformInvocationStatus as StoredInvocationStatus,
  Prisma,
  type AgentPlatformInvocation,
  type AgentPlatformInvocationAttempt,
} from '@prisma/client';
import {
  AgentInvocationLifecycleRequestSchema,
  AgentInvocationStatusPageSchema,
  AgentPublicErrorSchema,
  type AgentInvocationGatewayRequest,
  type AgentInvocationLifecycleRequest,
  type AgentPublicError,
  type AgentInvocationStatus,
  type AgentInvocationStatusPage,
  type AgentInvocationStatusRequest,
} from '@repo/shared/agent-platform';

import { PrismaService } from '../infra/db/db.module';
import type { AuthorizedAgentContext } from './agent-platform-gateway.dto';
import type { AgentPlatformGatewayConfig } from './agent-platform-gateway.config';

const TERMINAL_STATUSES = new Set<StoredInvocationStatus>([
  StoredInvocationStatus.succeeded,
  StoredInvocationStatus.failed,
  StoredInvocationStatus.cancelled,
]);
const CAPACITY_HOLDING_STATUSES: StoredInvocationStatus[] = [
  StoredInvocationStatus.admitting,
  StoredInvocationStatus.queued,
  StoredInvocationStatus.running,
  StoredInvocationStatus.waiting_for_approval,
];
const MAX_ACTIVE_INVOCATIONS_PER_PAGE = 550;

export {
  AgentInvocationLifecycleRequestSchema,
  type AgentInvocationLifecycleRequest,
};
export type AgentAdmissionPolicy = AgentPlatformGatewayConfig['admission'];

export type ReservedAgentInvocation = Readonly<{
  invocationId: string;
  provisionalRunId: string;
  workflowId: string | null;
  attemptId: string;
  attemptOrdinal: number;
  shouldForward: boolean;
}>;

export type ClaimedAgentInvocation = Readonly<{
  attemptId: string;
  attemptOrdinal: number;
  invocationId: string;
  conversationId: string;
  ownerActorId: string;
  inputEventId: string;
  clientMessageId: string;
  provisionalRunId: string;
  locale: string;
  leaseToken: string;
  admissionAttempts: number;
}>;

export type AdmissionRejectionScope =
  | 'global'
  | 'workspace'
  | 'actor'
  | 'provider_lane';
export type AdmissionRejectionDimension =
  | 'active_runs'
  | 'reserved_token_units'
  | 'reserved_cost_microusd';

/**
 * Structured reservation-time capacity rejection.
 *
 * The controller mirrors `retryAfterSeconds` into the standard Retry-After
 * response header. Capacity dimensions stay private to service telemetry; the
 * HTTP body remains the same strict five-field public error contract used by
 * lifecycle/status projection.
 */
export class AgentAdmissionRejectedException extends HttpException {
  readonly retryAfterSeconds: number;
  readonly diagnosticId: string;
  readonly scope: AdmissionRejectionScope;
  readonly dimension: AdmissionRejectionDimension;
  readonly limit: string;

  constructor(input: {
    scope: AdmissionRejectionScope;
    dimension: AdmissionRejectionDimension;
    limit: number | bigint;
    retryAfterSeconds: number;
  }) {
    const diagnosticId = randomUUID();
    super(
      AgentPublicErrorSchema.parse({
        code: 'AGENT_ADMISSION_CAPACITY_EXHAUSTED',
        messageKey: 'agent.error.capacity_exhausted',
        message:
          'Agent execution capacity is currently full. Retry after an active run settles.',
        retryable: true,
        diagnosticId,
      }),
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.diagnosticId = diagnosticId;
    this.scope = input.scope;
    this.dimension = input.dimension;
    this.limit = String(input.limit);
  }
}

@Injectable()
export class AgentPlatformInvocationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserve a root run or append one continuation trigger to an existing run.
   *
   * Root capacity is decided under PostgreSQL advisory locks in the global →
   * workspace → actor → provider-lane order. Every gateway replica uses the
   * same order and counts committed, non-terminal aggregates, so a rejection
   * leaves no invocation/attempt row and cannot oversubscribe on another pod.
   *
   * A continuation does not reserve capacity again: it belongs to the same
   * Ably run and reuses the aggregate's run/invocation identity.
   */
  async reserve(
    context: AuthorizedAgentContext,
    request: AgentInvocationGatewayRequest,
    policy: AgentAdmissionPolicy,
  ): Promise<ReservedAgentInvocation> {
    return this.prisma.$transaction(async (transaction) => {
      await lock(
        transaction,
        `agent-attempt-event:${context.conversationId}:${request.inputEventId}`,
      );
      await lock(
        transaction,
        `agent-attempt-message:${context.conversationId}:${request.clientMessageId}`,
      );

      const existingAttempt = await findExistingAttempt(
        transaction,
        context.conversationId,
        request,
      );
      if (existingAttempt) {
        assertAttemptIdentity(existingAttempt, context, request);
        if (existingAttempt.status !== StoredAttemptStatus.rejected) {
          return reservation(
            existingAttempt.invocation,
            existingAttempt,
            existingAttempt.status === StoredAttemptStatus.admitting,
          );
        }
        return this.reopenRejectedAttempt(
          transaction,
          existingAttempt,
          context,
          policy,
        );
      }

      if (request.continuationOfInvocationId) {
        return this.reserveContinuation(
          transaction,
          context,
          request,
          request.continuationOfInvocationId,
        );
      }

      const conversation =
        await transaction.agentPlatformConversation.findUnique({
          where: {
            id_ownerActorId: {
              id: context.conversationId,
              ownerActorId: context.actorId,
            },
          },
          select: { scopeKey: true },
        });
      if (!conversation) {
        throw publicNotFound(
          'AGENT_CONVERSATION_NOT_FOUND',
          'agent.error.conversation_not_found',
          'The Agent conversation does not exist.',
        );
      }
      const workspaceScopeKey = admissionWorkspaceScopeKey(
        context,
        conversation.scopeKey,
      );

      await lockAdmissionScopes(
        transaction,
        workspaceScopeKey,
        context.actorId,
        policy.providerLane,
      );
      await assertCapacityAvailable(
        transaction,
        workspaceScopeKey,
        context.actorId,
        policy,
      );

      const created = await transaction.agentPlatformInvocation.create({
        data: {
          conversationId: context.conversationId,
          ownerActorId: context.actorId,
          workspaceScopeKey,
          providerLane: policy.providerLane,
          reservedTokenUnits: policy.reservation.tokenUnits,
          reservedCostMicrousd: policy.reservation.costMicrousd,
          inputEventId: request.inputEventId,
          clientMessageId: request.clientMessageId,
          locale: request.locale,
          attempts: {
            create: {
              ordinal: 0,
              conversationId: context.conversationId,
              inputEventId: request.inputEventId,
              clientMessageId: request.clientMessageId,
              locale: request.locale,
            },
          },
        },
        include: { attempts: true },
      });
      return reservation(created, created.attempts[0], true);
    });
  }

  private async reserveContinuation(
    transaction: Prisma.TransactionClient,
    context: AuthorizedAgentContext,
    request: AgentInvocationGatewayRequest,
    invocationId: string,
  ): Promise<ReservedAgentInvocation> {
    await lock(transaction, `agent-invocation:${invocationId}`);
    const aggregate = await transaction.agentPlatformInvocation.findUnique({
      where: { id: invocationId },
    });
    if (
      !aggregate ||
      aggregate.conversationId !== context.conversationId ||
      aggregate.ownerActorId !== context.actorId
    ) {
      throw publicNotFound(
        'AGENT_INVOCATION_NOT_FOUND',
        'agent.error.invocation_not_found',
        'The Agent invocation does not exist.',
      );
    }

    const replay = await transaction.agentPlatformInvocationAttempt.findUnique({
      where: {
        conversationId_clientMessageId: {
          conversationId: context.conversationId,
          clientMessageId: request.clientMessageId,
        },
      },
    });
    if (replay) {
      assertAttemptIdentity(
        { ...replay, invocation: aggregate },
        context,
        request,
      );
      return reservation(
        aggregate,
        replay,
        replay.status === StoredAttemptStatus.admitting,
      );
    }

    if (aggregate.status !== StoredInvocationStatus.waiting_for_approval) {
      throw publicConflict(
        'AGENT_CONTINUATION_NOT_AWAITED',
        'agent.error.continuation_not_awaited',
        'This Agent run is not waiting for an approval or tool result.',
      );
    }
    if (aggregate.latestAttemptOrdinal !== aggregate.lifecycleAttemptOrdinal) {
      throw publicConflict(
        'AGENT_CONTINUATION_ALREADY_PENDING',
        'agent.error.continuation_pending',
        'This Agent run already has a continuation awaiting durable admission.',
      );
    }

    const ordinal = aggregate.latestAttemptOrdinal + 1;
    const attempt = await transaction.agentPlatformInvocationAttempt.create({
      data: {
        invocationId: aggregate.id,
        conversationId: aggregate.conversationId,
        ordinal,
        inputEventId: request.inputEventId,
        clientMessageId: request.clientMessageId,
        locale: request.locale,
      },
    });
    const updated = await transaction.agentPlatformInvocation.update({
      where: { id: aggregate.id },
      data: { latestAttemptOrdinal: ordinal },
    });
    return reservation(updated, attempt, true);
  }

  private async reopenRejectedAttempt(
    transaction: Prisma.TransactionClient,
    attempt: AttemptWithInvocation,
    context: AuthorizedAgentContext,
    policy: AgentAdmissionPolicy,
  ): Promise<ReservedAgentInvocation> {
    await lock(transaction, `agent-invocation:${attempt.invocationId}`);
    const aggregate =
      await transaction.agentPlatformInvocation.findUniqueOrThrow({
        where: { id: attempt.invocationId },
      });

    if (attempt.ordinal === 0) {
      if (aggregate.status !== StoredInvocationStatus.rejected) {
        throw retryConflict();
      }
      await lockAdmissionScopes(
        transaction,
        aggregate.workspaceScopeKey,
        context.actorId,
        policy.providerLane,
      );
      await assertCapacityAvailable(
        transaction,
        aggregate.workspaceScopeKey,
        context.actorId,
        policy,
      );
      const reopenedAttempt =
        await transaction.agentPlatformInvocationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: StoredAttemptStatus.admitting,
            error: Prisma.DbNull,
            admissionAttempts: 0,
            nextAdmissionAttemptAt: new Date(),
            admissionLeaseToken: null,
            admissionLeaseUntil: null,
            dispatchedAt: null,
          },
        });
      const reopenedAggregate =
        await transaction.agentPlatformInvocation.update({
          where: { id: aggregate.id },
          data: {
            providerLane: policy.providerLane,
            reservedTokenUnits: policy.reservation.tokenUnits,
            reservedCostMicrousd: policy.reservation.costMicrousd,
            status: StoredInvocationStatus.admitting,
            workflowId: null,
            error: Prisma.DbNull,
            admittedAt: null,
            startedAt: null,
            completedAt: null,
            lifecycleAttemptOrdinal: -1,
          },
        });
      return reservation(reopenedAggregate, reopenedAttempt, true);
    }

    if (
      aggregate.status !== StoredInvocationStatus.waiting_for_approval ||
      aggregate.latestAttemptOrdinal !== attempt.ordinal
    ) {
      throw retryConflict();
    }
    const reopenedAttempt =
      await transaction.agentPlatformInvocationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: StoredAttemptStatus.admitting,
          error: Prisma.DbNull,
          admissionAttempts: 0,
          nextAdmissionAttemptAt: new Date(),
          admissionLeaseToken: null,
          admissionLeaseUntil: null,
          dispatchedAt: null,
        },
      });
    return reservation(aggregate, reopenedAttempt, true);
  }

  async markQueued(
    attemptId: string,
    invocationId: string,
    conversationId: string,
    workflowId: string,
    leaseToken: string,
  ): Promise<void> {
    await this.withAttemptLock(
      attemptId,
      async (transaction, attempt, aggregate) => {
        assertAttemptAggregate(
          attempt,
          aggregate,
          invocationId,
          conversationId,
        );
        if (attempt.status === StoredAttemptStatus.dispatched) {
          if (
            !TERMINAL_STATUSES.has(aggregate.status) &&
            aggregate.workflowId === null
          ) {
            await transaction.agentPlatformInvocation.update({
              where: { id: aggregate.id },
              data: { workflowId },
            });
          }
          return;
        }
        if (
          attempt.status !== StoredAttemptStatus.admitting ||
          attempt.admissionLeaseToken !== leaseToken
        ) {
          return;
        }
        const now = new Date();
        await transaction.agentPlatformInvocationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: StoredAttemptStatus.dispatched,
            error: Prisma.DbNull,
            dispatchedAt: now,
            nextAdmissionAttemptAt: null,
            admissionLeaseToken: null,
            admissionLeaseUntil: null,
          },
        });

        if (
          attempt.ordinal === 0 &&
          aggregate.status === StoredInvocationStatus.admitting
        ) {
          await transaction.agentPlatformInvocation.update({
            where: { id: aggregate.id },
            data: {
              status: StoredInvocationStatus.queued,
              workflowId,
              admittedAt: aggregate.admittedAt ?? now,
              completedAt: null,
              error: Prisma.DbNull,
            },
          });
          return;
        }

        if (!TERMINAL_STATUSES.has(aggregate.status)) {
          await transaction.agentPlatformInvocation.update({
            where: { id: aggregate.id },
            data: { workflowId: aggregate.workflowId ?? workflowId },
          });
        }
      },
    );
  }

  async markRejected(
    attemptId: string,
    invocationId: string,
    conversationId: string,
    leaseToken: string,
    error: AgentPublicError,
  ): Promise<void> {
    AgentPublicErrorSchema.parse(error);
    await this.withAttemptLock(
      attemptId,
      async (transaction, attempt, aggregate) => {
        assertAttemptAggregate(
          attempt,
          aggregate,
          invocationId,
          conversationId,
        );
        if (
          attempt.status !== StoredAttemptStatus.admitting ||
          attempt.admissionLeaseToken !== leaseToken
        ) {
          return;
        }
        await rejectAttempt(transaction, attempt, aggregate, error);
      },
    );
  }

  async applyLifecycle(rawRequest: unknown): Promise<void> {
    const request = AgentInvocationLifecycleRequestSchema.parse(rawRequest);
    await this.withInvocationLock(
      request.invocationId,
      async (transaction, current) => {
        assertConversation(current, request.conversationId);
        if (current.provisionalRunId !== request.runId) {
          throw publicConflict(
            'AGENT_INVOCATION_RUN_MISMATCH',
            'agent.error.runtime_protocol_conflict',
            'The lifecycle update does not match the reserved Agent run.',
          );
        }

        const lifecycleAttempt =
          await transaction.agentPlatformInvocationAttempt.findUnique({
            where: { id: request.attemptId },
          });
        if (
          lifecycleAttempt === null ||
          lifecycleAttempt.invocationId !== current.id ||
          lifecycleAttempt.conversationId !== current.conversationId ||
          lifecycleAttempt.ordinal !== request.attemptOrdinal
        ) {
          throw publicConflict(
            'AGENT_INVOCATION_ATTEMPT_MISMATCH',
            'agent.error.runtime_protocol_conflict',
            'The lifecycle update does not match the reserved Agent attempt.',
          );
        }

        // A continuation may be reserved before a delayed callback from its
        // predecessor arrives. Attempt identity makes that callback an
        // acknowledged no-op instead of accidentally promoting the new
        // continuation to running or terminating the aggregate.
        if (request.attemptOrdinal < current.latestAttemptOrdinal) {
          return;
        }
        if (request.attemptOrdinal > current.latestAttemptOrdinal) {
          throw publicConflict(
            'AGENT_INVOCATION_ATTEMPT_NOT_RESERVED',
            'agent.error.runtime_protocol_conflict',
            'The lifecycle update references an Agent attempt that is not current.',
          );
        }
        if (TERMINAL_STATUSES.has(current.status)) {
          // Retries or stale non-terminal callbacks can arrive after the
          // terminal transaction. They are acknowledged as no-ops so an old
          // waiting state can neither regress the aggregate nor create noisy
          // callback retry loops. Different terminal outcomes remain a hard
          // split-brain signal.
          if (
            request.status === 'running' ||
            request.status === 'waiting_for_approval' ||
            current.status === request.status
          ) {
            return;
          }
          throw publicConflict(
            'AGENT_INVOCATION_TERMINAL_CONFLICT',
            'agent.error.runtime_protocol_conflict',
            'The Agent invocation already has a different terminal status.',
          );
        }
        if (current.status === StoredInvocationStatus.rejected) {
          throw publicConflict(
            'AGENT_INVOCATION_NOT_ADMITTED',
            'agent.error.runtime_protocol_conflict',
            'A rejected Agent invocation cannot enter execution.',
          );
        }
        if (lifecycleAttempt.status === StoredAttemptStatus.rejected) {
          throw publicConflict(
            'AGENT_INVOCATION_ATTEMPT_REJECTED',
            'agent.error.runtime_protocol_conflict',
            'A rejected Agent attempt cannot enter the execution lifecycle.',
          );
        }

        const now = new Date();
        const admittedAt = current.admittedAt ?? now;
        if (request.status === 'running') {
          if (
            current.lifecycleAttemptOrdinal === request.attemptOrdinal &&
            (current.status === StoredInvocationStatus.running ||
              current.status === StoredInvocationStatus.waiting_for_approval)
          ) {
            return;
          }

          // A lifecycle callback is stronger delivery evidence than the
          // gateway's upstream HTTP acknowledgement. Closing the attempt here
          // eliminates the response/callback race without regressing the
          // aggregate; the late HTTP acknowledgement may still attach the
          // workflow id through markQueued().
          await markAttemptDispatchedFromLifecycle(
            transaction,
            lifecycleAttempt,
            now,
          );

          await transaction.agentPlatformInvocation.update({
            where: { id: current.id },
            data: {
              status: StoredInvocationStatus.running,
              admittedAt,
              startedAt: current.startedAt ?? now,
              lifecycleAttemptOrdinal: request.attemptOrdinal,
              error: Prisma.DbNull,
            },
          });
          return;
        }
        if (request.status === 'waiting_for_approval') {
          if (
            current.status === StoredInvocationStatus.waiting_for_approval &&
            current.lifecycleAttemptOrdinal === request.attemptOrdinal
          ) {
            return;
          }
          if (
            current.status !== StoredInvocationStatus.running ||
            current.lifecycleAttemptOrdinal !== request.attemptOrdinal
          ) {
            // A duplicate waiting callback is idempotent; every other
            // non-running source would regress the aggregate.
            throw invalidTransition();
          }
          await transaction.agentPlatformInvocation.update({
            where: { id: current.id },
            data: {
              status: StoredInvocationStatus.waiting_for_approval,
              error: Prisma.DbNull,
            },
          });
          return;
        }

        await markAttemptDispatchedFromLifecycle(
          transaction,
          lifecycleAttempt,
          now,
        );
        await transaction.agentPlatformInvocation.update({
          where: { id: current.id },
          data: {
            status: request.status,
            admittedAt,
            startedAt:
              request.status === 'succeeded'
                ? (current.startedAt ?? now)
                : current.startedAt,
            completedAt: now,
            error:
              request.status === 'failed'
                ? (request.error as Prisma.InputJsonValue)
                : Prisma.DbNull,
            lifecycleAttemptOrdinal: request.attemptOrdinal,
          },
        });
      },
    );
  }

  async list(
    context: AuthorizedAgentContext,
    request: AgentInvocationStatusRequest,
  ): Promise<AgentInvocationStatusPage> {
    return this.prisma.$transaction(
      async (transaction) => {
        const scope = {
          conversationId: context.conversationId,
          ownerActorId: context.actorId,
        } as const;
        // A repeatable-read snapshot binds the aggregate revision and latest
        // trigger projection to one database fact. A callback committed after
        // this snapshot is above the returned cursor and arrives on the next
        // reconciliation; it can never leak future attempt state under an old
        // cursor.
        const snapshot = await transaction.agentPlatformInvocation.aggregate({
          where: scope,
          _max: { statusRevision: true },
        });
        const snapshotRevision = snapshot._max.statusRevision ?? 0n;
        const sinceRevision = BigInt(request.sinceRevision ?? '0');
        if (sinceRevision > snapshotRevision) {
          throw publicBadRequest(
            'AGENT_INVOCATION_REVISION_INVALID',
            'agent.error.status_cursor_invalid',
            'The invocation status cursor does not belong to this conversation snapshot.',
          );
        }

        const activeRows = await transaction.agentPlatformInvocation.findMany({
          where: {
            ...scope,
            status: { in: CAPACITY_HOLDING_STATUSES },
            statusRevision: { lte: snapshotRevision },
          },
          orderBy: [{ statusRevision: 'asc' }, { id: 'asc' }],
          take: MAX_ACTIVE_INVOCATIONS_PER_PAGE + 1,
        });
        if (activeRows.length > MAX_ACTIVE_INVOCATIONS_PER_PAGE) {
          throw publicServiceUnavailable(
            'AGENT_INVOCATION_ACTIVE_SET_EXCEEDED',
            'agent.error.status_unavailable',
            'The active invocation set exceeds the bounded reconciliation contract.',
          );
        }

        let changedRows: AgentPlatformInvocation[];
        let hasMore = false;
        let responseRevision = snapshotRevision;
        if (request.sinceRevision === undefined) {
          // The transcript/history endpoint owns old completed turns. Initial
          // status bootstrap needs only a bounded recent terminal window plus
          // every currently active aggregate.
          changedRows = await transaction.agentPlatformInvocation.findMany({
            where: {
              ...scope,
              status: { notIn: CAPACITY_HOLDING_STATUSES },
              statusRevision: { lte: snapshotRevision },
            },
            orderBy: [{ statusRevision: 'desc' }, { id: 'desc' }],
            take: request.limit,
          });
        } else {
          const candidates = await transaction.agentPlatformInvocation.findMany(
            {
              where: {
                ...scope,
                statusRevision: {
                  gt: sinceRevision,
                  lte: snapshotRevision,
                },
              },
              orderBy: [{ statusRevision: 'asc' }, { id: 'asc' }],
              take: request.limit + 1,
            },
          );
          hasMore = candidates.length > request.limit;
          changedRows = candidates.slice(0, request.limit);
          if (hasMore) {
            responseRevision =
              changedRows.at(-1)?.statusRevision ?? sinceRevision;
          }
        }

        const rowsById = new Map<string, AgentPlatformInvocation>();
        for (const row of [...changedRows, ...activeRows]) {
          rowsById.set(row.id, row);
        }
        const rows = [...rowsById.values()].sort((left, right) =>
          left.statusRevision < right.statusRevision
            ? -1
            : left.statusRevision > right.statusRevision
              ? 1
              : left.id.localeCompare(right.id),
        );
        const latestAttempts = await loadLatestAttempts(transaction, rows);
        return AgentInvocationStatusPageSchema.parse({
          schemaVersion: 'agent-invocation-status-page/v1',
          revision: responseRevision.toString(),
          hasMore,
          // Attempt history remains folded into one product Run. The latest
          // trigger is exposed only as structured delivery state so the UI can
          // render sending/retry inline without creating assistant messages.
          invocations: rows.map((row) => {
            const attempt = latestAttempts.get(row.id);
            if (!attempt) {
              throw new Error(
                `Agent invocation ${row.id} has no latest attempt projection.`,
              );
            }
            return toPublicStatus(row, attempt);
          }),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async markInactiveApprovalWaitCancelled(
    context: AuthorizedAgentContext,
    invocationId: string,
  ): Promise<void> {
    await this.withInvocationLock(
      invocationId,
      async (transaction, current) => {
        assertConversation(current, context.conversationId);
        if (current.ownerActorId !== context.actorId) {
          throw publicNotFound(
            'AGENT_INVOCATION_NOT_FOUND',
            'agent.error.invocation_not_found',
            'The Agent invocation does not exist.',
          );
        }
        if (current.status !== StoredInvocationStatus.waiting_for_approval) {
          return;
        }
        await transaction.agentPlatformInvocation.update({
          where: { id: current.id },
          data: {
            status: StoredInvocationStatus.cancelled,
            completedAt: new Date(),
            error: Prisma.DbNull,
          },
        });
      },
    );
  }

  /**
   * Lease the next due admission triggers.
   *
   * `admission_attempts < maxAttempts` is what keeps a deterministically
   * failing trigger from redelivering forever; `deadLetterExhaustedAdmissions`
   * owns everything this query stops picking up.
   */
  async claimPending(
    batchSize: number,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<ClaimedAgentInvocation[]> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    return this.prisma.$queryRaw<ClaimedAgentInvocation[]>`
      WITH candidates AS (
        SELECT attempt."id"
        FROM "agent_platform_invocation_attempts" AS attempt
        JOIN "agent_platform_invocations" AS invocation
          ON invocation."id" = attempt."invocation_id"
        WHERE attempt."status" = 'admitting'
          AND attempt."next_admission_attempt_at" <= ${now}
          AND attempt."admission_attempts" < ${maxAttempts}
          AND invocation."status" NOT IN (
            'succeeded',
            'failed',
            'cancelled'
          )
          AND (
            attempt."admission_lease_until" IS NULL
            OR attempt."admission_lease_until" <= ${now}
          )
        ORDER BY
          attempt."next_admission_attempt_at",
          attempt."created_at",
          attempt."id"
        FOR UPDATE OF attempt SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "agent_platform_invocation_attempts" AS attempt
      SET
        "admission_attempts" = attempt."admission_attempts" + 1,
        "admission_lease_token" = ${leaseToken}::uuid,
        "admission_lease_until" = ${leaseUntil},
        "updated_at" = ${now}
      FROM candidates, "agent_platform_invocations" AS invocation
      WHERE attempt."id" = candidates."id"
        AND invocation."id" = attempt."invocation_id"
      RETURNING
        attempt."id" AS "attemptId",
        attempt."ordinal" AS "attemptOrdinal",
        invocation."id" AS "invocationId",
        invocation."conversation_id" AS "conversationId",
        invocation."owner_actor_id" AS "ownerActorId",
        attempt."input_event_id" AS "inputEventId",
        attempt."client_message_id" AS "clientMessageId",
        invocation."provisional_run_id" AS "provisionalRunId",
        attempt."locale",
        attempt."admission_lease_token" AS "leaseToken",
        attempt."admission_attempts" AS "admissionAttempts"
    `;
  }

  async recordAdmissionFailure(
    claim: Pick<
      ClaimedAgentInvocation,
      'attemptId' | 'leaseToken' | 'admissionAttempts'
    >,
  ): Promise<void> {
    const delayMs = admissionRetryDelayMs(claim.admissionAttempts);
    await this.withAttemptLock(
      claim.attemptId,
      async (transaction, attempt) => {
        if (
          attempt.status !== StoredAttemptStatus.admitting ||
          attempt.admissionLeaseToken !== claim.leaseToken
        ) {
          return;
        }
        await transaction.agentPlatformInvocationAttempt.update({
          where: { id: attempt.id },
          data: {
            nextAdmissionAttemptAt: new Date(Date.now() + delayMs),
            admissionLeaseToken: null,
            admissionLeaseUntil: null,
          },
        });
      },
    );
  }

  /**
   * Terminalize admission triggers whose retry budget is already spent.
   *
   * A dispatcher that dies between claiming and recording its failure leaves
   * the attempt at its ceiling with a lease nobody releases, and `claimPending`
   * can never pick that row up again. Without this sweep the aggregate would
   * stay in `admitting` — a capacity-holding status — forever, so two poison
   * triggers permanently lock an actor out of the agent. The attachment ingest
   * and document dispatch queues bound themselves the same way.
   */
  async deadLetterExhaustedAdmissions(
    batchSize: number,
    maxAttempts: number,
  ): Promise<number> {
    const now = new Date();
    const exhausted = await this.prisma.$queryRaw<Array<{ attemptId: string }>>`
      SELECT attempt."id" AS "attemptId"
      FROM "agent_platform_invocation_attempts" AS attempt
      JOIN "agent_platform_invocations" AS invocation
        ON invocation."id" = attempt."invocation_id"
      WHERE attempt."status" = 'admitting'
        AND attempt."admission_attempts" >= ${maxAttempts}
        AND (
          attempt."admission_lease_until" IS NULL
          OR attempt."admission_lease_until" <= ${now}
        )
        AND invocation."status" NOT IN (
          'succeeded',
          'failed',
          'cancelled',
          'rejected'
        )
      ORDER BY attempt."created_at", attempt."id"
      LIMIT ${batchSize}
    `;

    let deadLettered = 0;
    for (const candidate of exhausted) {
      await this.withAttemptLock(
        candidate.attemptId,
        async (transaction, attempt, aggregate) => {
          if (
            attempt.status !== StoredAttemptStatus.admitting ||
            attempt.admissionAttempts < maxAttempts ||
            (attempt.admissionLeaseUntil !== null &&
              attempt.admissionLeaseUntil > new Date())
          ) {
            return;
          }
          await rejectAttempt(
            transaction,
            attempt,
            aggregate,
            admissionExhaustedError(),
          );
          deadLettered += 1;
        },
      );
    }
    return deadLettered;
  }

  /**
   * Release capacity held by an approval nobody is going to answer.
   *
   * `waiting_for_approval` counts against every admission axis and the session
   * Workflow suspends without a deadline, so a closed tab would otherwise hold
   * an actor's slot until an operator ran SQL. The aggregate's `updatedAt` is
   * the wait clock: reserving or dispatching a continuation touches the row,
   * so only a genuinely abandoned prompt ages out.
   */
  async expireStaleApprovalWaits(
    batchSize: number,
    timeoutMs: number,
  ): Promise<number> {
    const expiresBefore = new Date(Date.now() - timeoutMs);
    const stale = await this.prisma.agentPlatformInvocation.findMany({
      where: {
        status: StoredInvocationStatus.waiting_for_approval,
        updatedAt: { lte: expiresBefore },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: { id: true },
    });

    let expired = 0;
    for (const candidate of stale) {
      await this.withInvocationLock(
        candidate.id,
        async (transaction, current) => {
          if (
            current.status !== StoredInvocationStatus.waiting_for_approval ||
            current.updatedAt > expiresBefore
          ) {
            return;
          }
          await transaction.agentPlatformInvocation.update({
            where: { id: current.id },
            data: {
              status: StoredInvocationStatus.failed,
              completedAt: new Date(),
              error: approvalWaitExpiredError(),
            },
          });
          expired += 1;
        },
      );
    }
    return expired;
  }

  private async withInvocationLock(
    invocationId: string,
    action: (
      transaction: Prisma.TransactionClient,
      invocation: AgentPlatformInvocation,
    ) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lock(transaction, `agent-invocation:${invocationId}`);
      const invocation = await transaction.agentPlatformInvocation.findUnique({
        where: { id: invocationId },
      });
      if (!invocation) {
        throw publicNotFound(
          'AGENT_INVOCATION_NOT_FOUND',
          'agent.error.invocation_not_found',
          'The Agent invocation does not exist.',
        );
      }
      await action(transaction, invocation);
    });
  }

  private async withAttemptLock(
    attemptId: string,
    action: (
      transaction: Prisma.TransactionClient,
      attempt: AgentPlatformInvocationAttempt,
      aggregate: AgentPlatformInvocation,
    ) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lock(transaction, `agent-attempt:${attemptId}`);
      const attempt =
        await transaction.agentPlatformInvocationAttempt.findUnique({
          where: { id: attemptId },
        });
      if (!attempt) {
        throw publicNotFound(
          'AGENT_INVOCATION_ATTEMPT_NOT_FOUND',
          'agent.error.invocation_not_found',
          'The Agent invocation attempt does not exist.',
        );
      }
      await lock(transaction, `agent-invocation:${attempt.invocationId}`);
      const aggregate =
        await transaction.agentPlatformInvocation.findUniqueOrThrow({
          where: { id: attempt.invocationId },
        });
      await action(transaction, attempt, aggregate);
    });
  }
}

type AttemptWithInvocation = AgentPlatformInvocationAttempt & {
  invocation: AgentPlatformInvocation;
};

type LatestAttemptProjection = Readonly<{
  attemptId: string;
  invocationId: string;
  ordinal: number;
  inputEventId: string;
  clientMessageId: string;
  status: StoredAttemptStatus;
  error: Prisma.JsonValue | null;
}>;

async function loadLatestAttempts(
  transaction: Prisma.TransactionClient,
  invocations: readonly AgentPlatformInvocation[],
): Promise<ReadonlyMap<string, LatestAttemptProjection>> {
  if (invocations.length === 0) return new Map();
  const attempts = await transaction.$queryRaw<LatestAttemptProjection[]>`
    SELECT
      attempt."id" AS "attemptId",
      attempt."invocation_id" AS "invocationId",
      attempt."ordinal",
      attempt."input_event_id" AS "inputEventId",
      attempt."client_message_id" AS "clientMessageId",
      attempt."status",
      attempt."error"
    FROM "agent_platform_invocation_attempts" AS attempt
    JOIN "agent_platform_invocations" AS invocation
      ON invocation."id" = attempt."invocation_id"
      AND invocation."latest_attempt_ordinal" = attempt."ordinal"
    WHERE invocation."id" IN (${Prisma.join(
      invocations.map((invocation) => invocation.id),
    )})
  `;
  return new Map(
    attempts.map((attempt) => [attempt.invocationId, attempt] as const),
  );
}

async function findExistingAttempt(
  transaction: Prisma.TransactionClient,
  conversationId: string,
  request: AgentInvocationGatewayRequest,
): Promise<AttemptWithInvocation | null> {
  const byEvent = await transaction.agentPlatformInvocationAttempt.findUnique({
    where: {
      conversationId_inputEventId: {
        conversationId,
        inputEventId: request.inputEventId,
      },
    },
    include: { invocation: true },
  });
  if (byEvent) return byEvent;
  return transaction.agentPlatformInvocationAttempt.findUnique({
    where: {
      conversationId_clientMessageId: {
        conversationId,
        clientMessageId: request.clientMessageId,
      },
    },
    include: { invocation: true },
  });
}

function reservation(
  invocation: AgentPlatformInvocation,
  attempt: AgentPlatformInvocationAttempt,
  shouldForward: boolean,
): ReservedAgentInvocation {
  return {
    invocationId: invocation.id,
    provisionalRunId: invocation.provisionalRunId,
    workflowId: invocation.workflowId,
    attemptId: attempt.id,
    attemptOrdinal: attempt.ordinal,
    shouldForward,
  };
}

/**
 * Close one admission trigger and, for a root trigger, the run it reserved.
 *
 * A rejected ordinal-zero trigger releases the aggregate's reserved capacity;
 * a rejected continuation deliberately leaves the run in `waiting_for_approval`
 * so the user can answer the same prompt again.
 */
async function rejectAttempt(
  transaction: Prisma.TransactionClient,
  attempt: AgentPlatformInvocationAttempt,
  aggregate: AgentPlatformInvocation,
  error: AgentPublicError,
): Promise<void> {
  await transaction.agentPlatformInvocationAttempt.update({
    where: { id: attempt.id },
    data: {
      status: StoredAttemptStatus.rejected,
      error,
      nextAdmissionAttemptAt: null,
      admissionLeaseToken: null,
      admissionLeaseUntil: null,
    },
  });
  if (
    attempt.ordinal === 0 &&
    aggregate.status === StoredInvocationStatus.admitting
  ) {
    await transaction.agentPlatformInvocation.update({
      where: { id: aggregate.id },
      data: {
        status: StoredInvocationStatus.rejected,
        error,
        completedAt: new Date(),
      },
    });
  }
}

export function admissionExhaustedError(): AgentPublicError {
  return publicError(
    'AGENT_ADMISSION_EXHAUSTED',
    'agent.error.admission_exhausted',
    'StoryOS could not start this request after repeated attempts. Please send it again.',
    true,
  );
}

function approvalWaitExpiredError(): AgentPublicError {
  return publicError(
    'AGENT_APPROVAL_WAIT_EXPIRED',
    'agent.error.approval_wait_expired',
    'This request was closed because its permission prompt went unanswered. Please send it again.',
    true,
  );
}

async function markAttemptDispatchedFromLifecycle(
  transaction: Prisma.TransactionClient,
  attempt: AgentPlatformInvocationAttempt,
  now: Date,
): Promise<void> {
  if (attempt.status === StoredAttemptStatus.dispatched) return;
  await transaction.agentPlatformInvocationAttempt.update({
    where: { id: attempt.id },
    data: {
      status: StoredAttemptStatus.dispatched,
      error: Prisma.DbNull,
      dispatchedAt: attempt.dispatchedAt ?? now,
      nextAdmissionAttemptAt: null,
      admissionLeaseToken: null,
      admissionLeaseUntil: null,
    },
  });
}

function publicError(
  code: string,
  messageKey: string,
  message: string,
  retryable: boolean,
): AgentPublicError {
  return AgentPublicErrorSchema.parse({
    code,
    messageKey,
    message,
    retryable,
    diagnosticId: randomUUID(),
  });
}

function publicConflict(
  code: string,
  messageKey: string,
  message: string,
  retryable = false,
): ConflictException {
  return new ConflictException(
    publicError(code, messageKey, message, retryable),
  );
}

function publicNotFound(
  code: string,
  messageKey: string,
  message: string,
): NotFoundException {
  return new NotFoundException(publicError(code, messageKey, message, false));
}

function publicBadRequest(
  code: string,
  messageKey: string,
  message: string,
): BadRequestException {
  return new BadRequestException(publicError(code, messageKey, message, false));
}

function publicServiceUnavailable(
  code: string,
  messageKey: string,
  message: string,
): HttpException {
  return new HttpException(
    publicError(code, messageKey, message, true),
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function retryConflict(): ConflictException {
  return publicConflict(
    'AGENT_INVOCATION_RETRY_CONFLICT',
    'agent.error.retry_conflict',
    'The rejected Agent trigger no longer belongs to a retryable run state.',
  );
}

function assertAttemptIdentity(
  attempt: AttemptWithInvocation,
  context: AuthorizedAgentContext,
  request: AgentInvocationGatewayRequest,
): void {
  const expectedContinuation =
    attempt.ordinal === 0 ? undefined : attempt.invocationId;
  if (
    attempt.invocation.ownerActorId !== context.actorId ||
    attempt.clientMessageId !== request.clientMessageId ||
    attempt.inputEventId !== request.inputEventId ||
    attempt.locale !== request.locale ||
    request.continuationOfInvocationId !== expectedContinuation
  ) {
    throw publicConflict(
      'AGENT_INVOCATION_IDENTITY_CONFLICT',
      'agent.error.request_identity_conflict',
      'The realtime input is already bound to another Agent request.',
    );
  }
}

function assertAttemptAggregate(
  attempt: AgentPlatformInvocationAttempt,
  aggregate: AgentPlatformInvocation,
  invocationId: string,
  conversationId: string,
): void {
  if (
    attempt.invocationId !== invocationId ||
    aggregate.id !== invocationId ||
    aggregate.conversationId !== conversationId
  ) {
    throw publicConflict(
      'AGENT_INVOCATION_ATTEMPT_MISMATCH',
      'agent.error.runtime_protocol_conflict',
      'The admission result does not match the Agent run aggregate.',
    );
  }
}

function assertConversation(
  invocation: AgentPlatformInvocation,
  conversationId: string,
): void {
  if (invocation.conversationId !== conversationId) {
    throw publicConflict(
      'AGENT_INVOCATION_CONVERSATION_MISMATCH',
      'agent.error.runtime_protocol_conflict',
      'The lifecycle update does not match the Agent conversation.',
    );
  }
}

function admissionWorkspaceScopeKey(
  context: AuthorizedAgentContext,
  conversationScopeKey: string,
): string {
  return context.surface === 'story-studio'
    ? context.scope.workspaceId
    : conversationScopeKey;
}

function invalidTransition(): ConflictException {
  return publicConflict(
    'AGENT_INVOCATION_LIFECYCLE_CONFLICT',
    'agent.error.runtime_protocol_conflict',
    'The Agent invocation received an out-of-order lifecycle update.',
  );
}

function toPublicStatus(
  invocation: AgentPlatformInvocation,
  latestAttempt: LatestAttemptProjection,
): AgentInvocationStatus {
  return {
    invocationId: invocation.id,
    runId: invocation.provisionalRunId,
    clientMessageId: invocation.clientMessageId,
    inputEventId: invocation.inputEventId,
    status:
      invocation.status === StoredInvocationStatus.rejected
        ? 'failed'
        : invocation.status,
    error:
      invocation.status === StoredInvocationStatus.failed ||
      invocation.status === StoredInvocationStatus.rejected
        ? storedPublicError(invocation.error, invocation.id)
        : null,
    latestAttempt: {
      attemptId: latestAttempt.attemptId,
      ordinal: latestAttempt.ordinal,
      inputEventId: latestAttempt.inputEventId,
      clientMessageId: latestAttempt.clientMessageId,
      status: latestAttempt.status,
      error:
        latestAttempt.status === StoredAttemptStatus.rejected
          ? storedPublicError(latestAttempt.error, latestAttempt.attemptId)
          : null,
    },
    createdAt: invocation.createdAt.toISOString(),
    startedAt: invocation.startedAt?.toISOString() ?? null,
    completedAt: invocation.completedAt?.toISOString() ?? null,
  };
}

/**
 * A stored error is historical data. Parsing it with the current strict schema
 * makes every past failure unreadable the moment that schema gains a field —
 * and because the status endpoint reads a whole page of invocations, one
 * unparseable row 500s the entire poll and the conversation appears broken.
 *
 * So the read side degrades instead of throwing. Every write path still
 * constructs errors through AgentPublicErrorSchema, so nothing new can enter
 * the table in a shape this has to absorb; the fallback exists purely so old
 * rows stay legible. `AGENT_ERROR_UNREADABLE` surfacing in a response is the
 * signal that stored data predates the current contract.
 */
function storedPublicError(
  value: unknown,
  correlationId: string,
): AgentPublicError {
  const parsed = AgentPublicErrorSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return {
    code: 'AGENT_ERROR_UNREADABLE',
    messageKey: 'agent.error.unreadable',
    message:
      'This turn failed earlier, and the recorded reason predates the current error format.',
    // Not knowing why it failed is not evidence that retrying is safe.
    retryable: false,
    diagnosticId: correlationId,
  };
}

interface CapacitySnapshot {
  activeRuns: number;
  reservedTokenUnits: bigint;
  reservedCostMicrousd: bigint;
}

async function assertCapacityAvailable(
  transaction: Prisma.TransactionClient,
  workspaceScopeKey: string,
  actorId: string,
  policy: AgentAdmissionPolicy,
): Promise<void> {
  const [global, workspace, actor, providerLane] = await Promise.all([
    capacitySnapshot(transaction, {}),
    capacitySnapshot(transaction, { workspaceScopeKey }),
    capacitySnapshot(transaction, { ownerActorId: actorId }),
    capacitySnapshot(transaction, { providerLane: policy.providerLane }),
  ]);

  assertCapacityAxis(
    'global',
    global,
    policy.limits.activeRuns.global,
    policy.limits.reservedTokenUnits.global,
    policy.limits.reservedCostMicrousd.global,
    policy,
  );
  assertCapacityAxis(
    'workspace',
    workspace,
    policy.limits.activeRuns.workspace,
    policy.limits.reservedTokenUnits.workspace,
    policy.limits.reservedCostMicrousd.workspace,
    policy,
  );
  assertCapacityAxis(
    'actor',
    actor,
    policy.limits.activeRuns.actor,
    policy.limits.reservedTokenUnits.actor,
    policy.limits.reservedCostMicrousd.actor,
    policy,
  );
  assertCapacityAxis(
    'provider_lane',
    providerLane,
    policy.limits.activeRuns.providerLane,
    policy.limits.reservedTokenUnits.providerLane,
    policy.limits.reservedCostMicrousd.providerLane,
    policy,
  );
}

async function capacitySnapshot(
  transaction: Prisma.TransactionClient,
  where: Pick<
    Prisma.AgentPlatformInvocationWhereInput,
    'workspaceScopeKey' | 'ownerActorId' | 'providerLane'
  >,
): Promise<CapacitySnapshot> {
  const result = await transaction.agentPlatformInvocation.aggregate({
    where: {
      ...where,
      status: { in: CAPACITY_HOLDING_STATUSES },
    },
    _count: { _all: true },
    _sum: {
      reservedTokenUnits: true,
      reservedCostMicrousd: true,
    },
  });
  return {
    activeRuns: result._count._all,
    reservedTokenUnits: result._sum.reservedTokenUnits ?? 0n,
    reservedCostMicrousd: result._sum.reservedCostMicrousd ?? 0n,
  };
}

function assertCapacityAxis(
  scope: AdmissionRejectionScope,
  snapshot: CapacitySnapshot,
  activeLimit: number,
  tokenLimit: bigint,
  costLimit: bigint,
  policy: AgentAdmissionPolicy,
): void {
  if (snapshot.activeRuns + 1 > activeLimit) {
    throw new AgentAdmissionRejectedException({
      scope,
      dimension: 'active_runs',
      limit: activeLimit,
      retryAfterSeconds: policy.retryAfterSeconds,
    });
  }
  if (
    snapshot.reservedTokenUnits + policy.reservation.tokenUnits >
    tokenLimit
  ) {
    throw new AgentAdmissionRejectedException({
      scope,
      dimension: 'reserved_token_units',
      limit: tokenLimit,
      retryAfterSeconds: policy.retryAfterSeconds,
    });
  }
  if (
    snapshot.reservedCostMicrousd + policy.reservation.costMicrousd >
    costLimit
  ) {
    throw new AgentAdmissionRejectedException({
      scope,
      dimension: 'reserved_cost_microusd',
      limit: costLimit,
      retryAfterSeconds: policy.retryAfterSeconds,
    });
  }
}

async function lockAdmissionScopes(
  transaction: Prisma.TransactionClient,
  workspaceScopeKey: string,
  actorId: string,
  providerLane: string,
): Promise<void> {
  // Never change this order without changing every admission writer.
  await lock(transaction, 'agent-admission:global');
  await lock(transaction, `agent-admission:workspace:${workspaceScopeKey}`);
  await lock(transaction, `agent-admission:actor:${actorId}`);
  await lock(transaction, `agent-admission:provider:${providerLane}`);
}

function admissionRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 250 * 2 ** Math.min(Math.max(attempt - 1, 0), 7));
}

async function lock(
  transaction: Prisma.TransactionClient,
  identity: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))
  `;
}

import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthUser } from '../auth';
import { mastraFetch } from '../assistant/mastra-fetch';
import { AgentPlatformConversationService } from './agent-platform-conversation.service';
import { AgentPlatformGatewayConfigService } from './agent-platform-gateway.config';
import {
  AgentCancellationResultSchema,
  AgentHistoryPageSchema,
  AgentInvocationAcceptedSchema,
  AgentPublicErrorSchema,
  type AgentCancellationGatewayRequest,
  type AgentCancellationResult,
  type AgentConversationCreateRequest,
  type AgentConversationGrant,
  type AgentConversationPreferenceRequest,
  type AgentConversationResolveRequest,
  type AgentHistoryGatewayRequest,
  type AgentHistoryPage,
  type AgentInvocationAccepted,
  type AgentInvocationGatewayRequest,
  type AgentInvocationStatusPage,
  type AgentInvocationStatusRequest,
  type AgentPublicError,
  type AgentSessionGrantRequest,
  type AuthorizedAgentContext,
} from './agent-platform-gateway.dto';
import { AgentPlatformCredentialsService } from './agent-platform-credentials.service';
import {
  admissionExhaustedError,
  AgentAdmissionRejectedException,
  AgentPlatformInvocationService,
  type ClaimedAgentInvocation,
} from './agent-platform-invocation.service';

const MAX_AGENT_RESPONSE_BYTES = 64 * 1024;
const MAX_AGENT_HISTORY_RESPONSE_BYTES = 2 * 1024 * 1024;
const RETRYABLE_AGENT_STATUSES = new Set([502, 503, 504]);
const ATTEMPT_DELAYS_MS = [0, 50, 150] as const;
const MAX_OUTBOX_BATCHES_PER_DRAIN = 8;
const InternalAgentInvocationAcceptedSchema = z
  .object({
    schemaVersion: z.literal('agent-invocation-accepted/v1'),
    invocationId: z.uuid(),
    attemptId: z.uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
    workflowId: z.uuid(),
  })
  .strict();
type InternalAgentInvocationAccepted = z.infer<
  typeof InternalAgentInvocationAcceptedSchema
>;
type AdmissionFailure = Readonly<{
  error: AgentPublicError;
  redeliver: boolean;
}>;

@Injectable()
export class AgentPlatformGatewayService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  readonly #logger = new Logger(AgentPlatformGatewayService.name);
  readonly #config: AgentPlatformGatewayConfigService['values'];
  #outboxTimer: NodeJS.Timeout | null = null;
  #outboxDrain: Promise<void> | null = null;
  #outboxDrainRequested = false;
  #reclaimRequested = false;
  #stopping = false;

  constructor(
    config: AgentPlatformGatewayConfigService,
    private readonly conversations: AgentPlatformConversationService,
    private readonly credentials: AgentPlatformCredentialsService,
    private readonly invocations: AgentPlatformInvocationService,
  ) {
    this.#config = config.values;
  }

  onApplicationBootstrap(): void {
    this.#outboxTimer = setInterval(() => {
      // Queue-wide reclamation rides the polling edge only. An interactive
      // invoke() also wakes the outbox and must not pay for a full sweep.
      this.#reclaimRequested = true;
      void this.drainAdmissionOutbox();
    }, this.#config.invocationDispatchIntervalMs);
    this.#outboxTimer.unref();
    this.#reclaimRequested = true;
    void this.drainAdmissionOutbox();
  }

  async onModuleDestroy(): Promise<void> {
    this.#stopping = true;
    if (this.#outboxTimer) clearInterval(this.#outboxTimer);
    this.#outboxTimer = null;
    await this.#outboxDrain;
  }

  async resolveConversation(
    user: AuthUser,
    request: AgentConversationResolveRequest,
  ): Promise<AgentConversationGrant> {
    return this.issueConversationGrant(
      await this.conversations.resolve(user, request),
    );
  }

  async createConversation(
    user: AuthUser,
    request: AgentConversationCreateRequest,
  ): Promise<AgentConversationGrant> {
    return this.issueConversationGrant(
      await this.conversations.create(user, request),
    );
  }

  async authorizeSession(
    user: AuthUser,
    request: AgentSessionGrantRequest,
  ): Promise<AgentConversationGrant> {
    return this.issueConversationGrant(
      await this.conversations.authorizeExisting(user, request),
    );
  }

  async updateConversationPreference(
    user: AuthUser,
    request: AgentConversationPreferenceRequest,
  ): Promise<AgentConversationGrant> {
    return this.issueConversationGrant(
      await this.conversations.updatePreference(user, request),
    );
  }

  private issueConversationGrant(
    authorized: Awaited<
      ReturnType<AgentPlatformConversationService['authorizeExisting']>
    >,
  ): AgentConversationGrant {
    const { context, conversation } = authorized;
    const ably = this.credentials.issueAblyToken(
      context.sessionName,
      context.actorId,
    );
    return {
      schemaVersion: 'agent-conversation-grant/v1',
      conversation,
      sessionName: context.sessionName,
      ablyToken: ably.token,
      expiresAt: ably.expiresAt,
    };
  }

  async invoke(
    user: AuthUser,
    request: AgentInvocationGatewayRequest,
  ): Promise<AgentInvocationAccepted> {
    const startedAt = performance.now();
    const authorized = await this.authorizeControlRequest(user, request);
    const authorizedAt = performance.now();
    const reserved = await this.invocations
      .reserve(authorized.context, request, this.#config.admission)
      .catch((error: unknown) => {
        if (error instanceof AgentAdmissionRejectedException) {
          this.#logger.warn({
            event: 'agent.invocation.admission_rejected',
            traceId: authorized.context.traceId,
            diagnosticId: error.diagnosticId,
            scope: error.scope,
            dimension: error.dimension,
            limit: error.limit,
            retryAfterSeconds: error.retryAfterSeconds,
          });
        }
        throw error;
      });
    const publicAccepted = acceptedInvocation(reserved.invocationId);
    const reservedAt = performance.now();

    // A 202 response means the product has durably accepted ownership of this
    // turn, not that Temporal happens to be reachable in this request. Keeping
    // dispatch exclusively behind the leased outbox removes an upstream
    // network round trip from the interaction path and gives retries, process
    // crashes and deploys one consistent recovery mechanism.
    if (reserved.shouldForward) void this.drainAdmissionOutbox();

    this.#logger.log({
      event: 'agent.invocation.accepted',
      traceId: authorized.context.traceId,
      invocationId: reserved.invocationId,
      replayed: !reserved.shouldForward,
      authorizationMs: durationMs(startedAt, authorizedAt),
      reservationMs: durationMs(authorizedAt, reservedAt),
      totalMs: durationMs(startedAt, reservedAt),
    });
    return publicAccepted;
  }

  async invocationStatus(
    user: AuthUser,
    request: AgentInvocationStatusRequest,
  ): Promise<AgentInvocationStatusPage> {
    const authorized = await this.authorizeControlRequest(user, request);
    return this.invocations.list(authorized.context, request);
  }

  async cancel(
    user: AuthUser,
    request: AgentCancellationGatewayRequest,
  ): Promise<AgentCancellationResult> {
    const authorized = await this.authorizeControlRequest(user, request);
    const result = await this.forward(
      '/api/v1/cancellations',
      {
        invocationId: request.invocationId,
        sessionName: authorized.context.sessionName,
      },
      authorized,
      (payload) => AgentCancellationResultSchema.parse(payload),
    );
    if (result.status !== 'cancellation-requested') {
      await this.invocations.markInactiveApprovalWaitCancelled(
        authorized.context,
        request.invocationId,
      );
    }
    return result;
  }

  async history(
    user: AuthUser,
    request: AgentHistoryGatewayRequest,
  ): Promise<AgentHistoryPage> {
    const authorized = await this.authorizeControlRequest(user, request);
    return this.forward(
      '/api/v1/history',
      {
        sessionName: authorized.context.sessionName,
        cursor: request.cursor,
        limit: request.limit,
      },
      authorized,
      (payload) => AgentHistoryPageSchema.parse(payload),
    );
  }

  async drainAdmissionOutbox(): Promise<void> {
    if (this.#stopping) return;
    // This is a wake-up edge, not merely a request to join the current drain.
    // Without the latch, an invocation reserved just after the active drainer
    // observed an empty queue could sleep until the polling interval.
    this.#outboxDrainRequested = true;
    if (this.#outboxDrain) return this.#outboxDrain;

    const drain = this.runRequestedAdmissionDrains();
    const tracked = drain
      .catch((error: unknown) => {
        this.#logger.error(
          'Agent invocation admission outbox drain failed',
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        if (this.#outboxDrain === tracked) this.#outboxDrain = null;
      });
    this.#outboxDrain = tracked;
    return tracked;
  }

  private async runRequestedAdmissionDrains(): Promise<void> {
    while (this.#outboxDrainRequested && !this.#stopping) {
      this.#outboxDrainRequested = false;
      if (this.#reclaimRequested) {
        this.#reclaimRequested = false;
        await this.reclaimAbandonedAdmissions();
      }
      const mayHaveMore = await this.runAdmissionOutbox();
      if (mayHaveMore) {
        this.#outboxDrainRequested = true;
        // Yield after each bounded drain so high admission volume cannot
        // monopolize the NestJS event loop.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  private async authorizeControlRequest(
    user: AuthUser,
    request:
      | AgentInvocationGatewayRequest
      | AgentCancellationGatewayRequest
      | AgentHistoryGatewayRequest
      | AgentInvocationStatusRequest,
  ): Promise<Readonly<{ context: AuthorizedAgentContext; token: string }>> {
    const { context } = await this.conversations.authorizeExisting(user, {
      schemaVersion: 'agent-session-grant-request/v1',
      conversationId: request.conversationId,
      locale: request.locale,
    });
    return {
      context,
      token: this.credentials.issueAgentToken(context),
    };
  }

  private async forward<T>(
    path: '/api/v1/invocations' | '/api/v1/cancellations' | '/api/v1/history',
    body: unknown,
    authorized: Readonly<{
      context: AuthorizedAgentContext;
      token: string;
    }>,
    parse: (payload: unknown) => T,
  ): Promise<T> {
    const target = new URL(path, this.#config.agentUrl);
    const serializedBody = JSON.stringify(body);
    const deadlineAt = Date.now() + this.#config.requestTimeoutMs;

    for (const [attempt, delayMs] of ATTEMPT_DELAYS_MS.entries()) {
      if (delayMs > 0) await delay(delayMs);
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) break;
      let response: Response;
      try {
        // mastraFetch, not fetch: undici's keep-alive pool pins every request
        // on a connection to the one ClusterIP-DNAT'd API pod it first landed
        // on, defeating Service load-spreading and holding sockets to pods
        // that a rollout has already replaced. Same doctrine as
        // assistant/mastra-fetch.ts (verified under burst 2026-05-22).
        response = await mastraFetch(target, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${authorized.token}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'x-fizzdragon-trace-id': authorized.context.traceId,
          },
          body: serializedBody,
          signal: AbortSignal.timeout(remainingMs),
        });
      } catch {
        if (attempt < ATTEMPT_DELAYS_MS.length - 1 && Date.now() < deadlineAt) {
          continue;
        }
        throw new ServiceUnavailableException({
          code: 'AGENT_PLATFORM_UNAVAILABLE',
          message: 'The Agent Platform is temporarily unavailable.',
          retryable: true,
        });
      }

      if (
        RETRYABLE_AGENT_STATUSES.has(response.status) &&
        attempt < ATTEMPT_DELAYS_MS.length - 1
      ) {
        await response.body?.cancel();
        continue;
      }

      const payload = await readBoundedJson(
        response,
        path === '/api/v1/history'
          ? MAX_AGENT_HISTORY_RESPONSE_BYTES
          : MAX_AGENT_RESPONSE_BYTES,
      );
      if (response.ok) {
        try {
          return parse(payload);
        } catch {
          throw new ServiceUnavailableException({
            code: 'AGENT_PLATFORM_RESPONSE_INVALID',
            message: 'The Agent Platform returned an invalid response.',
            retryable: true,
          });
        }
      }

      throw new HttpException(
        isDisplayableError(payload)
          ? payload
          : {
              code: 'AGENT_PLATFORM_REQUEST_FAILED',
              message: `The Agent Platform returned HTTP ${response.status}.`,
              retryable: RETRYABLE_AGENT_STATUSES.has(response.status),
            },
        response.status,
      );
    }

    throw new ServiceUnavailableException({
      code: 'AGENT_PLATFORM_UNAVAILABLE',
      message: 'The Agent Platform is temporarily unavailable.',
      retryable: true,
    });
  }

  /**
   * Close out the two states nothing else can release: an admission trigger
   * whose retry budget is spent, and an approval prompt nobody answered. Both
   * hold reserved admission capacity, so leaving either unattended is how a
   * single poison request locks an actor out of the agent for good.
   */
  private async reclaimAbandonedAdmissions(): Promise<void> {
    const deadLettered = await this.invocations.deadLetterExhaustedAdmissions(
      this.#config.invocationDispatchConcurrency,
      this.#config.invocationDispatchMaxAttempts,
    );
    if (deadLettered > 0) {
      this.#logger.error({
        event: 'agent.invocation.admission_dead_lettered',
        count: deadLettered,
        maxAttempts: this.#config.invocationDispatchMaxAttempts,
      });
    }
    const expired = await this.invocations.expireStaleApprovalWaits(
      this.#config.invocationDispatchConcurrency,
      this.#config.approvalWaitTimeoutMs,
    );
    if (expired > 0) {
      this.#logger.warn({
        event: 'agent.invocation.approval_wait_expired',
        count: expired,
        timeoutMs: this.#config.approvalWaitTimeoutMs,
      });
    }
  }

  private async runAdmissionOutbox(): Promise<boolean> {
    for (
      let batch = 0;
      batch < MAX_OUTBOX_BATCHES_PER_DRAIN && !this.#stopping;
      batch += 1
    ) {
      const claims = await this.invocations.claimPending(
        this.#config.invocationDispatchConcurrency,
        this.#config.invocationDispatchLeaseMs,
        this.#config.invocationDispatchMaxAttempts,
      );
      if (claims.length === 0) return false;
      await Promise.all(claims.map((claim) => this.dispatchOutboxClaim(claim)));
      if (claims.length < this.#config.invocationDispatchConcurrency) {
        return false;
      }
    }
    return !this.#stopping;
  }

  private async dispatchOutboxClaim(
    claim: ClaimedAgentInvocation,
  ): Promise<void> {
    let authorized: Readonly<{
      context: AuthorizedAgentContext;
      token: string;
    }>;
    try {
      authorized = await this.authorizeControlRequest(
        { userId: claim.ownerActorId },
        {
          schemaVersion: 'agent-invocation-status-request/v1',
          conversationId: claim.conversationId,
          locale: claim.locale,
          limit: 1,
        },
      );
    } catch (error) {
      this.logAdmissionFailure(
        'agent.invocation.authorization_failed',
        claim,
        error,
      );
      const failure = classifyProductAuthorizationFailure(
        error,
        claim.attemptId,
      );
      await this.deferOrRejectAdmission(claim, failure);
      return;
    }

    try {
      await this.dispatchClaim(claim, authorized);
    } catch (error) {
      this.logAdmissionFailure(
        'agent.invocation.dispatch_failed',
        claim,
        error,
      );
      const failure = classifyAgentAdmissionFailure(error, claim.attemptId);
      await this.deferOrRejectAdmission(claim, failure);
    }
  }

  /**
   * A redeliverable failure only earns another delivery while the trigger has
   * budget left. Backing off forever would keep the run in `admitting`, which
   * holds its reserved capacity, so an exhausted trigger is rejected instead —
   * the same bound the attachment ingest and document dispatch queues apply.
   */
  private async deferOrRejectAdmission(
    claim: ClaimedAgentInvocation,
    failure: AdmissionFailure,
  ): Promise<void> {
    const exhausted =
      claim.admissionAttempts >= this.#config.invocationDispatchMaxAttempts;
    if (failure.redeliver && !exhausted) {
      await this.invocations.recordAdmissionFailure(claim);
      return;
    }
    if (failure.redeliver) {
      this.#logger.error({
        event: 'agent.invocation.admission_dead_lettered',
        diagnosticId: claim.attemptId,
        invocationId: claim.invocationId,
        attemptOrdinal: claim.attemptOrdinal,
        admissionAttempts: claim.admissionAttempts,
      });
    }
    await this.invocations.markRejected(
      claim.attemptId,
      claim.invocationId,
      claim.conversationId,
      claim.leaseToken,
      failure.redeliver ? admissionExhaustedError() : failure.error,
    );
  }

  private logAdmissionFailure(
    event: string,
    claim: ClaimedAgentInvocation,
    error: unknown,
  ): void {
    const httpStatus =
      error instanceof HttpException ? error.getStatus() : undefined;
    const response =
      error instanceof HttpException ? error.getResponse() : undefined;
    const upstreamCode =
      response && typeof response === 'object' && !Array.isArray(response)
        ? (response as Record<string, unknown>).code
        : undefined;
    this.#logger.warn({
      event,
      diagnosticId: claim.attemptId,
      invocationId: claim.invocationId,
      attemptOrdinal: claim.attemptOrdinal,
      httpStatus,
      upstreamCode: typeof upstreamCode === 'string' ? upstreamCode : undefined,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
    });
  }

  private async dispatchClaim(
    claim: ClaimedAgentInvocation,
    authorized: Readonly<{
      context: AuthorizedAgentContext;
      token: string;
    }>,
  ): Promise<void> {
    const accepted = await this.forward<InternalAgentInvocationAccepted>(
      '/api/v1/invocations',
      {
        inputEventId: claim.inputEventId,
        invocationId: claim.invocationId,
        attemptId: claim.attemptId,
        attemptOrdinal: claim.attemptOrdinal,
        provisionalRunId: claim.provisionalRunId,
        sessionName: authorized.context.sessionName,
      },
      authorized,
      (payload) => InternalAgentInvocationAcceptedSchema.parse(payload),
    );
    if (
      accepted.invocationId !== claim.invocationId ||
      accepted.attemptId !== claim.attemptId ||
      accepted.attemptOrdinal !== claim.attemptOrdinal
    ) {
      throw new ServiceUnavailableException({
        code: 'AGENT_PLATFORM_RESPONSE_IDENTITY_MISMATCH',
        message:
          'The Agent Platform returned a mismatched invocation attempt identity.',
        retryable: true,
      });
    }
    await this.invocations.markQueued(
      claim.attemptId,
      claim.invocationId,
      claim.conversationId,
      accepted.workflowId,
      claim.leaseToken,
    );
  }

  async isReady(): Promise<boolean> {
    try {
      const response = await mastraFetch(
        new URL('/api/v1/health/ready', this.#config.agentUrl),
        {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(this.#config.requestTimeoutMs),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

async function readBoundedJson(
  response: Response,
  maxResponseBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new ServiceUnavailableException({
      code: 'AGENT_PLATFORM_RESPONSE_TOO_LARGE',
      message: 'The Agent Platform returned an oversized response.',
      retryable: true,
    });
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxResponseBytes) {
      await reader.cancel();
      throw new ServiceUnavailableException({
        code: 'AGENT_PLATFORM_RESPONSE_TOO_LARGE',
        message: 'The Agent Platform returned an oversized response.',
        retryable: true,
      });
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
    ) as unknown;
  } catch {
    throw new ServiceUnavailableException({
      code: 'AGENT_PLATFORM_RESPONSE_INVALID',
      message: 'The Agent Platform returned a non-JSON response.',
      retryable: true,
    });
  }
}

function isDisplayableError(
  value: unknown,
): value is Readonly<{ code: string; message: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.message === 'string' &&
    candidate.message.length > 0
  );
}

function acceptedInvocation(invocationId: string): AgentInvocationAccepted {
  return AgentInvocationAcceptedSchema.parse({
    schemaVersion: 'agent-invocation-accepted/v1',
    invocationId,
  });
}

function classifyAgentAdmissionFailure(
  error: unknown,
  diagnosticId: string,
): AdmissionFailure {
  if (!(error instanceof HttpException)) {
    return {
      error: deferredAdmissionError(diagnosticId),
      redeliver: true,
    };
  }

  const status = error.getStatus();
  const response = error.getResponse();
  const publicError = AgentPublicErrorSchema.safeParse(response);
  const responseRecord =
    response && typeof response === 'object' && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : null;
  const retryable =
    typeof responseRecord?.retryable === 'boolean'
      ? responseRecord.retryable
      : status === 429 || status >= 500;

  return {
    error: publicError.success
      ? publicError.data
      : {
          code: 'AGENT_PLATFORM_REQUEST_FAILED',
          messageKey: 'agent.error.service_unavailable',
          message:
            'StoryOS could not accept this request. Please retry shortly.',
          retryable,
          diagnosticId,
        },
    // A full queue is a durable semantic rejection: the user may retry after
    // capacity changes, but the outbox must not silently reorder this turn.
    redeliver: status !== 429 && status >= 500,
  };
}

function classifyProductAuthorizationFailure(
  error: unknown,
  diagnosticId: string,
): AdmissionFailure {
  if (error instanceof HttpException && error.getStatus() < 500) {
    return {
      error: {
        code: 'AGENT_INVOCATION_AUTHORIZATION_REVOKED',
        messageKey: 'agent.error.authorization_revoked',
        message:
          'The conversation is no longer available to the user who submitted this Agent request.',
        retryable: false,
        diagnosticId,
      },
      redeliver: false,
    };
  }
  return {
    error: deferredAdmissionError(diagnosticId),
    redeliver: true,
  };
}

function deferredAdmissionError(diagnosticId: string): AgentPublicError {
  return AgentPublicErrorSchema.parse({
    code: 'AGENT_ADMISSION_DEFERRED',
    messageKey: 'agent.error.admission_deferred',
    message:
      'StoryOS is reconnecting to its execution service. This request remains safely queued.',
    retryable: true,
    diagnosticId,
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function durationMs(startedAt: number, completedAt: number): number {
  return Math.round((completedAt - startedAt) * 100) / 100;
}

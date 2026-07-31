import { randomUUID } from 'node:crypto';

import {
  AgentPlatformInvocationAttemptStatus,
  AgentPlatformInvocationStatus,
  type PrismaClient,
} from '@prisma/client';
import { ConflictException } from '@nestjs/common';

import { buildPrisma } from '../infra/db/db.module';
import { AgentPlatformConversationService } from './agent-platform-conversation.service';
import type {
  AgentInvocationGatewayRequest,
  AuthorizedAgentContext,
} from './agent-platform-gateway.dto';
import { AgentPublicErrorSchema } from './agent-platform-gateway.dto';
import {
  AgentAdmissionRejectedException,
  AgentPlatformInvocationService,
  type AgentAdmissionPolicy,
  type ReservedAgentInvocation,
} from './agent-platform-invocation.service';

const describePostgres =
  process.env.AGENT_PLATFORM_POSTGRES_INTEGRATION === '1'
    ? describe
    : describe.skip;
const ACTOR_PREFIX = 'agent-platform-invocation-integration';
const MAX_ADMISSION_ATTEMPTS = 10;
const POLICY: AgentAdmissionPolicy = Object.freeze({
  providerLane: 'gemini',
  retryAfterSeconds: 5,
  reservation: Object.freeze({
    tokenUnits: 100n,
    costMicrousd: 1_000n,
  }),
  limits: Object.freeze({
    activeRuns: Object.freeze({
      global: 100,
      workspace: 20,
      actor: 10,
      providerLane: 50,
    }),
    reservedTokenUnits: Object.freeze({
      global: 10_000n,
      workspace: 2_000n,
      actor: 1_000n,
      providerLane: 5_000n,
    }),
    reservedCostMicrousd: Object.freeze({
      global: 100_000n,
      workspace: 20_000n,
      actor: 10_000n,
      providerLane: 50_000n,
    }),
  }),
});

describePostgres('Agent Platform invocation PostgreSQL boundary', () => {
  let prisma: PrismaClient;
  let conversationId: string;
  let context: AuthorizedAgentContext;
  let service: AgentPlatformInvocationService;
  let conversations: AgentPlatformConversationService;

  beforeAll(async () => {
    prisma = buildPrisma();
    await prisma.$connect();
    // Conversations are created through the production service so the fixture
    // cannot invent a row the write path could never produce: one actor holds
    // at most one active conversation per business scope, and starting a new
    // one archives its predecessor in the same transaction.
    conversations = new AgentPlatformConversationService(
      prisma as never,
      {
        authorize: (
          user: { userId: string },
          request: { crewId: string; locale: string },
        ) =>
          Promise.resolve({
            actorId: user.userId,
            actorDisplayName: 'Invocation Integration',
            surface: 'crew-management' as const,
            scope: { kind: 'crew' as const, crewId: request.crewId },
            locale: request.locale,
            roles: ['crew.admin'],
            permissions: ['crew.read'],
          }),
      } as never,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
    ({ conversationId, context } = await createConversation({
      actorId: `${ACTOR_PREFIX}-primary`,
      scopeIdentity: 'workspace-primary',
    }));
    service = new AgentPlatformInvocationService(prisma as never);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('converges concurrent root retries on one run aggregate and one root attempt', async () => {
    const request = invocationRequest(context);
    const reservations = await Promise.all(
      Array.from({ length: 16 }, () =>
        service.reserve(context, request, POLICY),
      ),
    );

    expect(new Set(reservations.map((row) => row.invocationId)).size).toBe(1);
    expect(new Set(reservations.map((row) => row.provisionalRunId)).size).toBe(
      1,
    );
    expect(new Set(reservations.map((row) => row.attemptId)).size).toBe(1);
    await expect(
      prisma.agentPlatformInvocation.count({ where: { conversationId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.agentPlatformInvocationAttempt.count({
        where: { conversationId },
      }),
    ).resolves.toBe(1);
  });

  it('never rebinds one causal event or client message to a different request', async () => {
    const request = invocationRequest(context);
    const reserved = await service.reserve(context, request, POLICY);

    const changedEvent = await service
      .reserve(
        context,
        { ...request, inputEventId: `${request.inputEventId}-different` },
        POLICY,
      )
      .catch((error: unknown) => error);
    expect(changedEvent).toBeInstanceOf(ConflictException);
    expect(changedEvent).toMatchObject({
      response: { code: 'AGENT_INVOCATION_IDENTITY_CONFLICT' },
    });

    const changedMessage = await service
      .reserve(context, { ...request, clientMessageId: randomUUID() }, POLICY)
      .catch((error: unknown) => error);
    expect(changedMessage).toBeInstanceOf(ConflictException);
    expect(changedMessage).toMatchObject({
      response: { code: 'AGENT_INVOCATION_IDENTITY_CONFLICT' },
    });
    await expect(
      prisma.agentPlatformInvocationAttempt.count({
        where: { conversationId },
      }),
    ).resolves.toBe(1);

    const aggregateMutation = await prisma.agentPlatformInvocation
      .update({
        where: { id: reserved.invocationId },
        data: { clientMessageId: randomUUID() },
      })
      .catch((error: unknown) => error);
    const attemptMutation = await prisma.agentPlatformInvocationAttempt
      .update({
        where: { id: reserved.attemptId },
        data: { inputEventId: `forged-${randomUUID()}` },
      })
      .catch((error: unknown) => error);
    expect(aggregateMutation).toBeInstanceOf(Error);
    expect(attemptMutation).toBeInstanceOf(Error);
    await expect(
      prisma.agentPlatformInvocationAttempt.findUniqueOrThrow({
        where: { id: reserved.attemptId },
        select: { inputEventId: true, clientMessageId: true },
      }),
    ).resolves.toEqual({
      inputEventId: request.inputEventId,
      clientMessageId: request.clientMessageId,
    });
  });

  it('leases one attempt dispatcher and rejects stale admission outcomes', async () => {
    const reserved = await service.reserve(
      context,
      invocationRequest(context),
      POLICY,
    );
    const claims = (
      await Promise.all(
        Array.from({ length: 12 }, () =>
          service.claimPending(1, 30_000, MAX_ADMISSION_ATTEMPTS),
        ),
      )
    ).flat();
    expect(claims).toHaveLength(1);
    const firstClaim = claims[0];
    expect(firstClaim).toMatchObject({
      attemptId: reserved.attemptId,
      invocationId: reserved.invocationId,
      admissionAttempts: 1,
    });

    await prisma.agentPlatformInvocationAttempt.update({
      where: { id: reserved.attemptId },
      data: {
        nextAdmissionAttemptAt: new Date(0),
        admissionLeaseUntil: new Date(0),
      },
    });
    const [replacementClaim] = await service.claimPending(
      1,
      30_000,
      MAX_ADMISSION_ATTEMPTS,
    );
    expect(replacementClaim).toMatchObject({
      attemptId: reserved.attemptId,
      admissionAttempts: 2,
    });
    expect(replacementClaim.leaseToken).not.toBe(firstClaim.leaseToken);

    await service.markRejected(
      firstClaim.attemptId,
      reserved.invocationId,
      conversationId,
      firstClaim.leaseToken,
      publicError('STALE_REJECTION', false),
    );
    await service.markQueued(
      replacementClaim.attemptId,
      reserved.invocationId,
      conversationId,
      randomUUID(),
      replacementClaim.leaseToken,
    );

    await expect(
      prisma.agentPlatformInvocation.findUniqueOrThrow({
        where: { id: reserved.invocationId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: AgentPlatformInvocationStatus.queued });
    await expect(
      prisma.agentPlatformInvocationAttempt.findUniqueOrThrow({
        where: { id: reserved.attemptId },
        select: { status: true, admissionLeaseToken: true },
      }),
    ).resolves.toEqual({
      status: AgentPlatformInvocationAttemptStatus.dispatched,
      admissionLeaseToken: null,
    });
  });

  it('folds concurrent approval continuations into one run across tabs and reloads', async () => {
    const root = await admittedRunningRun(context);
    await lifecycle(root, 'waiting_for_approval');

    const continuationMessageId = randomUUID();
    const continuationEventId = `continuation-event-${randomUUID()}`;
    const requests = Array.from({ length: 12 }, () => ({
      ...invocationRequest(context, {
        inputEventId: continuationEventId,
        clientMessageId: continuationMessageId,
      }),
      continuationOfInvocationId: root.invocationId,
    }));
    const continuations = await Promise.all(
      requests.map((request) => service.reserve(context, request, POLICY)),
    );
    expect(new Set(continuations.map((row) => row.invocationId))).toEqual(
      new Set([root.invocationId]),
    );
    expect(new Set(continuations.map((row) => row.provisionalRunId))).toEqual(
      new Set([root.provisionalRunId]),
    );
    expect(new Set(continuations.map((row) => row.attemptId)).size).toBe(1);
    expect(new Set(continuations.map((row) => row.attemptOrdinal))).toEqual(
      new Set([1]),
    );
    await expect(
      prisma.agentPlatformInvocationAttempt.count({
        where: { invocationId: root.invocationId },
      }),
    ).resolves.toBe(2);

    const [claim] = await service.claimPending(
      1,
      30_000,
      MAX_ADMISSION_ATTEMPTS,
    );
    expect(claim).toMatchObject({
      invocationId: root.invocationId,
      attemptOrdinal: 1,
    });
    await service.markQueued(
      claim.attemptId,
      root.invocationId,
      conversationId,
      randomUUID(),
      claim.leaseToken,
    );
    const continuationRun = {
      ...root,
      attemptId: claim.attemptId,
      attemptOrdinal: claim.attemptOrdinal,
    };
    // A delayed root callback after the continuation was reserved is stale and
    // must not claim the continuation's lifecycle.
    await lifecycle(root, 'running');
    await expect(
      prisma.agentPlatformInvocation.findUniqueOrThrow({
        where: { id: root.invocationId },
        select: { status: true, lifecycleAttemptOrdinal: true },
      }),
    ).resolves.toEqual({
      status: AgentPlatformInvocationStatus.waiting_for_approval,
      lifecycleAttemptOrdinal: 0,
    });
    await lifecycle(continuationRun, 'running');
    await lifecycle(continuationRun, 'succeeded');
    // A delayed duplicate projector callback may never regress a terminal row.
    await lifecycle(root, 'waiting_for_approval');

    const page = await service.list(context, statusRequest());
    expect(page.invocations).toHaveLength(1);
    expect(page.invocations[0]).toMatchObject({
      invocationId: root.invocationId,
      runId: root.provisionalRunId,
      status: 'succeeded',
    });
  });

  it('admits exactly one distinct continuation while an approval trigger is pending', async () => {
    const root = await admittedRunningRun(context);
    await lifecycle(root, 'waiting_for_approval');

    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        service.reserve(
          context,
          {
            ...invocationRequest(context),
            continuationOfInvocationId: root.invocationId,
          },
          POLICY,
        ),
      ),
    );
    const admitted = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    const conflicts = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    );
    expect(admitted).toHaveLength(1);
    expect(conflicts).toHaveLength(11);
    for (const conflict of conflicts) {
      if (conflict.status !== 'rejected') throw new Error('unreachable');
      const reason: unknown = conflict.reason;
      expect(reason).toBeInstanceOf(ConflictException);
      expect(reason).toMatchObject({
        response: { code: 'AGENT_CONTINUATION_ALREADY_PENDING' },
      });
    }
    await expect(
      prisma.agentPlatformInvocationAttempt.count({
        where: { invocationId: root.invocationId },
      }),
    ).resolves.toBe(2);
  });

  it('reconciles continuation delivery state by revision without transcript errors', async () => {
    const root = await admittedRunningRun(context);
    await lifecycle(root, 'waiting_for_approval');
    const before = await service.list(context, statusRequest());

    const continuation = await service.reserve(
      context,
      {
        ...invocationRequest(context),
        continuationOfInvocationId: root.invocationId,
      },
      POLICY,
    );
    const admitting = await service.list(
      context,
      statusRequest({ sinceRevision: before.revision }),
    );
    expect(admitting.invocations).toHaveLength(1);
    expect(admitting.invocations[0]).toMatchObject({
      invocationId: root.invocationId,
      status: 'waiting_for_approval',
      error: null,
      latestAttempt: {
        attemptId: continuation.attemptId,
        ordinal: 1,
        status: 'admitting',
        error: null,
      },
    });

    const [claim] = await service.claimPending(
      1,
      30_000,
      MAX_ADMISSION_ATTEMPTS,
    );
    const error = publicError('AGENT_SESSION_QUEUE_FULL', true);
    await service.markRejected(
      claim.attemptId,
      root.invocationId,
      conversationId,
      claim.leaseToken,
      error,
    );
    const rejected = await service.list(
      context,
      statusRequest({ sinceRevision: admitting.revision }),
    );
    expect(rejected.invocations).toHaveLength(1);
    expect(rejected.invocations[0]).toMatchObject({
      invocationId: root.invocationId,
      status: 'waiting_for_approval',
      error: null,
      latestAttempt: {
        attemptId: continuation.attemptId,
        ordinal: 1,
        status: 'rejected',
        error,
      },
    });
    expect(BigInt(rejected.revision)).toBeGreaterThan(
      BigInt(admitting.revision),
    );
  });

  it('terminalizes approval cancellation and absorbs stale callbacks', async () => {
    const run = await admittedRunningRun(context);
    await lifecycle(run, 'waiting_for_approval');

    await service.markInactiveApprovalWaitCancelled(context, run.invocationId);
    await service.markInactiveApprovalWaitCancelled(context, run.invocationId);
    await lifecycle(run, 'waiting_for_approval');
    await lifecycle(run, 'running');

    const cancelled = await prisma.agentPlatformInvocation.findUniqueOrThrow({
      where: { id: run.invocationId },
      select: { status: true, completedAt: true, error: true },
    });
    expect(cancelled.status).toBe(AgentPlatformInvocationStatus.cancelled);
    expect(cancelled.completedAt).toBeInstanceOf(Date);
    expect(cancelled.error).toBeNull();
  });

  it('dead-letters a poison admission trigger and returns its reserved capacity', async () => {
    const constrained = constrainedPolicy('actor', 'active_runs');
    const poison = await service.reserve(
      context,
      invocationRequest(context),
      constrained,
    );
    const [claim] = await service.claimPending(1, 30_000, 1);
    expect(claim.admissionAttempts).toBe(1);

    // A dispatcher that dies after claiming leaves the lease behind; nothing
    // else in the system will ever move this row again.
    await prisma.agentPlatformInvocationAttempt.update({
      where: { id: poison.attemptId },
      data: {
        nextAdmissionAttemptAt: new Date(0),
        admissionLeaseUntil: new Date(0),
      },
    });
    await expect(service.claimPending(1, 30_000, 1)).resolves.toEqual([]);
    await expect(
      service.reserve(context, invocationRequest(context), constrained),
    ).rejects.toBeInstanceOf(AgentAdmissionRejectedException);

    await expect(service.deadLetterExhaustedAdmissions(8, 1)).resolves.toBe(1);
    await expect(service.deadLetterExhaustedAdmissions(8, 1)).resolves.toBe(0);

    await expect(
      prisma.agentPlatformInvocation.findUniqueOrThrow({
        where: { id: poison.invocationId },
        select: { status: true, error: true, completedAt: true },
      }),
    ).resolves.toMatchObject({
      status: AgentPlatformInvocationStatus.rejected,
      error: { code: 'AGENT_ADMISSION_EXHAUSTED', retryable: true },
    });
    await expect(
      prisma.agentPlatformInvocationAttempt.findUniqueOrThrow({
        where: { id: poison.attemptId },
        select: { status: true, admissionLeaseToken: true },
      }),
    ).resolves.toEqual({
      status: AgentPlatformInvocationAttemptStatus.rejected,
      admissionLeaseToken: null,
    });
    await expect(
      service.reserve(context, invocationRequest(context), constrained),
    ).resolves.toMatchObject({ shouldForward: true });
  });

  it('expires an unanswered approval wait and returns its reserved capacity', async () => {
    const constrained = constrainedPolicy('actor', 'active_runs');
    const abandoned = await admittedRunningRun(context, constrained);
    await lifecycle(abandoned, 'waiting_for_approval');
    await expect(
      service.reserve(context, invocationRequest(context), constrained),
    ).rejects.toBeInstanceOf(AgentAdmissionRejectedException);
    await expect(service.expireStaleApprovalWaits(8, 60_000)).resolves.toBe(0);

    await prisma.$executeRaw`
      UPDATE "agent_platform_invocations"
      SET "updated_at" = CURRENT_TIMESTAMP - INTERVAL '10 minutes'
      WHERE "id" = ${abandoned.invocationId}::uuid
    `;
    await expect(service.expireStaleApprovalWaits(8, 60_000)).resolves.toBe(1);
    await expect(service.expireStaleApprovalWaits(8, 60_000)).resolves.toBe(0);

    await expect(
      prisma.agentPlatformInvocation.findUniqueOrThrow({
        where: { id: abandoned.invocationId },
        select: { status: true, error: true, completedAt: true },
      }),
    ).resolves.toMatchObject({
      status: AgentPlatformInvocationStatus.failed,
      error: { code: 'AGENT_APPROVAL_WAIT_EXPIRED', retryable: true },
    });
    await expect(
      service.reserve(context, invocationRequest(context), constrained),
    ).resolves.toMatchObject({ shouldForward: true });
  });

  it('reopens deterministic root and continuation rejections without changing run identity', async () => {
    const request = invocationRequest(context);
    const root = await service.reserve(context, request, POLICY);
    const [rootClaim] = await service.claimPending(
      1,
      30_000,
      MAX_ADMISSION_ATTEMPTS,
    );
    await service.markRejected(
      rootClaim.attemptId,
      root.invocationId,
      conversationId,
      rootClaim.leaseToken,
      publicError('AGENT_SESSION_QUEUE_FULL', true),
    );
    const retriedRoot = await service.reserve(context, request, POLICY);
    expect(retriedRoot).toMatchObject({
      invocationId: root.invocationId,
      provisionalRunId: root.provisionalRunId,
      attemptId: root.attemptId,
      shouldForward: true,
    });

    const [replacementClaim] = await service.claimPending(
      1,
      30_000,
      MAX_ADMISSION_ATTEMPTS,
    );
    await service.markQueued(
      replacementClaim.attemptId,
      root.invocationId,
      conversationId,
      randomUUID(),
      replacementClaim.leaseToken,
    );
    await lifecycle(root, 'running');
    await lifecycle(root, 'waiting_for_approval');

    const continuationRequest = {
      ...invocationRequest(context),
      continuationOfInvocationId: root.invocationId,
    };
    const continuation = await service.reserve(
      context,
      continuationRequest,
      POLICY,
    );
    const [continuationClaim] = await service.claimPending(
      1,
      30_000,
      MAX_ADMISSION_ATTEMPTS,
    );
    await service.markRejected(
      continuationClaim.attemptId,
      root.invocationId,
      conversationId,
      continuationClaim.leaseToken,
      publicError('AGENT_SESSION_QUEUE_FULL', true),
    );
    const retriedContinuation = await service.reserve(
      context,
      continuationRequest,
      POLICY,
    );
    expect(retriedContinuation).toMatchObject({
      invocationId: root.invocationId,
      provisionalRunId: root.provisionalRunId,
      attemptId: continuation.attemptId,
      attemptOrdinal: 1,
      shouldForward: true,
    });
  });

  it.each([
    ['global', 'active_runs'] as const,
    ['workspace', 'active_runs'] as const,
    ['actor', 'active_runs'] as const,
    ['provider_lane', 'active_runs'] as const,
    ['actor', 'reserved_token_units'] as const,
    ['actor', 'reserved_cost_microusd'] as const,
  ])(
    'rejects %s %s capacity atomically and releases it on terminal completion',
    async (expectedScope, expectedDimension) => {
      await cleanup();
      const sharedScope = `capacity-${expectedScope}-${expectedDimension}`;
      const first = await createConversation({
        actorId: `${ACTOR_PREFIX}-capacity-a`,
        scopeIdentity: sharedScope,
      });
      const second = await createConversation({
        actorId:
          expectedScope === 'actor'
            ? first.context.actorId
            : `${ACTOR_PREFIX}-capacity-b`,
        scopeIdentity:
          expectedScope === 'workspace' || expectedScope === 'actor'
            ? sharedScope
            : `${sharedScope}-other`,
      });
      const constrained = constrainedPolicy(expectedScope, expectedDimension);
      const firstRun = await service.reserve(
        first.context,
        invocationRequest(first.context),
        constrained,
      );

      const rejection = await service
        .reserve(second.context, invocationRequest(second.context), constrained)
        .catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(AgentAdmissionRejectedException);
      const admissionRejection = rejection as AgentAdmissionRejectedException;
      expect(
        AgentPublicErrorSchema.parse(admissionRejection.getResponse()),
      ).toStrictEqual({
        code: 'AGENT_ADMISSION_CAPACITY_EXHAUSTED',
        messageKey: 'agent.error.capacity_exhausted',
        message:
          'Agent execution capacity is currently full. Retry after an active run settles.',
        retryable: true,
        diagnosticId: admissionRejection.diagnosticId,
      });
      expect(admissionRejection.scope).toBe(expectedScope);
      expect(admissionRejection.dimension).toBe(expectedDimension);
      await expect(
        prisma.agentPlatformInvocation.count({
          where: { conversationId: second.conversationId },
        }),
      ).resolves.toBe(0);

      await lifecycle(firstRun, 'succeeded', first.conversationId);
      await expect(
        service.reserve(
          second.context,
          invocationRequest(second.context),
          constrained,
        ),
      ).resolves.toMatchObject({ shouldForward: true });
    },
  );

  it('returns bounded initial state and lossless cursor deltas plus every nonterminal aggregate', async () => {
    const persistentActive = await service.reserve(
      context,
      invocationRequest(context),
      POLICY,
    );
    for (let index = 0; index < 4; index += 1) {
      const run = await service.reserve(
        context,
        invocationRequest(context),
        POLICY,
      );
      await lifecycle(run, 'succeeded');
    }

    const initial = await service.list(context, statusRequest({ limit: 2 }));
    expect(initial.hasMore).toBe(false);
    expect(initial.invocations).toHaveLength(3);
    expect(
      initial.invocations.some(
        (invocation) =>
          invocation.invocationId === persistentActive.invocationId &&
          invocation.status === 'admitting',
      ),
    ).toBe(true);

    const expectedDelta = new Set<string>();
    for (let index = 0; index < 3; index += 1) {
      const run = await service.reserve(
        context,
        invocationRequest(context),
        POLICY,
      );
      expectedDelta.add(run.invocationId);
      await lifecycle(run, 'succeeded');
    }
    const firstDelta = await service.list(
      context,
      statusRequest({ sinceRevision: initial.revision, limit: 2 }),
    );
    expect(firstDelta.hasMore).toBe(true);
    expect(firstDelta.revision).not.toBe(initial.revision);
    const secondDelta = await service.list(
      context,
      statusRequest({ sinceRevision: firstDelta.revision, limit: 2 }),
    );
    expect(secondDelta.hasMore).toBe(false);
    expect(
      [...firstDelta.invocations, ...secondDelta.invocations].filter(
        (invocation) => expectedDelta.has(invocation.invocationId),
      ),
    ).toHaveLength(3);
    expect(
      firstDelta.invocations.some(
        (invocation) =>
          invocation.invocationId === persistentActive.invocationId,
      ),
    ).toBe(true);
    expect(
      secondDelta.invocations.some(
        (invocation) =>
          invocation.invocationId === persistentActive.invocationId,
      ),
    ).toBe(true);
  });

  it('persists and projects only the strict public failure wire shape', async () => {
    const run = await service.reserve(
      context,
      invocationRequest(context),
      POLICY,
    );
    const error = publicError('AGENT_INFERENCE_STEP_FAILED', true);
    await lifecycle(run, 'failed', conversationId, error);
    const page = await service.list(context, statusRequest());
    expect(page.invocations[0]?.error).toEqual(error);

    await expect(
      service.applyLifecycle({
        schemaVersion: 'agent-invocation-lifecycle/v1',
        invocationId: run.invocationId,
        attemptId: run.attemptId,
        attemptOrdinal: run.attemptOrdinal,
        conversationId,
        runId: run.provisionalRunId,
        status: 'failed',
        error: {
          code: 'AGENT_INFERENCE_STEP_FAILED',
          message: 'raw provider stack',
          retryable: true,
        },
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('still reads a failure recorded before the public error shape gained fields', async () => {
    const run = await service.reserve(
      context,
      invocationRequest(context),
      POLICY,
    );
    await lifecycle(run, 'failed', conversationId);
    // Exactly what an earlier revision of AgentPublicErrorSchema persisted:
    // code/message/retryable, before messageKey and diagnosticId existed. Only
    // a direct write can produce it now, because applyLifecycle rejects the
    // shape (asserted above) — which is the point: the row is historical, and
    // the read path must not turn schema evolution into a 500 that takes the
    // whole status page and the conversation with it.
    await prisma.agentPlatformInvocation.update({
      where: { id: run.invocationId },
      data: {
        error: {
          code: 'AGENT_INFERENCE_STEP_FAILED',
          message: 'recorded by a previous revision',
          retryable: true,
        },
      },
    });

    const page = await service.list(context, statusRequest());

    expect(page.invocations[0]?.error).toEqual({
      code: 'AGENT_ERROR_UNREADABLE',
      messageKey: 'agent.error.unreadable',
      message:
        'This turn failed earlier, and the recorded reason predates the current error format.',
      retryable: false,
      diagnosticId: run.invocationId,
    });
  });

  async function admittedRunningRun(
    runContext: AuthorizedAgentContext,
    policy: AgentAdmissionPolicy = POLICY,
  ): Promise<ReservedAgentInvocation> {
    const run = await service.reserve(
      runContext,
      invocationRequest(runContext),
      policy,
    );
    const [claim] = await service.claimPending(
      1,
      30_000,
      MAX_ADMISSION_ATTEMPTS,
    );
    await service.markQueued(
      claim.attemptId,
      run.invocationId,
      runContext.conversationId,
      randomUUID(),
      claim.leaseToken,
    );
    await lifecycle(run, 'running', runContext.conversationId);
    return run;
  }

  async function lifecycle(
    run: ReservedAgentInvocation,
    status:
      | 'running'
      | 'waiting_for_approval'
      | 'succeeded'
      | 'failed'
      | 'cancelled',
    targetConversationId = conversationId,
    error = status === 'failed'
      ? publicError('AGENT_RUNTIME_FAILED', true)
      : null,
  ): Promise<void> {
    await service.applyLifecycle({
      schemaVersion: 'agent-invocation-lifecycle/v1',
      invocationId: run.invocationId,
      attemptId: run.attemptId,
      attemptOrdinal: run.attemptOrdinal,
      conversationId: targetConversationId,
      runId: run.provisionalRunId,
      status,
      error,
    });
  }

  async function createConversation(input: {
    actorId: string;
    scopeIdentity: string;
  }): Promise<{
    conversationId: string;
    context: AuthorizedAgentContext;
  }> {
    const { context: created } = await conversations.create(
      { userId: input.actorId },
      {
        schemaVersion: 'agent-conversation-create/v1',
        surface: 'crew-management',
        crewId: input.scopeIdentity,
        locale: 'en-GB',
      },
    );
    return { conversationId: created.conversationId, context: created };
  }

  async function cleanup(): Promise<void> {
    if (!prisma) return;
    await prisma.agentPlatformConversation.deleteMany({
      where: { ownerActorId: { startsWith: ACTOR_PREFIX } },
    });
  }
});

function invocationRequest(
  context: AuthorizedAgentContext,
  overrides: Partial<AgentInvocationGatewayRequest> = {},
): AgentInvocationGatewayRequest {
  return {
    schemaVersion: 'agent-invocation-gateway/v1',
    conversationId: context.conversationId,
    inputEventId: `event-${randomUUID()}`,
    clientMessageId: randomUUID(),
    sessionName: context.sessionName,
    locale: context.locale,
    ...overrides,
  };
}

function statusRequest(
  overrides: Readonly<{
    sinceRevision?: string;
    limit?: number;
  }> = {},
) {
  return {
    schemaVersion: 'agent-invocation-status-request/v1' as const,
    conversationId: '',
    locale: 'en-GB',
    limit: overrides.limit ?? 50,
    ...(overrides.sinceRevision
      ? { sinceRevision: overrides.sinceRevision }
      : {}),
  };
}

function publicError(code: string, retryable: boolean) {
  return {
    code,
    messageKey: 'agent.error.runtime_failed',
    message: 'StoryOS could not complete this request. Please retry.',
    retryable,
    diagnosticId: randomUUID(),
  };
}

function constrainedPolicy(
  scope: 'global' | 'workspace' | 'actor' | 'provider_lane',
  dimension: 'active_runs' | 'reserved_token_units' | 'reserved_cost_microusd',
): AgentAdmissionPolicy {
  const activeRuns = { ...POLICY.limits.activeRuns };
  const reservedTokenUnits = { ...POLICY.limits.reservedTokenUnits };
  const reservedCostMicrousd = {
    ...POLICY.limits.reservedCostMicrousd,
  };
  const key = scope === 'provider_lane' ? 'providerLane' : scope;
  if (dimension === 'active_runs') {
    activeRuns[key] = 1;
  } else if (dimension === 'reserved_token_units') {
    reservedTokenUnits[key] = POLICY.reservation.tokenUnits;
  } else {
    reservedCostMicrousd[key] = POLICY.reservation.costMicrousd;
  }
  return {
    ...POLICY,
    limits: {
      activeRuns,
      reservedTokenUnits,
      reservedCostMicrousd,
    },
  };
}

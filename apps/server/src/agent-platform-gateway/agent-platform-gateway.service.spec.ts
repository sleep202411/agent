import { NotFoundException } from '@nestjs/common';

import type {
  AgentCancellationGatewayRequest,
  AgentConversationSummary,
  AgentInvocationGatewayRequest,
  AuthorizedAgentContext,
} from './agent-platform-gateway.dto';
import { AgentPlatformGatewayService } from './agent-platform-gateway.service';

const INVOCATION_ID = '0197f4a2-0800-7000-8000-000000000010';
const ATTEMPT_ID = '0197f4a2-0800-7000-8000-000000000016';
const RUN_ID = '0197f4a2-0800-7000-8000-000000000012';
const CLIENT_MESSAGE_ID = '0197f4a2-0800-7000-8000-000000000013';
const WORKFLOW_ID = '0197f4a2-0800-7000-8000-000000000014';
const CONVERSATION_ID = '0197f4a2-0800-7000-8000-000000000004';
const SESSION_NAME = `agent:v1:conversation:${CONVERSATION_ID}`;
const ADMISSION = Object.freeze({
  providerLane: 'gemini',
  retryAfterSeconds: 5,
  reservation: Object.freeze({
    tokenUnits: 131_072n,
    costMicrousd: 500_000n,
  }),
  limits: Object.freeze({
    activeRuns: Object.freeze({
      global: 64,
      workspace: 8,
      actor: 2,
      providerLane: 32,
    }),
    reservedTokenUnits: Object.freeze({
      global: 8_388_608n,
      workspace: 1_048_576n,
      actor: 262_144n,
      providerLane: 4_194_304n,
    }),
    reservedCostMicrousd: Object.freeze({
      global: 32_000_000n,
      workspace: 4_000_000n,
      actor: 1_000_000n,
      providerLane: 16_000_000n,
    }),
  }),
});
const CONVERSATION: AgentConversationSummary = Object.freeze({
  id: CONVERSATION_ID,
  surface: 'crew-management',
  title: null,
  permissionMode: 'smart',
  createdAt: '2026-07-30T12:00:00.000Z',
  updatedAt: '2026-07-30T12:00:00.000Z',
  archivedAt: null,
});
const CONTEXT: AuthorizedAgentContext = Object.freeze({
  actorId: '42',
  actorDisplayName: 'Isaac',
  conversationId: CONVERSATION_ID,
  surface: 'crew-management',
  scope: Object.freeze({ kind: 'crew', crewId: 'crew-7' }),
  sessionName: SESSION_NAME,
  permissionMode: 'smart',
  locale: 'en-US',
  roles: Object.freeze(['crew.admin']),
  permissions: Object.freeze(['crew.read', 'crew.manage', 'crew.finance']),
  traceId: '0197f4a2-0800-7000-8000-000000000011',
});
const AUTHORIZED = Object.freeze({
  context: CONTEXT,
  conversation: CONVERSATION,
});
const REQUEST: AgentInvocationGatewayRequest = Object.freeze({
  schemaVersion: 'agent-invocation-gateway/v1',
  conversationId: CONVERSATION_ID,
  locale: 'en-US',
  inputEventId: 'event-1',
  clientMessageId: CLIENT_MESSAGE_ID,
  sessionName: SESSION_NAME,
});
const CLAIM = Object.freeze({
  attemptId: ATTEMPT_ID,
  attemptOrdinal: 0,
  invocationId: INVOCATION_ID,
  conversationId: CONVERSATION_ID,
  ownerActorId: CONTEXT.actorId,
  inputEventId: REQUEST.inputEventId,
  clientMessageId: CLIENT_MESSAGE_ID,
  provisionalRunId: RUN_ID,
  locale: REQUEST.locale,
  leaseToken: '0197f4a2-0800-7000-8000-000000000015',
  admissionAttempts: 1,
});
const CANCELLATION_REQUEST: AgentCancellationGatewayRequest = Object.freeze({
  schemaVersion: 'agent-cancellation-gateway/v1',
  conversationId: CONVERSATION_ID,
  locale: 'en-US',
  invocationId: INVOCATION_ID,
});

function fixture() {
  const conversations = {
    resolve: jest.fn().mockResolvedValue(AUTHORIZED),
    create: jest.fn().mockResolvedValue(AUTHORIZED),
    authorizeExisting: jest.fn().mockResolvedValue(AUTHORIZED),
    updatePreference: jest.fn().mockResolvedValue(AUTHORIZED),
  };
  const credentials = {
    issueAgentToken: jest.fn().mockReturnValue('signed-agent-token'),
    issueAblyToken: jest.fn().mockReturnValue({
      token: 'signed-ably-token',
      expiresAt: '2026-07-30T12:05:00.000Z',
    }),
  };
  const config = {
    values: {
      agentUrl: new URL('http://agent.internal:4111'),
      requestTimeoutMs: 5_000,
      invocationDispatchIntervalMs: 500,
      invocationDispatchLeaseMs: 45_000,
      invocationDispatchConcurrency: 8,
      invocationDispatchMaxAttempts: 3,
      approvalWaitTimeoutMs: 3_600_000,
      admission: ADMISSION,
    },
  };
  const invocations = {
    reserve: jest.fn().mockResolvedValue({
      invocationId: INVOCATION_ID,
      provisionalRunId: RUN_ID,
      workflowId: null,
      attemptId: ATTEMPT_ID,
      attemptOrdinal: 0,
      shouldForward: true,
    }),
    claimPending: jest.fn().mockResolvedValue([]),
    markQueued: jest.fn().mockResolvedValue(undefined),
    markRejected: jest.fn().mockResolvedValue(undefined),
    recordAdmissionFailure: jest.fn().mockResolvedValue(undefined),
    deadLetterExhaustedAdmissions: jest.fn().mockResolvedValue(0),
    expireStaleApprovalWaits: jest.fn().mockResolvedValue(0),
    markInactiveApprovalWaitCancelled: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({
      schemaVersion: 'agent-invocation-status-page/v1',
      revision: '0',
      hasMore: false,
      invocations: [],
    }),
  };
  return {
    conversations,
    credentials,
    invocations,
    service: new AgentPlatformGatewayService(
      config as never,
      conversations as never,
      credentials as never,
      invocations as never,
    ),
  };
}

describe('AgentPlatformGatewayService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the current conversation and returns only a scoped Ably grant', async () => {
    const { service, conversations, credentials } = fixture();
    const request = {
      schemaVersion: 'agent-conversation-resolve/v1' as const,
      surface: 'crew-management' as const,
      crewId: 'crew-7',
      locale: 'en-US',
    };

    await expect(
      service.resolveConversation({ userId: '42' }, request),
    ).resolves.toEqual({
      schemaVersion: 'agent-conversation-grant/v1',
      conversation: CONVERSATION,
      sessionName: SESSION_NAME,
      ablyToken: 'signed-ably-token',
      expiresAt: '2026-07-30T12:05:00.000Z',
    });
    expect(conversations.resolve).toHaveBeenCalledWith(
      { userId: '42' },
      request,
    );
    expect(credentials.issueAblyToken).toHaveBeenCalledWith(
      SESSION_NAME,
      CONTEXT.actorId,
    );
    expect(credentials.issueAgentToken).not.toHaveBeenCalled();
  });

  it('creates a fresh conversation through the same grant contract', async () => {
    const { service, conversations } = fixture();
    const request = {
      schemaVersion: 'agent-conversation-create/v1' as const,
      surface: 'crew-management' as const,
      crewId: 'crew-7',
      locale: 'en-US',
      permissionMode: 'ask' as const,
    };

    await service.createConversation({ userId: '42' }, request);

    expect(conversations.create).toHaveBeenCalledWith(
      { userId: '42' },
      request,
    );
  });

  it('re-authorizes an existing conversation when renewing credentials', async () => {
    const { service, conversations } = fixture();
    const request = {
      schemaVersion: 'agent-session-grant-request/v1' as const,
      conversationId: CONVERSATION_ID,
      locale: 'en-US',
    };

    await service.authorizeSession({ userId: '42' }, request);

    expect(conversations.authorizeExisting).toHaveBeenCalledWith(
      { userId: '42' },
      request,
    );
  });

  it('durably reserves every invocation and schedules dispatch without waiting upstream', async () => {
    const { service, conversations, credentials, invocations } = fixture();
    const fetchMock = jest.spyOn(global, 'fetch');
    const drain = jest
      .spyOn(service, 'drainAdmissionOutbox')
      .mockResolvedValue(undefined);

    await expect(service.invoke({ userId: '42' }, REQUEST)).resolves.toEqual({
      schemaVersion: 'agent-invocation-accepted/v1',
      invocationId: INVOCATION_ID,
    });

    expect(conversations.authorizeExisting).toHaveBeenCalledWith(
      { userId: '42' },
      {
        schemaVersion: 'agent-session-grant-request/v1',
        conversationId: CONVERSATION_ID,
        locale: 'en-US',
      },
    );
    expect(credentials.issueAgentToken).toHaveBeenCalledWith(CONTEXT);
    expect(invocations.reserve).toHaveBeenCalledWith(
      CONTEXT,
      REQUEST,
      ADMISSION,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(invocations.markQueued).not.toHaveBeenCalled();
  });

  it('returns a previously admitted invocation without a second upstream wake-up', async () => {
    const { service, invocations } = fixture();
    invocations.reserve.mockResolvedValueOnce({
      invocationId: INVOCATION_ID,
      provisionalRunId: RUN_ID,
      workflowId: WORKFLOW_ID,
      attemptId: ATTEMPT_ID,
      attemptOrdinal: 0,
      shouldForward: false,
    });
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(service.invoke({ userId: '42' }, REQUEST)).resolves.toEqual({
      schemaVersion: 'agent-invocation-accepted/v1',
      invocationId: INVOCATION_ID,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(invocations.claimPending).not.toHaveBeenCalled();
    expect(invocations.markQueued).not.toHaveBeenCalled();
  });

  it('records a bounded queue rejection asynchronously so the same identity can be reopened', async () => {
    const { service, invocations } = fixture();
    invocations.claimPending
      .mockResolvedValueOnce([CLAIM])
      .mockResolvedValueOnce([]);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          code: 'AGENT_SESSION_QUEUE_FULL',
          messageKey: 'agent.error.queue_full',
          message:
            'This Agent conversation has reached its bounded pending-turn limit.',
          retryable: true,
          diagnosticId: ATTEMPT_ID,
        },
        429,
      ),
    );

    await service.drainAdmissionOutbox();
    expect(invocations.markRejected).toHaveBeenCalledWith(
      ATTEMPT_ID,
      INVOCATION_ID,
      CONVERSATION_ID,
      CLAIM.leaseToken,
      {
        code: 'AGENT_SESSION_QUEUE_FULL',
        messageKey: 'agent.error.queue_full',
        message:
          'This Agent conversation has reached its bounded pending-turn limit.',
        retryable: true,
        diagnosticId: ATTEMPT_ID,
      },
    );
  });

  it('does not lose an invocation wake-up while an outbox drain is already running', async () => {
    const { service, invocations } = fixture();
    let releaseFirstClaim: (() => void) | undefined;
    const firstClaim = new Promise<never[]>((resolve) => {
      releaseFirstClaim = () => resolve([]);
    });
    invocations.claimPending
      .mockReturnValueOnce(firstClaim)
      .mockResolvedValueOnce([]);

    const firstDrain = service.drainAdmissionOutbox();
    const joinedDrain = service.drainAdmissionOutbox();
    releaseFirstClaim?.();

    await Promise.all([firstDrain, joinedDrain]);
    expect(invocations.claimPending).toHaveBeenCalledTimes(2);
  });

  it('reads invocation status only after re-authorizing the conversation', async () => {
    const { service, conversations, invocations } = fixture();

    await expect(
      service.invocationStatus(
        { userId: '42' },
        {
          schemaVersion: 'agent-invocation-status-request/v1',
          conversationId: CONVERSATION_ID,
          locale: 'en-US',
          limit: 50,
        },
      ),
    ).resolves.toEqual({
      schemaVersion: 'agent-invocation-status-page/v1',
      revision: '0',
      hasMore: false,
      invocations: [],
    });
    expect(conversations.authorizeExisting).toHaveBeenCalled();
    expect(invocations.list).toHaveBeenCalledWith(CONTEXT, {
      schemaVersion: 'agent-invocation-status-request/v1',
      conversationId: CONVERSATION_ID,
      locale: 'en-US',
      limit: 50,
    });
  });

  it('rejects an inaccessible conversation before issuing credentials', async () => {
    const { service, conversations, credentials } = fixture();
    const fetchMock = jest.spyOn(global, 'fetch');
    conversations.authorizeExisting.mockRejectedValueOnce(
      new NotFoundException(),
    );

    await expect(
      service.invoke({ userId: 'another-user' }, REQUEST),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(credentials.issueAgentToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries retryable upstream failures with the same idempotency pointer', async () => {
    const { service, invocations } = fixture();
    invocations.claimPending
      .mockResolvedValueOnce([CLAIM])
      .mockResolvedValueOnce([]);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            schemaVersion: 'agent-invocation-accepted/v1',
            invocationId: INVOCATION_ID,
            attemptId: ATTEMPT_ID,
            attemptOrdinal: 0,
            workflowId: INVOCATION_ID,
          },
          202,
        ),
      );

    await service.drainAdmissionOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map((call) => (call[1] as RequestInit).body),
    ).toEqual(
      Array(3).fill(
        JSON.stringify({
          inputEventId: 'event-1',
          invocationId: INVOCATION_ID,
          attemptId: ATTEMPT_ID,
          attemptOrdinal: 0,
          provisionalRunId: RUN_ID,
          sessionName: SESSION_NAME,
        }),
      ),
    );
  });

  it('durably defers admission after an ambiguous upstream outage', async () => {
    const { service, invocations } = fixture();
    invocations.claimPending
      .mockResolvedValueOnce([CLAIM])
      .mockResolvedValueOnce([]);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('unavailable', { status: 503 }));

    await service.drainAdmissionOutbox();
    expect(invocations.recordAdmissionFailure).toHaveBeenCalledWith(CLAIM);
    expect(invocations.markRejected).not.toHaveBeenCalled();
  });

  it('dead-letters a redeliverable admission once its retry budget is spent', async () => {
    const { service, invocations } = fixture();
    const exhausted = { ...CLAIM, admissionAttempts: 3 };
    invocations.claimPending
      .mockResolvedValueOnce([exhausted])
      .mockResolvedValueOnce([]);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('unavailable', { status: 503 }));

    await service.drainAdmissionOutbox();

    expect(invocations.recordAdmissionFailure).not.toHaveBeenCalled();
    expect(invocations.markRejected).toHaveBeenCalledWith(
      ATTEMPT_ID,
      INVOCATION_ID,
      CONVERSATION_ID,
      CLAIM.leaseToken,
      expect.objectContaining({
        code: 'AGENT_ADMISSION_EXHAUSTED',
        retryable: true,
      }),
    );
  });

  it('bounds every outbox claim by the configured admission attempt ceiling', async () => {
    const { service, invocations } = fixture();

    await service.drainAdmissionOutbox();

    expect(invocations.claimPending).toHaveBeenCalledWith(8, 45_000, 3);
  });

  it('reclaims exhausted admissions and abandoned approvals only on the polling edge', async () => {
    const { service, invocations } = fixture();

    await service.drainAdmissionOutbox();
    expect(invocations.deadLetterExhaustedAdmissions).not.toHaveBeenCalled();
    expect(invocations.expireStaleApprovalWaits).not.toHaveBeenCalled();

    service.onApplicationBootstrap();
    await service.onModuleDestroy();

    expect(invocations.deadLetterExhaustedAdmissions).toHaveBeenCalledWith(
      8,
      3,
    );
    expect(invocations.expireStaleApprovalWaits).toHaveBeenCalledWith(
      8,
      3_600_000,
    );
  });

  it('re-authorizes and dispatches a leased outbox invocation', async () => {
    const { service, invocations, conversations } = fixture();
    invocations.claimPending
      .mockResolvedValueOnce([CLAIM])
      .mockResolvedValueOnce([]);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          schemaVersion: 'agent-invocation-accepted/v1',
          invocationId: INVOCATION_ID,
          attemptId: ATTEMPT_ID,
          attemptOrdinal: 0,
          workflowId: WORKFLOW_ID,
        },
        202,
      ),
    );

    await service.drainAdmissionOutbox();

    expect(conversations.authorizeExisting).toHaveBeenCalledWith(
      { userId: CONTEXT.actorId },
      {
        schemaVersion: 'agent-session-grant-request/v1',
        conversationId: CONVERSATION_ID,
        locale: 'en-US',
      },
    );
    expect(invocations.markQueued).toHaveBeenCalledWith(
      ATTEMPT_ID,
      INVOCATION_ID,
      CONVERSATION_ID,
      WORKFLOW_ID,
      CLAIM.leaseToken,
    );
  });

  it('re-authorizes and durably cancels through the Agent Platform', async () => {
    const { service, credentials, invocations } = fixture();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          schemaVersion: 'agent-cancellation-result/v1',
          invocationId: INVOCATION_ID,
          status: 'cancellation-requested',
        },
        200,
      ),
    );

    await expect(
      service.cancel({ userId: '42' }, CANCELLATION_REQUEST),
    ).resolves.toEqual({
      schemaVersion: 'agent-cancellation-result/v1',
      invocationId: INVOCATION_ID,
      status: 'cancellation-requested',
    });

    expect(credentials.issueAgentToken).toHaveBeenCalledWith(CONTEXT);
    expect((fetchMock.mock.calls[0][0] as URL).href).toBe(
      'http://agent.internal:4111/api/v1/cancellations',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        invocationId: INVOCATION_ID,
        sessionName: SESSION_NAME,
      }),
    });
    expect(
      invocations.markInactiveApprovalWaitCancelled,
    ).not.toHaveBeenCalled();
  });

  it('terminalizes a persisted approval wait when Temporal confirms it is inactive', async () => {
    const { service, invocations } = fixture();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          schemaVersion: 'agent-cancellation-result/v1',
          invocationId: INVOCATION_ID,
          status: 'already-terminal',
        },
        200,
      ),
    );

    await expect(
      service.cancel({ userId: '42' }, CANCELLATION_REQUEST),
    ).resolves.toMatchObject({
      invocationId: INVOCATION_ID,
      status: 'already-terminal',
    });

    expect(invocations.markInactiveApprovalWaitCancelled).toHaveBeenCalledWith(
      CONTEXT,
      INVOCATION_ID,
    );
  });

  it('loads bounded history through the signed conversation scope', async () => {
    const { service } = fixture();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          schemaVersion: 'agent-history-page/v1',
          messages: [
            {
              id: 'message-1',
              role: 'user',
              parts: [{ type: 'text', text: 'Hello' }],
            },
          ],
          nextCursor: null,
        },
        200,
      ),
    );

    await expect(
      service.history(
        { userId: '42' },
        {
          schemaVersion: 'agent-history-gateway/v1',
          conversationId: CONVERSATION_ID,
          locale: 'en-US',
          cursor: 'cursor-1',
          limit: 25,
        },
      ),
    ).resolves.toMatchObject({
      schemaVersion: 'agent-history-page/v1',
      messages: [{ id: 'message-1' }],
    });
    expect((fetchMock.mock.calls[0][0] as URL).href).toBe(
      'http://agent.internal:4111/api/v1/history',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      body: JSON.stringify({
        sessionName: SESSION_NAME,
        cursor: 'cursor-1',
        limit: 25,
      }),
    });
  });

  it('surfaces structured non-retryable Agent errors without rewriting them', async () => {
    const { service, invocations } = fixture();
    invocations.claimPending
      .mockResolvedValueOnce([CLAIM])
      .mockResolvedValueOnce([]);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          code: 'AGENT_SESSION_SCOPE_MISMATCH',
          messageKey: 'agent.error.scope_mismatch',
          message: 'The requested session is outside the signed agent scope.',
          retryable: false,
          diagnosticId: ATTEMPT_ID,
        },
        403,
      ),
    );

    await service.drainAdmissionOutbox();

    expect(invocations.markRejected).toHaveBeenCalledWith(
      ATTEMPT_ID,
      INVOCATION_ID,
      CONVERSATION_ID,
      CLAIM.leaseToken,
      {
        code: 'AGENT_SESSION_SCOPE_MISMATCH',
        messageKey: 'agent.error.scope_mismatch',
        message: 'The requested session is outside the signed agent scope.',
        retryable: false,
        diagnosticId: ATTEMPT_ID,
      },
    );
  });

  it('reports dependency readiness without making the product API depend on it', async () => {
    const { service } = fixture();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(service.isReady()).resolves.toBe(true);
    await expect(service.isReady()).resolves.toBe(false);
  });
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

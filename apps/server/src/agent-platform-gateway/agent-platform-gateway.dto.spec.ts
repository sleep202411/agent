import {
  AgentCancellationGatewayRequestSchema,
  AgentConversationCreateRequestSchema,
  AgentConversationResolveRequestSchema,
  AgentHistoryGatewayRequestSchema,
  AgentInvocationGatewayRequestSchema,
  AgentInvocationLifecycleAcknowledgementSchema,
  AgentInvocationLifecycleRequestSchema,
  AgentInvocationStatusPageSchema,
  AgentInvocationStatusRequestSchema,
  AgentSessionGrantRequestSchema,
  canonicalAgentSessionName,
} from './agent-platform-gateway.dto';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const CONVERSATION_ID = '0197f4a2-0800-7000-8000-000000000004';

describe('Agent Platform gateway contracts', () => {
  it('parses a Story scope and canonicalizes its locale', () => {
    const request = AgentConversationResolveRequestSchema.parse({
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'story-studio',
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      locale: 'zh-hk',
    });

    expect(request.locale).toBe('zh-HK');
    expect(canonicalAgentSessionName(CONVERSATION_ID)).toBe(
      `agent:v1:conversation:${CONVERSATION_ID}`,
    );
  });

  it('models Crew as its own aggregate without a fabricated workspace', () => {
    const request = AgentConversationCreateRequestSchema.parse({
      schemaVersion: 'agent-conversation-create/v1',
      surface: 'crew-management',
      crewId: 'crew_7',
      locale: 'en-GB',
      permissionMode: 'ask',
    });

    expect(request).toEqual({
      schemaVersion: 'agent-conversation-create/v1',
      surface: 'crew-management',
      crewId: 'crew_7',
      locale: 'en-GB',
      permissionMode: 'ask',
    });
  });

  it('rejects unknown scope fields and malformed locales', () => {
    expect(
      AgentConversationResolveRequestSchema.safeParse({
        schemaVersion: 'agent-conversation-resolve/v1',
        surface: 'crew-management',
        crewId: 'crew_7',
        workspaceId: WORKSPACE_ID,
        locale: 'not a locale',
      }).success,
    ).toBe(false);
  });

  it('binds control requests only to an immutable conversation identity', () => {
    const invocation = AgentInvocationGatewayRequestSchema.parse({
      schemaVersion: 'agent-invocation-gateway/v1',
      conversationId: CONVERSATION_ID,
      locale: 'en-US',
      inputEventId: 'event-1',
      clientMessageId: '0197f4a2-0800-7000-8000-000000000012',
      sessionName: canonicalAgentSessionName(CONVERSATION_ID),
    });

    expect(invocation).toEqual({
      schemaVersion: 'agent-invocation-gateway/v1',
      conversationId: CONVERSATION_ID,
      locale: 'en-US',
      inputEventId: 'event-1',
      clientMessageId: '0197f4a2-0800-7000-8000-000000000012',
      sessionName: canonicalAgentSessionName(CONVERSATION_ID),
    });
    expect(
      AgentInvocationGatewayRequestSchema.safeParse({
        ...invocation,
        sessionName: 'agent:v1:conversation:forged',
      }).success,
    ).toBe(false);

    expect(
      AgentInvocationGatewayRequestSchema.parse({
        ...invocation,
        inputEventId: 'approval-continuation',
        clientMessageId: 'approval-message',
        continuationOfInvocationId: '0197f4a2-0800-7000-8000-000000000010',
      }),
    ).toMatchObject({
      continuationOfInvocationId: '0197f4a2-0800-7000-8000-000000000010',
    });
  });

  it('keeps lifecycle failures public, strict, and diagnostic-correlated', () => {
    const error = {
      code: 'AGENT_INFERENCE_STEP_FAILED',
      messageKey: 'agent.error.response_failed',
      message: 'StoryOS could not generate a response. Please retry.',
      retryable: true,
      diagnosticId: '0197f4a2-0800-7000-8000-000000000099',
    };
    expect(
      AgentInvocationLifecycleRequestSchema.parse({
        schemaVersion: 'agent-invocation-lifecycle/v1',
        invocationId: '0197f4a2-0800-7000-8000-000000000010',
        attemptId: '0197f4a2-0800-7000-8000-000000000012',
        attemptOrdinal: 0,
        conversationId: CONVERSATION_ID,
        runId: '0197f4a2-0800-7000-8000-000000000011',
        status: 'failed',
        error,
      }),
    ).toMatchObject({ error });
    expect(
      AgentInvocationLifecycleRequestSchema.safeParse({
        schemaVersion: 'agent-invocation-lifecycle/v1',
        invocationId: '0197f4a2-0800-7000-8000-000000000010',
        attemptId: '0197f4a2-0800-7000-8000-000000000012',
        attemptOrdinal: 0,
        conversationId: CONVERSATION_ID,
        runId: '0197f4a2-0800-7000-8000-000000000011',
        status: 'failed',
        error: { ...error, providerStack: 'must never cross the wire' },
      }).success,
    ).toBe(false);
    expect(
      AgentInvocationLifecycleAcknowledgementSchema.parse({
        schemaVersion: 'agent-invocation-lifecycle-ack/v1',
        invocationId: '0197f4a2-0800-7000-8000-000000000010',
        attemptId: '0197f4a2-0800-7000-8000-000000000012',
        attemptOrdinal: 0,
      }),
    ).toMatchObject({
      invocationId: '0197f4a2-0800-7000-8000-000000000010',
      attemptId: '0197f4a2-0800-7000-8000-000000000012',
      attemptOrdinal: 0,
    });
    expect(
      AgentInvocationLifecycleAcknowledgementSchema.safeParse({
        schemaVersion: 'agent-invocation-lifecycle-ack/v1',
        invocationId: '0197f4a2-0800-7000-8000-000000000010',
      }).success,
    ).toBe(false);
  });

  it('uses a bounded monotonic cursor for incremental status reconciliation', () => {
    const request = AgentInvocationStatusRequestSchema.parse({
      schemaVersion: 'agent-invocation-status-request/v1',
      conversationId: CONVERSATION_ID,
      locale: 'en-US',
      sinceRevision: '42',
    });
    expect(request).toMatchObject({ sinceRevision: '42', limit: 50 });
    expect(
      AgentInvocationStatusPageSchema.parse({
        schemaVersion: 'agent-invocation-status-page/v1',
        revision: '45',
        hasMore: false,
        invocations: [
          {
            invocationId: '0197f4a2-0800-7000-8000-000000000010',
            runId: '0197f4a2-0800-7000-8000-000000000011',
            clientMessageId: 'root-message',
            inputEventId: 'root-event',
            status: 'waiting_for_approval',
            error: null,
            latestAttempt: {
              attemptId: '0197f4a2-0800-7000-8000-000000000012',
              ordinal: 1,
              inputEventId: 'approval-event',
              clientMessageId: 'approval-message',
              status: 'rejected',
              error: {
                code: 'AGENT_SESSION_QUEUE_FULL',
                messageKey: 'agent.error.service_unavailable',
                message: 'StoryOS could not accept this request. Please retry.',
                retryable: true,
                diagnosticId: '0197f4a2-0800-7000-8000-000000000099',
              },
            },
            createdAt: '2026-07-30T12:00:00.000Z',
            startedAt: '2026-07-30T12:00:01.000Z',
            completedAt: null,
          },
        ],
      }),
    ).toMatchObject({
      revision: '45',
      hasMore: false,
      invocations: [
        {
          status: 'waiting_for_approval',
          error: null,
          latestAttempt: {
            ordinal: 1,
            status: 'rejected',
          },
        },
      ],
    });
    expect(
      AgentInvocationStatusPageSchema.safeParse({
        schemaVersion: 'agent-invocation-status-page/v1',
        revision: '45',
        hasMore: false,
        invocations: [
          {
            invocationId: '0197f4a2-0800-7000-8000-000000000010',
            runId: '0197f4a2-0800-7000-8000-000000000011',
            clientMessageId: 'message-1',
            inputEventId: 'event-1',
            status: 'failed',
            error: null,
            latestAttempt: {
              attemptId: '0197f4a2-0800-7000-8000-000000000012',
              ordinal: 0,
              inputEventId: 'event-1',
              clientMessageId: 'message-1',
              status: 'dispatched',
              error: null,
            },
            createdAt: '2026-07-30T12:00:00.000Z',
            startedAt: '2026-07-30T12:00:01.000Z',
            completedAt: '2026-07-30T12:00:02.000Z',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('uses the same immutable identity for cancellation and token renewal', () => {
    expect(
      AgentCancellationGatewayRequestSchema.parse({
        schemaVersion: 'agent-cancellation-gateway/v1',
        conversationId: CONVERSATION_ID,
        locale: 'en-GB',
        invocationId: '0197f4a2-0800-7000-8000-000000000010',
      }),
    ).toMatchObject({ conversationId: CONVERSATION_ID });

    expect(
      AgentSessionGrantRequestSchema.parse({
        schemaVersion: 'agent-session-grant-request/v1',
        conversationId: CONVERSATION_ID,
        locale: 'en-GB',
      }),
    ).toEqual({
      schemaVersion: 'agent-session-grant-request/v1',
      conversationId: CONVERSATION_ID,
      locale: 'en-GB',
    });
  });

  it('bounds history pagination and keeps its cursor opaque', () => {
    expect(
      AgentHistoryGatewayRequestSchema.parse({
        schemaVersion: 'agent-history-gateway/v1',
        conversationId: CONVERSATION_ID,
        locale: 'en-GB',
      }),
    ).toMatchObject({
      conversationId: CONVERSATION_ID,
      limit: 50,
    });
    expect(
      AgentHistoryGatewayRequestSchema.safeParse({
        schemaVersion: 'agent-history-gateway/v1',
        conversationId: CONVERSATION_ID,
        locale: 'en-GB',
        limit: 101,
      }).success,
    ).toBe(false);
  });
});

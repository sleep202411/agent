import { AgentOsDomainExecuteBodySchema } from './agent-os-domain.dto';

const VALID_BODY = {
  runId: '019a0361-2ea8-7400-83dd-cda59aeb6c89',
  conversationId: '019a0361-309a-7113-9a10-543c433d5fcc',
  turnId: '019a0361-3236-7288-af07-658d602de1c6',
  toolCallId: 'call_story_author_1',
  actorId: 'creator-1',
  projectId: '019a0361-33c5-7e79-872d-5d9f63bc4204',
  skillResolutionId: '019a0361-34d7-7caf-96d9-14b866fa3b57',
  skillVersionIds: [],
  idempotencyKey:
    '019a0361-33c5-7e79-872d-5d9f63bc4204:019a0361-2ea8-7400-83dd-cda59aeb6c89:call_story_author_1:v1',
  arguments: {},
};

describe('AgentOsDomainExecuteBodySchema durable execution identity', () => {
  it('accepts a complete run, conversation, turn, and tool-call identity', () => {
    expect(AgentOsDomainExecuteBodySchema.parse(VALID_BODY)).toEqual(
      VALID_BODY,
    );
  });

  it.each(['runId', 'conversationId', 'turnId', 'toolCallId'] as const)(
    'rejects a request missing %s',
    (field) => {
      const body: Record<string, unknown> = { ...VALID_BODY };
      delete body[field];
      expect(AgentOsDomainExecuteBodySchema.safeParse(body).success).toBe(
        false,
      );
    },
  );

  it('accepts one complete continuation execution proof', () => {
    const continuationExecution = {
      executionToken: '019a0361-44d7-7caf-96d9-14b866fa3b57',
      executionAttemptId: '019a0361-45d7-7caf-96d9-14b866fa3b57',
      executionEpoch: 2,
      executionOwnerId: '019a0361-46d7-7caf-96d9-14b866fa3b57',
    };
    expect(
      AgentOsDomainExecuteBodySchema.parse({
        ...VALID_BODY,
        continuationExecution,
      }).continuationExecution,
    ).toEqual(continuationExecution);
  });

  it('accepts checkpoint-backed execution proofs from the durable worker', () => {
    const startExecution = {
      executionToken: '019a0361-44d7-7caf-96d9-14b866fa3b57',
      executionAttemptId: '019a0361-45d7-7caf-96d9-14b866fa3b57',
      executionEpoch: 2,
      executionOwnerId: '019a0361-46d7-7caf-96d9-14b866fa3b57',
      checkpointId: 'checkpoint-1',
      checkpointNamespace: '',
      checkpointThreadId: VALID_BODY.conversationId,
      checkpointMessageId: '019a0361-47d7-7caf-96d9-14b866fa3b57',
    };

    expect(
      AgentOsDomainExecuteBodySchema.parse({
        ...VALID_BODY,
        startExecution,
      }).startExecution,
    ).toEqual(startExecution);
    expect(
      AgentOsDomainExecuteBodySchema.safeParse({
        ...VALID_BODY,
        startExecution: {
          ...startExecution,
          checkpointMessageId: undefined,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects partial or competing execution authorities', () => {
    expect(
      AgentOsDomainExecuteBodySchema.safeParse({
        ...VALID_BODY,
        continuationExecution: {
          executionToken: '019a0361-44d7-7caf-96d9-14b866fa3b57',
        },
      }).success,
    ).toBe(false);
    const completeProof = {
      executionToken: '019a0361-44d7-7caf-96d9-14b866fa3b57',
      executionAttemptId: '019a0361-45d7-7caf-96d9-14b866fa3b57',
      executionEpoch: 2,
      executionOwnerId: '019a0361-46d7-7caf-96d9-14b866fa3b57',
    };
    expect(
      AgentOsDomainExecuteBodySchema.safeParse({
        ...VALID_BODY,
        startExecution: completeProof,
        continuationExecution: completeProof,
      }).success,
    ).toBe(false);
  });
});

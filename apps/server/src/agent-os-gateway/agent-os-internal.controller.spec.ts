import { BadRequestException } from '@nestjs/common';
import { AgentOsInternalController } from './agent-os-internal.controller';

const TOKEN = 'internal-secret-token-123';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '33333333-3333-4333-8333-333333333333';

describe('AgentOsInternalController journal boundary', () => {
  it('accepts the full durable external-handoff snapshot from the Worker', async () => {
    const upsertSnapshot = jest.fn().mockResolvedValue({
      acceptedLastSequence: 1,
      status: 'waiting_for_external',
    });
    const controller = new AgentOsInternalController(
      { value: { internalToken: TOKEN } } as never,
      { upsertSnapshot } as never,
    );
    const pendingExternal = {
      kind: 'external_job',
      jobId: '44444444-4444-4444-8444-444444444444',
      startedMessage: 'I have started drafting the proposal.',
      turnId: TURN_ID,
      toolCallId: 'tool-call-1',
      toolId: 'story.author',
    } as const;
    const body = journalBody({ pendingExternal });

    await expect(
      controller.putJournal(RUN_ID, TOKEN, body),
    ).resolves.toMatchObject({
      ok: true,
      runId: RUN_ID,
      acceptedLastSequence: 1,
    });
    expect(upsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        reportedLastSequence: 1,
        pendingExternal,
      }),
    );
  });

  it('rejects a Worker journal that omits the monotonic tail claim', async () => {
    const controller = new AgentOsInternalController(
      { value: { internalToken: TOKEN } } as never,
      { upsertSnapshot: jest.fn() } as never,
    );
    const body = journalBody();
    const { lastSequence: _removed, ...withoutTail } = body;

    await expect(
      controller.putJournal(RUN_ID, TOKEN, withoutTail),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function journalBody(overrides: Record<string, unknown> = {}) {
  return {
    projectId: '55555555-5555-4555-8555-555555555555',
    conversationId: CONVERSATION_ID,
    actorId: 'user-1',
    modelProfileId: 'qwen-plus',
    status: 'waiting_for_external',
    lastSequence: 1,
    events: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        protocolVersion: 'fizz.agent.v1',
        sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
        runId: RUN_ID,
        conversationId: CONVERSATION_ID,
        sequence: 1,
        timestamp: '2026-08-20T12:00:00.000Z',
        type: 'RunPaused',
        data: {
          turnId: TURN_ID,
          status: 'waiting_for_external',
          externalJobId: '44444444-4444-4444-8444-444444444444',
        },
      },
    ],
    pendingApproval: null,
    pendingUserInput: null,
    pendingExternal: null,
    assistantText: 'I have started drafting the proposal.',
    projectKind: 'story',
    workbenchMode: 'story-canvas',
    skillMountSnapshot: {
      schemaVersion: 'project-skill-resolution/v1',
      resolutionId: '77777777-7777-4777-8777-777777777777',
      ownerKind: 'story',
      projectId: '55555555-5555-4555-8555-555555555555',
      projectRevision: 0,
      scope: 'agent_prompt',
      workbenchMode: 'story-canvas',
      sourceSurface: 'fizzagent',
      resolvedAt: '2026-08-20T12:00:00.000Z',
      skills: [],
      checksum: '0'.repeat(64),
    },
    ...overrides,
  };
}

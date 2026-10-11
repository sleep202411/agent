/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await -- In-memory Prisma mocks intentionally model structurally typed rows. */
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FIZZ_AGENT_PROTOCOL_VERSION,
  type AgentEventEnvelope,
  type AgentRunStatus,
} from '@repo/agent-protocol';
import {
  AgentOsContinuationNotReadyError,
  AgentOsRunJournalService,
  storyProposalApplyToolCallId,
  storyProposalApprovalId,
  storyProposalDecisionTurnId,
} from './agent-os-run-journal.service';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CHAPTER_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '66666666-6666-4666-8666-666666666666';
const EXTERNAL_JOB_ID = '77777777-7777-4777-8777-777777777777';
const STORY_PROPOSAL_ARTIFACT = {
  storyProjectId: PROJECT_ID,
  storyChapterId: CHAPTER_ID,
  workspaceId: WORKSPACE_ID,
  stage: 'assets' as const,
  schemaVersion: 'story-asset-proposal-v1',
};
const EVENT_IDS = [
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000005',
  '50000000-0000-4000-8000-000000000006',
  '50000000-0000-4000-8000-000000000007',
  '50000000-0000-4000-8000-000000000008',
  '50000000-0000-4000-8000-000000000009',
  '50000000-0000-4000-8000-000000000010',
  '50000000-0000-4000-8000-000000000011',
  '50000000-0000-4000-8000-000000000012',
  '50000000-0000-4000-8000-000000000013',
  '50000000-0000-4000-8000-000000000014',
  '50000000-0000-4000-8000-000000000015',
  '50000000-0000-4000-8000-000000000016',
  '50000000-0000-4000-8000-000000000017',
  '50000000-0000-4000-8000-000000000018',
  '50000000-0000-4000-8000-000000000019',
  '50000000-0000-4000-8000-000000000020',
];

describe('AgentOsRunJournalService', () => {
  it('reads the earliest immutable user message without loading the full journal', async () => {
    const fixture = createFixture();
    const started = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });
    const initial = event(2, 'UserMessage', {
      messageId: 'user-message-1',
      turnId: TURN_ID,
      text: 'Complete Script, Plot, Assets, and Storyboard stage by stage.',
    });
    const followUp = event(3, 'UserMessage', {
      messageId: 'user-message-2',
      turnId: TURN_ID,
      text: 'Approve Script.',
    });
    await fixture.service.upsertSnapshot(
      input('running', [started, initial, followUp]),
    );

    await expect(
      fixture.service.getInitialUserMessageText(RUN_ID),
    ).resolves.toBe(
      'Complete Script, Plot, Assets, and Storyboard stage by stage.',
    );
    expect(fixture.tx.agentOsRunEvent.findFirst).toHaveBeenLastCalledWith({
      where: { runId: RUN_ID, type: 'UserMessage' },
      orderBy: { sequence: 'asc' },
      select: { data: true },
    });
  });

  it('ignores a late shorter snapshot instead of truncating a terminal run', async () => {
    const fixture = createFixture();
    const started = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });
    const user = event(2, 'UserMessage', {
      messageId: 'user-message-1',
      turnId: TURN_ID,
      text: 'Build an interactive film.',
    });
    const completed = event(3, 'RunCompleted', {
      turnId: TURN_ID,
      status: 'completed',
    });

    await fixture.service.upsertSnapshot(input('running', [started, user]));
    await fixture.service.upsertSnapshot(
      input('completed', [started, user, completed]),
    );
    const accepted = await fixture.service.upsertSnapshot(
      input('running', [started, user]),
    );

    expect(accepted).toEqual({
      acceptedLastSequence: 3,
      status: 'completed',
    });
    expect(fixture.state.run?.status).toBe('completed');
    expect(fixture.state.events).toHaveLength(3);
  });

  it('rejects a journal that rewrites an acknowledged sequence', async () => {
    const fixture = createFixture();
    const original = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });
    await fixture.service.upsertSnapshot(input('running', [original]));

    const divergent = {
      ...original,
      id: '99999999-9999-4999-8999-999999999999',
    } satisfies AgentEventEnvelope;
    await expect(
      fixture.service.upsertSnapshot(input('running', [divergent])),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.state.events).toEqual([
      expect.objectContaining({ id: original.id, sequence: 1 }),
    ]);
  });

  it('rejects a divergent stale prefix instead of disguising split brain as success', async () => {
    const fixture = createFixture();
    const started = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });
    const user = event(2, 'UserMessage', {
      messageId: 'user-message-1',
      turnId: TURN_ID,
      text: 'Build an interactive film.',
    });
    const completed = event(3, 'RunCompleted', {
      turnId: TURN_ID,
      status: 'completed',
    });
    await fixture.service.upsertSnapshot(
      input('completed', [started, user, completed]),
    );

    await expect(
      fixture.service.upsertSnapshot(
        input('running', [
          {
            ...started,
            id: '99999999-9999-4999-8999-999999999999',
          },
        ]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects status projections not proven by lifecycle events', async () => {
    const fixture = createFixture();
    const started = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });
    const messageStarted = event(2, 'MessageStarted', {
      turnId: TURN_ID,
      messageId: 'assistant-message-1',
      segmentKind: 'response',
    });
    const delta = event(3, 'MessageDelta', {
      turnId: TURN_ID,
      messageId: 'assistant-message-1',
      delta: 'Still working',
    });

    await expect(
      fixture.service.upsertSnapshot(
        input('completed', [started, messageStarted, delta]),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_REPORTED_STATUS_DIVERGED',
      }),
    });
  });

  it('rejects a claimed lastSequence that is not the transmitted event tail', async () => {
    const fixture = createFixture();
    const started = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });

    await expect(
      fixture.service.upsertSnapshot({
        ...input('running', [started]),
        reportedLastSequence: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.state.events).toEqual([]);
  });

  it('appends an external result exactly once across delivery retries', async () => {
    const fixture = createFixture();
    const started = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });
    const handoff = event(2, 'ToolCompleted', {
      turnId: TURN_ID,
      toolCallId: 'story-author-call-1',
      toolId: 'story.author',
      agentHandoff: {
        kind: 'external_job',
        jobId: EXTERNAL_JOB_ID,
        startedMessage: 'I am preparing the story proposal now.',
      },
    });
    const paused = event(3, 'RunPaused', {
      turnId: TURN_ID,
      status: 'waiting_for_external',
      externalJobId: EXTERNAL_JOB_ID,
      toolCallId: 'story-author-call-1',
      toolId: 'story.author',
    });
    await fixture.service.upsertSnapshot(
      input('waiting_for_external', [started, handoff, paused]),
    );

    const payload = {
      runId: RUN_ID,
      turnId: TURN_ID,
      toolCallId: 'story-author-call-1',
      toolId: 'story.author',
      externalJobId: EXTERNAL_JOB_ID,
      phase: 'authoring' as const,
      text: 'The proposal is ready for review.',
      outcome: 'completed' as const,
    };
    const first = await fixture.service.appendExternalResult(payload);
    const retried = await fixture.service.appendExternalResult(payload);

    expect(first.events.map((item) => item.type)).toEqual([
      'RunResumed',
      'MessageStarted',
      'MessageDelta',
      'MessageCompleted',
      'RunCompleted',
    ]);
    expect(retried.events).toEqual([]);
    expect(fixture.state.run?.status).toBe('completed');
    expect(fixture.state.events).toHaveLength(8);

    await expect(
      fixture.service.appendExternalResult({
        ...payload,
        text: 'A different terminal result must not be accepted.',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_EXTERNAL_RESULT_CONFLICT',
      }),
    });
  });

  it('repairs a stale external wait projection before retrying its continuation', async () => {
    const fixture = createFixture();
    const toolCallId = 'story-author-call-1';
    const events = [
      event(1, 'RunStarted', {
        turnId: TURN_ID,
        status: 'running',
        workspaceType: 'story',
        modelProfileId: 'qwen-plus',
      }),
      event(2, 'ToolCompleted', {
        turnId: TURN_ID,
        toolCallId,
        toolId: 'story.author',
        agentHandoff: {
          kind: 'external_job',
          jobId: EXTERNAL_JOB_ID,
          startedMessage: 'Preparing a reviewable proposal.',
        },
      }),
      event(3, 'RunPaused', {
        turnId: TURN_ID,
        status: 'waiting_for_external',
        externalJobId: EXTERNAL_JOB_ID,
        toolCallId,
        toolId: 'story.author',
      }),
      event(4, 'RunResumed', {
        turnId: TURN_ID,
        reason: 'external_job_completed',
        externalJobId: EXTERNAL_JOB_ID,
      }),
      // Legacy checkpoint replay: immutable evidence, but no longer allowed
      // to move the canonical projection back to waiting.
      event(5, 'RunPaused', {
        turnId: TURN_ID,
        status: 'waiting_for_external',
        externalJobId: EXTERNAL_JOB_ID,
        toolCallId,
        toolId: 'story.author',
      }),
    ];
    fixture.state.events = events.map((item) =>
      storedEvent({
        ...item,
        occurredAt: new Date(item.timestamp),
      }),
    );
    if (!fixture.state.run) throw new Error('run missing');
    Object.assign(fixture.state.run, {
      status: 'waiting_for_external',
      lastSequence: 5,
      pendingExternal: {
        kind: 'external_job',
        jobId: EXTERNAL_JOB_ID,
        turnId: TURN_ID,
        toolCallId,
        toolId: 'story.author',
        startedMessage: 'Preparing a reviewable proposal.',
      },
      continuationCommand: externalResultContinuationCommand(toolCallId),
      continuationExecutionToken: '88888888-8888-4888-8888-888888888888',
      continuationExecutionAttemptId: null,
      continuationExecutionLeaseExpiresAt: null,
      continuationExecutionFinishedAt: null,
      continuationDispatchNextAttemptAt: fixture.state.now,
    });

    const claim = await fixture.service.claimRunContinuationDispatch(RUN_ID);

    expect(claim).toMatchObject({ kind: 'claimed', executionEpoch: 1 });
    expect(fixture.state.run).toMatchObject({
      status: 'running',
      pendingExternal: null,
      continuationExecutionEpoch: 1,
    });
  });

  it('does not let an equal-tail report erase a pending external decision', async () => {
    const fixture = createFixture();
    const started = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });
    const handoff = event(2, 'ToolCompleted', {
      turnId: TURN_ID,
      toolCallId: 'story-author-call-1',
      toolId: 'story.author',
      agentHandoff: {
        kind: 'external_job',
        jobId: EXTERNAL_JOB_ID,
        startedMessage: 'I am preparing the story proposal now.',
      },
    });
    const paused = event(3, 'RunPaused', {
      turnId: TURN_ID,
      status: 'waiting_for_external',
      externalJobId: EXTERNAL_JOB_ID,
      toolCallId: 'story-author-call-1',
      toolId: 'story.author',
    });
    const events = [started, handoff, paused];
    await fixture.service.upsertSnapshot(input('waiting_for_external', events));

    await fixture.service.upsertSnapshot({
      ...input('waiting_for_external', events),
      pendingExternal: null,
      assistantText: 'forged replacement',
    });

    expect(fixture.state.run?.pendingExternal).toMatchObject({
      jobId: EXTERNAL_JOB_ID,
      toolCallId: 'story-author-call-1',
    });
    expect(fixture.state.run?.assistantText).not.toBe('forged replacement');
  });

  it('keeps a v2 Story proposal nonterminal and resumes approval on a new decision turn', async () => {
    const fixture = createFixture();
    const handoff = event(2, 'ToolCompleted', {
      turnId: TURN_ID,
      toolCallId: 'story-author-call-1',
      toolId: 'story.author',
      agentHandoff: {
        kind: 'external_job',
        jobId: EXTERNAL_JOB_ID,
        startedMessage: 'I am preparing the story proposal now.',
      },
    });
    await fixture.service.upsertSnapshot(
      input('waiting_for_external', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
        handoff,
        event(3, 'RunPaused', {
          turnId: TURN_ID,
          status: 'waiting_for_external',
          externalJobId: EXTERNAL_JOB_ID,
          toolCallId: 'story-author-call-1',
          toolId: 'story.author',
        }),
      ]),
    );

    const ready = await fixture.service.appendStoryProposalReadyInTransaction(
      fixture.tx as never,
      {
        runId: RUN_ID,
        turnId: TURN_ID,
        authorToolCallId: 'story-author-call-1',
        externalJobId: EXTERNAL_JOB_ID,
        ...STORY_PROPOSAL_ARTIFACT,
        text: 'The proposal is ready for review.',
        title: 'Late Ming interactive film',
        summary: 'A branching survival drama.',
      },
    );
    const readyInput = {
      runId: RUN_ID,
      turnId: TURN_ID,
      authorToolCallId: 'story-author-call-1',
      externalJobId: EXTERNAL_JOB_ID,
      ...STORY_PROPOSAL_ARTIFACT,
      text: 'The proposal is ready for review.',
      title: 'Late Ming interactive film',
      summary: 'A branching survival drama.',
    };
    const readyDuplicate =
      await fixture.service.appendStoryProposalReadyInTransaction(
        fixture.tx as never,
        readyInput,
      );

    expect(ready.events.map((item) => item.type)).toEqual([
      'RunResumed',
      'MessageStarted',
      'MessageDelta',
      'MessageCompleted',
      'ArtifactCreated',
      'ToolProposed',
      'ApprovalRequired',
      'RunPaused',
    ]);
    expect(fixture.state.run).toMatchObject({
      status: 'waiting_for_approval',
      pendingApproval: {
        approvalId: storyProposalApprovalId(EXTERNAL_JOB_ID),
        turnId: TURN_ID,
        toolId: 'story.applyProposal',
      },
    });
    expect(ready.events.some((item) => item.type === 'RunCompleted')).toBe(
      false,
    );
    expect(readyDuplicate.events).toEqual([]);
    await expect(
      fixture.service.appendStoryProposalReadyInTransaction(
        fixture.tx as never,
        { ...readyInput, summary: 'A divergent proposal summary.' },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_STORY_PROPOSAL_APPROVAL_CONFLICT',
      }),
    });

    const responseId = '88888888-8888-4888-8888-888888888888';
    const decision = {
      runId: RUN_ID,
      approvalTurnId: TURN_ID,
      storyRunId: EXTERNAL_JOB_ID,
      approvalId: storyProposalApprovalId(EXTERNAL_JOB_ID),
      responseId,
      decision: 'approve' as const,
      locale: 'en-US' as const,
      userText: 'Apply this proposal.',
      assistantText: 'I received your approval and will apply it now.',
      applyStartedMessage: 'Applying the approved proposal.',
    };
    const approved =
      await fixture.service.appendStoryProposalDecisionInTransaction(
        fixture.tx as never,
        decision,
      );
    const duplicate =
      await fixture.service.appendStoryProposalDecisionInTransaction(
        fixture.tx as never,
        decision,
      );
    const decisionTurnId = storyProposalDecisionTurnId(responseId);

    expect(approved.events.map((item) => item.type)).toEqual([
      'UserMessage',
      'ApprovalResolved',
      'ArtifactUpdated',
      'RunResumed',
      'MessageStarted',
      'MessageDelta',
      'MessageCompleted',
      'ToolStarted',
      'ToolCompleted',
      'RunPaused',
    ]);
    expect(
      approved.events
        .filter((item) => item.type !== 'ApprovalRequired')
        .map((item) => item.data.turnId),
    ).toEqual(Array(approved.events.length).fill(decisionTurnId));
    expect(duplicate.events).toEqual([]);
    expect(fixture.state.run).toMatchObject({
      status: 'waiting_for_external',
      pendingApproval: null,
      pendingExternal: {
        jobId: EXTERNAL_JOB_ID,
        turnId: decisionTurnId,
        toolId: 'story.applyProposal',
      },
    });
    expect(approved.events.some((item) => item.type === 'RunCompleted')).toBe(
      false,
    );

    const applied = await fixture.service.appendExternalResultInTransaction(
      fixture.tx as never,
      {
        runId: RUN_ID,
        turnId: decisionTurnId,
        toolCallId: storyProposalApplyToolCallId(EXTERNAL_JOB_ID),
        toolId: 'story.applyProposal',
        externalJobId: EXTERNAL_JOB_ID,
        phase: 'apply',
        text: 'The approved proposal was applied.',
        outcome: 'completed',
      },
    );
    const appliedRetry =
      await fixture.service.appendExternalResultInTransaction(
        fixture.tx as never,
        {
          runId: RUN_ID,
          turnId: decisionTurnId,
          toolCallId: storyProposalApplyToolCallId(EXTERNAL_JOB_ID),
          toolId: 'story.applyProposal',
          externalJobId: EXTERNAL_JOB_ID,
          phase: 'apply',
          text: 'The approved proposal was applied.',
          outcome: 'completed',
        },
      );
    expect(applied.events.map((item) => item.type)).toEqual([
      'RunResumed',
      'ArtifactUpdated',
      'MessageStarted',
      'MessageDelta',
      'MessageCompleted',
    ]);
    expect(appliedRetry.events).toEqual([]);
    expect(fixture.state.run).toMatchObject({
      status: 'running',
      pendingExternal: null,
      continuationCommand: expect.objectContaining({
        kind: 'external_result',
        externalJobId: EXTERNAL_JOB_ID,
        toolId: 'story.applyProposal',
        phase: 'apply',
        outcome: 'completed',
      }),
      continuationExecutionToken: expect.any(String),
      continuationDispatchNextAttemptAt: expect.any(Date),
    });
    expect(
      fixture.state.events.filter((item) => item.type === 'ToolCompleted'),
    ).toHaveLength(2);

    await expect(
      fixture.service.appendStoryProposalDecisionInTransaction(
        fixture.tx as never,
        {
          ...decision,
          assistantText: 'A divergent acknowledgement.',
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_STORY_PROPOSAL_RESPONSE_CONFLICT',
      }),
    });
  });

  it('replays a Story proposal closure only for the exact durable payload', async () => {
    const fixture = createFixture();
    await fixture.service.upsertSnapshot(
      input('waiting_for_external', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
        event(2, 'ToolCompleted', {
          turnId: TURN_ID,
          toolCallId: 'story-author-call-1',
          toolId: 'story.author',
          agentHandoff: {
            kind: 'external_job',
            jobId: EXTERNAL_JOB_ID,
            startedMessage: 'I am preparing the story proposal now.',
          },
        }),
        event(3, 'RunPaused', {
          turnId: TURN_ID,
          status: 'waiting_for_external',
          externalJobId: EXTERNAL_JOB_ID,
          toolCallId: 'story-author-call-1',
          toolId: 'story.author',
        }),
      ]),
    );
    await fixture.service.appendStoryProposalReadyInTransaction(
      fixture.tx as never,
      {
        runId: RUN_ID,
        turnId: TURN_ID,
        authorToolCallId: 'story-author-call-1',
        externalJobId: EXTERNAL_JOB_ID,
        ...STORY_PROPOSAL_ARTIFACT,
        text: 'The proposal is ready for review.',
        title: 'Story draft',
        summary: 'A branching story.',
      },
    );
    const closure = {
      runId: RUN_ID,
      turnId: TURN_ID,
      storyRunId: EXTERNAL_JOB_ID,
      approvalId: storyProposalApprovalId(EXTERNAL_JOB_ID),
      outcome: 'cancelled' as const,
      code: 'STORY_AGENT_SUPERSEDED',
      text: 'A newer proposal superseded this one.',
    };

    const first = await fixture.service.appendStoryProposalClosureInTransaction(
      fixture.tx as never,
      closure,
    );
    const duplicate =
      await fixture.service.appendStoryProposalClosureInTransaction(
        fixture.tx as never,
        closure,
      );

    expect(first.events.map((item) => item.type)).toEqual([
      'ArtifactUpdated',
      'ToolFailed',
      'MessageStarted',
      'MessageDelta',
      'MessageCompleted',
      'RunCancelled',
    ]);
    expect(duplicate.events).toEqual([]);
    for (const divergent of [
      { ...closure, text: 'A different closure message.' },
      { ...closure, outcome: 'failed' as const },
      {
        ...closure,
        approvalId: '99999999-9999-4999-8999-999999999999',
      },
      { ...closure, turnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    ]) {
      await expect(
        fixture.service.appendStoryProposalClosureInTransaction(
          fixture.tx as never,
          divergent,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'AGENT_OS_STORY_PROPOSAL_CLOSURE_CONFLICT',
        }),
      });
    }
  });

  it('fails closed when a closure retry targets an unrelated terminal run', async () => {
    const fixture = createFixture();
    await fixture.service.upsertSnapshot(
      input('completed', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
        event(2, 'RunCompleted', {
          turnId: TURN_ID,
          status: 'completed',
        }),
      ]),
    );

    await expect(
      fixture.service.appendStoryProposalClosureInTransaction(
        fixture.tx as never,
        {
          runId: RUN_ID,
          turnId: TURN_ID,
          storyRunId: EXTERNAL_JOB_ID,
          approvalId: storyProposalApprovalId(EXTERNAL_JOB_ID),
          outcome: 'cancelled',
          code: 'STORY_AGENT_SUPERSEDED',
          text: 'A newer proposal superseded this one.',
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_STORY_PROPOSAL_CLOSURE_CONFLICT',
      }),
    });
  });

  it('claims a structured-input response once without holding a network transaction', async () => {
    const fixture = createFixture();
    const requestId = '88888888-8888-4888-8888-888888888888';
    const responseId = '99999999-9999-4999-8999-999999999999';
    const events = waitingInputEvents(requestId);
    await fixture.service.upsertSnapshot(input('waiting_for_input', events));

    const first = await fixture.service.claimUserInputResponse({
      runId: RUN_ID,
      requestId,
      responseId,
      answers: { aspect_ratio: 'landscape_16_9' },
    });
    const duplicate = await fixture.service.claimUserInputResponse({
      runId: RUN_ID,
      requestId,
      responseId,
      answers: { aspect_ratio: 'landscape_16_9' },
    });

    expect(first.kind).toBe('claimed');
    expect(duplicate.kind).toBe('in_flight');
  });

  it('fences a late structured-input suffix after another response takes over the expired claim', async () => {
    const fixture = createFixture();
    const requestId = '88888888-8888-4888-8888-888888888888';
    const responseA = '99999999-9999-4999-8999-999999999991';
    const responseB = '99999999-9999-4999-8999-999999999992';
    const waiting = waitingInputEvents(requestId);
    await fixture.service.upsertSnapshot(input('waiting_for_input', waiting));

    await fixture.service.claimUserInputResponse({
      runId: RUN_ID,
      requestId,
      responseId: responseA,
      answers: { aspect_ratio: 'portrait_9_16' },
      leaseDurationMs: 5_000,
    });
    fixture.state.now = new Date(fixture.state.now.getTime() + 5_001);
    await expect(
      fixture.service.claimUserInputResponse({
        runId: RUN_ID,
        requestId,
        responseId: responseB,
        answers: { aspect_ratio: 'landscape_16_9' },
        leaseDurationMs: 5_000,
      }),
    ).resolves.toMatchObject({ kind: 'claimed' });

    await expect(
      fixture.service.upsertSnapshot(
        continuationInput(
          userInputResponseEvents(waiting, requestId, responseA, {
            aspect_ratio: 'portrait_9_16',
          }),
          requestId,
          responseA,
          { aspect_ratio: 'portrait_9_16' },
        ),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_INPUT_RESPONSE_NOT_CLAIMED',
      }),
    });
    expect(fixture.state.events).toHaveLength(waiting.length);
    expect(fixture.state.run).toMatchObject({
      inputResponseId: responseB,
      inputRequestId: requestId,
    });

    await expect(
      fixture.service.upsertSnapshot(
        continuationInput(
          userInputResponseEvents(waiting, requestId, responseB, {
            aspect_ratio: 'landscape_16_9',
          }),
          requestId,
          responseB,
          { aspect_ratio: 'landscape_16_9' },
        ),
      ),
    ).resolves.toMatchObject({ status: 'running' });
    expect(fixture.state.run).toMatchObject({
      inputResponseId: null,
      continuationExecutionToken: expect.any(String),
    });
  });

  it('rejects incomplete continuation message-flow suffixes before admitting a command', async () => {
    const requestId = '88888888-8888-4888-8888-888888888888';
    const responseId = '99999999-9999-4999-8999-999999999999';
    const answers = { aspect_ratio: 'landscape_16_9' };
    const cases: Array<{
      name: string;
      mutate(events: AgentEventEnvelope[]): AgentEventEnvelope[];
    }> = [
      {
        name: 'missing UserMessage',
        mutate: (events) =>
          resequence(events.filter((event) => event.type !== 'UserMessage')),
      },
      {
        name: 'missing RunResumed',
        mutate: (events) =>
          resequence(events.filter((event) => event.type !== 'RunResumed')),
      },
      {
        name: 'completion for another acknowledgement message',
        mutate: (events) =>
          events.map((event) =>
            event.type === 'MessageCompleted'
              ? {
                  ...event,
                  data: {
                    ...event.data,
                    messageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                  },
                }
              : event,
          ),
      },
    ];

    for (const scenario of cases) {
      const fixture = createFixture();
      const waiting = waitingInputEvents(requestId);
      await fixture.service.upsertSnapshot(input('waiting_for_input', waiting));
      await fixture.service.claimUserInputResponse({
        runId: RUN_ID,
        requestId,
        responseId,
        answers,
      });
      const malformed = scenario.mutate(
        userInputResponseEvents(waiting, requestId, responseId, answers),
      );

      await expect(
        fixture.service.upsertSnapshot(
          continuationInput(malformed, requestId, responseId, answers),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(fixture.state.events).toHaveLength(waiting.length);
      expect(fixture.state.run?.continuationCommand).toBeFalsy();
    }
  });

  it('claims a generic approval once and fences a concurrent different response', async () => {
    const fixture = createFixture();
    const approvalId = '88888888-8888-4888-8888-888888888888';
    const responseId = '99999999-9999-4999-8999-999999999999';
    await fixture.service.upsertSnapshot(
      input('waiting_for_approval', waitingApprovalEvents(approvalId)),
    );

    const first = await fixture.service.claimApprovalResponse({
      runId: RUN_ID,
      approvalId,
      responseId,
      decision: 'approve',
      responseText: 'Approved',
      locale: 'en-US',
    });
    const duplicate = await fixture.service.claimApprovalResponse({
      runId: RUN_ID,
      approvalId,
      responseId,
      decision: 'approve',
      responseText: 'Approved',
      locale: 'en-US',
    });

    expect(first.kind).toBe('claimed');
    expect(duplicate.kind).toBe('in_flight');
    await expect(
      fixture.service.claimApprovalResponse({
        runId: RUN_ID,
        approvalId,
        responseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        decision: 'reject',
        responseText: 'Rejected',
        locale: 'en-US',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_APPROVAL_RESPONSE_IN_FLIGHT',
      }),
    });
  });

  it('accepts only the claimed generic ApprovalResolved suffix and clears its lease', async () => {
    const fixture = createFixture();
    const approvalId = '88888888-8888-4888-8888-888888888888';
    const responseId = '99999999-9999-4999-8999-999999999999';
    const waiting = waitingApprovalEvents(approvalId);
    const resolved = approvalResponseEvents(waiting, approvalId, responseId);
    await fixture.service.upsertSnapshot(
      input('waiting_for_approval', waiting),
    );

    await expect(
      fixture.service.upsertSnapshot(input('running', resolved)),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_APPROVAL_RESPONSE_NOT_CLAIMED',
      }),
    });
    await fixture.service.claimApprovalResponse({
      runId: RUN_ID,
      approvalId,
      responseId,
      decision: 'approve',
      responseText: 'Approved',
      locale: 'en-US',
    });
    await fixture.service.upsertSnapshot(input('running', resolved));

    expect(fixture.state.run).toMatchObject({
      status: 'running',
      approvalResponseId: null,
      approvalId: null,
      approvalFingerprint: null,
      approvalResponseLeaseId: null,
      approvalResponseLeaseExpiresAt: null,
    });
    await expect(
      fixture.service.claimApprovalResponse({
        runId: RUN_ID,
        approvalId,
        responseId,
        decision: 'approve',
        responseText: 'Approved',
        locale: 'en-US',
      }),
    ).resolves.toMatchObject({ kind: 'resolved' });
  });

  it('rejects a Worker Story approval even when no generic claim is present', async () => {
    const fixture = createFixture();
    const handoff = event(2, 'ToolCompleted', {
      turnId: TURN_ID,
      toolCallId: 'story-author-call-1',
      toolId: 'story.author',
      agentHandoff: {
        kind: 'external_job',
        jobId: EXTERNAL_JOB_ID,
        startedMessage: 'I am preparing the story proposal now.',
      },
    });
    await fixture.service.upsertSnapshot(
      input('waiting_for_external', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
        handoff,
        event(3, 'RunPaused', {
          turnId: TURN_ID,
          status: 'waiting_for_external',
          externalJobId: EXTERNAL_JOB_ID,
          toolCallId: 'story-author-call-1',
          toolId: 'story.author',
        }),
      ]),
    );
    const ready = await fixture.service.appendStoryProposalReadyInTransaction(
      fixture.tx as never,
      {
        runId: RUN_ID,
        turnId: TURN_ID,
        authorToolCallId: 'story-author-call-1',
        externalJobId: EXTERNAL_JOB_ID,
        ...STORY_PROPOSAL_ARTIFACT,
        text: 'The proposal is ready for review.',
        title: 'Story proposal',
        summary: 'A branching story proposal.',
      },
    );
    const approvalId = storyProposalApprovalId(EXTERNAL_JOB_ID);
    const responseId = '99999999-9999-4999-8999-999999999999';
    await expect(
      fixture.service.claimApprovalResponse({
        runId: RUN_ID,
        approvalId,
        responseId,
        decision: 'approve',
        responseText: 'Approved',
        locale: 'en-US',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_STORY_APPROVAL_COORDINATOR_REQUIRED',
      }),
    });
    const workerResolution = [
      ...fixture.state.events.map(storedEventToEnvelope),
      ...approvalResponseEvents(
        [],
        approvalId,
        responseId,
        ready.snapshot.lastSequence,
      ),
    ];

    await expect(
      fixture.service.upsertSnapshot(input('running', workerResolution)),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_STORY_APPROVAL_COORDINATOR_REQUIRED',
      }),
    });
  });

  it('does not attach a result to a run that has not durably handed off', async () => {
    const fixture = createFixture();
    await fixture.service.upsertSnapshot(
      input('running', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
      ]),
    );

    await expect(
      fixture.service.appendExternalResult({
        runId: RUN_ID,
        turnId: TURN_ID,
        toolCallId: 'story-author-call-1',
        toolId: 'story.author',
        externalJobId: EXTERNAL_JOB_ID,
        phase: 'authoring',
        text: 'Must not be appended.',
        outcome: 'completed',
      }),
    ).rejects.toBeInstanceOf(AgentOsContinuationNotReadyError);
    expect(fixture.state.events).toHaveLength(1);
  });

  it('durably closes an open assistant segment and cancels exactly once', async () => {
    const fixture = createFixture();
    const started = event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    });
    const messageStarted = event(2, 'MessageStarted', {
      turnId: TURN_ID,
      messageId: 'assistant-message-1',
      segmentKind: 'response',
    });
    const delta = event(3, 'MessageDelta', {
      turnId: TURN_ID,
      messageId: 'assistant-message-1',
      delta: 'Partial answer',
    });
    await fixture.service.upsertSnapshot(
      input('running', [started, messageStarted, delta]),
    );

    const first = await fixture.service.cancelRun({
      runId: RUN_ID,
      reason: 'Stopped by user',
    });
    const duplicate = await fixture.service.cancelRun({
      runId: RUN_ID,
      reason: 'A later retry must not rewrite the terminal reason',
    });

    expect(first.events.map((item) => item.type)).toEqual([
      'MessageCompleted',
      'RunCancelled',
    ]);
    expect(first.events[0]?.data).toMatchObject({
      messageId: 'assistant-message-1',
      text: 'Partial answer',
      finishReason: 'cancelled',
    });
    expect(duplicate.events).toEqual([]);
    expect(fixture.state.run?.status).toBe('cancelled');
    expect(fixture.state.events).toHaveLength(5);
  });

  it('recovers a registered external handoff when the Worker dies before RunPaused', async () => {
    const fixture = createFixture();
    await fixture.service.upsertSnapshot(
      input('running', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
      ]),
    );

    const recovered =
      await fixture.service.reconcileExternalHandoff(EXTERNAL_JOB_ID);
    const duplicate =
      await fixture.service.reconcileExternalHandoff(EXTERNAL_JOB_ID);

    expect(recovered.events.map((item) => item.type)).toEqual([
      'ToolCompleted',
      'MessageStarted',
      'MessageDelta',
      'MessageCompleted',
      'RunPaused',
    ]);
    expect(duplicate.events).toEqual([]);
    expect(fixture.state.run).toMatchObject({
      status: 'waiting_for_external',
      pendingExternal: {
        jobId: EXTERNAL_JOB_ID,
        turnId: TURN_ID,
        toolCallId: 'story-author-call-1',
        toolId: 'story.author',
      },
    });
  });

  it('restores the actionable generation batch card once after a worker crash', async () => {
    const fixture = createFixture();
    const registration =
      await fixture.tx.agentOsExternalHandoffRegistration.findUnique({
        where: { externalJobId: EXTERNAL_JOB_ID },
      });
    fixture.tx.agentOsExternalHandoffRegistration.findUnique.mockResolvedValue({
      ...registration!,
      generationBatchId: EXTERNAL_JOB_ID,
      sourceToolId: 'story.confirmGenerationBatch',
    });
    await fixture.service.upsertSnapshot(
      input('running', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
      ]),
    );
    const recovered =
      await fixture.service.reconcileExternalHandoff(EXTERNAL_JOB_ID);
    expect(
      recovered.events.filter((item) => item.type === 'ArtifactCreated'),
    ).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          artifactId: EXTERNAL_JOB_ID,
          artifact: {
            kind: 'story_generation_batch',
            generationBatchId: EXTERNAL_JOB_ID,
            storyProjectId: PROJECT_ID,
            storyChapterId: CHAPTER_ID,
            schemaVersion: 'story-generation-batch-artifact/v1',
          },
        }),
      }),
    ]);
    expect(
      (await fixture.service.reconcileExternalHandoff(EXTERNAL_JOB_ID)).events,
    ).toEqual([]);
  });

  it('does not replay a resolved handoff over a later running turn', async () => {
    const fixture = createFixture();
    await fixture.service.upsertSnapshot(
      input('running', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
        event(2, 'ToolCompleted', {
          turnId: TURN_ID,
          toolCallId: 'story-author-call-1',
          toolId: 'story.author',
          agentHandoff: {
            kind: 'external_job',
            jobId: EXTERNAL_JOB_ID,
            startedMessage: 'Working',
          },
        }),
        event(3, 'RunPaused', {
          turnId: TURN_ID,
          status: 'waiting_for_external',
          externalJobId: EXTERNAL_JOB_ID,
          toolCallId: 'story-author-call-1',
          toolId: 'story.author',
        }),
        event(4, 'RunResumed', {
          turnId: TURN_ID,
          reason: 'external_job_completed',
          externalJobId: EXTERNAL_JOB_ID,
        }),
      ]),
    );
    const recovered =
      await fixture.service.reconcileExternalHandoff(EXTERNAL_JOB_ID);
    expect(recovered.events).toEqual([]);
    expect(fixture.state.run?.status).toBe('running');
    expect(fixture.state.events).toHaveLength(4);
  });

  it.each([
    'startExecutionLeaseExpiresAt',
    'continuationExecutionLeaseExpiresAt',
  ] as const)('does not recover while a Worker owns %s', async (field) => {
    const fixture = createFixture();
    await fixture.service.upsertSnapshot(
      input('running', [
        event(1, 'RunStarted', {
          turnId: TURN_ID,
          status: 'running',
          workspaceType: 'story',
          modelProfileId: 'qwen-plus',
        }),
      ]),
    );
    fixture.state.run![field] = new Date(fixture.state.now.getTime() + 60_000);
    expect(
      (await fixture.service.reconcileExternalHandoff(EXTERNAL_JOB_ID)).events,
    ).toEqual([]);
    fixture.state.run![field] = new Date(fixture.state.now.getTime() - 1);
    expect(
      (await fixture.service.reconcileExternalHandoff(EXTERNAL_JOB_ID)).snapshot
        .status,
    ).toBe('waiting_for_external');
  });

  it('restores the newest bounded tail and keeps the latest waiting interaction after more than the limit', async () => {
    const requestId = '99999999-9999-4999-8999-999999999999';
    const rows = Array.from({ length: 45 }, (_, offset) => {
      const ordinal = offset + 1;
      const runId = `90000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
      const createdAt = new Date(Date.UTC(2026, 7, 20, 12, 0, ordinal));
      const isLatest = ordinal === 45;
      return {
        id: runId,
        projectId: PROJECT_ID,
        actorId: 'user-1',
        conversationId: CONVERSATION_ID,
        status: isLatest ? 'waiting_for_input' : 'completed',
        modelProfileId: 'qwen-plus',
        pendingApproval: null,
        pendingExternal: null,
        assistantText: null,
        createdAt,
        updatedAt: createdAt,
        events: isLatest
          ? [
              {
                id: '91000000-0000-4000-8000-000000000001',
                runId,
                conversationId: CONVERSATION_ID,
                sequence: 1,
                protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
                sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
                type: 'UserInputRequired',
                data: {
                  turnId: TURN_ID,
                  requestId,
                  toolCallId: 'request-input-call-latest',
                  resumeAcknowledgement: 'Thanks — I have your choice.',
                  questions: [
                    {
                      id: 'aspect_ratio',
                      header: 'Aspect ratio',
                      question: 'Which frame should this story use?',
                      options: [
                        {
                          value: 'landscape_16_9',
                          label: '16:9 landscape',
                        },
                      ],
                    },
                  ],
                },
                occurredAt: createdAt,
              },
              {
                id: '91000000-0000-4000-8000-000000000002',
                runId,
                conversationId: CONVERSATION_ID,
                sequence: 2,
                protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
                sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
                type: 'RunPaused',
                data: { turnId: TURN_ID, status: 'waiting_for_input' },
                occurredAt: createdAt,
              },
            ]
          : [],
      };
    });
    const findMany = jest.fn(
      async ({
        orderBy,
        take,
      }: {
        orderBy: Array<{ createdAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>;
        take: number;
      }) => {
        const descending = orderBy[0]?.createdAt === 'desc';
        return [...rows]
          .sort((left, right) =>
            descending
              ? right.createdAt.getTime() - left.createdAt.getTime()
              : left.createdAt.getTime() - right.createdAt.getTime(),
          )
          .slice(0, take);
      },
    );
    const service = new AgentOsRunJournalService(
      {
        agentOsRun: {
          findMany,
          findFirst: jest.fn(),
        },
      } as never,
      { schedule: jest.fn() } as never,
    );

    const history = await service.getConversationHistory({
      projectId: PROJECT_ID,
      actorId: 'user-1',
      conversationId: CONVERSATION_ID,
      limit: 40,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 40,
      }),
    );
    expect(history.runs).toHaveLength(40);
    expect(history.runs[0]?.runId).toBe('90000000-0000-4000-8000-000000000006');
    expect(history.runs.at(-1)).toMatchObject({
      runId: '90000000-0000-4000-8000-000000000045',
      status: 'waiting_for_input',
      pendingUserInput: expect.objectContaining({ requestId }),
    });
  });
});

describe('AgentOsRunJournalService start admission fencing', () => {
  it.each([
    ['false', 'story', 'active', false],
    ['true', 'platform', 'active', false],
    ['true', 'story', 'none', false],
    ['true', 'story', 'active', true],
  ] as const)(
    'isolates App admission (enabled=%s, kind=%s, App=%s)',
    async (enabled, kind, active, busy) => {
      const previous = process.env.APP_STORY_AGENT_ENABLED;
      process.env.APP_STORY_AGENT_ENABLED = enabled;
      try {
        const fixture = createFixture();
        fixture.state.run = null;
        fixture.state.events = [];
        fixture.tx.appStoryRun.findFirst.mockResolvedValue(
          active === 'active' ? { id: 'app-run' } : null,
        );
        const admission = fixture.service.reserveRunStart({
          ...startCommand(),
          projectKind: kind,
        });
        if (busy) {
          await expect(admission).rejects.toMatchObject({
            response: { code: 'APP_STORY_PROJECT_BUSY' },
          });
          expect(fixture.state.run).toBeNull();
        } else {
          await expect(admission).resolves.toMatchObject({ kind: 'created' });
        }
        if (enabled === 'true' && kind === 'story') {
          expect(fixture.tx.appStoryRun.findFirst).toHaveBeenCalledWith({
            where: {
              projectId: PROJECT_ID,
              status: {
                in: [
                  'queued',
                  'planning',
                  'producing',
                  'blocked',
                  'cancelling',
                ],
              },
            },
            select: { id: true },
          });
        } else {
          expect(fixture.tx.appStoryRun.findFirst).not.toHaveBeenCalled();
        }
      } finally {
        if (previous === undefined) delete process.env.APP_STORY_AGENT_ENABLED;
        else process.env.APP_STORY_AGENT_ENABLED = previous;
      }
    },
  );

  it('replays an existing Agent OS admission even if App work is now active', async () => {
    const previous = process.env.APP_STORY_AGENT_ENABLED;
    process.env.APP_STORY_AGENT_ENABLED = 'true';
    try {
      const fixture = createFixture();
      fixture.state.run = null;
      fixture.state.events = [];
      const first = await fixture.service.reserveRunStart(startCommand());
      fixture.tx.appStoryRun.findFirst.mockResolvedValue({ id: 'app-run' });
      fixture.tx.appStoryRun.findFirst.mockClear();
      await expect(
        fixture.service.reserveRunStart(startCommand()),
      ).resolves.toMatchObject({ kind: 'replay', runId: first.runId });
      expect(fixture.tx.appStoryRun.findFirst).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.APP_STORY_AGENT_ENABLED;
      else process.env.APP_STORY_AGENT_ENABLED = previous;
    }
  });

  it('reserves the exact strict UserMessage#1 before any Worker dispatch', async () => {
    const fixture = createFixture();
    fixture.state.run = null;
    fixture.state.events = [];

    const reservation = await fixture.service.reserveRunStart(startCommand());

    expect(reservation.kind).toBe('created');
    expect(reservation.events).toHaveLength(1);
    expect(reservation.events[0]).toMatchObject({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      sequence: 1,
      type: 'UserMessage',
      data: {
        turnId: TURN_ID,
        messageId: '66666666-6666-4666-8666-666666666666',
        text: 'Build an interactive film.',
        attachments: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            filename: 'source.md',
          },
        ],
      },
    });
    expect(fixture.state.run).toMatchObject({
      status: 'queued',
      lastSequence: 1,
      startAdmissionVersion: 2,
      clientSubmissionId: '55555555-5555-4555-8555-555555555555',
      startTurnId: TURN_ID,
      startUserMessageId: '66666666-6666-4666-8666-666666666666',
      submissionFingerprint: 'a'.repeat(64),
    });
  });

  it('replays the first run across a lost response even when dynamic resolver output changed', async () => {
    const fixture = createFixture();
    fixture.state.run = null;
    fixture.state.events = [];
    const first = await fixture.service.reserveRunStart(startCommand());
    const retry = await fixture.service.reserveRunStart({
      ...startCommand(),
      runId: '99999999-9999-4999-8999-999999999999',
      modelContext: 'Project state changed after the first execution.',
      skillMountSnapshot: {
        ...startCommand().skillMountSnapshot,
        resolutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        resolvedAt: '2026-08-21T12:00:00.000Z',
        checksum: 'b'.repeat(64),
      },
    });

    expect(retry).toMatchObject({ kind: 'replay', runId: first.runId });
    expect(fixture.state.run).toMatchObject({ id: RUN_ID });
    expect(fixture.state.events).toHaveLength(1);
  });

  it('rejects reuse of one actor/project submission id in another conversation', async () => {
    const fixture = createFixture();
    fixture.state.run = null;
    fixture.state.events = [];
    await fixture.service.reserveRunStart(startCommand());

    await expect(
      fixture.service.findRunStartSubmission({
        actorId: 'user-1',
        projectId: PROJECT_ID,
        clientSubmissionId: '55555555-5555-4555-8555-555555555555',
        conversationId: '99999999-9999-4999-8999-999999999999',
        submissionFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_START_SUBMISSION_CONFLICT',
      }),
    });
  });

  it('grants the first journal CAS and clears the command only with a checkpoint-backed pause', async () => {
    const fixture = createFixture();
    fixture.state.run = null;
    fixture.state.events = [];
    const reservation = await fixture.service.reserveRunStart(startCommand());
    const claim = await fixture.service.claimRunStartDispatch(RUN_ID);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('claim missing');
    const events = initialExecutionEvents(reservation.events[0]);
    events.push(
      startEvent(events[0], 4, 'UserInputRequired', {
        turnId: TURN_ID,
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        toolCallId: 'request-input-1',
        resumeAcknowledgement: 'Thanks — I will continue.',
        questions: [
          {
            id: 'ratio',
            header: 'Aspect ratio',
            question: 'Which ratio?',
            options: [
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ],
          },
        ],
      }),
      startEvent(events[0], 5, 'RunPaused', {
        turnId: TURN_ID,
        status: 'waiting_for_input',
      }),
    );
    const accepted = await fixture.service.upsertSnapshot(
      fencedInput('waiting_for_input', events, claim, 'checkpoint-pause-1'),
    );

    expect(accepted.startExecutionDisposition).toBe('granted');
    expect(fixture.state.run).toMatchObject({
      status: 'waiting_for_input',
      startCommand: null,
      startExecutionCheckpointId: 'checkpoint-pause-1',
      startExecutionCheckpointThreadId: CONVERSATION_ID,
      startExecutionCheckpointMessageId: '66666666-6666-4666-8666-666666666666',
    });
    expect(
      fixture.state.events.filter((item) => item.type === 'UserMessage'),
    ).toHaveLength(1);
  });

  it('accepts a newer checkpoint from the same owner and uses it to finish the start', async () => {
    const fixture = createFixture();
    fixture.state.run = null;
    fixture.state.events = [];
    const reservation = await fixture.service.reserveRunStart(startCommand());
    const claim = await fixture.service.claimRunStartDispatch(RUN_ID);
    if (claim.kind !== 'claimed') throw new Error('claim missing');
    const running = initialExecutionEvents(reservation.events[0]);
    await fixture.service.upsertSnapshot(
      fencedInput('running', running, claim, 'checkpoint-input-1'),
    );
    const completed = [
      ...running,
      startEvent(running[0], 4, 'RunCompleted', {
        turnId: TURN_ID,
        status: 'completed',
      }),
    ];
    const accepted = await fixture.service.upsertSnapshot(
      fencedInput('completed', completed, claim, 'checkpoint-terminal-2'),
    );

    expect(accepted.startExecutionDisposition).toBe('accepted');
    expect(fixture.state.run).toMatchObject({
      status: 'completed',
      startCommand: null,
      startExecutionCheckpointId: 'checkpoint-terminal-2',
    });
  });

  it('rejects the expired owner after a new epoch takes over', async () => {
    const fixture = createFixture();
    fixture.state.run = null;
    fixture.state.events = [];
    const reservation = await fixture.service.reserveRunStart(startCommand());
    const first = await fixture.service.claimRunStartDispatch(RUN_ID);
    if (first.kind !== 'claimed') throw new Error('first claim missing');
    const running = initialExecutionEvents(reservation.events[0]);
    await fixture.service.upsertSnapshot(
      fencedInput('running', running, first, 'checkpoint-input-1'),
    );
    fixture.state.now = new Date(fixture.state.now.getTime() + 4 * 60 * 1_000);
    const second = await fixture.service.claimRunStartDispatch(RUN_ID);
    if (second.kind !== 'claimed') throw new Error('second claim missing');

    await expect(
      fixture.service.upsertSnapshot(
        fencedInput('running', running, first, 'checkpoint-input-1'),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_START_EXECUTION_FENCED',
      }),
    });
    const accepted = await fixture.service.upsertSnapshot(
      fencedInput('running', running, second, 'checkpoint-input-1'),
    );
    expect(accepted.startExecutionDisposition).toBe('granted');
    expect(fixture.state.run).toMatchObject({ startExecutionEpoch: 2 });
  });

  it('fences a proofless continuation after the durable run is terminal', async () => {
    const fixture = createFixture();
    if (!fixture.state.run) throw new Error('run missing');
    fixture.state.run.status = 'cancelled';
    fixture.state.run.startAdmissionVersion = 2;
    fixture.state.run.startCommand = null;
    fixture.state.run.startExecutionFinishedAt = fixture.state.now;

    await expect(
      fixture.service.assertToolExecutionFenceInTx(fixture.tx as never, {
        runId: RUN_ID,
        conversationId: CONVERSATION_ID,
        projectId: PROJECT_ID,
        actorId: 'user-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AGENT_OS_START_EXECUTION_FENCED',
      }),
    });
  });

  it('allows a proofless continuation while the durable run is nonterminal', async () => {
    const fixture = createFixture();
    if (!fixture.state.run) throw new Error('run missing');
    fixture.state.run.status = 'waiting_for_approval';
    fixture.state.run.startAdmissionVersion = 2;
    fixture.state.run.startCommand = null;
    fixture.state.run.startExecutionFinishedAt = fixture.state.now;

    await expect(
      fixture.service.assertToolExecutionFenceInTx(fixture.tx as never, {
        runId: RUN_ID,
        conversationId: CONVERSATION_ID,
        projectId: PROJECT_ID,
        actorId: 'user-1',
      }),
    ).resolves.toBeUndefined();
  });
});

function startCommand() {
  return {
    runId: RUN_ID,
    clientSubmissionId: '55555555-5555-4555-8555-555555555555',
    submissionFingerprint: 'a'.repeat(64),
    turnId: TURN_ID,
    messageId: '66666666-6666-4666-8666-666666666666',
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    actorId: 'user-1',
    message: 'Build an interactive film.',
    modelContext: 'The project is empty.',
    modelProfileId: 'qwen-plus',
    attachmentIds: ['88888888-8888-4888-8888-888888888888'],
    attachments: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        filename: 'source.md',
      },
    ],
    permissionMode: 'smart' as const,
    projectKind: 'story' as const,
    workbenchMode: 'story-canvas',
    workbenchContext: { chapterId: 'chapter-1' },
    skillIds: ['story.edit'],
    projectSkillInstallationIds: ['99999999-9999-4999-8999-999999999999'],
    disabledDefaultSkillInstallationIds: [],
    skillMountSnapshot: {
      schemaVersion: 'project-skill-resolution/v1' as const,
      resolutionId: '77777777-7777-4777-8777-777777777777',
      ownerKind: 'story' as const,
      projectId: PROJECT_ID,
      projectRevision: 0,
      scope: 'agent_prompt' as const,
      workbenchMode: 'story-canvas',
      sourceSurface: 'agent_os:story-canvas',
      resolvedAt: '2026-08-20T12:00:00.000Z',
      skills: [],
      checksum: '0'.repeat(64),
    },
  };
}

function startEvent(
  admission: AgentEventEnvelope,
  sequence: number,
  type: AgentEventEnvelope['type'],
  data: Record<string, unknown>,
): AgentEventEnvelope {
  return {
    id: `70000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
    sessionId: admission.sessionId,
    runId: admission.runId,
    conversationId: admission.conversationId,
    sequence,
    timestamp: new Date(Date.UTC(2026, 7, 20, 12, 0, sequence)).toISOString(),
    type,
    data,
  };
}

function initialExecutionEvents(
  admission: AgentEventEnvelope,
): AgentEventEnvelope[] {
  return [
    admission,
    startEvent(admission, 2, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'project_canvas',
      modelProfileId: 'qwen-plus',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
      workbenchContext: { chapterId: 'chapter-1' },
    }),
    startEvent(admission, 3, 'StepStarted', {
      turnId: TURN_ID,
      step: 'permission',
      permissionMode: 'smart',
      agentMode: 'ASSIST',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
    }),
  ];
}

function fencedInput(
  status: AgentRunStatus,
  events: AgentEventEnvelope[],
  claim: {
    executionToken: string;
    executionAttemptId: string;
    executionEpoch: number;
  },
  checkpointId: string,
) {
  return {
    ...input(status, events),
    skillMountSnapshot: startCommand().skillMountSnapshot,
    startExecution: {
      executionToken: claim.executionToken,
      executionAttemptId: claim.executionAttemptId,
      executionEpoch: claim.executionEpoch,
      executionOwnerId:
        claim.executionEpoch === 1
          ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
          : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      checkpointId,
      checkpointNamespace: '',
      checkpointThreadId: CONVERSATION_ID,
      checkpointMessageId: '66666666-6666-4666-8666-666666666666',
    },
  };
}

function input(status: AgentRunStatus, events: AgentEventEnvelope[]) {
  return {
    runId: RUN_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    actorId: 'user-1',
    modelProfileId: 'qwen-plus',
    status,
    reportedLastSequence: events.at(-1)?.sequence ?? 0,
    events,
    projectKind: 'story' as const,
    workbenchMode: 'story-canvas',
    skillMountSnapshot: {} as never,
  };
}

function event(
  sequence: number,
  type: AgentEventEnvelope['type'],
  data: Record<string, unknown>,
): AgentEventEnvelope {
  return {
    id: EVENT_IDS[sequence - 1],
    protocolVersion: 'fizz.agent.v1',
    sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
    runId: RUN_ID,
    conversationId: CONVERSATION_ID,
    sequence,
    timestamp: new Date(Date.UTC(2026, 7, 20, 12, 0, sequence)).toISOString(),
    type,
    data,
  };
}

function waitingInputEvents(requestId: string): AgentEventEnvelope[] {
  return [
    event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    }),
    event(2, 'UserInputRequired', {
      turnId: TURN_ID,
      requestId,
      toolCallId: 'request-input-call-1',
      resumeAcknowledgement: 'Thanks — I have your choice.',
      questions: [
        {
          id: 'aspect_ratio',
          header: 'Aspect ratio',
          question: 'Which frame should this story use?',
          options: [
            { value: 'portrait_9_16', label: '9:16 portrait' },
            { value: 'landscape_16_9', label: '16:9 landscape' },
          ],
        },
      ],
    }),
    event(3, 'RunPaused', {
      turnId: TURN_ID,
      status: 'waiting_for_input',
    }),
  ];
}

function userInputResponseEvents(
  prefix: AgentEventEnvelope[],
  requestId: string,
  responseId: string,
  answers: Record<string, string>,
): AgentEventEnvelope[] {
  const turnId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const messageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const acknowledgementId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const base = prefix.length;
  const acknowledgement = 'Thanks — I have your choice.';
  return [
    ...prefix,
    event(base + 1, 'UserMessage', {
      turnId,
      messageId,
      text: `Aspect ratio: ${answers.aspect_ratio ?? ''}`,
      interaction: {
        kind: 'user_input',
        requestId,
        responseId,
        answers,
      },
    }),
    event(base + 2, 'UserInputResolved', {
      turnId,
      requestId,
      responseId,
      answers,
    }),
    event(base + 3, 'RunResumed', {
      turnId,
      reason: 'user_input_resolved',
      requestId,
    }),
    event(base + 4, 'MessageStarted', {
      turnId,
      messageId: acknowledgementId,
      segmentKind: 'acknowledgement',
    }),
    event(base + 5, 'MessageDelta', {
      turnId,
      messageId: acknowledgementId,
      delta: acknowledgement,
    }),
    event(base + 6, 'MessageCompleted', {
      turnId,
      messageId: acknowledgementId,
      text: acknowledgement,
      finishReason: 'stop',
    }),
  ];
}

function continuationInput(
  events: AgentEventEnvelope[],
  requestId: string,
  responseId: string,
  answers: Record<string, string>,
) {
  const responseTurnId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  return {
    ...input('running', events),
    continuationCommand: {
      kind: 'user_input' as const,
      runId: RUN_ID,
      turnId: responseTurnId,
      responseId,
      requestId,
      answers,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      actorId: 'user-1',
      modelProfileId: 'qwen-plus',
      projectKind: 'story' as const,
      workbenchMode: 'story-canvas',
      permissionMode: 'smart' as const,
      skillMountSnapshot: startCommand().skillMountSnapshot,
    },
  };
}

function externalResultContinuationCommand(toolCallId: string) {
  return {
    kind: 'external_result' as const,
    runId: RUN_ID,
    turnId: TURN_ID,
    responseId: '99999999-9999-4999-8999-999999999999',
    externalJobId: EXTERNAL_JOB_ID,
    toolCallId,
    toolId: 'story.author',
    resultMessageId: 'external-result-message',
    phase: 'apply' as const,
    outcome: 'completed' as const,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    actorId: 'user-1',
    modelProfileId: 'qwen-plus',
    projectKind: 'story' as const,
    workbenchMode: 'story-canvas',
    permissionMode: 'smart' as const,
    skillMountSnapshot: startCommand().skillMountSnapshot,
  };
}

function resequence(events: AgentEventEnvelope[]): AgentEventEnvelope[] {
  return events.map((item, index) => ({
    ...item,
    id: EVENT_IDS[index],
    sequence: index + 1,
  }));
}

function waitingApprovalEvents(approvalId: string): AgentEventEnvelope[] {
  const toolCallId = 'generic-write-call-1';
  return [
    event(1, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'story',
      modelProfileId: 'qwen-plus',
    }),
    event(2, 'ToolProposed', {
      turnId: TURN_ID,
      toolCallId,
      toolId: 'characters.upsert',
      arguments: { characterId: 'hero' },
      risk: 'reversible',
    }),
    event(3, 'ApprovalRequired', {
      turnId: TURN_ID,
      approvalId,
      toolCallId,
      title: 'Update the hero',
      description: 'Review the character update before continuing.',
      reversible: true,
      actions: ['approve', 'reject'],
    }),
    event(4, 'RunPaused', {
      turnId: TURN_ID,
      status: 'waiting_for_approval',
    }),
  ];
}

function approvalResponseEvents(
  prefix: AgentEventEnvelope[],
  approvalId: string,
  responseId: string,
  baseSequence = prefix.length,
): AgentEventEnvelope[] {
  const responseTurnId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  return [
    ...prefix,
    event(baseSequence + 1, 'UserMessage', {
      turnId: responseTurnId,
      messageId: `approval-response:${responseId}`,
      text: 'Approved',
      interaction: {
        kind: 'approval',
        approvalId,
        responseId,
        decision: 'approve',
        locale: 'en-US',
      },
    }),
    event(baseSequence + 2, 'ApprovalResolved', {
      turnId: responseTurnId,
      approvalId,
      responseId,
      decision: 'approve',
    }),
    event(baseSequence + 3, 'RunResumed', {
      turnId: responseTurnId,
      reason: 'approval_resolved',
      approvalId,
    }),
  ];
}

function storedEventToEnvelope(
  input: ReturnType<typeof storedEvent>,
): AgentEventEnvelope {
  return {
    id: input.id,
    runId: input.runId,
    conversationId: input.conversationId,
    sequence: input.sequence,
    protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
    sessionId: input.sessionId,
    timestamp: input.occurredAt.toISOString(),
    type: input.type as AgentEventEnvelope['type'],
    data: input.data,
  };
}

function createFixture() {
  type StoredRun = Record<string, unknown> & {
    id: string;
    status: string;
    lastSequence: number;
    conversationId: string;
    assistantText: string | null;
    pendingApproval: unknown;
    pendingExternal: null;
    inputResponseId: string | null;
    inputRequestId: string | null;
    inputAnswersFingerprint: string | null;
    inputResponseLeaseId: string | null;
    inputResponseLeaseExpiresAt: Date | null;
    approvalResponseId: string | null;
    approvalId: string | null;
    approvalFingerprint: string | null;
    approvalResponseLeaseId: string | null;
    approvalResponseLeaseExpiresAt: Date | null;
  };
  type StoredEvent = ReturnType<typeof storedEvent>;
  const state: { run: StoredRun | null; events: StoredEvent[]; now: Date } = {
    run: {
      id: RUN_ID,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      actorId: 'user-1',
      modelProfileId: 'qwen-plus',
      permissionMode: 'smart',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
      workbenchContext: { chapterId: 'chapter-1' },
      skillSnapshot: startCommand().skillMountSnapshot,
      status: 'queued',
      lastSequence: 0,
      assistantText: null,
      pendingApproval: null,
      pendingExternal: null,
      inputResponseId: null,
      inputRequestId: null,
      inputAnswersFingerprint: null,
      inputResponseLeaseId: null,
      inputResponseLeaseExpiresAt: null,
      approvalResponseId: null,
      approvalId: null,
      approvalFingerprint: null,
      approvalResponseLeaseId: null,
      approvalResponseLeaseExpiresAt: null,
      startAdmissionVersion: 1,
      startCommand: null,
      startExecutionFinishedAt: null,
      continuationExecutionEpoch: 0,
    },
    events: [],
    now: new Date('2026-08-20T12:00:00.000Z'),
  };
  const agentOsRun = {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
      state.run?.id === where.id ? state.run : null,
    ),
    findUniqueOrThrow: jest.fn(async () => {
      if (!state.run) throw new Error('run missing');
      return state.run;
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.run = {
        ...data,
        id: String(data.id),
        conversationId: String(data.conversationId),
        status: String(data.status),
        lastSequence: Number(data.lastSequence),
        assistantText: (data.assistantText as string | null) ?? null,
        pendingApproval: null,
        pendingExternal: null,
        inputResponseId: null,
        inputRequestId: null,
        inputAnswersFingerprint: null,
        inputResponseLeaseId: null,
        inputResponseLeaseExpiresAt: null,
        approvalResponseId: null,
        approvalId: null,
        approvalFingerprint: null,
        approvalResponseLeaseId: null,
        approvalResponseLeaseExpiresAt: null,
        startExecutionEpoch: Number(data.startExecutionEpoch ?? 0),
        startExecutionAttemptId: null,
        startExecutionOwnerId: null,
        startExecutionLeaseExpiresAt: null,
        startExecutionHeartbeatAt: null,
        startExecutionCheckpointId: null,
        startExecutionCheckpointNamespace: null,
        startExecutionCheckpointThreadId: null,
        startExecutionCheckpointMessageId: null,
        startExecutionCheckpointedAt: null,
        startExecutionFinishedAt: null,
      };
      return state.run;
    }),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (!state.run) throw new Error('run missing');
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          state.run[key] =
            value === Prisma.DbNull || value === Prisma.JsonNull ? null : value;
        }
      }
      return state.run;
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (!state.run || (where.id && where.id !== state.run.id))
          return { count: 0 };
        Object.assign(state.run, data);
        return { count: 1 };
      },
    ),
    findFirst: jest.fn(
      async ({
        where,
        include,
      }: {
        where?: Record<string, unknown> & {
          NOT?: { actorId?: string; projectId?: string };
        };
        include?: unknown;
        select?: unknown;
      } = {}) => {
        if (!state.run) return null;
        if (where?.actorId && where.actorId !== state.run.actorId) return null;
        if (where?.projectId && where.projectId !== state.run.projectId)
          return null;
        if (
          where?.clientSubmissionId &&
          where.clientSubmissionId !== state.run.clientSubmissionId
        )
          return null;
        if (
          where?.conversationId &&
          where.conversationId !== state.run.conversationId
        )
          return null;
        if (
          where?.NOT &&
          where.NOT.actorId === state.run.actorId &&
          where.NOT.projectId === state.run.projectId
        )
          return null;
        return include ? { ...state.run, events: state.events } : state.run;
      },
    ),
  };
  const agentOsRunEvent = {
    findMany: jest.fn(
      async ({
        where,
      }: {
        where?: {
          sequence?: { lte?: number };
          type?: string | { in?: string[] };
        };
      }) => {
        const maximum = where?.sequence?.lte ?? Number.POSITIVE_INFINITY;
        const allowedTypes =
          typeof where?.type === 'string' ? [where.type] : where?.type?.in;
        return state.events
          .filter(
            (item) =>
              item.sequence <= maximum &&
              (!allowedTypes || allowedTypes.includes(item.type)),
          )
          .sort((left, right) => left.sequence - right.sequence);
      },
    ),
    findUnique: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        state.events.find((item) => item.id === where.id) ?? null,
    ),
    findFirst: jest.fn(
      async ({
        where,
        orderBy,
      }: {
        where?: {
          runId?: string;
          type?: string | { in?: string[] };
        };
        orderBy?: { sequence?: 'asc' | 'desc' };
        select?: unknown;
      }) => {
        const allowed =
          typeof where?.type === 'string' ? [where.type] : where?.type?.in;
        const candidates = state.events.filter(
          (item) =>
            (!where?.runId || item.runId === where.runId) &&
            (!allowed || allowed.includes(item.type)),
        );
        candidates.sort((left, right) => left.sequence - right.sequence);
        if (orderBy?.sequence !== 'asc') candidates.reverse();
        return candidates[0] ?? null;
      },
    ),
    createMany: jest.fn(
      async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const item of data) state.events.push(storedEvent(item));
        return { count: data.length };
      },
    ),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = storedEvent(data);
      state.events.push(row);
      return row;
    }),
  };
  const agentOsExternalHandoffRegistration = {
    findUnique: jest.fn(
      async ({ where }: { where: { externalJobId: string } }) =>
        where.externalJobId === EXTERNAL_JOB_ID
          ? {
              generationBatchId: null as string | null,
              externalJobId: EXTERNAL_JOB_ID,
              sourceAgentRunId: RUN_ID,
              sourceAgentTurnId: TURN_ID,
              sourceAgentToolCallId: 'story-author-call-1',
              sourceConversationId: CONVERSATION_ID,
              sourceToolId: 'story.author',
              startedMessage: 'I am preparing the story proposal now.',
            }
          : null,
    ),
  };
  const transaction = {
    appStoryRun: {
      findFirst: jest
        .fn<Promise<{ id: string } | null>, [unknown]>()
        .mockResolvedValue(null),
    },
    storyGenerationBatch: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: EXTERNAL_JOB_ID,
        storyProjectId: PROJECT_ID,
        storyChapterId: CHAPTER_ID,
      }),
    },
    $queryRaw: jest.fn(async (query: { strings?: readonly string[] }) => {
      const sql = query?.strings?.join(' ') ?? '';
      if (sql.includes('pg_try_advisory_xact_lock')) {
        const startHeld = Boolean(
          state.run?.startCommand &&
          state.run.startExecutionAttemptId &&
          state.run.startExecutionLeaseExpiresAt instanceof Date &&
          state.run.startExecutionLeaseExpiresAt > state.now,
        );
        const continuationHeld = Boolean(
          state.run?.continuationCommand &&
          state.run.continuationExecutionAttemptId &&
          state.run.continuationExecutionLeaseExpiresAt instanceof Date &&
          state.run.continuationExecutionLeaseExpiresAt > state.now,
        );
        return [{ acquired: !(startHeld || continuationHeld) }];
      }
      return [{ now: state.now }];
    }),
    agentOsRun,
    agentOsRunEvent,
    agentOsExternalHandoffRegistration,
  };
  const prisma = {
    $transaction: jest.fn(
      async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
    agentOsRun,
    agentOsRunEvent,
    agentOsExternalHandoffRegistration,
  };
  const realtimeOutbox = { schedule: jest.fn() };
  return {
    state,
    tx: transaction,
    service: new AgentOsRunJournalService(
      prisma as never,
      realtimeOutbox as never,
    ),
  };
}

function storedEvent(input: Record<string, unknown>) {
  return {
    id: String(input.id),
    runId: String(input.runId),
    conversationId: String(input.conversationId),
    sequence: Number(input.sequence),
    protocolVersion: String(input.protocolVersion),
    sessionId: String(input.sessionId),
    type: String(input.type),
    data: input.data as Record<string, unknown>,
    occurredAt: input.occurredAt as Date,
  };
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest assertions inspect structurally typed Prisma payloads. */
import { StoryAgentRunStatus } from '@prisma/client';
import { AgentOsContinuationNotReadyError } from '../agent-os-journal/agent-os-run-journal.service';
import { StoryAgentRunContinuationWorkerService } from './story-agent-run-continuation-worker.service';

const STORY_RUN_ID = '019a0331-2fa4-7f0b-a42f-88c00c07b936';
const AGENT_RUN_ID = '019a0331-327d-7b70-827c-ece76580783e';
const TURN_ID = '019a0331-343d-7a2f-9025-556dbafcccd4';
const TOOL_CALL_ID = 'call_story_author_1';
const CONVERSATION_ID = '019a0331-38cb-780d-a5e5-294d17b5ef22';
const DECISION_TURN_ID = '019a0331-4000-7000-8000-000000000001';
const NOW = new Date('2026-08-20T12:00:00.000Z');
const LEASE_EXPIRES_AT = new Date('2026-08-20T12:00:30.000Z');

describe('StoryAgentRunContinuationWorkerService', () => {
  const originalEnabled = process.env.STORY_AGENT_CONTINUATION_WORKER_ENABLED;

  beforeEach(() => {
    process.env.STORY_AGENT_CONTINUATION_WORKER_ENABLED = 'true';
  });

  afterAll(() => {
    if (originalEnabled === undefined) {
      delete process.env.STORY_AGENT_CONTINUATION_WORKER_ENABLED;
    } else {
      process.env.STORY_AGENT_CONTINUATION_WORKER_ENABLED = originalEnabled;
    }
  });

  it('claims with SKIP LOCKED so multiple pods cannot hot-loop the same job', async () => {
    const fixture = createFixture({ claimRows: [] });

    await fixture.worker.drainOnce(17);

    expect(fixture.claim).toHaveBeenCalledTimes(1);
    const sql = fixture.claimSql();
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('source_result_delivery_lease_owner');
    expect(sql).toContain('source_result_delivery_lease_expires_at');
    expect(sql).toContain('source_result_delivery_attempts');
    expect(sql).toContain('run."status" = \'authoring_failed\'');
    expect(sql).toContain('run."authoring_attempts" >=');
    expect(sql).toMatch(
      /source_proposal_ready_delivered_at" IS NOT NULL[\s\S]*source_approval_decision" = 'approve'[\s\S]*status" = 'authoring_failed'/,
    );
  });

  it('appends the correlated result and delivery CAS in one transaction, then publishes', async () => {
    const fixture = createFixture({
      run: storyRun({ status: StoryAgentRunStatus.proposed }),
    });

    await fixture.worker.drainOnce();

    expect(fixture.reconcileExternalHandoffInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      STORY_RUN_ID,
    );
    expect(fixture.appendExternalResultInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      {
        runId: AGENT_RUN_ID,
        turnId: TURN_ID,
        toolCallId: TOOL_CALL_ID,
        toolId: 'story.author',
        externalJobId: STORY_RUN_ID,
        phase: 'authoring',
        outcome: 'completed',
        text: 'Your interactive-film proposal is ready to review.',
      },
    );
    expect(fixture.updateMany).toHaveBeenCalledWith({
      where: {
        id: STORY_RUN_ID,
        status: StoryAgentRunStatus.proposed,
        authoringAttempts: 1,
        sourceResultDeliveredAt: null,
        sourceResultDeliveryLeaseOwner: fixture.workerId,
      },
      data: {
        sourceResultDeliveredAt: NOW,
        sourceResultDeliveryNextAttemptAt: null,
        sourceResultDeliveryLeaseOwner: null,
        sourceResultDeliveryLeaseExpiresAt: null,
        sourceResultDeliveryLastError: null,
      },
    });
    expect(fixture.publishCommitted).toHaveBeenCalledWith(fixture.dispatch);
    expect(
      fixture.reconcileExternalHandoffInTransaction.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.appendExternalResultInTransaction.mock.invocationCallOrder[0],
    );
    expect(
      fixture.appendExternalResultInTransaction.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.updateMany.mock.invocationCallOrder[0]);
    expect(fixture.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.publishCommitted.mock.invocationCallOrder[0],
    );
  });

  it('re-reads a cancellation that raced a proposed claim and reports cancellation', async () => {
    const fixture = createFixture({
      run: storyRun({
        status: StoryAgentRunStatus.cancelled,
        errorCode: 'STORY_AGENT_CANCELLED_BY_EDITOR',
        errorDetail: 'The editor cancelled this authoring request.',
      }),
    });

    await fixture.worker.drainOnce();

    expect(fixture.appendExternalResultInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        outcome: 'cancelled',
        text: 'The editor cancelled this authoring request.',
        error: {
          code: 'STORY_AGENT_CANCELLED_BY_EDITOR',
          message: 'The editor cancelled this authoring request.',
          retryable: false,
        },
      }),
    );
  });

  it('does not terminalize a failed authoring job that was re-armed for retry', async () => {
    const fixture = createFixture({
      // The row was claimed while authoring_failed, but the editor re-armed it
      // before this transaction obtained the row lock.
      run: storyRun({
        status: StoryAgentRunStatus.authoring,
        authoringAttempts: 2,
      }),
    });

    await fixture.worker.drainOnce();

    expect(fixture.appendExternalResultInTransaction).not.toHaveBeenCalled();
    expect(fixture.updateMany).toHaveBeenCalledWith({
      where: {
        id: STORY_RUN_ID,
        sourceResultDeliveryLeaseOwner: fixture.workerId,
        OR: [
          { decisionContractVersion: 1, sourceResultDeliveredAt: null },
          { decisionContractVersion: 2, sourceTerminalDeliveredAt: null },
        ],
      },
      data: {
        sourceResultDeliveryNextAttemptAt: null,
        sourceResultDeliveryLeaseOwner: null,
        sourceResultDeliveryLeaseExpiresAt: null,
      },
    });
    expect(fixture.publishCommitted).not.toHaveBeenCalled();
  });

  it('only terminalizes authoring_failed after the bounded retry budget is exhausted', async () => {
    const fixture = createFixture({
      run: storyRun({
        status: StoryAgentRunStatus.authoring_failed,
        authoringAttempts: 5,
        errorCode: 'STORY_AGENT_MODEL_OUTPUT_INVALID',
        errorDetail: 'The authored branch points to a missing scene.',
      }),
    });

    await fixture.worker.drainOnce();

    expect(fixture.appendExternalResultInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        outcome: 'failed',
        text: 'The authored branch points to a missing scene.',
        error: {
          code: 'STORY_AGENT_MODEL_OUTPUT_INVALID',
          message: 'The authored branch points to a missing scene.',
          retryable: false,
        },
      }),
    );
  });

  it('backs off without stamping delivery while the Agent run has not journaled the handoff', async () => {
    const fixture = createFixture({
      reconcileError: new AgentOsContinuationNotReadyError(
        AGENT_RUN_ID,
        'running',
      ),
    });

    await fixture.worker.drainOnce();

    expect(fixture.publishCommitted).not.toHaveBeenCalled();
    expect(fixture.releaseForRetry).toHaveBeenCalledTimes(1);
    const sql = fixture.releaseSql();
    expect(sql).toContain('source_result_delivery_next_attempt_at');
    expect(sql).toContain('source_result_delivery_last_error');
    expect(sql).toContain('source_result_delivery_lease_owner');
  });

  it('recovers a crash/lost CAS by replaying the deterministic journal append', async () => {
    const fixture = createFixture({ updateCounts: [0, 1] });

    await fixture.worker.drainOnce();
    await fixture.worker.drainOnce();

    expect(fixture.appendExternalResultInTransaction).toHaveBeenCalledTimes(2);
    expect(fixture.publishCommitted).toHaveBeenCalledTimes(1);
    expect(fixture.releaseForRetry).toHaveBeenCalledTimes(1);
  });

  it('rejects a registration whose immutable source tuple diverges from the Story row', async () => {
    const fixture = createFixture({
      registration: registration({ sourceAgentToolCallId: 'call_other' }),
    });

    await fixture.worker.drainOnce();

    expect(fixture.appendExternalResultInTransaction).not.toHaveBeenCalled();
    expect(fixture.releaseForRetry).toHaveBeenCalledTimes(1);
    expect(fixture.publishCommitted).not.toHaveBeenCalled();
  });

  it('pauses a v2 proposal for durable approval without terminalizing its Agent run', async () => {
    const fixture = createFixture({
      run: storyRun({ decisionContractVersion: 2 }),
      registration: registration({ decisionContractVersion: 2 }),
    });

    await fixture.worker.drainOnce();

    expect(fixture.appendStoryProposalReadyInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      {
        runId: AGENT_RUN_ID,
        turnId: TURN_ID,
        authorToolCallId: TOOL_CALL_ID,
        externalJobId: STORY_RUN_ID,
        text: 'Your interactive-film proposal is ready to review.',
        title: 'Story title',
        summary: 'Story summary',
      },
    );
    expect(fixture.appendExternalResultInTransaction).not.toHaveBeenCalled();
    expect(fixture.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceProposalReadyDeliveredAt: null,
          sourceTerminalDeliveredAt: null,
        }),
        data: expect.objectContaining({
          sourceProposalReadyDeliveredAt: NOW,
          sourceResultDeliveryAttempts: 0,
        }),
      }),
    );
    expect(fixture.publishCommitted).toHaveBeenCalledTimes(1);
  });

  it('delivers the approved v2 apply result on its decision turn and second tool phase', async () => {
    const fixture = createFixture({
      run: storyRun({
        decisionContractVersion: 2,
        status: StoryAgentRunStatus.succeeded,
        sourceProposalReadyDeliveredAt: new Date('2026-08-20T11:58:00.000Z'),
        sourceApprovalDecision: 'approve',
        sourceApprovalDecisionTurnId: DECISION_TURN_ID,
        sourceApprovalLocale: 'zh-CN',
      }),
      registration: registration({ decisionContractVersion: 2 }),
    });

    await fixture.worker.drainOnce();

    expect(
      fixture.reconcileExternalHandoffInTransaction,
    ).not.toHaveBeenCalled();
    expect(fixture.appendExternalResultInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        runId: AGENT_RUN_ID,
        turnId: DECISION_TURN_ID,
        toolId: 'story.applyProposal',
        externalJobId: STORY_RUN_ID,
        phase: 'apply',
        outcome: 'completed',
        text: '已批准的剧本已写入 Script，并据此构建了情节树、资产规格与分镜时间轴。尚未生成任何图片或视频——准备好后，请在资产页与分镜页点击生成。',
      }),
    );
    expect(fixture.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceTerminalDeliveredAt: null }),
        data: expect.objectContaining({ sourceTerminalDeliveredAt: NOW }),
      }),
    );
  });

  it('terminalizes an exhausted v2 downstream authoring failure on the approval turn', async () => {
    const fixture = createFixture({
      run: storyRun({
        decisionContractVersion: 2,
        status: StoryAgentRunStatus.authoring_failed,
        authoringAttempts: 5,
        sourceProposalReadyDeliveredAt: new Date('2026-08-20T11:58:00.000Z'),
        sourceApprovalDecision: 'approve',
        sourceApprovalDecisionTurnId: DECISION_TURN_ID,
        errorCode: 'STORY_PRODUCTION_PLAN_INVALID',
        errorDetail:
          'The approved Script could not be compiled into a complete production plan.',
      }),
      registration: registration({ decisionContractVersion: 2 }),
    });

    await fixture.worker.drainOnce();

    expect(
      fixture.reconcileExternalHandoffInTransaction,
    ).not.toHaveBeenCalled();
    expect(fixture.appendExternalResultInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        runId: AGENT_RUN_ID,
        turnId: DECISION_TURN_ID,
        toolId: 'story.applyProposal',
        externalJobId: STORY_RUN_ID,
        phase: 'apply',
        outcome: 'failed',
        text: 'The approved Script could not be compiled into a complete production plan.',
        error: {
          code: 'STORY_PRODUCTION_PLAN_INVALID',
          message:
            'The approved Script could not be compiled into a complete production plan.',
          retryable: false,
        },
      }),
    );
    expect(fixture.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceTerminalDeliveredAt: null }),
        data: expect.objectContaining({ sourceTerminalDeliveredAt: NOW }),
      }),
    );
    expect(fixture.publishCommitted).toHaveBeenCalledTimes(1);
  });
});

function createFixture(
  options: {
    claimRows?: Array<{ id: string; attempt: number }>;
    run?: ReturnType<typeof storyRun>;
    registration?: ReturnType<typeof registration>;
    reconcileError?: Error;
    updateCounts?: number[];
  } = {},
) {
  let workerId = '';
  let claimedSql = '';
  let releasedSql = '';
  const claim = jest.fn().mockImplementation((query: unknown) => {
    claimedSql = sqlText(query);
    return Promise.resolve(
      options.claimRows ?? [{ id: STORY_RUN_ID, attempt: 1 }],
    );
  });
  const releaseForRetry = jest.fn().mockImplementation((query: unknown) => {
    releasedSql = sqlText(query);
    return Promise.resolve(1);
  });
  const updateMany = jest.fn();
  if (options.updateCounts) {
    for (const count of options.updateCounts) {
      updateMany.mockResolvedValueOnce({ count });
    }
  } else {
    updateMany.mockResolvedValue({ count: 1 });
  }
  const txQueryRaw = jest
    .fn()
    .mockImplementation((query: unknown) =>
      Promise.resolve(
        sqlText(query).includes('SELECT NOW()') ? [{ databaseNow: NOW }] : [],
      ),
    );
  const tx = {
    $queryRaw: txQueryRaw,
    storyAgentRun: {
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...(options.run ?? storyRun()),
          sourceResultDeliveryLeaseOwner: workerId,
        }),
      ),
      updateMany,
    },
    agentOsExternalHandoffRegistration: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options.registration ?? registration()),
    },
  };
  const prisma = {
    $queryRaw: claim,
    $executeRaw: releaseForRetry,
    $transaction: jest
      .fn()
      .mockImplementation(
        async (
          callback: (transaction: typeof tx) => Promise<unknown>,
        ): Promise<unknown> => callback(tx),
      ),
  };
  const handoffDispatch = {
    events: [{ id: 'handoff-event' }],
    snapshot: { runId: AGENT_RUN_ID, status: 'waiting_for_external' },
  };
  const resultDispatch = {
    events: [{ id: 'result-event' }],
    snapshot: { runId: AGENT_RUN_ID, status: 'completed' },
  };
  const dispatch = {
    events: [...handoffDispatch.events, ...resultDispatch.events],
    snapshot: resultDispatch.snapshot,
  };
  const reconcileExternalHandoffInTransaction = options.reconcileError
    ? jest.fn().mockRejectedValue(options.reconcileError)
    : jest.fn().mockResolvedValue(handoffDispatch);
  const appendExternalResultInTransaction = jest
    .fn()
    .mockResolvedValue(resultDispatch);
  const appendStoryProposalReadyInTransaction = jest
    .fn()
    .mockResolvedValue(resultDispatch);
  const publishCommitted = jest.fn().mockResolvedValue(undefined);
  const worker = new StoryAgentRunContinuationWorkerService(
    prisma as never,
    {
      reconcileExternalHandoffInTransaction,
      appendExternalResultInTransaction,
      appendStoryProposalReadyInTransaction,
      publishCommitted,
    } as never,
  );
  workerId = (
    worker as unknown as {
      workerId: string;
    }
  ).workerId;

  return {
    worker,
    workerId,
    tx,
    claim,
    claimSql: () => claimedSql,
    releaseForRetry,
    releaseSql: () => releasedSql,
    updateMany,
    reconcileExternalHandoffInTransaction,
    appendExternalResultInTransaction,
    appendStoryProposalReadyInTransaction,
    publishCommitted,
    dispatch,
  };
}

function storyRun(
  overrides: Partial<{
    status: StoryAgentRunStatus;
    authoringAttempts: number;
    decisionContractVersion: number;
    sourceProposalReadyDeliveredAt: Date | null;
    sourceTerminalDeliveredAt: Date | null;
    sourceApprovalDecision: 'approve' | 'reject' | null;
    sourceApprovalDecisionTurnId: string | null;
    sourceApprovalLocale: 'en-US' | 'zh-CN' | 'zh-HK' | null;
    errorCode: string | null;
    errorDetail: string | null;
  }> = {},
) {
  return {
    id: STORY_RUN_ID,
    storyProjectId: '019a0331-5000-7000-8000-000000000001',
    status: StoryAgentRunStatus.proposed,
    authoringAttempts: 1,
    decisionContractVersion: 1,
    proposal: { title: 'Story title', summary: 'Story summary' },
    sourceAgentRunId: AGENT_RUN_ID,
    sourceAgentTurnId: TURN_ID,
    sourceAgentToolCallId: TOOL_CALL_ID,
    sourceCompletionMessage:
      'Your interactive-film proposal is ready to review.',
    sourceResultDeliveredAt: null,
    sourceProposalReadyDeliveredAt: null,
    sourceTerminalDeliveredAt: null,
    sourceApprovalDecision: null,
    sourceApprovalDecisionTurnId: null,
    sourceApprovalLocale: null,
    sourceResultDeliveryLeaseOwner: 'assigned-by-fixture',
    sourceResultDeliveryLeaseExpiresAt: LEASE_EXPIRES_AT,
    errorCode: null,
    errorDetail: null,
    ...overrides,
  };
}

function registration(
  overrides: Partial<{
    sourceAgentToolCallId: string;
    decisionContractVersion: number;
  }> = {},
) {
  return {
    id: '019a0331-4aaa-71b8-91c6-63da6dc4d82d',
    externalJobId: STORY_RUN_ID,
    storyAgentRunId: STORY_RUN_ID,
    decisionContractVersion: 1,
    sourceAgentRunId: AGENT_RUN_ID,
    sourceAgentTurnId: TURN_ID,
    sourceAgentToolCallId: TOOL_CALL_ID,
    sourceConversationId: CONVERSATION_ID,
    sourceToolId: 'story.author',
    startedMessage: 'I am shaping the proposal now.',
    completionMessage: 'Your interactive-film proposal is ready to review.',
    createdAt: NOW,
    ...overrides,
  };
}

function sqlText(value: unknown): string {
  const sql = value as { strings?: readonly string[]; sql?: string };
  return sql.strings?.join(' ? ') ?? sql.sql ?? String(value);
}

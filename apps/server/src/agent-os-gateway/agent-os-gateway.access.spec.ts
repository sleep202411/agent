import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AgentOsGatewayService,
  startRunSubmissionFingerprint,
  storyAuthoringModelContext,
} from './agent-os-gateway.service';

/**
 * Object-level authorization on the run-scoped routes.
 *
 * The client sends a runId and a projectId side by side and they are unrelated
 * ids, so authorizing the projectId proves nothing about the run. Before this,
 * any member of any project could pass their own projectId with someone else's
 * runId and read that transcript, cancel the turn, or resolve the pending write.
 */
const VICTIM = {
  runId: '11111111-1111-4111-8111-111111111111',
  projectId: 'aaaaaaaa-1111-4111-8111-111111111111',
  actorId: 'victim-user',
  conversationId: 'cccccccc-1111-4111-8111-111111111111',
  workbenchMode: 'storyboard',
  workbenchContext: {
    sectionId: 'dddddddd-1111-4111-8111-111111111111',
  },
};
const ATTACKER_PROJECT = 'bbbbbbbb-2222-4222-8222-222222222222';
const ATTACKER = { userId: 'attacker-user' } as never;
const APPROVAL_ID = '66666666-6666-4666-8666-666666666666';
const APPROVAL_RESPONSE_ID = '77777777-7777-4777-8777-777777777777';
const APPROVAL_DISPLAY = {
  responseText: 'Approved',
  locale: 'en-US' as const,
};
const START_IDENTITIES = {
  conversationId: 'cccccccc-1111-4111-8111-111111111111',
  clientSubmissionId: '12121212-1212-4212-8212-121212121212',
  turnId: '13131313-1313-4313-8313-131313131313',
  messageId: '14141414-1414-4414-8414-141414141414',
};
const STORY_OWNERSHIP = {
  ...VICTIM,
  projectKind: 'story' as const,
  workbenchMode: 'story',
  workbenchContext: {
    chapterId: 'dddddddd-1111-4111-8111-111111111111',
  },
};
const EMPTY_STORY_PRODUCTION_STATE = {
  projectId: ATTACKER_PROJECT,
  chapterId: '11111111-1111-4111-8111-111111111111',
  profile: { status: 'missing' as const },
  script: {
    status: 'missing' as const,
    documentId: null,
    sequence: null,
  },
  plotTree: { status: 'missing' as const, nodeCount: 0 },
  assets: { status: 'missing' as const, currentCount: 0 },
  storyboard: {
    status: 'missing' as const,
    sequenceCount: 0,
    missingPlotNodeIds: [],
  },
  ready: false,
};

function pendingApprovalSnapshot(
  toolId = 'characters.upsert',
  args: Record<string, unknown> = {},
) {
  return {
    runId: VICTIM.runId,
    status: 'waiting_for_approval',
    events: [],
    pendingApproval: {
      kind: 'tool_approval',
      approvalId: APPROVAL_ID,
      toolId,
      toolCallId: 'tool-call-1',
      arguments: args,
      title: 'Review this action',
      description: 'Review before continuing.',
    },
    pendingUserInput: null,
    pendingExternal: null,
    assistantText: 'Please review this action.',
  };
}

function resolvedApprovalSnapshot(
  decision: 'approve' | 'reject' = 'approve',
  responseId = APPROVAL_RESPONSE_ID,
) {
  return {
    ...pendingApprovalSnapshot(),
    status: 'running',
    events: [
      {
        type: 'UserMessage',
        data: {
          turnId: '88888888-8888-4888-8888-888888888888',
          messageId: 'user-approval-response',
          text: 'Approved',
          interaction: {
            kind: 'approval',
            approvalId: APPROVAL_ID,
            responseId,
            decision,
            locale: 'en-US',
          },
        },
      },
      {
        type: 'ApprovalResolved',
        data: {
          turnId: '88888888-8888-4888-8888-888888888888',
          approvalId: APPROVAL_ID,
          responseId,
          decision,
        },
      },
    ],
    pendingApproval: null,
    assistantText: 'I have your decision and will continue.',
  };
}

function makeService(overrides?: {
  ownership?: {
    runId: string;
    projectId: string;
    actorId: string;
    conversationId: string;
    projectKind?: 'platform' | 'story';
    workbenchMode: string;
    workbenchContext?: Readonly<Record<string, string>>;
  } | null;
  conversationConflicts?: boolean;
  projectKind?: 'platform' | 'story';
  latestStoryRun?: { id: string; status: 'cancelled' | 'authoring' } | null;
  storyProductionState?: typeof EMPTY_STORY_PRODUCTION_STATE;
}) {
  let reservedStart: Record<string, unknown> | null = null;
  const worker = {
    listEvents: jest
      .fn()
      .mockResolvedValue({ status: 'completed', events: [] }),
    cancelRun: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    resolveApproval: jest.fn().mockResolvedValue({ status: 'running' }),
    resolveUserInput: jest.fn(),
    startRun: jest
      .fn()
      .mockImplementation((input: { runId: string }) =>
        Promise.resolve({ runId: input.runId, status: 'running' }),
      ),
  };
  const journal = {
    findRunStartSubmission: jest.fn().mockResolvedValue(null),
    reserveRunStart: jest.fn().mockImplementation((command: unknown) => {
      reservedStart = command as Record<string, unknown>;
      const runId = String(reservedStart.runId);
      const conversationId = String(reservedStart.conversationId);
      const events = [
        {
          id: String(reservedStart.messageId),
          runId,
          conversationId,
          sequence: 1,
          type: 'UserMessage',
          data: {
            messageId: reservedStart.messageId,
            turnId: reservedStart.turnId,
            text: reservedStart.message,
            attachments: reservedStart.attachments,
          },
        },
      ];
      return Promise.resolve({
        kind: 'created',
        runId,
        events,
        snapshot: {
          runId,
          conversationId,
          status: 'queued',
          lastSequence: 1,
          pendingApproval: null,
          pendingUserInput: null,
          pendingExternal: null,
          assistantText: null,
        },
      });
    }),
    claimUserInputResponse: jest.fn().mockResolvedValue({
      kind: 'claimed',
      leaseId: 'lease-1',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      snapshot: {},
    }),
    claimApprovalResponse: jest.fn().mockResolvedValue({
      kind: 'claimed',
      leaseId: 'approval-lease-1',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      snapshot: {},
    }),
    cancelRun: jest.fn().mockResolvedValue({
      events: [{ type: 'RunCancelled' }],
      snapshot: { runId: VICTIM.runId, status: 'cancelled' },
    }),
    getRunOwnership: jest
      .fn()
      .mockResolvedValue(
        overrides?.ownership === undefined ? VICTIM : overrides.ownership,
      ),
    conversationConflictsWith: jest
      .fn()
      .mockResolvedValue(overrides?.conversationConflicts ?? false),
    getEventsAfter: jest.fn().mockResolvedValue({
      runId: VICTIM.runId,
      status: 'waiting_for_input',
      events: [],
      pendingApproval: null,
      pendingUserInput: { requestId: '99999999-9999-4999-8999-999999999999' },
      pendingExternal: null,
      assistantText: 'Choose an option.',
    }),
  };
  worker.resolveUserInput.mockImplementation(
    (input: {
      runId: string;
      requestId: string;
      responseId: string;
      answers: Record<string, string>;
    }) => {
      // The real Worker returns only after this acknowledgement has been
      // accepted by the PostgreSQL journal. Mirror that contract in the
      // default fixture so Gateway can return the durable API shape.
      journal.getEventsAfter.mockResolvedValue({
        runId: input.runId,
        status: 'running',
        events: [
          {
            type: 'UserInputResolved',
            data: {
              turnId: '77777777-7777-4777-8777-777777777777',
              requestId: input.requestId,
              responseId: input.responseId,
              answers: input.answers,
            },
          },
        ],
        pendingApproval: null,
        pendingUserInput: null,
        pendingExternal: null,
        assistantText: 'Thanks — I have your answers.',
      });
      return Promise.resolve({ runId: input.runId, status: 'running' });
    },
  );
  worker.resolveApproval.mockImplementation(() => {
    journal.getEventsAfter.mockResolvedValue(resolvedApprovalSnapshot());
    return Promise.resolve({ runId: VICTIM.runId, status: 'running' });
  });
  const realtimeTokens = {
    issueConversationToken: jest.fn().mockResolvedValue({}),
  };
  const projects = {
    requireRead: jest.fn().mockResolvedValue({
      projectId: ATTACKER_PROJECT,
      projectKind: overrides?.projectKind ?? 'platform',
      workspaceId: 'workspace-1',
    }),
    requireWrite: jest.fn().mockResolvedValue({
      projectId: ATTACKER_PROJECT,
      projectKind: overrides?.projectKind ?? 'platform',
      workspaceId: 'workspace-1',
    }),
    requireStoryWorkbenchContext: jest
      .fn()
      .mockImplementation(
        (_projectId: string, context: { chapterId: string }) =>
          Promise.resolve(context),
      ),
    requirePlatformWorkbenchContext: jest
      .fn()
      .mockImplementation(
        (_projectId: string, context: { sectionId: string }) =>
          Promise.resolve({
            ...context,
            canvasDocumentId: 'eeeeeeee-1111-4111-8111-111111111111',
          }),
      ),
  };
  const attachments = {
    validateForRun: jest
      .fn()
      .mockImplementation(
        (_kind: string, _projectId: string, ids?: readonly string[]) =>
          Promise.resolve(
            ids
              ? [...new Set(ids)].map((id) => ({ id, filename: `${id}.md` }))
              : undefined,
          ),
      ),
  };
  const storyAgentRuns = {
    getLatestRun: jest
      .fn()
      .mockResolvedValue(overrides?.latestStoryRun ?? null),
    resolveAgentOsProposalDecision: jest.fn().mockResolvedValue({
      runId: VICTIM.runId,
      status: 'waiting_for_external',
      events: [],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: {
        kind: 'external_job',
        jobId: '99999999-9999-4999-8999-999999999999',
        toolId: 'story.applyProposal',
      },
      assistantText: 'Applying the proposal.',
    }),
    cancelAgentOsAuthoring: jest.fn().mockResolvedValue({
      runId: VICTIM.runId,
      status: 'cancelled',
      events: [{ type: 'RunCancelled' }],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: 'Story authoring was stopped.',
    }),
  };
  const storyProductionPlans = {
    getProductionState: jest
      .fn()
      .mockResolvedValue(
        overrides?.storyProductionState ?? EMPTY_STORY_PRODUCTION_STATE,
      ),
  };
  const runStarts = {
    dispatch: jest.fn().mockImplementation((): Promise<unknown> => {
      if (!reservedStart) throw new Error('Start was not reserved');
      return Promise.resolve(worker.startRun(reservedStart) as unknown);
    }),
  };
  const runContinuations = {
    dispatch: jest.fn().mockResolvedValue(null),
  };
  // Permission checks pass: the point is that they are asked about the WRONG
  // project unless the run is resolved first.
  const service = new AgentOsGatewayService(
    worker as never, // worker
    projects as never,
    { value: { mobileChatModelProfileId: 'qwen3.7-plus' } } as never, // config
    journal as never,
    {} as never, // domain
    realtimeTokens as never,
    attachments as never,
    { resolve: jest.fn().mockResolvedValue({ skills: [] }) } as never,
    storyAgentRuns as never,
    storyProductionPlans as never,
    { cancelAgentHandoff: jest.fn() } as never,
    runStarts as never,
    runContinuations as never,
  );
  return {
    service,
    worker,
    journal,
    projects,
    realtimeTokens,
    attachments,
    storyAgentRuns,
    storyProductionPlans,
    runStarts,
    runContinuations,
  };
}

describe('Story authoring model context', () => {
  it('marks a cancelled background run as terminal and exposes canonical empty state', () => {
    const context = storyAuthoringModelContext({
      latestRun: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'cancelled',
      },
      productionState: EMPTY_STORY_PRODUCTION_STATE,
    });
    expect(context).toContain('"status":"cancelled"');
    expect(context).toContain('authoringActive=false');
    expect(context).toContain(
      'canonicalProductionState={"profile":"missing","script":"missing","plot":"missing","assets":"missing","storyboard":"missing","ready":false}',
    );
    expect(context).toContain('chapterHasNoScript=true');
    expect(context).toContain('does not block a new create request');
  });
});

describe('start submission identity', () => {
  const body: Parameters<typeof startRunSubmissionFingerprint>[0] = {
    ...START_IDENTITIES,
    projectId: ATTACKER_PROJECT,
    message: 'Add a shot',
    modelProfileId: 'qwen-plus',
    attachmentIds: [
      'eeeeeeee-1111-4111-8111-111111111111',
      'ffffffff-1111-4111-8111-111111111111',
    ],
    workbenchMode: 'storyboard',
    workbenchContext: {
      sectionId: 'dddddddd-1111-4111-8111-111111111111',
    },
    skillIds: ['story.edit', 'story.read'],
    projectSkillInstallationIds: [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ],
  };

  it('canonicalizes unordered selections but preserves attachment order', () => {
    const canonical = startRunSubmissionFingerprint(body);
    expect(
      startRunSubmissionFingerprint({
        ...body,
        permissionMode: 'smart',
        skillIds: ['story.read', 'story.edit', 'story.read'],
        projectSkillInstallationIds: [
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ],
        attachmentIds: [
          'eeeeeeee-1111-4111-8111-111111111111',
          'ffffffff-1111-4111-8111-111111111111',
          'eeeeeeee-1111-4111-8111-111111111111',
        ],
      }),
    ).toBe(canonical);
    expect(
      startRunSubmissionFingerprint({
        ...body,
        attachmentIds: [...(body.attachmentIds ?? [])].reverse(),
      }),
    ).not.toBe(canonical);
  });
});

describe('run-scoped authorization', () => {
  it('refuses to read a run that belongs to another project', async () => {
    const { service, worker } = makeService();
    await expect(
      service.listEvents(ATTACKER, VICTIM.runId, ATTACKER_PROJECT, 0),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.listEvents).not.toHaveBeenCalled();
  });

  it('refuses to cancel another project’s run', async () => {
    const { service, worker } = makeService();
    await expect(
      service.cancelRun(ATTACKER, VICTIM.runId, ATTACKER_PROJECT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.cancelRun).not.toHaveBeenCalled();
  });

  it('returns a durable cancellation even when the Worker cannot be notified', async () => {
    const { service, worker, journal } = makeService();
    journal.getEventsAfter.mockResolvedValue({
      runId: VICTIM.runId,
      status: 'cancelled',
      events: [{ type: 'RunCancelled' }],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: null,
    });
    worker.cancelRun.mockRejectedValue(new Error('worker restarted'));

    await expect(
      service.cancelRun(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        VICTIM.projectId,
      ),
    ).resolves.toMatchObject({
      runId: VICTIM.runId,
      status: 'cancelled',
      events: [{ type: 'RunCancelled' }],
    });
    expect(journal.cancelRun.mock.invocationCallOrder[0]).toBeLessThan(
      worker.cancelRun.mock.invocationCallOrder[0],
    );
  });

  it('refuses Stop after Story proposal application is committed', async () => {
    const { service, worker, journal, storyAgentRuns } = makeService({
      projectKind: 'story',
      ownership: STORY_OWNERSHIP,
    });
    journal.getEventsAfter.mockResolvedValue({
      runId: VICTIM.runId,
      status: 'waiting_for_external',
      events: [],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: {
        kind: 'external_job',
        jobId: '99999999-9999-4999-8999-999999999999',
        toolId: 'story.applyProposal',
      },
      assistantText: 'Applying the proposal.',
    });

    try {
      await service.cancelRun(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        VICTIM.projectId,
      );
      throw new Error('Expected cancelRun to reject a committed operation.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'OPERATION_COMMITTED',
      });
    }
    expect(journal.cancelRun).not.toHaveBeenCalled();
    expect(worker.cancelRun).not.toHaveBeenCalled();
    expect(storyAgentRuns.cancelAgentOsAuthoring).not.toHaveBeenCalled();
  });

  it('refuses a late generic Stop while a Story proposal awaits Approve or Discard', async () => {
    const { service, worker, journal, storyAgentRuns } = makeService({
      projectKind: 'story',
      ownership: STORY_OWNERSHIP,
    });
    const storyRunId = '99999999-9999-4999-8999-999999999999';
    journal.getEventsAfter.mockResolvedValue(
      pendingApprovalSnapshot('story.applyProposal', {
        storyAgentRunId: storyRunId,
      }),
    );

    try {
      await service.cancelRun(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        VICTIM.projectId,
      );
      throw new Error('Expected Story proposal Stop to require a decision.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        code: 'AGENT_OS_STORY_PROPOSAL_DECISION_REQUIRED',
        message:
          'This Story proposal is awaiting a decision and cannot be stopped. Choose Approve or Discard.',
        storyRunId,
      });
    }
    expect(journal.cancelRun).not.toHaveBeenCalled();
    expect(worker.cancelRun).not.toHaveBeenCalled();
    expect(storyAgentRuns.cancelAgentOsAuthoring).not.toHaveBeenCalled();
    expect(
      storyAgentRuns.resolveAgentOsProposalDecision,
    ).not.toHaveBeenCalled();
  });

  it('atomically cancels the initial Story authoring handoff', async () => {
    const { service, worker, journal, storyAgentRuns, projects } = makeService({
      projectKind: 'story',
      ownership: STORY_OWNERSHIP,
    });
    const storyRunId = '99999999-9999-4999-8999-999999999999';
    projects.requireWrite.mockResolvedValue({
      projectId: VICTIM.projectId,
      projectKind: 'story',
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    journal.getEventsAfter.mockResolvedValue({
      runId: VICTIM.runId,
      status: 'waiting_for_external',
      events: [],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: {
        kind: 'external_job',
        jobId: storyRunId,
        toolId: 'story.author',
      },
      assistantText: 'Drafting the proposal.',
    });

    await expect(
      service.cancelRun(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        VICTIM.projectId,
        'Stopped by user',
      ),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(storyAgentRuns.cancelAgentOsAuthoring).toHaveBeenCalledWith({
      user: { userId: VICTIM.actorId },
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      projectId: VICTIM.projectId,
      agentRunId: VICTIM.runId,
      conversationId: VICTIM.conversationId,
      storyRunId,
      reason: 'Stopped by user',
    });
    expect(journal.cancelRun).not.toHaveBeenCalled();
    expect(worker.cancelRun).toHaveBeenCalledWith(
      VICTIM.runId,
      'Stopped by user',
    );
  });

  it('never lets stale Worker memory override a durable terminal run', async () => {
    const { service, worker, journal } = makeService();
    worker.listEvents.mockResolvedValue({
      runId: VICTIM.runId,
      status: 'running',
      events: [{ type: 'MessageDelta' }],
    });
    journal.getEventsAfter.mockResolvedValue({
      runId: VICTIM.runId,
      status: 'cancelled',
      events: [{ type: 'RunCancelled' }],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: null,
    });

    await expect(
      service.listEvents(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        VICTIM.projectId,
        0,
      ),
    ).resolves.toMatchObject({
      status: 'cancelled',
      source: 'postgres',
      events: [{ type: 'RunCancelled' }],
    });
    expect(worker.listEvents).not.toHaveBeenCalled();
  });

  it('refuses to resolve another project’s pending approval', async () => {
    const { service, worker } = makeService();
    await expect(
      service.resolveApproval(ATTACKER, VICTIM.runId, {
        approvalId: APPROVAL_ID,
        responseId: APPROVAL_RESPONSE_ID,
        decision: 'approve',
        ...APPROVAL_DISPLAY,
        projectId: ATTACKER_PROJECT,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.resolveApproval).not.toHaveBeenCalled();
  });

  it('refuses to answer another project’s structured input request', async () => {
    const { service, worker } = makeService();
    await expect(
      service.resolveUserInput(ATTACKER, VICTIM.runId, {
        requestId: '99999999-9999-4999-8999-999999999999',
        responseId: '88888888-8888-4888-8888-888888888888',
        answers: { aspect_ratio: 'landscape_16_9' },
        projectId: ATTACKER_PROJECT,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.resolveUserInput).not.toHaveBeenCalled();
  });

  it('resumes structured input with the run’s own identity', async () => {
    const { service, worker } = makeService();
    await service.resolveUserInput(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        requestId: '99999999-9999-4999-8999-999999999999',
        responseId: '88888888-8888-4888-8888-888888888888',
        answers: { aspect_ratio: 'landscape_16_9' },
        projectId: VICTIM.projectId,
        conversationId: 'dddddddd-9999-4999-8999-999999999999',
        modelProfileId: 'qwen-plus',
      } as never,
    );
    expect(worker.resolveUserInput).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
        responseId: '88888888-8888-4888-8888-888888888888',
      }),
    );
  });

  it('returns the durable snapshot for an identical responseId retry', async () => {
    const { service, worker, journal } = makeService();
    const requestId = '99999999-9999-4999-8999-999999999999';
    const responseId = '88888888-8888-4888-8888-888888888888';
    journal.getEventsAfter.mockResolvedValue({
      runId: VICTIM.runId,
      status: 'running',
      events: [
        {
          type: 'UserInputResolved',
          data: {
            turnId: '77777777-7777-4777-8777-777777777777',
            requestId,
            responseId,
            answers: {
              story_language: 'zh-CN',
              aspect_ratio: 'landscape_16_9',
            },
          },
        },
      ],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: { kind: 'external_job', jobId: 'job-1' },
      assistantText: 'Thanks — I have your answers.',
    });
    journal.claimUserInputResponse.mockResolvedValue({
      kind: 'resolved',
      snapshot: {},
    });

    const result = await service.resolveUserInput(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        requestId,
        responseId,
        // Reversed key order proves comparison is canonical, not JSON order.
        answers: {
          aspect_ratio: 'landscape_16_9',
          story_language: 'zh-CN',
        },
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      } as never,
    );

    expect(worker.resolveUserInput).not.toHaveBeenCalled();
    expect(journal.claimUserInputResponse).toHaveBeenCalledWith({
      runId: VICTIM.runId,
      requestId,
      responseId,
      answers: {
        aspect_ratio: 'landscape_16_9',
        story_language: 'zh-CN',
      },
      leaseDurationMs: 30_000,
    });
    expect(result).toMatchObject({
      runId: VICTIM.runId,
      status: 'running',
      pendingUserInput: null,
      pendingExternal: { kind: 'external_job', jobId: 'job-1' },
      assistantText: 'Thanks — I have your answers.',
    });
  });

  it('rejects reuse of a responseId with a different payload', async () => {
    const { service, worker, journal } = makeService();
    const requestId = '99999999-9999-4999-8999-999999999999';
    const responseId = '88888888-8888-4888-8888-888888888888';
    journal.claimUserInputResponse.mockRejectedValue(
      new ConflictException({
        code: 'AGENT_OS_INPUT_RESPONSE_CONFLICT',
        message:
          'This responseId was already used for a different structured-input answer.',
      }),
    );

    await expect(
      service.resolveUserInput(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        {
          requestId,
          responseId,
          answers: { aspect_ratio: 'portrait_9_16' },
          projectId: VICTIM.projectId,
          conversationId: VICTIM.conversationId,
          modelProfileId: 'qwen-plus',
        } as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(worker.resolveUserInput).not.toHaveBeenCalled();
  });

  it('waits outside the claim transaction for an in-flight identical response', async () => {
    const { service, worker, journal } = makeService();
    const requestId = '99999999-9999-4999-8999-999999999999';
    const responseId = '88888888-8888-4888-8888-888888888888';
    const waiting = {
      runId: VICTIM.runId,
      status: 'waiting_for_input',
      events: [],
      pendingApproval: null,
      pendingUserInput: { requestId },
      pendingExternal: null,
      assistantText: 'Choose an option.',
    };
    const resolved = {
      ...waiting,
      status: 'running',
      events: [
        {
          type: 'UserInputResolved',
          data: {
            turnId: '77777777-7777-4777-8777-777777777777',
            requestId,
            responseId,
            answers: { aspect_ratio: 'landscape_16_9' },
          },
        },
      ],
      pendingUserInput: null,
      assistantText: 'Thanks — I have your answers.',
    };
    journal.claimUserInputResponse.mockResolvedValue({
      kind: 'in_flight',
      leaseExpiresAt: new Date(Date.now() + 5_000),
      snapshot: waiting,
    });
    journal.getEventsAfter
      .mockResolvedValueOnce(waiting)
      .mockResolvedValue(resolved);

    const result = await service.resolveUserInput(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        requestId,
        responseId,
        answers: { aspect_ratio: 'landscape_16_9' },
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      } as never,
    );

    expect(worker.resolveUserInput).not.toHaveBeenCalled();
    expect(journal.getEventsAfter).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      runId: VICTIM.runId,
      status: 'running',
      pendingUserInput: null,
      assistantText: 'Thanks — I have your answers.',
    });
  });

  it('returns PostgreSQL success when the Worker acknowledgement is lost', async () => {
    const { service, worker, journal, runContinuations } = makeService();
    const requestId = '99999999-9999-4999-8999-999999999999';
    const responseId = '88888888-8888-4888-8888-888888888888';
    worker.resolveUserInput.mockRejectedValue(new Error('socket closed'));
    journal.getEventsAfter.mockResolvedValue({
      runId: VICTIM.runId,
      status: 'running',
      events: [
        {
          type: 'UserInputResolved',
          data: {
            turnId: '77777777-7777-4777-8777-777777777777',
            requestId,
            responseId,
            answers: { aspect_ratio: 'landscape_16_9' },
          },
        },
      ],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: 'Thanks — I have your answers.',
    });

    const result = await service.resolveUserInput(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        requestId,
        responseId,
        answers: { aspect_ratio: 'landscape_16_9' },
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      } as never,
    );

    expect(worker.resolveUserInput).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'running',
      pendingUserInput: null,
    });
    expect(runContinuations.dispatch).toHaveBeenCalledWith(VICTIM.runId);
  });

  it('answers the same for an unknown run as for someone else’s', async () => {
    // Existence is itself information about another tenant.
    const { service } = makeService({ ownership: null });
    await expect(
      service.listEvents(ATTACKER, VICTIM.runId, ATTACKER_PROJECT, 0),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sends the run’s own identity downstream, not the caller’s copy', async () => {
    const { service, worker, journal } = makeService();
    journal.getEventsAfter.mockResolvedValue(pendingApprovalSnapshot());
    await service.resolveApproval(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        approvalId: APPROVAL_ID,
        responseId: APPROVAL_RESPONSE_ID,
        decision: 'approve',
        ...APPROVAL_DISPLAY,
        projectId: VICTIM.projectId,
        // A conversationId that does not belong to the run must not reach the
        // worker: it is the LangGraph thread the write resumes into.
        conversationId: 'dddddddd-9999-4999-8999-999999999999',
        modelProfileId: 'qwen-plus',
      } as never,
    );
    expect(worker.resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: APPROVAL_ID,
        responseId: APPROVAL_RESPONSE_ID,
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
      }),
    );
    expect(journal.claimApprovalResponse).toHaveBeenCalledWith({
      runId: VICTIM.runId,
      approvalId: APPROVAL_ID,
      responseId: APPROVAL_RESPONSE_ID,
      decision: 'approve',
      ...APPROVAL_DISPLAY,
      leaseDurationMs: 30_000,
    });
  });

  it('waits outside the claim transaction when another pod owns the same approval response', async () => {
    const { service, worker, journal } = makeService();
    const waiting = pendingApprovalSnapshot();
    const resolved = resolvedApprovalSnapshot();
    journal.claimApprovalResponse.mockResolvedValue({
      kind: 'in_flight',
      leaseExpiresAt: new Date(Date.now() + 5_000),
      snapshot: waiting,
    });
    journal.getEventsAfter
      .mockResolvedValueOnce(waiting)
      .mockResolvedValueOnce(waiting)
      .mockResolvedValue(resolved);

    const result = await service.resolveApproval(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        approvalId: APPROVAL_ID,
        responseId: APPROVAL_RESPONSE_ID,
        decision: 'approve',
        ...APPROVAL_DISPLAY,
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      },
    );

    expect(worker.resolveApproval).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'running',
      pendingApproval: null,
    });
  });

  it('does not dispatch a competing approval response rejected by the durable claim', async () => {
    const { service, worker, journal } = makeService();
    journal.getEventsAfter.mockResolvedValue(pendingApprovalSnapshot());
    journal.claimApprovalResponse.mockRejectedValue(
      new ConflictException({
        code: 'AGENT_OS_APPROVAL_RESPONSE_IN_FLIGHT',
        message:
          'Another response to this approval is already being submitted.',
      }),
    );

    await expect(
      service.resolveApproval(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        {
          approvalId: APPROVAL_ID,
          responseId: 'aaaaaaaa-7777-4777-8777-777777777777',
          decision: 'reject',
          responseText: 'Rejected',
          locale: 'en-US',
          projectId: VICTIM.projectId,
          conversationId: VICTIM.conversationId,
          modelProfileId: 'qwen-plus',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(worker.resolveApproval).not.toHaveBeenCalled();
  });

  it('returns PostgreSQL approval success when the Worker HTTP response is lost', async () => {
    const { service, worker, journal, runContinuations } = makeService();
    journal.getEventsAfter.mockResolvedValue(pendingApprovalSnapshot());
    worker.resolveApproval.mockImplementation(() => {
      journal.getEventsAfter.mockResolvedValue(resolvedApprovalSnapshot());
      return Promise.reject(new Error('socket closed'));
    });

    const result = await service.resolveApproval(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        approvalId: APPROVAL_ID,
        responseId: APPROVAL_RESPONSE_ID,
        decision: 'approve',
        ...APPROVAL_DISPLAY,
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      },
    );

    expect(worker.resolveApproval).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'running',
      pendingApproval: null,
    });
    expect(runContinuations.dispatch).toHaveBeenCalledWith(VICTIM.runId);
  });

  it('returns the durable snapshot for an identical approval response retry', async () => {
    const { service, worker, journal } = makeService();
    journal.getEventsAfter.mockResolvedValue(resolvedApprovalSnapshot());

    const result = await service.resolveApproval(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        approvalId: APPROVAL_ID,
        responseId: APPROVAL_RESPONSE_ID,
        decision: 'approve',
        ...APPROVAL_DISPLAY,
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
      },
    );

    expect(worker.resolveApproval).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      runId: VICTIM.runId,
      status: 'running',
      pendingApproval: null,
      assistantText: 'I have your decision and will continue.',
    });
  });

  it('rejects reuse of an approval responseId with a different decision', async () => {
    const { service, worker, journal } = makeService();
    journal.getEventsAfter.mockResolvedValue(resolvedApprovalSnapshot());

    await expect(
      service.resolveApproval(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        {
          approvalId: APPROVAL_ID,
          responseId: APPROVAL_RESPONSE_ID,
          decision: 'reject',
          ...APPROVAL_DISPLAY,
          projectId: VICTIM.projectId,
          conversationId: VICTIM.conversationId,
          modelProfileId: 'qwen-plus',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(worker.resolveApproval).not.toHaveBeenCalled();
  });

  it('rejects reuse of an approval responseId with different durable display copy', async () => {
    const { service, worker, journal } = makeService();
    journal.getEventsAfter.mockResolvedValue(resolvedApprovalSnapshot());

    await expect(
      service.resolveApproval(
        { userId: VICTIM.actorId } as never,
        VICTIM.runId,
        {
          approvalId: APPROVAL_ID,
          responseId: APPROVAL_RESPONSE_ID,
          decision: 'approve',
          responseText: '已批准',
          locale: 'zh-CN',
          projectId: VICTIM.projectId,
          conversationId: VICTIM.conversationId,
          modelProfileId: 'qwen-plus',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(worker.resolveApproval).not.toHaveBeenCalled();
  });

  it('routes Story proposal decisions to the atomic Story coordinator', async () => {
    const { service, worker, journal, storyAgentRuns, projects } = makeService({
      projectKind: 'story',
      ownership: STORY_OWNERSHIP,
    });
    const storyRunId = '99999999-9999-4999-8999-999999999999';
    journal.getEventsAfter.mockResolvedValue(
      pendingApprovalSnapshot('story.applyProposal', {
        storyAgentRunId: storyRunId,
      }),
    );
    projects.requireWrite.mockResolvedValue({
      projectId: VICTIM.projectId,
      projectKind: 'story',
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    const result = await service.resolveApproval(
      { userId: VICTIM.actorId } as never,
      VICTIM.runId,
      {
        approvalId: APPROVAL_ID,
        responseId: APPROVAL_RESPONSE_ID,
        decision: 'approve',
        ...APPROVAL_DISPLAY,
        projectId: VICTIM.projectId,
        conversationId: VICTIM.conversationId,
        modelProfileId: 'qwen-plus',
        experience: 'mobile_h5',
      },
    );

    expect(worker.resolveApproval).not.toHaveBeenCalled();
    expect(storyAgentRuns.resolveAgentOsProposalDecision).toHaveBeenCalledWith({
      user: { userId: VICTIM.actorId },
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      projectId: VICTIM.projectId,
      agentRunId: VICTIM.runId,
      conversationId: VICTIM.conversationId,
      storyRunId,
      approvalId: APPROVAL_ID,
      responseId: APPROVAL_RESPONSE_ID,
      decision: 'approve',
      ...APPROVAL_DISPLAY,
      experience: 'mobile_h5',
    });
    expect(result.status).toBe('waiting_for_external');
  });

  it('refuses a realtime token for a conversation owned by someone else', async () => {
    const { service, realtimeTokens } = makeService({
      conversationConflicts: true,
    });
    await expect(
      service.issueRealtimeToken(
        ATTACKER,
        ATTACKER_PROJECT,
        VICTIM.conversationId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(realtimeTokens.issueConversationToken).not.toHaveBeenCalled();
  });

  it('still mints a token for a conversation that has no runs yet', async () => {
    // The client mints before the first turn exists; an unclaimed conversation
    // must keep working or every new thread fails on its first message.
    const { service, realtimeTokens } = makeService({
      conversationConflicts: false,
    });
    await service.issueRealtimeToken(ATTACKER, ATTACKER_PROJECT, 'brand-new');
    expect(realtimeTokens.issueConversationToken).toHaveBeenCalled();
  });

  it('refuses to start a run on another actor’s conversation', async () => {
    const { service, worker } = makeService({ conversationConflicts: true });
    await expect(
      service.startRun(ATTACKER, {
        ...START_IDENTITIES,
        projectId: ATTACKER_PROJECT,
        conversationId: VICTIM.conversationId,
        message: 'hi',
        modelProfileId: 'qwen-plus',
        workbenchMode: 'storyboard',
        workbenchContext: {
          sectionId: 'dddddddd-1111-4111-8111-111111111111',
        },
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(worker.startRun).not.toHaveBeenCalled();
  });

  it('returns the first durable run after a replay dispatch response is lost', async () => {
    const { service, journal, runStarts, attachments, projects } = makeService({
      conversationConflicts: false,
    });
    const durableEvent = {
      id: START_IDENTITIES.messageId,
      runId: VICTIM.runId,
      conversationId: START_IDENTITIES.conversationId,
      sequence: 1,
      type: 'UserMessage',
      data: {
        messageId: START_IDENTITIES.messageId,
        turnId: START_IDENTITIES.turnId,
        text: 'Add a shot',
      },
    };
    journal.findRunStartSubmission.mockResolvedValue({
      kind: 'replay',
      runId: VICTIM.runId,
      events: [durableEvent],
      snapshot: {
        runId: VICTIM.runId,
        conversationId: START_IDENTITIES.conversationId,
        status: 'completed',
        lastSequence: 1,
        pendingApproval: null,
        pendingUserInput: null,
        pendingExternal: null,
        assistantText: 'Done.',
      },
    });
    runStarts.dispatch.mockRejectedValue(
      new Error('Worker response was lost after persistence'),
    );
    journal.getEventsAfter.mockResolvedValue({
      runId: VICTIM.runId,
      status: 'completed',
      events: [durableEvent],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: 'Done.',
    });

    const result = await service.startRun(ATTACKER, {
      ...START_IDENTITIES,
      projectId: ATTACKER_PROJECT,
      message: 'Add a shot',
      modelProfileId: 'qwen-plus',
      workbenchMode: 'storyboard',
      workbenchContext: {
        sectionId: 'dddddddd-1111-4111-8111-111111111111',
      },
    });

    expect(runStarts.dispatch).toHaveBeenCalledWith(VICTIM.runId);
    expect(journal.reserveRunStart).not.toHaveBeenCalled();
    expect(attachments.validateForRun).not.toHaveBeenCalled();
    expect(projects.requirePlatformWorkbenchContext).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      runId: VICTIM.runId,
      status: 'completed',
      assistantText: 'Done.',
      events: [durableEvent],
    });
  });

  it('passes only the validated Platform chapter canvas scope to the worker', async () => {
    const { service, worker, projects } = makeService({
      conversationConflicts: false,
    });
    await service.startRun(ATTACKER, {
      ...START_IDENTITIES,
      projectId: ATTACKER_PROJECT,
      message: 'Add a shot',
      modelProfileId: 'qwen-plus',
      workbenchMode: 'storyboard',
      workbenchContext: {
        sectionId: 'dddddddd-1111-4111-8111-111111111111',
      },
    });
    expect(projects.requirePlatformWorkbenchContext).toHaveBeenCalledWith(
      ATTACKER_PROJECT,
      { sectionId: 'dddddddd-1111-4111-8111-111111111111' },
    );
    expect(worker.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKind: 'platform',
        workbenchContext: {
          sectionId: 'dddddddd-1111-4111-8111-111111111111',
          canvasDocumentId: 'eeeeeeee-1111-4111-8111-111111111111',
        },
      }),
    );
  });

  it('preserves the validated mobile H5 Story surface for the worker', async () => {
    const cancelledRunId = '99999999-9999-4999-8999-999999999999';
    const { service, worker, projects, storyAgentRuns, storyProductionPlans } =
      makeService({
        projectKind: 'story',
        conversationConflicts: false,
        latestStoryRun: { id: cancelledRunId, status: 'cancelled' },
      });
    await service.startRun(ATTACKER, {
      ...START_IDENTITIES,
      projectId: ATTACKER_PROJECT,
      message: 'Continue this chapter',
      modelProfileId: 'qwen-plus',
      workbenchMode: 'story',
      workbenchContext: {
        chapterId: '11111111-1111-4111-8111-111111111111',
        experience: 'mobile_h5',
      },
    });
    expect(projects.requireStoryWorkbenchContext).toHaveBeenCalledWith(
      ATTACKER_PROJECT,
      { chapterId: '11111111-1111-4111-8111-111111111111' },
    );
    expect(storyAgentRuns.getLatestRun).toHaveBeenCalledWith(
      ATTACKER,
      'workspace-1',
      ATTACKER_PROJECT,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(storyProductionPlans.getProductionState).toHaveBeenCalledWith(
      ATTACKER,
      ATTACKER_PROJECT,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(worker.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKind: 'story',
        modelProfileId: 'qwen3.7-plus',
        workbenchMode: 'story',
        workbenchContext: {
          chapterId: '11111111-1111-4111-8111-111111111111',
          experience: 'mobile_h5',
        },
        modelContext: storyAuthoringModelContext({
          latestRun: { id: cancelledRunId, status: 'cancelled' },
          productionState: EMPTY_STORY_PRODUCTION_STATE,
        }),
      }),
    );
  });

  it('validates and canonicalizes attachment ids before starting a run', async () => {
    const { service, worker, attachments } = makeService({
      projectKind: 'story',
      conversationConflicts: false,
    });
    const attachmentId = 'eeeeeeee-1111-4111-8111-111111111111';
    await service.startRun(ATTACKER, {
      ...START_IDENTITIES,
      projectId: ATTACKER_PROJECT,
      message: 'Use this source',
      modelProfileId: 'qwen-plus',
      workbenchMode: 'story',
      workbenchContext: {
        chapterId: '11111111-1111-4111-8111-111111111111',
      },
      attachmentIds: [attachmentId, attachmentId],
    });
    expect(attachments.validateForRun).toHaveBeenCalledWith(
      'story',
      ATTACKER_PROJECT,
      [attachmentId],
    );
    expect(worker.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ id: attachmentId, filename: `${attachmentId}.md` }],
      }),
    );
  });
});

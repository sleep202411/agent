/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest mock payload inspection is intentionally structural. */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  Prisma,
  StoryAgentAuthoringMode,
  StoryAgentRunKind,
  StoryAgentRunStatus,
  StoryDurationPreset,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
} from '@prisma/client';
import type {
  StoryPatchBrief,
  StoryPatchProposal,
} from '@repo/shared/story-agent';
import {
  buildStoryScreenplayDocument,
  StoryAssetProposalSchema,
  StoryPlotProposalSchema,
  StoryScreenplayProposalSchema,
} from '@repo/shared/story-agent';
import { storyVisualStyleSkillBySlug } from '@repo/shared';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
  type StoryVisualStyle,
} from './dto';
import {
  storyProposalApprovalId,
  storyProposalDecisionTurnId,
} from '../agent-os-journal/agent-os-run-journal.service';
import {
  type StoryAgentProposalAuthority,
  screenplayForCanonicalChapter,
  StoryAgentRunService,
} from './story-agent-run.service';

const USER = { userId: 'user-1' };
const CONFIRMING_EDITOR = { userId: 'editor-2' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-00000000000c';
const RUN_ID = '0197f4a2-0800-7000-8000-000000000003';
const OTHER_RUN_ID = '0197f4a2-0800-7000-8000-000000000004';
const OPERATION_ID = '0197f4a2-0800-7000-8000-000000000005';
const WORKER_ID = 'story-agent:test-worker';
const NOW = new Date('2026-07-18T12:00:00.000Z');
const PENDING_LEASE_TTL_MS = 5_000;
const AUTHORING_TTL_MS = 15 * 60 * 1_000;
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1_000;
const PRE_CONFIRM_STATUSES = [
  StoryAgentRunStatus.authoring,
  StoryAgentRunStatus.authoring_failed,
  StoryAgentRunStatus.proposed,
];
const AUTHORING_SNAPSHOT = {
  draftRevision: 7,
  draftContentHash: canonicalJsonHash(EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT),
  layoutRevision: 3,
  scriptDocumentId: null,
  scriptSequence: 0,
  scriptHash: canonicalJsonHash({ state: null, sequence: 0 }),
} as const;
const BRIEF_TEXT =
  'Open the story bible with a premise about a dream that remembers its author.';
const DOCUMENT_ID = '0197f4a2-0800-7000-8000-00000000000d';
const BRIEF_CONVERSATION_ID = `story-canvas:${PROJECT_ID}:${CHAPTER_ID}`;
const SOURCE_AGENT_RUN_ID = '0197f4a2-0800-7000-8000-00000000000e';
const SOURCE_AGENT_TURN_ID = '0197f4a2-0800-7000-8000-00000000000f';
const SOURCE_AGENT_CONVERSATION_ID = '0197f4a2-0800-7000-8000-000000000010';
const SOURCE_CONTINUATION_PLAN = {
  continueThrough: 'storyboard' as const,
  title: 'A remembered dream',
  summary: 'Establish the premise.',
  brief: BRIEF_TEXT,
};
const CINEMATIC_REALISM_SKILL =
  storyVisualStyleSkillBySlug('cinematic-realism')!;
const CINEMATIC_REALISM_PROMPT =
  'Compose grounded live-action imagery with motivated light, tactile production design, and restrained cinematic color.';
const CINEMATIC_REALISM_POLICY = {
  promptAuthoring: { instructions: CINEMATIC_REALISM_PROMPT },
  image: { promptSuffix: 'grounded cinematic realism' },
  video: { promptSuffix: 'grounded live-action motion' },
} as const;

describe('screenplayForCanonicalChapter', () => {
  it('preserves Script prose and adds Plot clips created through another write path', () => {
    const draft = InteractiveStoryDraftContentSchema.parse({
      ...EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      graph: {
        entryNodeId: 'opening',
        nodes: [
          {
            kind: 'clip',
            nodeId: 'opening',
            clipKey: 'OPENING',
            name: 'Opening',
            description: 'The page opens.',
            interactions: [],
            exit: { kind: 'auto', nextNodeId: 'clip:scene-30' },
          },
          {
            kind: 'clip',
            nodeId: 'clip:scene-30',
            clipKey: 'SCENE_30',
            name: 'Scene 30',
            description: 'A newly imported scene.',
            interactions: [],
            exit: { kind: 'auto', nextNodeId: null },
          },
        ],
      },
    });

    const projected = screenplayForCanonicalChapter(
      LEGACY_APPROVED_SCREENPLAY,
      draft,
    );

    expect(projected.scenes.map((scene) => scene.nodeId)).toEqual([
      'opening',
      'clip:scene-30',
    ]);
    expect(projected.scenes[0]).toMatchObject({
      action: 'A page turns itself in the dark.',
      exit: { kind: 'auto', nextNodeId: 'clip:scene-30' },
    });
    expect(projected.scenes[1]).toMatchObject({
      heading: 'Scene 30',
      beat: 'A newly imported scene.',
      action: 'A newly imported scene.',
    });
  });
});
const LEGACY_APPROVED_SCREENPLAY = {
  schemaVersion: 'interactive-screenplay-v1' as const,
  storyLanguage: 'en-US',
  title: 'A remembered dream',
  logline: 'A dream remembers its author.',
  synopsis: 'The author wakes inside the dream they abandoned.',
  characters: [],
  entrySceneId: 'opening',
  scenes: [
    {
      nodeId: 'opening',
      clipKey: 'OPENING',
      heading: 'INT. DREAM – NIGHT',
      beat: 'The dream recognizes its author.',
      action: 'A page turns itself in the dark.',
      dialogue: [],
      exit: { kind: 'auto' as const, nextNodeId: null },
    },
  ],
};
const LEGACY_SCRIPT_DOCUMENT_ID = '0197f4a2-0800-7000-8000-000000000041';
const LEGACY_SCRIPT_VERSION_ID = '0197f4a2-0800-7000-8000-000000000042';
const LEGACY_REARMED_PROPOSAL = StoryScreenplayProposalSchema.parse({
  schemaVersion: 'story-screenplay-proposal-v1',
  draftSchemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  baseDraftRevision: AUTHORING_SNAPSHOT.draftRevision,
  baseContentHash: AUTHORING_SNAPSHOT.draftContentHash,
  baseLayoutRevision: AUTHORING_SNAPSHOT.layoutRevision,
  baseScriptDocumentId: LEGACY_SCRIPT_DOCUMENT_ID,
  baseScriptSequence: 0,
  baseScriptHash: 'b'.repeat(64),
  title: 'A remembered dream',
  summary: 'The approved Script was already saved.',
  screenplay: LEGACY_APPROVED_SCREENPLAY,
  productionPlan: {
    schemaVersion: 'story-production-plan-v1',
    assetSpecs: [],
    storyboardSequences: [
      {
        plotNodeId: 'opening',
        title: 'Opening',
        description: 'The dream recognizes its author.',
        durationMs: 1_000,
        clips: [
          {
            stableKey: 'shot.opening',
            kind: 'image',
            title: 'Opening',
            description: 'The opening frame.',
            startMs: 0,
            durationMs: 1_000,
            imagePrompt: 'A page turns itself in a dark dream.',
          },
        ],
        cues: [],
      },
    ],
  },
});
const H5_ASSET_PROPOSAL = StoryAssetProposalSchema.parse({
  schemaVersion: 'story-asset-proposal-v1',
  draftSchemaVersion: LEGACY_REARMED_PROPOSAL.draftSchemaVersion,
  baseDraftRevision: LEGACY_REARMED_PROPOSAL.baseDraftRevision,
  baseContentHash: LEGACY_REARMED_PROPOSAL.baseContentHash,
  baseLayoutRevision: LEGACY_REARMED_PROPOSAL.baseLayoutRevision,
  baseScriptDocumentId: LEGACY_SCRIPT_DOCUMENT_ID,
  baseScriptSequence: 0,
  baseScriptHash:
    '96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7',
  title: LEGACY_REARMED_PROPOSAL.title,
  summary: 'Asset Specs are ready.',
  screenplay: LEGACY_REARMED_PROPOSAL.screenplay,
  assetPlan: {
    assetSpecs: [
      {
        stableKey: 'location.dream-room',
        kind: 'location',
        name: 'Dream Room',
        description: 'A dark room where pages turn themselves.',
        imagePrompt: 'A cinematic dark room with a page turning by itself.',
        sourceNodeIds: ['opening'],
      },
    ],
  },
});
const H5_PLOT_PROPOSAL = StoryPlotProposalSchema.parse({
  schemaVersion: 'story-plot-proposal-v1',
  draftSchemaVersion: LEGACY_REARMED_PROPOSAL.draftSchemaVersion,
  baseDraftRevision: LEGACY_REARMED_PROPOSAL.baseDraftRevision,
  baseContentHash: LEGACY_REARMED_PROPOSAL.baseContentHash,
  baseLayoutRevision: LEGACY_REARMED_PROPOSAL.baseLayoutRevision,
  baseScriptDocumentId: LEGACY_SCRIPT_DOCUMENT_ID,
  baseScriptSequence: 0,
  baseScriptHash:
    '96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7',
  title: LEGACY_REARMED_PROPOSAL.title,
  summary: 'Plot Tree is ready.',
  screenplay: LEGACY_REARMED_PROPOSAL.screenplay,
  document: buildStoryScreenplayDocument(LEGACY_REARMED_PROPOSAL.screenplay),
});

const changedOverviewOperation = {
  operationId: OPERATION_ID,
  summary: 'Give the story a premise.',
  kind: 'story_bible.update_overview' as const,
  payload: { logline: 'A dream remembers its author.' },
};

describe('StoryAgentRunService', () => {
  it('rejects client-provided App origins without the Server production authority', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const { service } = serviceWith(proposalTransaction(createdRows));
    await expect(
      service.createAuthoringRun(USER, WORKSPACE_ID, PROJECT_ID, {
        ...briefInput(),
        sourceAppStoryRunId: '01990000-0000-7000-8000-000000000010',
      }),
    ).rejects.toThrow('Server coordinator');
    expect(createdRows).toHaveLength(0);
  });

  it('files a drafting brief as a durable authoring run with a pending worker lease', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows);
    const { service, realtime } = serviceWith(tx);

    const result = await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput(),
    );

    expect(result.status).toBe('authoring');
    expect(result.proposal).toEqual(briefRecord());
    expect(result.expiresAt).toBe(
      new Date(NOW.getTime() + AUTHORING_TTL_MS).toISOString(),
    );
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toEqual(
      expect.objectContaining({
        kind: StoryAgentRunKind.apply,
        status: StoryAgentRunStatus.authoring,
        proposal: briefRecord(),
        baseDraftRevision: 7,
        baseLayoutRevision: 3,
        leaseOwner: 'story-agent:pending',
        leaseAcquiredAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + PENDING_LEASE_TTL_MS),
        expiresAt: new Date(NOW.getTime() + AUTHORING_TTL_MS),
        idempotencyKey: `story-agent:proposal:${PROJECT_ID}:tool-call-1`,
        requestFingerprint: briefFingerprint(),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
  });

  it('derives a bounded stable database key from a long original tool idempotency key', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const { service } = serviceWith(proposalTransaction(createdRows));
    const originalKey = `${PROJECT_ID}:${RUN_ID}:${'tool-call'.repeat(30)}:v1`;

    await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput({ idempotencyKey: originalKey }),
    );

    const stored = String(createdRows[0]?.idempotencyKey);
    expect(stored).toMatch(
      new RegExp(`^story-agent:proposal:${PROJECT_ID}:sha256:[0-9a-f]{64}$`),
    );
    expect(stored.length).toBeLessThanOrEqual(240);
  });

  it('rejects authoring until the creator confirms a complete creative profile', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows, {
      project: canonicalProjectRow({
        durationPreset: null,
        visualStyle: null,
        creativeProfileConfirmedAt: null,
      }),
    });
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(USER, WORKSPACE_ID, PROJECT_ID, briefInput()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_CREATIVE_PROFILE_REQUIRED',
      }),
    });
    expect(createdRows).toHaveLength(0);
  });

  it('persists the complete originating Agent OS handoff identity and copy', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows);
    const { service } = serviceWith(tx);
    const source = {
      conversationId: SOURCE_AGENT_CONVERSATION_ID,
      sourceAgentRunId: SOURCE_AGENT_RUN_ID,
      sourceAgentTurnId: SOURCE_AGENT_TURN_ID,
      sourceAgentToolCallId: 'call_story_author_1',
      sourceStartedMessage: 'I am shaping the proposal now.',
      sourceCompletionMessage: 'The proposal is ready for review.',
      sourceContinuationPlan: SOURCE_CONTINUATION_PLAN,
    };

    await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput(source),
    );

    expect(createdRows[0]).toEqual(
      expect.objectContaining({
        conversationId: source.conversationId,
        sourceAgentRunId: source.sourceAgentRunId,
        sourceAgentTurnId: source.sourceAgentTurnId,
        sourceAgentToolCallId: source.sourceAgentToolCallId,
        sourceStartedMessage: source.sourceStartedMessage,
        sourceCompletionMessage: source.sourceCompletionMessage,
        sourceResultDeliveredAt: null,
        requestFingerprint: briefFingerprint(source),
      }),
    );
    expect(tx.agentOsRun.findFirst).toHaveBeenCalledWith({
      where: {
        id: SOURCE_AGENT_RUN_ID,
        projectId: PROJECT_ID,
        conversationId: SOURCE_AGENT_CONVERSATION_ID,
        actorId: USER.userId,
        projectKind: 'story',
        status: {
          in: [
            'queued',
            'running',
            'waiting_for_approval',
            'waiting_for_input',
            'waiting_for_external',
            'paused',
          ],
        },
      },
      select: { id: true, permissionMode: true },
    });
    expect(tx.agentOsExternalHandoffRegistration.create).toHaveBeenCalledWith({
      data: {
        externalJobId: RUN_ID,
        storyAgentRunId: RUN_ID,
        decisionContractVersion: 2,
        sourceAgentRunId: SOURCE_AGENT_RUN_ID,
        sourceAgentTurnId: SOURCE_AGENT_TURN_ID,
        sourceAgentToolCallId: 'call_story_author_1',
        sourceConversationId: SOURCE_AGENT_CONVERSATION_ID,
        sourceToolId: 'story.author',
        startedMessage: 'I am shaping the proposal now.',
        completionMessage: 'The proposal is ready for review.',
        continuationPlan: {
          ...SOURCE_CONTINUATION_PLAN,
          autoApplyTextStages: false,
        },
      },
    });
  });

  it.each([
    { permissionMode: 'full', experience: undefined, expected: true },
    { permissionMode: 'smart', experience: undefined, expected: false },
    { permissionMode: 'ask', experience: undefined, expected: false },
    { permissionMode: 'full', experience: 'mobile_h5', expected: false },
  ])(
    'derives text auto-apply from trusted $permissionMode / $experience',
    async ({ permissionMode, experience, expected }) => {
      const tx = proposalTransaction([]);
      tx.agentOsRun.findFirst.mockResolvedValue({
        id: SOURCE_AGENT_RUN_ID,
        permissionMode,
      });
      const { service } = serviceWith(tx);
      await service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          conversationId: SOURCE_AGENT_CONVERSATION_ID,
          sourceAgentRunId: SOURCE_AGENT_RUN_ID,
          sourceAgentTurnId: SOURCE_AGENT_TURN_ID,
          sourceAgentToolCallId: 'call_story_author_full',
          sourceStartedMessage: 'Preparing the requested text.',
          sourceCompletionMessage: 'The text is ready.',
          sourceContinuationPlan: {
            ...SOURCE_CONTINUATION_PLAN,
            ...(experience ? { experience } : {}),
            autoApplyTextStages: !expected,
          },
        }),
      );
      expect(tx.agentOsExternalHandoffRegistration.create).toHaveBeenCalledWith(
        {
          data: expect.objectContaining({
            continuationPlan: expect.objectContaining({
              autoApplyTextStages: expected,
            }),
          }),
        },
      );
    },
  );

  it('replays an accepted source handoff after its Agent run becomes terminal', async () => {
    const source = {
      conversationId: SOURCE_AGENT_CONVERSATION_ID,
      sourceAgentRunId: SOURCE_AGENT_RUN_ID,
      sourceAgentTurnId: SOURCE_AGENT_TURN_ID,
      sourceAgentToolCallId: 'call_story_author_1',
      sourceStartedMessage: 'I am shaping the proposal now.',
      sourceCompletionMessage: 'The proposal is ready for review.',
      sourceContinuationPlan: SOURCE_CONTINUATION_PLAN,
    };
    const tx = proposalTransaction([], {
      existing: authoringRunRow({
        ...source,
        requestFingerprint: briefFingerprint(source),
      }),
    });
    tx.agentOsRun.findFirst.mockResolvedValue(null);
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput(source),
      ),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'authoring' });

    expect(tx.agentOsRun.findFirst).not.toHaveBeenCalled();
    expect(tx.agentOsExternalHandoffRegistration.create).not.toHaveBeenCalled();
  });

  it('rejects a v2 proposal through one durable Story and Agent decision transaction', async () => {
    const approvalId = storyProposalApprovalId(RUN_ID);
    const responseId = '0197f4a2-0800-7000-8000-000000000011';
    const fixture = agentOsDecisionTransaction();
    const { service, realtime, agentOsJournal } = serviceWith(fixture.tx);
    const dispatch = agentDispatch('completed', 'Proposal discarded.');
    agentOsJournal.appendStoryProposalDecisionInTransaction.mockResolvedValue(
      dispatch,
    );

    const result = await service.resolveAgentOsProposalDecision({
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      agentRunId: SOURCE_AGENT_RUN_ID,
      conversationId: SOURCE_AGENT_CONVERSATION_ID,
      storyRunId: RUN_ID,
      approvalId,
      responseId,
      responseText: 'Discard this proposal.',
      locale: 'en-US',
      decision: 'reject',
    });

    expect(fixture.tx.storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.cancelled,
          sourceApprovalId: approvalId,
          sourceApprovalResponseId: responseId,
          sourceApprovalResponseText: 'Discard this proposal.',
          sourceApprovalLocale: 'en-US',
          sourceApprovalDecisionTurnId: storyProposalDecisionTurnId(responseId),
          sourceApprovalDecision: 'reject',
          sourceTerminalDeliveredAt: NOW,
        }),
      }),
    );
    expect(
      agentOsJournal.appendStoryProposalDecisionInTransaction,
    ).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        approvalTurnId: SOURCE_AGENT_TURN_ID,
        responseId,
        locale: 'en-US',
        decision: 'reject',
        userText: 'Discard this proposal.',
      }),
    );
    expect(result).toMatchObject({
      runId: SOURCE_AGENT_RUN_ID,
      status: 'completed',
      assistantText: 'Proposal discarded.',
    });
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
    expect(agentOsJournal.publishCommitted).toHaveBeenCalledWith(dispatch);
  });

  it('treats an approval response id as the exact idempotency identity', async () => {
    const approvalId = storyProposalApprovalId(RUN_ID);
    const responseId = '0197f4a2-0800-7000-8000-000000000011';
    const decided = agentManagedProposalRow({
      status: StoryAgentRunStatus.cancelled,
      sourceApprovalId: approvalId,
      sourceApprovalResponseId: responseId,
      sourceApprovalResponseText: 'Discard this proposal.',
      sourceApprovalLocale: 'zh-CN',
      sourceApprovalDecisionTurnId: storyProposalDecisionTurnId(responseId),
      sourceApprovalDecision: 'reject',
      sourceApprovalDecidedAt: NOW,
      sourceApprovalDecidedByUserId: USER.userId,
      sourceTerminalDeliveredAt: NOW,
    });
    const fixture = agentOsDecisionTransaction(decided);
    const { service, agentOsJournal } = serviceWith(fixture.tx);
    const dispatch = agentDispatch('completed', '故事提案已放弃。');
    agentOsJournal.snapshotRunInTransaction.mockResolvedValue(dispatch);

    await expect(
      service.resolveAgentOsProposalDecision({
        user: USER,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        agentRunId: SOURCE_AGENT_RUN_ID,
        conversationId: SOURCE_AGENT_CONVERSATION_ID,
        storyRunId: RUN_ID,
        approvalId,
        responseId,
        responseText: 'Discard this proposal.',
        locale: 'zh-CN',
        decision: 'reject',
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(fixture.tx.storyAgentRun.update).not.toHaveBeenCalled();

    await expect(
      service.resolveAgentOsProposalDecision({
        user: USER,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        agentRunId: SOURCE_AGENT_RUN_ID,
        conversationId: SOURCE_AGENT_CONVERSATION_ID,
        storyRunId: RUN_ID,
        approvalId,
        responseId: '0197f4a2-0800-7000-8000-000000000012',
        responseText: 'Discard this proposal.',
        locale: 'zh-CN',
        decision: 'reject',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_AGENT_APPROVAL_ALREADY_RESOLVED',
      }),
    });
  });

  it('writes applying and the complete v2 approval tuple atomically', async () => {
    const approvalId = storyProposalApprovalId(RUN_ID);
    const responseId = '0197f4a2-0800-7000-8000-000000000013';
    const fixture = agentOsDecisionTransaction();
    const { service, agentOsJournal } = serviceWith(fixture.tx);
    agentOsJournal.appendStoryProposalDecisionInTransaction.mockResolvedValue(
      agentDispatch('waiting_for_external', '正在应用故事提案。'),
    );

    await service.resolveAgentOsProposalDecision({
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      agentRunId: SOURCE_AGENT_RUN_ID,
      conversationId: SOURCE_AGENT_CONVERSATION_ID,
      storyRunId: RUN_ID,
      approvalId,
      responseId,
      responseText: '应用这个提案。',
      locale: 'zh-CN',
      decision: 'approve',
    });

    const applyingWrites = fixture.tx.storyAgentRun.update.mock.calls.filter(
      ([call]) => call.data.status === StoryAgentRunStatus.applying,
    );
    expect(applyingWrites).toHaveLength(1);
    expect(applyingWrites[0]?.[0].data).toEqual(
      expect.objectContaining({
        status: StoryAgentRunStatus.applying,
        sourceApprovalId: approvalId,
        sourceApprovalResponseId: responseId,
        sourceApprovalResponseText: '应用这个提案。',
        sourceApprovalLocale: 'zh-CN',
        sourceApprovalDecisionTurnId: storyProposalDecisionTurnId(responseId),
        sourceApprovalDecision: 'approve',
      }),
    );
    expect(
      fixture.tx.storyAgentRun.update.mock.calls.some(
        ([call]) =>
          call.data.sourceApprovalId === approvalId &&
          call.data.status === undefined,
      ),
    ).toBe(false);
  });

  it('upgrades a pre-existing Asset proposal when Continue is decided on H5', async () => {
    const fixture = agentOsDecisionTransaction(
      agentManagedProposalRow({ proposal: H5_ASSET_PROPOSAL }),
    );
    mockCurrentEmptyScriptHead(fixture.tx);
    const { service, agentOsJournal } = serviceWith(fixture.tx);
    agentOsJournal.appendStoryProposalDecisionInTransaction.mockResolvedValue(
      agentDispatch('waiting_for_external', '正在应用资产规格。'),
    );

    await service.resolveAgentOsProposalDecision({
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      agentRunId: SOURCE_AGENT_RUN_ID,
      conversationId: SOURCE_AGENT_CONVERSATION_ID,
      storyRunId: RUN_ID,
      approvalId: storyProposalApprovalId(RUN_ID),
      responseId: '0197f4a2-0800-7000-8000-000000000099',
      responseText: '继续：保存资产规格并自动生图',
      locale: 'zh-CN',
      decision: 'approve',
      experience: 'mobile_h5',
    });

    expect(
      fixture.tx.agentOsExternalHandoffRegistration.update,
    ).toHaveBeenCalledWith({
      where: { storyAgentRunId: RUN_ID },
      data: {
        continuationPlan: {
          ...SOURCE_CONTINUATION_PLAN,
          experience: 'mobile_h5',
          autoGenerateAssetImages: true,
        },
      },
    });
  });

  it('records H5 Plot Continue as authority to auto-apply Asset Specs and generate them sequentially', async () => {
    const fixture = agentOsDecisionTransaction(
      agentManagedProposalRow({ proposal: H5_PLOT_PROPOSAL }),
    );
    mockCurrentEmptyScriptHead(fixture.tx);
    const { service, agentOsJournal } = serviceWith(fixture.tx);
    agentOsJournal.appendStoryProposalDecisionInTransaction.mockResolvedValue(
      agentDispatch('waiting_for_external', '正在应用情节树。'),
    );

    await service.resolveAgentOsProposalDecision({
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      agentRunId: SOURCE_AGENT_RUN_ID,
      conversationId: SOURCE_AGENT_CONVERSATION_ID,
      storyRunId: RUN_ID,
      approvalId: storyProposalApprovalId(RUN_ID),
      responseId: '0197f4a2-0800-7000-8000-000000000097',
      responseText: '继续',
      locale: 'zh-CN',
      decision: 'approve',
      experience: 'mobile_h5',
    });

    expect(
      fixture.tx.agentOsExternalHandoffRegistration.update,
    ).toHaveBeenCalledWith({
      where: { storyAgentRunId: RUN_ID },
      data: {
        continuationPlan: {
          ...SOURCE_CONTINUATION_PLAN,
          experience: 'mobile_h5',
          autoApplyAssetSpecs: true,
          autoGenerateAssetImages: true,
        },
      },
    });
  });

  it('does not authorize automatic Asset generation from a desktop approval', async () => {
    const fixture = agentOsDecisionTransaction(
      agentManagedProposalRow({ proposal: H5_ASSET_PROPOSAL }),
    );
    mockCurrentEmptyScriptHead(fixture.tx);
    const { service, agentOsJournal } = serviceWith(fixture.tx);
    agentOsJournal.appendStoryProposalDecisionInTransaction.mockResolvedValue(
      agentDispatch('waiting_for_external', 'Applying Asset Specs.'),
    );

    await service.resolveAgentOsProposalDecision({
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      agentRunId: SOURCE_AGENT_RUN_ID,
      conversationId: SOURCE_AGENT_CONVERSATION_ID,
      storyRunId: RUN_ID,
      approvalId: storyProposalApprovalId(RUN_ID),
      responseId: '0197f4a2-0800-7000-8000-000000000098',
      responseText: 'Approve these Asset Specs.',
      locale: 'en-US',
      decision: 'approve',
    });

    expect(
      fixture.tx.agentOsExternalHandoffRegistration.update,
    ).not.toHaveBeenCalled();
  });

  it('atomically cancels initial v2 authoring but refuses Stop after proposal application commits', async () => {
    const fixture = agentOsDecisionTransaction(
      agentManagedProposalRow({
        status: StoryAgentRunStatus.authoring,
        proposal: briefRecord(),
        sourceProposalReadyDeliveredAt: null,
        leaseOwner: WORKER_ID,
        leaseAcquiredAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 30_000),
      }),
    );
    const { service, agentOsJournal } = serviceWith(fixture.tx);
    const dispatch = agentDispatch('cancelled', 'Authoring stopped.');
    agentOsJournal.cancelRunInTransaction.mockResolvedValue(dispatch);

    await expect(
      service.cancelAgentOsAuthoring({
        user: USER,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        agentRunId: SOURCE_AGENT_RUN_ID,
        conversationId: SOURCE_AGENT_CONVERSATION_ID,
        storyRunId: RUN_ID,
        reason: 'Stopped by creator',
      }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(fixture.tx.storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: StoryAgentRunStatus.cancelled,
          sourceTerminalDeliveredAt: NOW,
          leaseOwner: null,
        }),
      }),
    );
    expect(agentOsJournal.cancelRunInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      { runId: SOURCE_AGENT_RUN_ID, reason: 'Stopped by creator' },
    );

    const committedFixture = agentOsDecisionTransaction(
      agentManagedProposalRow({
        status: StoryAgentRunStatus.applying,
        sourceApprovalId: storyProposalApprovalId(RUN_ID),
      }),
    );
    const committed = serviceWith(committedFixture.tx);
    await expect(
      committed.service.cancelAgentOsAuthoring({
        user: USER,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        agentRunId: SOURCE_AGENT_RUN_ID,
        conversationId: SOURCE_AGENT_CONVERSATION_ID,
        storyRunId: RUN_ID,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OPERATION_COMMITTED' }),
    });
    expect(
      committed.agentOsJournal.cancelRunInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('rejects a partial Agent OS source tuple before creating a run', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const { service } = serviceWith(proposalTransaction(createdRows));

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({ sourceAgentRunId: SOURCE_AGENT_RUN_ID }),
      ),
    ).rejects.toThrow(
      'Agent OS source run, turn, tool call, lifecycle copy, and continuation plan must be supplied together.',
    );
    expect(createdRows).toHaveLength(0);
  });

  it('rejects a complete Agent OS source tuple without its conversation', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const { service } = serviceWith(proposalTransaction(createdRows));

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          sourceAgentRunId: SOURCE_AGENT_RUN_ID,
          sourceAgentTurnId: SOURCE_AGENT_TURN_ID,
          sourceAgentToolCallId: 'call_story_author_1',
          sourceStartedMessage: 'I am shaping the proposal now.',
          sourceCompletionMessage: 'The proposal is ready for review.',
          sourceContinuationPlan: SOURCE_CONTINUATION_PLAN,
        }),
      ),
    ).rejects.toThrow(
      'An Agent OS source handoff requires its originating conversation.',
    );
    expect(createdRows).toHaveLength(0);
  });

  it.each([true, false])(
    'validates and persists the selected project attachment (available=%s)',
    async (available) => {
      const createdRows: Array<Record<string, unknown>> = [];
      const attachmentQuery = jest.fn().mockResolvedValue(
        available
          ? {
              id: DOCUMENT_ID,
              filename: 'script.docx',
              status: 'ready',
              textContent: 'The complete script.',
            }
          : null,
      );
      const tx = {
        ...proposalTransaction(createdRows),
        agentOsAttachment: { findFirst: attachmentQuery },
      };
      const { service } = serviceWith(tx);
      const result = service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({ sourceAttachmentId: DOCUMENT_ID }),
      );
      if (available) {
        await expect(result).resolves.toMatchObject({
          proposal: { sourceAttachmentId: DOCUMENT_ID },
        });
        expect(createdRows[0]).toMatchObject({
          proposal: { sourceAttachmentId: DOCUMENT_ID },
        });
      } else {
        await expect(result).rejects.toThrow(
          'The source attachment is not available on this Story project.',
        );
        expect(createdRows).toHaveLength(0);
      }
      expect(attachmentQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: DOCUMENT_ID,
            projectKind: 'story',
            storyProjectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
          },
        }),
      );
    },
  );

  it('persists the brief documentId after verifying conversation-scoped ownership', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows) as Record<string, unknown> & {
      copilotDocument?: { findUnique: jest.Mock };
    };
    tx.copilotDocument = {
      findUnique: jest.fn().mockResolvedValue({
        userId: USER.userId,
        conversationId: BRIEF_CONVERSATION_ID,
      }),
    };
    const { service } = serviceWith(tx);

    const result = await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput({
        documentId: DOCUMENT_ID,
        conversationId: BRIEF_CONVERSATION_ID,
      }),
    );

    expect(tx.copilotDocument.findUnique).toHaveBeenCalledWith({
      where: { id: DOCUMENT_ID },
      select: { userId: true, conversationId: true },
    });
    expect(result.proposal).toEqual({
      ...briefRecord(),
      documentId: DOCUMENT_ID,
    });
    expect(createdRows[0]).toEqual(
      expect.objectContaining({
        proposal: { ...briefRecord(), documentId: DOCUMENT_ID },
        conversationId: BRIEF_CONVERSATION_ID,
        requestFingerprint: briefFingerprint({
          documentId: DOCUMENT_ID,
          conversationId: BRIEF_CONVERSATION_ID,
        }),
      }),
    );
  });

  it.each([
    [
      'a document owned by another creator',
      { userId: 'someone-else', conversationId: BRIEF_CONVERSATION_ID },
    ],
    [
      'a document from another conversation',
      { userId: USER.userId, conversationId: 'story-canvas:another' },
    ],
    ['a missing document', null],
  ])('rejects %s with a deterministic 422', async (_label, documentRow) => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows) as Record<string, unknown> & {
      copilotDocument?: { findUnique: jest.Mock };
    };
    tx.copilotDocument = {
      findUnique: jest.fn().mockResolvedValue(documentRow),
    };
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          documentId: DOCUMENT_ID,
          conversationId: BRIEF_CONVERSATION_ID,
        }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_AGENT_DOCUMENT_INVALID',
      }),
    });
    expect(createdRows).toHaveLength(0);
  });

  it('rejects a documentId that arrives without its conversation scope', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows) as Record<string, unknown> & {
      copilotDocument?: { findUnique: jest.Mock };
    };
    tx.copilotDocument = { findUnique: jest.fn() };
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({ documentId: DOCUMENT_ID }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_AGENT_DOCUMENT_INVALID',
      }),
    });
    expect(tx.copilotDocument.findUnique).not.toHaveBeenCalled();
    expect(createdRows).toHaveLength(0);
  });

  it.each([
    ['documentId', false],
    ['sourceAttachmentId', false],
    ['documentId', true],
  ] as const)(
    'loads the full %s text into the authoring job (App: %s)',
    async (sourceField, app) => {
      const authoringRun = runRow({
        status: StoryAgentRunStatus.authoring,
        proposal: { ...briefRecord(), [sourceField]: DOCUMENT_ID },
        conversationId: BRIEF_CONVERSATION_ID,
        leaseOwner: WORKER_ID,
        leaseExpiresAt: new Date(NOW.getTime() + 30_000),
        ...(app
          ? { sourceAppStoryRunId: '01990000-0000-7000-8000-000000000010' }
          : {}),
      });
      const emptyScriptDocument = {
        id: '0197f4a2-0800-7000-8000-000000000011',
        currentSequence: 0,
        crdtState: Buffer.from([0, 0]),
      };
      const tx = {
        appStoryRun: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ phase: 'script' }),
          findUnique: jest.fn().mockResolvedValue({
            plan: { goal: 'video' },
            modelConfig: {
              planner: 'qwen-planner',
              author: 'qwen-pinned-author',
              image: { modelId: 'image', schemaVersion: 'v1' },
              video: {
                modelId: 'minimax-h3-max',
                schemaVersion: 'v1',
                clipDurationSeconds: [5, 10, 15],
              },
            },
          }),
        },
        agentOsExternalHandoffRegistration: {
          findUnique: jest.fn().mockResolvedValue({
            continuationPlan: {
              ...SOURCE_CONTINUATION_PLAN,
              experience: 'mobile_h5',
            },
            sourceAgentRun: { modelProfileId: 'qwen3.7-plus' },
          }),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
        storyAgentRun: {
          findUnique: jest.fn().mockResolvedValue(authoringRun),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        storyProject: {
          findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
        },
        storyChapter: {
          findFirst: jest.fn().mockResolvedValue({ title: 'Chapter 1' }),
        },
        studioDocument: {
          findFirst: jest.fn().mockResolvedValue(emptyScriptDocument),
        },
        agentOsAttachment: {
          findFirst: jest.fn().mockResolvedValue({
            id: DOCUMENT_ID,
            filename: '剧本.docx',
            status: 'ready',
            textContent:
              'Opening section.\n'.repeat(2_000) +
              'Final section: the gate creaks open.',
          }),
        },
        copilotDocument: {
          findUnique: jest.fn().mockResolvedValue({
            id: DOCUMENT_ID,
            userId: USER.userId,
            conversationId: BRIEF_CONVERSATION_ID,
            name: '剧本.docx',
            text:
              'Opening section.\n'.repeat(2_000) +
              'Final section: the gate creaks open.',
          }),
        },
      };
      const { service } = serviceWith(tx);

      const load = await service.loadAuthoringJob(RUN_ID, WORKER_ID);

      expect(load.kind).toBe('job');
      if (load.kind !== 'job') throw new Error('expected job');
      // A resumed mobile job keeps its admitted model, even after the default changes.
      expect(load.job.modelId).toBe(
        app ? 'qwen-pinned-author' : 'qwen3.7-plus',
      );
      expect(load.job.videoClipDurationSeconds).toEqual(
        app ? [5, 10, 15] : undefined,
      );
      expect(load.job.document).toEqual({
        id: DOCUMENT_ID,
        name: '剧本.docx',
        text:
          'Opening section.\n'.repeat(2_000) +
          'Final section: the gate creaks open.',
      });
      expect(load.job.creativeProfile).toEqual({
        frameProfile: StoryFrameProfile.landscape_16_9,
        durationPreset: StoryDurationPreset.short_5_15,
        visualStyle: 'cinematic-realism',
        visualStyleSkillId: CINEMATIC_REALISM_SKILL.skillId,
        visualStyleSkillVersionId: CINEMATIC_REALISM_SKILL.versionId,
        visualStylePrompt: CINEMATIC_REALISM_PROMPT,
        storyLanguage: 'en-US',
        confirmedAt: NOW.toISOString(),
      });
      if (sourceField === 'sourceAttachmentId') {
        expect(tx.agentOsAttachment.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: DOCUMENT_ID,
              projectKind: 'story',
              storyProjectId: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
            },
          }),
        );
        expect(tx.copilotDocument.findUnique).not.toHaveBeenCalled();
        return;
      }
      expect(tx.copilotDocument.findUnique).toHaveBeenCalledWith({
        where: { id: DOCUMENT_ID },
        select: {
          id: true,
          userId: true,
          conversationId: true,
          name: true,
          text: true,
        },
      });
    },
  );

  it.each([
    StoryAgentAuthoringMode.downstream_reconcile,
    StoryAgentAuthoringMode.noop,
  ])(
    'terminalizes a legacy confirmed %s same-run continuation without downstream writes',
    async (authoringMode) => {
      const legacy = authoringRunRow({
        proposal: LEGACY_REARMED_PROPOSAL,
        authoringMode,
        confirmedByUserId: USER.userId,
        confirmedAt: NOW,
      });
      const completed = runRow({
        ...legacy,
        status: StoryAgentRunStatus.succeeded,
        authoringStages: null,
        resultDraftRevision: AUTHORING_SNAPSHOT.draftRevision,
        resultLayoutRevision: AUTHORING_SNAPSHOT.layoutRevision,
        beforeDraftSnapshot: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
        beforeDraftHash: AUTHORING_SNAPSHOT.draftContentHash,
        afterDraftSnapshot: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
        afterDraftHash: AUTHORING_SNAPSHOT.draftContentHash,
        beforeLayoutSnapshot: { nodePositions: {} },
        beforeLayoutHash: canonicalJsonHash({ nodePositions: {} }),
        afterLayoutSnapshot: { nodePositions: {} },
        afterLayoutHash: canonicalJsonHash({ nodePositions: {} }),
        applyingAt: NOW,
        revealStartedAt: NOW,
        completedAt: NOW,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
      });
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ now: NOW }])
          .mockResolvedValueOnce([freeWriteState()])
          .mockResolvedValueOnce([]),
        storyAgentRun: {
          findUnique: jest.fn().mockResolvedValue(legacy),
          findFirst: jest.fn().mockResolvedValue(completed),
          updateMany,
        },
        storyProject: {
          findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
        },
        studioDocument: {
          findFirst: jest.fn().mockResolvedValue({
            id: LEGACY_SCRIPT_DOCUMENT_ID,
            currentSequence: 1,
            currentVersionId: LEGACY_SCRIPT_VERSION_ID,
          }),
        },
        studioDocumentVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: LEGACY_SCRIPT_VERSION_ID,
            documentId: LEGACY_SCRIPT_DOCUMENT_ID,
            sequence: 1,
            snapshot: {
              screenplay: LEGACY_APPROVED_SCREENPLAY,
              document: buildStoryScreenplayDocument(
                LEGACY_APPROVED_SCREENPLAY,
              ),
            },
          }),
        },
      };
      const { service, realtime } = serviceWith(tx);

      await expect(
        service.loadAuthoringJob(RUN_ID, WORKER_ID),
      ).resolves.toEqual({
        kind: 'skip',
      });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: RUN_ID,
            status: StoryAgentRunStatus.authoring,
            authoringMode,
            confirmedAt: { not: null },
          }),
          data: expect.objectContaining({
            status: StoryAgentRunStatus.succeeded,
            resultDraftRevision: AUTHORING_SNAPSHOT.draftRevision,
            resultLayoutRevision: AUTHORING_SNAPSHOT.layoutRevision,
            affectedNodeIds: [],
            createdNodeIds: [],
            leaseOwner: null,
          }),
        }),
      );
      expect(realtime.enqueue).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    StoryAgentAuthoringMode.downstream_reconcile,
    StoryAgentAuthoringMode.noop,
  ])(
    'terminalizes a legacy confirmed applying %s run without replaying Script or downstream writes',
    async (authoringMode) => {
      const applying = runRow({
        status: StoryAgentRunStatus.applying,
        proposal: LEGACY_REARMED_PROPOSAL,
        authoringMode,
        confirmedByUserId: USER.userId,
        confirmedAt: NOW,
        applyingAt: NOW,
        fencingToken: 11n,
        leaseOwner: WORKER_ID,
        leaseAcquiredAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 30_000),
      });
      const storyRunUpdate = jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(
            runRow({
              ...applying,
              ...data,
              activeWriteState: null,
            }),
          ),
        );
      const scriptCreate = jest.fn();
      const scriptUpdate = jest.fn();
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            storyProjectId: PROJECT_ID,
            activeAgentRunId: RUN_ID,
            fencingToken: 11n,
            lockedAt: NOW,
            lockExpiresAt: new Date(NOW.getTime() + 60_000),
            databaseNow: NOW,
          },
        ]),
        storyAgentRun: {
          findUnique: jest.fn().mockResolvedValue(applying),
          update: storyRunUpdate,
        },
        storyProject: {
          findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
        },
        storyProjectWriteState: {
          update: jest.fn().mockResolvedValue(undefined),
        },
        studioDocument: {
          findFirst: jest.fn().mockResolvedValue({
            id: LEGACY_SCRIPT_DOCUMENT_ID,
            currentSequence: 1,
            currentVersionId: LEGACY_SCRIPT_VERSION_ID,
          }),
          create: scriptCreate,
          update: scriptUpdate,
        },
        studioDocumentVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: LEGACY_SCRIPT_VERSION_ID,
            documentId: LEGACY_SCRIPT_DOCUMENT_ID,
            sequence: 1,
            snapshot: {
              screenplay: LEGACY_APPROVED_SCREENPLAY,
              document: buildStoryScreenplayDocument(
                LEGACY_APPROVED_SCREENPLAY,
              ),
            },
          }),
        },
      };
      const { service, realtime } = serviceWith(tx);

      await service.executeClaimedRun(RUN_ID, WORKER_ID);

      expect(tx.storyProjectWriteState.update).toHaveBeenCalledWith({
        where: { storyProjectId: PROJECT_ID },
        data: {
          activeAgentRunId: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      });
      expect(storyRunUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: StoryAgentRunStatus.succeeded,
            resultDraftRevision: AUTHORING_SNAPSHOT.draftRevision,
            resultLayoutRevision: AUTHORING_SNAPSHOT.layoutRevision,
            affectedNodeIds: [],
            createdNodeIds: [],
            fencingToken: null,
          }),
        }),
      );
      expect(scriptCreate).not.toHaveBeenCalled();
      expect(scriptUpdate).not.toHaveBeenCalled();
      expect(realtime.enqueue).toHaveBeenCalledTimes(1);
    },
  );

  it('selects Storyboard after an approved empty Asset plan is current', async () => {
    const authoringRun = authoringRunRow();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        findUnique: jest.fn().mockResolvedValue(authoringRun),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({
          title: 'Chapter 1',
          sourceScriptDocumentId: null,
          sourceScriptVersionId: null,
          sourceScriptSequence: null,
        }),
      },
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: LEGACY_SCRIPT_DOCUMENT_ID,
          currentSequence: 1,
          currentVersionId: LEGACY_SCRIPT_VERSION_ID,
          crdtState: Buffer.from([0, 0]),
        }),
      },
      studioDocumentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: LEGACY_SCRIPT_VERSION_ID,
          documentId: LEGACY_SCRIPT_DOCUMENT_ID,
          sequence: 1,
          snapshot: {
            screenplay: LEGACY_APPROVED_SCREENPLAY,
            document: buildStoryScreenplayDocument(LEGACY_APPROVED_SCREENPLAY),
          },
        }),
      },
    };
    const { service, productionPlans } = serviceWith(tx);
    productionPlans.getProductionStateInTransaction.mockResolvedValue({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      profile: { status: 'current' },
      script: {
        status: 'current',
        documentId: LEGACY_SCRIPT_DOCUMENT_ID,
        sequence: 1,
      },
      plotTree: { status: 'current', nodeCount: 1 },
      assets: { status: 'current', currentCount: 0 },
      storyboard: {
        status: 'missing',
        sequenceCount: 0,
        missingPlotNodeIds: ['opening'],
      },
      ready: false,
    });
    productionPlans.readCurrentAssetPlanInTransaction.mockResolvedValue({
      assetSpecs: [],
    });

    const load = await service.loadAuthoringJob(RUN_ID, WORKER_ID);

    expect(load.kind).toBe('job');
    if (load.kind !== 'job') throw new Error('expected job');
    expect(load.job.targetStage).toBe('storyboard');
    expect(load.job.screenplaySnapshot?.versionId).toBe(
      LEGACY_SCRIPT_VERSION_ID,
    );
    expect(load.job.assetPlan).toEqual({ assetSpecs: [] });
    expect(
      productionPlans.readCurrentAssetPlanInTransaction,
    ).toHaveBeenCalledWith(tx, PROJECT_ID, CHAPTER_ID);
    expect(tx.storyAgentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authoringMode: StoryAgentAuthoringMode.downstream_reconcile,
        }),
      }),
    );
  });

  it.each([false, true])(
    'selects Assets when missing or explicitly requested again (regenerate=%s)',
    async (regenerate) => {
      const authoringRun = authoringRunRow({
        proposal: {
          ...briefRecord(),
          ...(regenerate ? { regenerateStage: 'assets' } : {}),
        },
      });
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
        storyAgentRun: {
          findUnique: jest.fn().mockResolvedValue(authoringRun),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        storyProject: {
          findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
        },
        storyChapter: {
          findFirst: jest.fn().mockResolvedValue({
            title: 'Chapter 1',
            sourceScriptDocumentId: null,
            sourceScriptVersionId: null,
            sourceScriptSequence: null,
          }),
        },
        studioDocument: {
          findFirst: jest.fn().mockResolvedValue({
            id: LEGACY_SCRIPT_DOCUMENT_ID,
            currentSequence: 1,
            currentVersionId: LEGACY_SCRIPT_VERSION_ID,
            crdtState: Buffer.from([0, 0]),
          }),
        },
        studioDocumentVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: LEGACY_SCRIPT_VERSION_ID,
            documentId: LEGACY_SCRIPT_DOCUMENT_ID,
            sequence: 1,
            snapshot: {
              screenplay: LEGACY_APPROVED_SCREENPLAY,
              document: buildStoryScreenplayDocument(
                LEGACY_APPROVED_SCREENPLAY,
              ),
            },
          }),
        },
      };
      const { service, productionPlans } = serviceWith(tx);
      productionPlans.getProductionStateInTransaction.mockResolvedValue({
        projectId: PROJECT_ID,
        chapterId: CHAPTER_ID,
        profile: { status: 'current' },
        script: {
          status: 'current',
          documentId: LEGACY_SCRIPT_DOCUMENT_ID,
          sequence: 1,
        },
        plotTree: { status: 'current', nodeCount: 1 },
        assets: {
          status: regenerate ? 'current' : 'missing',
          currentCount: regenerate ? 1 : 0,
        },
        storyboard: {
          status: 'current',
          sequenceCount: 1,
          missingPlotNodeIds: [],
        },
        ready: regenerate,
      });

      const load = await service.loadAuthoringJob(RUN_ID, WORKER_ID);

      expect(load.kind).toBe('job');
      if (load.kind !== 'job') throw new Error('expected job');
      expect(load.job.targetStage).toBe('assets');
      expect(load.job.screenplaySnapshot?.versionId).toBe(
        LEGACY_SCRIPT_VERSION_ID,
      );
      expect(load.job.assetPlan).toBeNull();
      expect(
        productionPlans.readCurrentAssetPlanInTransaction,
      ).not.toHaveBeenCalled();
      expect(tx.storyAgentRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authoringMode: StoryAgentAuthoringMode.downstream_reconcile,
          }),
        }),
      );
    },
  );

  it('fails authoring durably when the referenced document is out of scope', async () => {
    const authoringRun = runRow({
      status: StoryAgentRunStatus.authoring,
      proposal: { ...briefRecord(), documentId: DOCUMENT_ID },
      conversationId: BRIEF_CONVERSATION_ID,
      leaseOwner: WORKER_ID,
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    });
    const emptyScriptDocument = {
      id: '0197f4a2-0800-7000-8000-000000000011',
      currentSequence: 0,
      crdtState: Buffer.from([0, 0]),
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        findUnique: jest.fn().mockResolvedValue(authoringRun),
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          runRow({
            status: StoryAgentRunStatus.authoring_failed,
            proposal: { ...briefRecord(), documentId: DOCUMENT_ID },
            conversationId: BRIEF_CONVERSATION_ID,
            errorCode: 'STORY_AGENT_DOCUMENT_MISSING',
            errorDetail: 'missing',
          }),
        ),
        updateMany,
      },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({ title: 'Chapter 1' }),
      },
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue(emptyScriptDocument),
      },
      copilotDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: DOCUMENT_ID,
          userId: 'someone-else',
          conversationId: BRIEF_CONVERSATION_ID,
          name: 'script.docx',
          text: 'text',
        }),
      },
    };
    const { service } = serviceWith(tx);

    const load = await service.loadAuthoringJob(RUN_ID, WORKER_ID);

    expect(load).toEqual({ kind: 'failed' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: RUN_ID }),
        data: expect.objectContaining({
          status: StoryAgentRunStatus.authoring_failed,
          errorCode: 'STORY_AGENT_DOCUMENT_MISSING',
        }),
      }),
    );
  });

  it('retains external authority locks through the Story write and persists only canonical values', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const tx = proposalTransaction(createdRows);
    const { service } = serviceWith(tx);
    const canonicalizeAndFence = jest
      .fn()
      .mockImplementation(
        (
          receivedTx: Parameters<
            StoryAgentProposalAuthority['canonicalizeAndFence']
          >[0],
        ) => {
          expect(receivedTx).toBe(tx);
          return Promise.resolve({
            proposal: {
              title: 'Canonical brief',
              summary: 'The first fenced brief wins.',
              brief: 'Draft the canonical premise, not the retried one.',
            },
            initiatedBySessionId: '0197f4a2-0800-7000-8000-000000000099',
          });
        },
      );
    const authority: StoryAgentProposalAuthority = { canonicalizeAndFence };

    await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput({
        title: 'Untrusted model brief',
        summary: 'Must be replaced by the fenced value.',
        idempotencyKey: 'tool-call-authority',
        conversationId: `story-canvas:${PROJECT_ID}`,
      }),
      authority,
    );

    expect(canonicalizeAndFence).toHaveBeenCalledTimes(1);
    expect(canonicalizeAndFence).toHaveBeenCalledWith(tx, {
      proposal: {
        title: 'Untrusted model brief',
        summary: 'Must be replaced by the fenced value.',
        brief: BRIEF_TEXT,
      },
    });
    expect(canonicalizeAndFence.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(createdRows[0]).toEqual(
      expect.objectContaining({
        initiatedBySessionId: '0197f4a2-0800-7000-8000-000000000099',
        conversationId: `story-canvas:${PROJECT_ID}`,
        proposal: expect.objectContaining({
          title: 'Canonical brief',
          summary: 'The first fenced brief wins.',
          brief: 'Draft the canonical premise, not the retried one.',
        }),
        requestFingerprint: briefFingerprint({
          title: 'Canonical brief',
          summary: 'The first fenced brief wins.',
          brief: 'Draft the canonical premise, not the retried one.',
          initiatedBySessionId: '0197f4a2-0800-7000-8000-000000000099',
          conversationId: `story-canvas:${PROJECT_ID}`,
        }),
      }),
    );
  });

  it('does not acquire the Story write lock when external proposal authority is stale', async () => {
    const tx = proposalTransaction([]);
    const { service } = serviceWith(tx);
    const authorityError = new Error('COPILOT_TURN_STALE');
    const authority: StoryAgentProposalAuthority = {
      canonicalizeAndFence: jest.fn().mockRejectedValue(authorityError),
    };

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          title: 'Stale brief',
          summary: 'Must never reach the Story domain.',
          idempotencyKey: 'tool-call-stale-authority',
        }),
        authority,
      ),
    ).rejects.toBe(authorityError);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused for a different request fingerprint', async () => {
    const tx = proposalTransaction([], {
      existing: authoringRunRow({ requestFingerprint: 'f'.repeat(64) }),
    });
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          title: 'Different request',
          summary: 'This is not the original request.',
        }),
      ),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'STORY_AGENT_IDEMPOTENCY_CONFLICT',
      }),
    });
  });

  it('replays the original authoring run for an idempotent duplicate without side effects', async () => {
    const tx = proposalTransaction([], {
      existing: authoringRunRow({
        leaseOwner: 'story-agent:pending',
        requestFingerprint: briefFingerprint(),
        idempotencyKey: `story-agent:proposal:${PROJECT_ID}:tool-call-1`,
      }),
    });
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(USER, WORKSPACE_ID, PROJECT_ID, briefInput()),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'authoring' });

    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
    expect(tx.storyProject.findFirst).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('exposes the independent Undo data head under story.read permission', async () => {
    const storyAgentRun = { findMany: jest.fn().mockResolvedValue([]) };
    const tx = {
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      storyAgentRun,
    };
    const { service, permissions } = serviceWith(tx);

    await expect(
      service.getUndoableRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toBeNull();
    expect(permissions.requireProject).toHaveBeenCalledWith(
      USER.userId,
      PROJECT_ID,
      'story.read',
      { allowArchived: true },
    );
    expect(storyAgentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storyProjectId: PROJECT_ID,
          kind: StoryAgentRunKind.apply,
          status: StoryAgentRunStatus.succeeded,
        }),
      }),
    );
    expect(tx.storyProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [StoryProjectStatus.active, StoryProjectStatus.archived],
          },
        }),
      }),
    );
  });

  it('walks past every zero-change stage success to the real Undo head', async () => {
    const currentLayout = { nodePositions: {} };
    const beforeDraft = {
      ...EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      storyBible: {
        ...EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT.storyBible,
        logline: 'The premise before the Plot apply.',
      },
    };
    const currentDraftHash = canonicalJsonHash(
      EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
    );
    const currentLayoutHash = canonicalJsonHash(currentLayout);
    const completed = (id: string, authoringMode: StoryAgentAuthoringMode) =>
      runRow({
        id,
        status: StoryAgentRunStatus.succeeded,
        authoringMode,
        resultDraftRevision: 7,
        resultLayoutRevision: 3,
        beforeDraftSnapshot: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
        beforeDraftHash: currentDraftHash,
        afterDraftSnapshot: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
        afterDraftHash: currentDraftHash,
        beforeLayoutSnapshot: currentLayout,
        beforeLayoutHash: currentLayoutHash,
        afterLayoutSnapshot: currentLayout,
        afterLayoutHash: currentLayoutHash,
        confirmedByUserId: USER.userId,
        confirmedAt: NOW,
        applyingAt: NOW,
        revealStartedAt: NOW,
        completedAt: NOW,
      });
    const realApply = runRow({
      id: '0197f4a2-0800-7000-8000-000000000040',
      status: StoryAgentRunStatus.succeeded,
      resultDraftRevision: 7,
      resultLayoutRevision: 3,
      beforeDraftSnapshot: beforeDraft,
      beforeDraftHash: canonicalJsonHash(beforeDraft),
      afterDraftSnapshot: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      afterDraftHash: currentDraftHash,
      beforeLayoutSnapshot: currentLayout,
      beforeLayoutHash: currentLayoutHash,
      afterLayoutSnapshot: currentLayout,
      afterLayoutHash: currentLayoutHash,
      confirmedByUserId: USER.userId,
      confirmedAt: NOW,
      applyingAt: NOW,
      revealStartedAt: NOW,
      completedAt: new Date(NOW.getTime() - 1_000),
    });
    const zeroChangeModes = [
      StoryAgentAuthoringMode.noop,
      StoryAgentAuthoringMode.downstream_reconcile,
      StoryAgentAuthoringMode.downstream_reconcile,
      StoryAgentAuthoringMode.screenplay_required,
    ];
    const zeroChangeRuns = Array.from({ length: 55 }, (_, index) =>
      completed(
        `0197f4a2-0800-7000-8000-${index.toString(16).padStart(12, '0')}`,
        zeroChangeModes[index % zeroChangeModes.length],
      ),
    );
    const storyAgentRun = {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(zeroChangeRuns.slice(0, 50))
        .mockResolvedValueOnce([...zeroChangeRuns.slice(50), realApply]),
    };
    const tx = {
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.getUndoableRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toMatchObject({ id: realApply.id });
    expect(storyAgentRun.findMany).toHaveBeenCalledTimes(2);
    expect(storyAgentRun.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { id: zeroChangeRuns[49].id },
        skip: 1,
      }),
    );
  });

  it('returns the prompt and the exact server-only canonical authoring snapshot', async () => {
    const tx = {
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
    };
    const { service } = serviceWith(tx);

    await expect(
      service.getAuthoringContext(USER, WORKSPACE_ID, PROJECT_ID, CHAPTER_ID),
    ).resolves.toEqual({
      prompt: expect.stringContaining('"schemaVersion"'),
      snapshot: AUTHORING_SNAPSHOT,
    });
    const result = await service.getAuthoringContext(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      CHAPTER_ID,
    );
    expect(result.prompt).not.toContain('"revision"');
    expect(result.prompt).not.toContain(AUTHORING_SNAPSHOT.draftContentHash);
  });

  it('does not read canonical state when Undo-head authorization fails', async () => {
    const storyProject = { findFirst: jest.fn() };
    const { service, permissions } = serviceWith({
      storyProject,
      storyAgentRun: { findFirst: jest.fn() },
    });
    permissions.requireProject.mockRejectedValueOnce(
      new ForbiddenException({
        code: 'STORY_PERMISSION_DENIED',
        message: 'Read access is required.',
      }),
    );

    await expect(
      service.getUndoableRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });
    expect(storyProject.findFirst).not.toHaveBeenCalled();
  });

  it('atomically supersedes prior pre-confirm runs from the same user conversation', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const superseded = runRow({
      id: OTHER_RUN_ID,
      conversationId: 'story-canvas:conversation-1',
      status: StoryAgentRunStatus.stale,
      proposal: briefRecord(),
      completedAt: NOW,
      errorCode: 'STORY_AGENT_SUPERSEDED_IN_CONVERSATION',
      errorDetail:
        'A newer proposal from the same conversation superseded this proposal.',
    });
    const tx = proposalTransaction(createdRows);
    tx.storyAgentRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: OTHER_RUN_ID }])
      .mockResolvedValueOnce([superseded]);
    const { service, realtime } = serviceWith(tx);

    await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput({
        title: 'A newer remembered dream',
        summary: 'Replace the earlier drafting run.',
        idempotencyKey: 'tool-call-newer',
        conversationId: 'story-canvas:conversation-1',
      }),
    );

    expect(tx.storyAgentRun.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          storyProjectId: PROJECT_ID,
          initiatedByUserId: USER.userId,
          conversationId: 'story-canvas:conversation-1',
          status: { in: PRE_CONFIRM_STATUSES },
        }),
      }),
    );
    expect(tx.storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OTHER_RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.stale,
          errorCode: 'STORY_AGENT_SUPERSEDED_IN_CONVERSATION',
        }),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(2);
  });

  it('maps an unmatched active-scope uniqueness race to a domain conflict', async () => {
    const tx = proposalTransaction([]);
    tx.storyAgentRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate active scope', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({ conversationId: 'story-canvas:conversation-race' }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'STORY_AGENT_PROPOSAL_SCOPE_BUSY',
      }),
    });
  });

  it('closes a superseded v2 proposal approval and stamps Story terminal delivery atomically', async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const awaitingApproval = agentManagedProposalRow({
      id: OTHER_RUN_ID,
      conversationId: 'story-canvas:conversation-2',
    });
    const tx = proposalTransaction(createdRows);
    tx.storyAgentRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: OTHER_RUN_ID }])
      .mockResolvedValueOnce([awaitingApproval]);
    const { service, agentOsJournal } = serviceWith(tx);
    const dispatch = agentDispatch('cancelled', 'Proposal superseded.');
    agentOsJournal.appendStoryProposalClosureInTransaction.mockResolvedValue(
      dispatch,
    );

    await service.createAuthoringRun(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      briefInput({
        idempotencyKey: 'tool-call-v2-superseding',
        conversationId: 'story-canvas:conversation-2',
      }),
    );

    expect(
      agentOsJournal.appendStoryProposalClosureInTransaction,
    ).toHaveBeenCalledWith(tx, {
      runId: SOURCE_AGENT_RUN_ID,
      turnId: SOURCE_AGENT_TURN_ID,
      storyRunId: OTHER_RUN_ID,
      approvalId: storyProposalApprovalId(OTHER_RUN_ID),
      outcome: 'cancelled',
      code: 'STORY_AGENT_SUPERSEDED_IN_CONVERSATION',
      text: 'A newer proposal from the same conversation superseded this proposal.',
    });
    expect(tx.storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OTHER_RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.stale,
          sourceTerminalDeliveredAt: NOW,
        }),
      }),
    );
    expect(agentOsJournal.publishCommitted).toHaveBeenCalledWith(dispatch);
  });

  it('refuses the 65th active pre-confirm run for one project', async () => {
    const tx = proposalTransaction([]);
    tx.storyAgentRun.count.mockResolvedValue(64);
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          title: 'Over capacity',
          summary: 'Must not grow the active run set without bound.',
          idempotencyKey: 'tool-call-over-capacity',
          conversationId: 'story-canvas:new-conversation',
        }),
      ),
    ).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({
        code: 'STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED',
        maximum: 64,
      }),
    });
    expect(tx.storyAgentRun.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: PRE_CONFIRM_STATUSES },
        }),
      }),
    );
    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
  });

  it('lands authored operations as a canonical proposed head pinned to the fresh base', async () => {
    const tx = completeTransaction(authoringRunRow());
    const { service, realtime } = serviceWith(tx);

    const completion = await service.completeAuthoring(RUN_ID, WORKER_ID, {
      operations: [changedOverviewOperation],
      authoredAgainst: AUTHORING_SNAPSHOT,
    });

    expect(completion).toEqual({
      kind: 'completed',
      run: expect.objectContaining({ id: RUN_ID, status: 'proposed' }),
    });
    expect(tx.storyAgentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: RUN_ID },
          status: { in: PRE_CONFIRM_STATUSES },
        }),
      }),
    );
    expect(tx.storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.proposed,
          proposal: expect.objectContaining({
            schemaVersion: 'story-patch-v1',
            baseDraftRevision: 7,
            baseContentHash: canonicalJsonHash(
              EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
            ),
            baseLayoutRevision: 3,
            title: 'A remembered dream',
            summary: 'Establish the premise.',
            operations: [changedOverviewOperation],
          }),
          expiresAt: new Date(NOW.getTime() + PROPOSAL_TTL_MS),
          fencingToken: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['draft revision', { ...AUTHORING_SNAPSHOT, draftRevision: 6 }],
    [
      'draft content hash',
      { ...AUTHORING_SNAPSHOT, draftContentHash: 'f'.repeat(64) },
    ],
    ['layout revision', { ...AUTHORING_SNAPSHOT, layoutRevision: 2 }],
  ])(
    'returns stale_base instead of landing operations authored against a stale %s',
    async (_name, staleSnapshot) => {
      const tx = completeTransaction(authoringRunRow());
      const { service, realtime } = serviceWith(tx);

      await expect(
        service.completeAuthoring(RUN_ID, WORKER_ID, {
          operations: [changedOverviewOperation],
          authoredAgainst: staleSnapshot,
        }),
      ).resolves.toEqual({ kind: 'stale_base' });
      expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
      expect(tx.storyAgentRun.updateMany).not.toHaveBeenCalled();
      expect(realtime.enqueue).not.toHaveBeenCalled();
    },
  );

  it('rejects an authored document that does not change the project', async () => {
    const tx = completeTransaction(authoringRunRow());
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.completeAuthoring(RUN_ID, WORKER_ID, {
        operations: [
          {
            ...changedOverviewOperation,
            payload: { logline: '' },
          },
        ],
        authoredAgainst: AUTHORING_SNAPSHOT,
      }),
    ).resolves.toEqual({
      kind: 'invalid',
      error: {
        code: 'STORY_AGENT_PROPOSAL_NO_CHANGES',
        detail: expect.stringContaining('do not change the project'),
      },
    });
    expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('rejects an authored document that references a missing graph node', async () => {
    const tx = completeTransaction(authoringRunRow());
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.completeAuthoring(RUN_ID, WORKER_ID, {
        operations: [
          {
            operationId: OPERATION_ID,
            summary: 'Remove a node that never existed.',
            kind: 'story_graph.remove_node',
            payload: { nodeId: 'clip.missing' },
          },
        ],
        authoredAgainst: AUTHORING_SNAPSHOT,
      }),
    ).resolves.toEqual({
      kind: 'invalid',
      error: {
        code: 'STORY_PATCH_ENTITY_MISSING',
        detail: expect.stringContaining('clip.missing'),
      },
    });
    expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a 5,000-level hostile payload before recursive Zod parsing', async () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 5_000; depth += 1) {
      deep = { nested: deep };
    }
    const tx = completeTransaction(authoringRunRow());
    const { service } = serviceWith(tx);

    await expect(
      service.completeAuthoring(RUN_ID, WORKER_ID, {
        operations: [
          {
            operationId: OPERATION_ID,
            summary: 'Deeply nested payload.',
            kind: 'story_graph.put_node',
            payload: {
              intent: 'create',
              node: deep,
            },
          },
        ],
        authoredAgainst: AUTHORING_SNAPSHOT,
      }),
    ).resolves.toEqual({
      kind: 'invalid',
      error: {
        code: 'STORY_AGENT_AUTHORED_DOC_INVALID',
        detail: expect.stringContaining('STORY_PATCH_INPUT_TOO_COMPLEX'),
      },
    });
    expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the run was cancelled while drafting',
      authoringRunRow({
        status: StoryAgentRunStatus.cancelled,
        cancelledByUserId: USER.userId,
        cancelledAt: NOW,
        completedAt: NOW,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
      }),
    ],
    [
      'another worker holds the run lease',
      authoringRunRow({ leaseOwner: 'story-agent:another-worker' }),
    ],
    [
      'the worker lease already expired',
      authoringRunRow({ leaseExpiresAt: new Date(NOW.getTime() - 1) }),
    ],
  ])('lands nothing when %s', async (_name, run) => {
    const tx = completeTransaction(run);
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.completeAuthoring(RUN_ID, WORKER_ID, {
        operations: [changedOverviewOperation],
        authoredAgainst: AUTHORING_SNAPSHOT,
      }),
    ).resolves.toEqual({ kind: 'skip' });
    expect(tx.storyAgentRun.update).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('fails an authoring run in place, clearing the lease and keeping no completedAt', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        findUnique: jest.fn().mockResolvedValue({
          decisionContractVersion: 1,
          sourceAgentRunId: null,
        }),
        updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          authoringFailedRunRow({
            errorCode: 'STORY_AGENT_AUTHORING_FAILED',
            errorDetail: 'The author model rejected the brief.',
          }),
        ),
      },
    };
    const { service, realtime } = serviceWith(tx);

    await service.failAuthoring(RUN_ID, WORKER_ID, {
      code: 'STORY_AGENT_AUTHORING_FAILED',
      detail: 'The author model rejected the brief.',
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: RUN_ID,
          status: StoryAgentRunStatus.authoring,
          leaseOwner: WORKER_ID,
        },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.authoring_failed,
          errorCode: 'STORY_AGENT_AUTHORING_FAILED',
          errorDetail: 'The author model rejected the brief.',
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          // A failure re-opens a full drafting window instead of inheriting
          // whatever remained of the original TTL.
          expiresAt: new Date(NOW.getTime() + 15 * 60 * 1_000),
        }),
      }),
    );
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('completedAt');
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
  });

  it('terminalizes an Agent OS authoring failure in failed without consuming the retryable scope', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        findUnique: jest.fn().mockResolvedValue({
          decisionContractVersion: 2,
          sourceAgentRunId: SOURCE_AGENT_RUN_ID,
          authoringAttempts: 1,
        }),
        updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          runRow({
            status: StoryAgentRunStatus.failed,
            decisionContractVersion: 2,
            sourceAgentRunId: SOURCE_AGENT_RUN_ID,
            sourceAgentTurnId: SOURCE_AGENT_TURN_ID,
            sourceAgentToolCallId: 'call_story_author_1',
            authoringAttempts: 1,
            proposal: briefRecord(),
            completedAt: NOW,
            errorCode: 'STORY_AGENT_STAGE_FAILED',
            errorDetail: 'The structure stage exhausted its attempts.',
          }),
        ),
      },
    };
    const { service, realtime } = serviceWith(tx);

    await service.failAuthoring(RUN_ID, WORKER_ID, {
      code: 'STORY_AGENT_STAGE_FAILED',
      detail: 'The structure stage exhausted its attempts.',
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: RUN_ID,
          status: StoryAgentRunStatus.authoring,
          leaseOwner: WORKER_ID,
        },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.failed,
          completedAt: NOW,
          authoringStages: Prisma.DbNull,
          errorCode: 'STORY_AGENT_STAGE_FAILED',
          errorDetail: 'The structure stage exhausted its attempts.',
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'authoringAttempts',
    );
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('expiresAt');
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not fail a run when the status/lease CAS loses', async () => {
    // The atomic updateMany matches nothing when the run left authoring or
    // another worker took the lease between claim and failure.
    const findUniqueOrThrow = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        findUnique: jest.fn().mockResolvedValue({
          decisionContractVersion: 1,
          sourceAgentRunId: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow,
      },
    };
    const { service, realtime } = serviceWith(tx);

    await service.failAuthoring(RUN_ID, WORKER_ID, {
      code: 'STORY_AGENT_AUTHORING_FAILED',
      detail: 'A displaced worker must not write this failure.',
    });

    expect(findUniqueOrThrow).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('lets a lease-less system caller fail an authoring run another worker holds', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: {
        findUnique: jest.fn().mockResolvedValue({
          decisionContractVersion: 1,
          sourceAgentRunId: null,
        }),
        updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          authoringFailedRunRow({
            errorCode: 'STORY_AGENT_BRIEF_CORRUPT',
            errorDetail:
              'The stored drafting brief is not a valid story patch brief.',
          }),
        ),
      },
    };
    const { service } = serviceWith(tx);

    await service.failAuthoring(RUN_ID, null, {
      code: 'STORY_AGENT_BRIEF_CORRUPT',
      detail: 'The stored drafting brief is not a valid story patch brief.',
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    // A system caller pins no lease owner in the CAS.
    expect(updateMany.mock.calls[0][0].where).not.toHaveProperty('leaseOwner');
  });

  it('re-arms a failed drafting run with a fresh pending lease', async () => {
    const update = jest.fn().mockResolvedValue(
      authoringRunRow({
        leaseOwner: 'story-agent:pending',
        leaseExpiresAt: new Date(NOW.getTime() + PENDING_LEASE_TTL_MS),
      }),
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyAgentRun: {
        findFirst: jest.fn().mockResolvedValue(authoringFailedRunRow()),
        update,
      },
    };
    const { service, realtime } = serviceWith(tx);

    const result = await service.retryAuthoring(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      RUN_ID,
    );

    expect(result.status).toBe('authoring');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.authoring,
          errorCode: null,
          errorDetail: null,
          leaseOwner: 'story-agent:pending',
          leaseAcquiredAt: NOW,
          leaseExpiresAt: new Date(NOW.getTime() + PENDING_LEASE_TTL_MS),
          expiresAt: new Date(NOW.getTime() + AUTHORING_TTL_MS),
        }),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(1);
  });

  it('treats retrying a run that is already authoring as an idempotent no-op', async () => {
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyAgentRun: {
        findFirst: jest.fn().mockResolvedValue(authoringRunRow()),
        update,
      },
    };
    const { service, realtime } = serviceWith(tx);

    await expect(
      service.retryAuthoring(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'authoring' });
    expect(update).not.toHaveBeenCalled();
    expect(realtime.enqueue).not.toHaveBeenCalled();
  });

  it('rejects retrying a run that is not in a drafting state', async () => {
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyAgentRun: {
        findFirst: jest.fn().mockResolvedValue(runRow()),
        update,
      },
    };
    const { service } = serviceWith(tx);

    await expect(
      service.retryAuthoring(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'STORY_AGENT_RUN_NOT_RETRYABLE',
        runId: RUN_ID,
      }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('requires story.generate before opening a retry transaction', async () => {
    const { service, prisma } = serviceWith(
      {},
      { capabilities: ['story.read', 'story.edit'] },
    );

    await expect(
      service.retryAuthoring(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not let a retry terminalize an expired recoverable run', async () => {
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([expiredReservedWriteState()]),
      storyAgentRun: {
        findFirst: jest.fn().mockResolvedValue(authoringFailedRunRow()),
        update,
      },
    };
    const { service } = serviceWith(tx);

    await expect(
      service.retryAuthoring(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      status: 423,
      response: expect.objectContaining({
        code: 'STORY_AGENT_APPLYING',
        runId: OTHER_RUN_ID,
        recoveryPending: true,
      }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('releases the project fence when an owned apply transaction rolls back', async () => {
    const applying = runRow({
      status: StoryAgentRunStatus.applying,
      applyingAt: NOW,
      confirmedByUserId: CONFIRMING_EDITOR.userId,
      confirmedAt: NOW,
      fencingToken: 9n,
      leaseOwner: WORKER_ID,
      leaseAcquiredAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    });
    const failed = runRow({
      ...applying,
      status: StoryAgentRunStatus.failed,
      completedAt: NOW,
      fencingToken: null,
      leaseOwner: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      errorCode: 'STORY_PRODUCTION_STORYBOARD_INCOMPLETE',
      errorDetail: 'Missing clip:scene-30.',
    });
    const storyAgentRun = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce({ storyProjectId: PROJECT_ID })
        .mockResolvedValueOnce(applying),
      update: jest.fn().mockResolvedValue(failed),
    };
    const storyProjectWriteState = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            storyProjectId: PROJECT_ID,
            activeAgentRunId: RUN_ID,
            fencingToken: 9n,
            lockedAt: NOW,
            lockExpiresAt: new Date(NOW.getTime() + 60_000),
            databaseNow: NOW,
          },
        ])
        .mockResolvedValueOnce([{ now: NOW }]),
      storyAgentRun,
      storyProjectWriteState,
    };
    const { service, realtime } = serviceWith(tx);

    await service.failClaimedApply(RUN_ID, WORKER_ID, {
      code: 'STORY_PRODUCTION_STORYBOARD_INCOMPLETE',
      detail: 'Missing clip:scene-30.',
    });

    expect(storyProjectWriteState.updateMany).toHaveBeenCalledWith({
      where: { storyProjectId: PROJECT_ID, activeAgentRunId: RUN_ID },
      data: { activeAgentRunId: null, lockedAt: null, lockExpiresAt: null },
    });
    expect(storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.failed,
          fencingToken: null,
          leaseOwner: null,
          errorCode: 'STORY_PRODUCTION_STORYBOARD_INCOMPLETE',
        }),
      }),
    );
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
  });

  it('cancels a drafting run directly, clearing its error and lease', async () => {
    const cancelled = runRow({
      status: StoryAgentRunStatus.cancelled,
      proposal: briefRecord(),
      cancelledByUserId: CONFIRMING_EDITOR.userId,
      cancelledAt: NOW,
      completedAt: NOW,
    });
    const storyAgentRun = {
      findFirst: jest.fn().mockResolvedValue(authoringFailedRunRow()),
      update: jest.fn().mockResolvedValue(cancelled),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    const result = await service.cancel(
      CONFIRMING_EDITOR,
      WORKSPACE_ID,
      PROJECT_ID,
      RUN_ID,
    );

    expect(result).toMatchObject({
      status: 'cancelled',
      cancelledByUserId: CONFIRMING_EDITOR.userId,
      cancelledAt: NOW.toISOString(),
      completedAt: null,
    });
    expect(storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.cancelled,
          completedAt: NOW,
          cancelledByUserId: CONFIRMING_EDITOR.userId,
          cancelledAt: NOW,
          errorCode: null,
          errorDetail: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    // Drafting cancellation never demands the canonical proposed head: the
    // single findFirst is the run lookup itself.
    expect(storyAgentRun.findFirst).toHaveBeenCalledTimes(1);
  });

  it('prefers an unexpired authoring run over any proposed or terminal head', async () => {
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(authoringRunRow()),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({ id: CHAPTER_ID }),
      },
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.getLatestRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'authoring' });
    expect(storyAgentRun.findFirst).toHaveBeenCalledTimes(2);
    expect(storyAgentRun.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: StoryAgentRunStatus.applying,
        }),
      }),
    );
    expect(storyAgentRun.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: StoryAgentRunStatus.authoring,
          expiresAt: { gt: NOW },
        }),
      }),
    );
  });

  it('excludes terminal-delivered and exhausted delivered rows from the proposal expiry sweep', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyAgentRun: { findMany },
    };
    const { service } = serviceWith(tx);

    await service.expireProposals();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: expect.any(Array) },
          sourceTerminalDeliveredAt: null,
          expiresAt: { lte: NOW },
          NOT: expect.objectContaining({
            decisionContractVersion: 1,
            status: StoryAgentRunStatus.authoring_failed,
            authoringAttempts: { gte: expect.any(Number) },
            sourceResultDeliveredAt: { not: null },
          }),
        }),
      }),
    );
  });

  it.each([
    [
      StoryAgentRunStatus.authoring,
      StoryAgentRunStatus.failed,
      'STORY_AGENT_AUTHORING_TIMEOUT',
    ],
    [
      StoryAgentRunStatus.proposed,
      StoryAgentRunStatus.stale,
      'STORY_AGENT_PROPOSAL_EXPIRED',
    ],
  ])(
    'expires %s as %s without confusing execution and approval deadlines',
    async (status, expectedStatus, expectedCode) => {
      let current = runRow({
        status,
        expiresAt: new Date(NOW.getTime() - 1),
        ...(status === StoryAgentRunStatus.authoring
          ? {
              proposal: briefRecord(),
              authoringMode: StoryAgentAuthoringMode.screenplay_required,
            }
          : {}),
      });
      const findMany = jest
        .fn()
        .mockResolvedValueOnce([{ id: RUN_ID, storyProjectId: PROJECT_ID }])
        .mockResolvedValueOnce([{ id: RUN_ID }])
        .mockImplementation(() => Promise.resolve([current]));
      const update = jest.fn(({ data }: { data: Partial<typeof current> }) => {
        current = { ...current, ...data };
        return Promise.resolve(current);
      });
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ now: NOW }])
          .mockResolvedValue([freeWriteState()]),
        storyAgentRun: { findMany, update },
      };
      const { service, realtime } = serviceWith(tx);

      await service.expireProposals();

      expect(current).toMatchObject({
        status: expectedStatus,
        errorCode: expectedCode,
        completedAt: NOW,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      if (status === StoryAgentRunStatus.authoring) {
        expect(update.mock.calls[0][0].data.authoringStages).toBe(
          Prisma.DbNull,
        );
        expect(current.errorDetail).not.toContain('editor confirmed');
      }
      expect(realtime.publishCommitted).toHaveBeenCalledTimes(1);
    },
  );

  it('excludes authoring and proposed statuses from the terminal fallback head', async () => {
    const cancelled = runRow({
      status: StoryAgentRunStatus.cancelled,
      proposal: briefRecord(),
      cancelledByUserId: USER.userId,
      cancelledAt: NOW,
      completedAt: NOW,
    });
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(cancelled),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({ id: CHAPTER_ID }),
      },
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.getLatestRun(USER, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toMatchObject({ id: RUN_ID, status: 'cancelled' });
    expect(storyAgentRun.findFirst).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            notIn: [
              StoryAgentRunStatus.proposed,
              StoryAgentRunStatus.authoring,
            ],
          },
        }),
      }),
    );
  });

  it('claims one proposal, fences the project, and supersedes every other proposal atomically', async () => {
    const proposed = runRow();
    const superseded = runRow({
      id: OTHER_RUN_ID,
      status: StoryAgentRunStatus.stale,
      completedAt: NOW,
      errorCode: 'STORY_AGENT_SUPERSEDED',
      errorDetail:
        'Another Story Agent run claimed the project and superseded this proposal.',
    });
    const applying = runRow({
      status: StoryAgentRunStatus.applying,
      applyingAt: NOW,
      confirmedByUserId: CONFIRMING_EDITOR.userId,
      confirmedAt: NOW,
      fencingToken: 9n,
      leaseOwner: 'story-agent:pending',
      leaseAcquiredAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 5_000),
      activeWriteState: {
        storyProjectId: PROJECT_ID,
        activeAgentRunId: RUN_ID,
        fencingToken: 9n,
        lockedAt: NOW,
        lockExpiresAt: new Date(NOW.getTime() + 60_000),
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(proposed)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(proposed)
        .mockResolvedValueOnce(applying),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: OTHER_RUN_ID }])
        .mockResolvedValueOnce([superseded]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(proposed),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          storyProjectId: PROJECT_ID,
          activeAgentRunId: null,
          fencingToken: 8n,
          lockedAt: null,
          lockExpiresAt: null,
          databaseNow: NOW,
        },
      ]),
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      storyAgentRun,
      storyProjectWriteState: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service, realtime, permissions, writeGuard } = serviceWith(tx);

    const result = await service.confirm(
      CONFIRMING_EDITOR,
      WORKSPACE_ID,
      PROJECT_ID,
      RUN_ID,
      'confirm-1',
    );

    expect(result.status).toBe('applying');
    expect(writeGuard.assertAgentClaimAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    expect(storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OTHER_RUN_ID },
        data: expect.objectContaining({
          status: StoryAgentRunStatus.stale,
          errorCode: 'STORY_AGENT_SUPERSEDED',
        }),
      }),
    );
    expect(tx.storyProjectWriteState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activeAgentRunId: RUN_ID,
          fencingToken: 9n,
          lockExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          confirmedByUserId: CONFIRMING_EDITOR.userId,
          confirmedAt: NOW,
        }),
      }),
    );
    expect(realtime.enqueue).toHaveBeenCalledTimes(2);
    expect(realtime.publishCommitted).toHaveBeenCalledTimes(2);
    expect(permissions.requireProject).toHaveBeenCalledWith(
      CONFIRMING_EDITOR.userId,
      PROJECT_ID,
      'story.read',
    );
  });

  it('rejects direct confirmation of an older non-canonical proposal', async () => {
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(runRow())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(runRow({ id: OTHER_RUN_ID })),
      update: jest.fn(),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          storyProjectId: PROJECT_ID,
          activeAgentRunId: null,
          fencingToken: 0n,
          lockedAt: null,
          lockExpiresAt: null,
          databaseNow: NOW,
        },
      ]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.confirm(
        CONFIRMING_EDITOR,
        WORKSPACE_ID,
        PROJECT_ID,
        RUN_ID,
        'confirm-old',
      ),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'STORY_AGENT_RUN_NOT_CANONICAL_HEAD',
        runId: RUN_ID,
        canonicalRunId: OTHER_RUN_ID,
      }),
    });
    expect(storyAgentRun.update).not.toHaveBeenCalled();
  });

  it('returns the applying run on repeated confirm even after its worker lease expired', async () => {
    const expiredLeaseAcquiredAt = new Date(NOW.getTime() - 60_000);
    const expiredLeaseExpiresAt = new Date(NOW.getTime() - 30_000);
    const applying = runRow({
      status: StoryAgentRunStatus.applying,
      applyingAt: NOW,
      confirmedByUserId: USER.userId,
      confirmedAt: NOW,
      fencingToken: 2n,
      leaseOwner: 'worker',
      leaseAcquiredAt: expiredLeaseAcquiredAt,
      leaseExpiresAt: expiredLeaseExpiresAt,
      activeWriteState: {
        storyProjectId: PROJECT_ID,
        activeAgentRunId: RUN_ID,
        fencingToken: 2n,
        lockedAt: expiredLeaseAcquiredAt,
        lockExpiresAt: expiredLeaseExpiresAt,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          storyProjectId: PROJECT_ID,
          activeAgentRunId: RUN_ID,
          fencingToken: 2n,
          lockedAt: expiredLeaseAcquiredAt,
          lockExpiresAt: expiredLeaseExpiresAt,
          databaseNow: NOW,
        },
      ]),
      storyAgentRun: { findFirst: jest.fn().mockResolvedValue(applying) },
    };
    const { service, prisma } = serviceWith(tx);

    await expect(
      service.confirm(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID, 'confirm-retry'),
    ).resolves.toMatchObject({ status: 'applying', id: RUN_ID });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not let a new drafting brief terminalize an expired recoverable run', async () => {
    const tx = proposalTransaction([]);
    tx.$queryRaw.mockResolvedValueOnce([expiredReservedWriteState()]);
    const { service } = serviceWith(tx);

    await expect(
      service.createAuthoringRun(
        USER,
        WORKSPACE_ID,
        PROJECT_ID,
        briefInput({
          title: 'Must wait for recovery',
          summary: 'The prior applying run still owns the project.',
          idempotencyKey: 'proposal-during-recovery',
        }),
      ),
    ).rejects.toMatchObject({
      status: 423,
      response: expect.objectContaining({
        code: 'STORY_AGENT_APPLYING',
        runId: OTHER_RUN_ID,
        recoveryPending: true,
      }),
    });
    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
  });

  it('does not let confirmation or cancellation of another proposal terminalize an expired recoverable run', async () => {
    for (const action of ['confirm', 'cancel'] as const) {
      const storyAgentRun = {
        findFirst: jest.fn().mockResolvedValue(runRow()),
        update: jest.fn(),
      };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([expiredReservedWriteState()]),
        storyAgentRun,
      };
      const { service } = serviceWith(tx);
      const request =
        action === 'confirm'
          ? service.confirm(
              USER,
              WORKSPACE_ID,
              PROJECT_ID,
              RUN_ID,
              'confirm-during-recovery',
            )
          : service.cancel(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID);

      await expect(request).rejects.toMatchObject({
        status: 423,
        response: expect.objectContaining({
          code: 'STORY_AGENT_APPLYING',
          runId: OTHER_RUN_ID,
          recoveryPending: true,
        }),
      });
      expect(storyAgentRun.update).not.toHaveBeenCalled();
    }
  });

  it('does not let Undo terminalize an expired recoverable run', async () => {
    const succeeded = runRow({
      id: RUN_ID,
      status: StoryAgentRunStatus.succeeded,
      resultDraftRevision: 8,
      resultLayoutRevision: 4,
      beforeDraftSnapshot: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      beforeLayoutSnapshot: {
        nodePositions: {},
      },
      afterDraftHash: canonicalJsonHash(EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT),
      afterLayoutHash: canonicalJsonHash({
        nodePositions: {},
      }),
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([expiredReservedWriteState()]),
      storyAgentRun: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        findFirst: jest.fn().mockResolvedValue(succeeded),
        create: jest.fn(),
      },
    };
    const { service } = serviceWith(tx);

    await expect(
      service.undo(USER, WORKSPACE_ID, PROJECT_ID, RUN_ID, 'undo-recovery'),
    ).rejects.toMatchObject({
      status: 423,
      response: expect.objectContaining({
        code: 'STORY_AGENT_APPLYING',
        runId: OTHER_RUN_ID,
        recoveryPending: true,
      }),
    });
    expect(tx.storyAgentRun.create).not.toHaveBeenCalled();
  });

  it('persists the cancelling editor independently from the proposal initiator', async () => {
    const cancelled = runRow({
      status: StoryAgentRunStatus.cancelled,
      cancelledByUserId: CONFIRMING_EDITOR.userId,
      cancelledAt: NOW,
      completedAt: NOW,
    });
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(runRow())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(runRow()),
      update: jest.fn().mockResolvedValue(cancelled),
    };
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            storyProjectId: PROJECT_ID,
            activeAgentRunId: null,
            fencingToken: 0n,
            lockedAt: null,
            lockExpiresAt: null,
            databaseNow: NOW,
          },
        ])
        .mockResolvedValueOnce([{ now: NOW }]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    const result = await service.cancel(
      CONFIRMING_EDITOR,
      WORKSPACE_ID,
      PROJECT_ID,
      RUN_ID,
    );

    expect(result).toMatchObject({
      initiator: { id: USER.userId },
      cancelledByUserId: CONFIRMING_EDITOR.userId,
      cancelledAt: NOW.toISOString(),
    });
    expect(storyAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelledByUserId: CONFIRMING_EDITOR.userId,
          cancelledAt: NOW,
        }),
      }),
    );
  });

  it('rejects direct cancellation of an older non-canonical proposal', async () => {
    const storyAgentRun = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(runRow())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(runRow({ id: OTHER_RUN_ID })),
      update: jest.fn(),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          storyProjectId: PROJECT_ID,
          activeAgentRunId: null,
          fencingToken: 0n,
          lockedAt: null,
          lockExpiresAt: null,
          databaseNow: NOW,
        },
      ]),
      storyAgentRun,
    };
    const { service } = serviceWith(tx);

    await expect(
      service.cancel(CONFIRMING_EDITOR, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'STORY_AGENT_RUN_NOT_CANONICAL_HEAD',
        canonicalRunId: OTHER_RUN_ID,
      }),
    });
    expect(storyAgentRun.update).not.toHaveBeenCalled();
  });

  it('rejects every lifecycle mutation before opening a transaction when the caller lacks story.edit', async () => {
    const viewer = { userId: 'viewer-3' };
    const { service, prisma, permissions } = serviceWith(
      {},
      { capabilities: ['story.read'] },
    );

    await expect(
      service.confirm(
        viewer,
        WORKSPACE_ID,
        PROJECT_ID,
        RUN_ID,
        'viewer-confirm',
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });
    await expect(
      service.cancel(viewer, WORKSPACE_ID, PROJECT_ID, RUN_ID),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });
    await expect(
      service.undo(viewer, WORKSPACE_ID, PROJECT_ID, RUN_ID, 'viewer-undo'),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'STORY_PERMISSION_DENIED' }),
    });

    expect(permissions.requireProject).toHaveBeenCalledTimes(3);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function serviceWith(
  tx: Record<string, unknown>,
  options: { capabilities?: string[] } = {},
) {
  tx.skillVersion ??= {
    findUnique: jest.fn().mockResolvedValue({
      id: CINEMATIC_REALISM_SKILL.versionId,
      skillId: CINEMATIC_REALISM_SKILL.skillId,
      status: 'published',
      generationPolicy: CINEMATIC_REALISM_POLICY,
      skill: { slug: CINEMATIC_REALISM_SKILL.slug, category: 'style' },
    }),
  };
  tx.storyChapter ??= {
    findFirst: jest.fn().mockResolvedValue(null),
  };
  tx.studioDocument ??= {
    findFirst: jest.fn().mockResolvedValue(null),
  };
  tx.studioDocumentOperation ??= {
    findMany: jest.fn().mockResolvedValue([]),
  };
  tx.studioDocumentVersion ??= {
    findFirst: jest.fn().mockResolvedValue(null),
  };
  const prisma = {
    agentOsExternalHandoffRegistration:
      tx.agentOsExternalHandoffRegistration ?? {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
    $queryRaw: (tx.$queryRaw ?? jest.fn()) as jest.Mock,
    storyProject: (tx.storyProject ?? {}) as Record<string, unknown>,
    storyChapter: (tx.storyChapter ?? {}) as Record<string, unknown>,
    storyCanvasLayout: (tx.storyCanvasLayout ?? {}) as Record<string, unknown>,
    storyDraft: (tx.storyDraft ?? {}) as Record<string, unknown>,
    storyAgentRun: (tx.storyAgentRun ?? {}) as Record<string, unknown>,
    appStoryRun: (tx.appStoryRun ?? {}) as Record<string, unknown>,
    skillVersion: (tx.skillVersion ?? {}) as Record<string, unknown>,
    copilotDocument: (tx.copilotDocument ?? {}) as Record<string, unknown>,
    agentOsAttachment: (tx.agentOsAttachment ?? {}) as Record<string, unknown>,
    studioDocument: (tx.studioDocument ?? {
      findFirst: jest.fn().mockResolvedValue(null),
    }) as Record<string, unknown>,
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        status: StoryProjectStatus.active,
      },
      role: StoryProjectMemberRole.owner,
      capabilities: options.capabilities ?? [
        'story.read',
        'story.edit',
        'story.generate',
      ],
    }),
  };
  const realtime = {
    enqueue: jest.fn().mockImplementation((_transaction, run) => ({
      outboxId: `outbox-${run.id}`,
      eventId: `event-${run.id}`,
      userId: USER.userId,
      event: { kind: 'story_agent_run_changed' },
    })),
    publishCommitted: jest.fn().mockResolvedValue(undefined),
  };
  const writeGuard = {
    assertAgentClaimAllowed: jest.fn().mockResolvedValue(undefined),
    findActiveExternalCommand: jest.fn().mockResolvedValue(null),
  };
  const agentOsJournal = {
    snapshotRunInTransaction: jest.fn(),
    appendStoryProposalDecisionInTransaction: jest.fn(),
    cancelRunInTransaction: jest.fn(),
    appendStoryProposalClosureInTransaction: jest.fn(),
    publishCommitted: jest.fn().mockResolvedValue(undefined),
  };
  const productionPlans = {
    getProductionStateInTransaction: jest.fn().mockResolvedValue({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      profile: { status: 'current' },
      script: { status: 'missing', documentId: null, sequence: null },
      plotTree: { status: 'missing', nodeCount: 0 },
      assets: { status: 'missing', currentCount: 0 },
      storyboard: {
        status: 'missing',
        sequenceCount: 0,
        missingPlotNodeIds: [],
      },
      ready: false,
    }),
    readCurrentAssetPlanInTransaction: jest.fn().mockResolvedValue(null),
    validateApprovedAssetPlan: jest.fn(
      ({ assetPlan }: { assetPlan: unknown }) => assetPlan,
    ),
    validateApprovedStoryboardPlan: jest.fn(
      ({ storyboardPlan }: { storyboardPlan: unknown }) => storyboardPlan,
    ),
  };
  return {
    service: new StoryAgentRunService(
      prisma as never,
      permissions as never,
      realtime as never,
      writeGuard as never,
      agentOsJournal as never,
      { scheduleCompaction: jest.fn() } as never,
      { publishDocumentOperation: jest.fn() } as never,
      productionPlans as never,
    ),
    prisma,
    realtime,
    permissions,
    writeGuard,
    agentOsJournal,
    productionPlans,
  };
}

function proposalTransaction(
  createdRows: Array<Record<string, unknown>>,
  options: {
    existing?: ReturnType<typeof runRow>;
    project?: ReturnType<typeof canonicalProjectRow>;
  } = {},
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
    storyProject: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.project ?? canonicalProjectRow()),
    },
    storyAgentRun: {
      findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { id: string }; data: object }) =>
            runRow({ id: where.id, ...data }),
        ),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdRows.push(data);
          return runRow(data);
        }),
    },
    agentOsRun: {
      findFirst: jest.fn().mockResolvedValue({ id: SOURCE_AGENT_RUN_ID }),
    },
    agentOsExternalHandoffRegistration: {
      create: jest
        .fn()
        .mockImplementation(
          ({ data }: { data: Record<string, unknown> }) => data,
        ),
    },
  };
  return tx;
}

/**
 * Mock transaction for `completeAuthoring`: run lookup, write-state lock,
 * canonical state, scope supersession, and the landing update.
 */
function completeTransaction(
  run: ReturnType<typeof runRow>,
  landed: ReturnType<typeof runRow> = runRow(),
) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
    storyProject: {
      findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
    },
    storyAgentRun: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ storyProjectId: PROJECT_ID }),
      findUnique: jest.fn().mockResolvedValue(run),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue(landed),
    },
  };
}

function agentManagedProposalRow(overrides: Record<string, unknown> = {}) {
  return runRow({
    decisionContractVersion: 2,
    conversationId: SOURCE_AGENT_CONVERSATION_ID,
    sourceAgentRunId: SOURCE_AGENT_RUN_ID,
    sourceAgentTurnId: SOURCE_AGENT_TURN_ID,
    sourceAgentToolCallId: 'call_story_author_1',
    sourceStartedMessage: 'I am shaping the proposal now.',
    sourceCompletionMessage: 'The proposal is ready for review.',
    sourceProposalReadyDeliveredAt: NOW,
    ...overrides,
  });
}

function agentOsDecisionTransaction(
  initial: ReturnType<typeof runRow> = agentManagedProposalRow(),
) {
  let current = initial;
  const storyAgentRun = {
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      if (where.id === RUN_ID) return Promise.resolve(current);
      if (where.status === StoryAgentRunStatus.applying) {
        return Promise.resolve(null);
      }
      if (where.status === StoryAgentRunStatus.authoring) {
        return Promise.resolve(null);
      }
      if (where.status === StoryAgentRunStatus.proposed) {
        return Promise.resolve(
          current.status === StoryAgentRunStatus.proposed ? current : null,
        );
      }
      return Promise.resolve(null);
    }),
    findUnique: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      if ('sourceApprovalResponseId' in where) {
        return Promise.resolve(
          current.sourceApprovalResponseId === where.sourceApprovalResponseId
            ? { id: current.id }
            : null,
        );
      }
      return Promise.resolve(current);
    }),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      current = { ...current, ...data };
      return Promise.resolve(current);
    }),
  };
  return {
    tx: {
      $queryRaw: jest.fn().mockResolvedValue([freeWriteState()]),
      storyProject: {
        findFirst: jest.fn().mockResolvedValue(canonicalProjectRow()),
      },
      storyProjectWriteState: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      studioDocumentOperation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      storyAgentRun,
      agentOsExternalHandoffRegistration: {
        findUnique: jest.fn().mockResolvedValue({
          continuationPlan: SOURCE_CONTINUATION_PLAN,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    },
    current: () => current,
  };
}

function mockCurrentEmptyScriptHead(
  tx: ReturnType<typeof agentOsDecisionTransaction>['tx'],
) {
  tx.studioDocument.findFirst.mockResolvedValue({
    id: LEGACY_SCRIPT_DOCUMENT_ID,
    currentSequence: 0,
    snapshotSequence: 0,
    crdtState: Buffer.from([0, 0]),
  });
  tx.studioDocumentOperation.findMany.mockResolvedValue([]);
}

function agentDispatch(
  status: 'completed' | 'cancelled' | 'waiting_for_external',
  assistantText: string,
) {
  return {
    events: [],
    snapshot: {
      runId: SOURCE_AGENT_RUN_ID,
      status,
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText,
    },
  };
}

function freeWriteState() {
  return {
    storyProjectId: PROJECT_ID,
    activeAgentRunId: null,
    fencingToken: 0n,
    lockedAt: null,
    lockExpiresAt: null,
    databaseNow: NOW,
  };
}

function expiredReservedWriteState() {
  return {
    storyProjectId: PROJECT_ID,
    activeAgentRunId: OTHER_RUN_ID,
    fencingToken: 11n,
    lockedAt: new Date(NOW.getTime() - 60_000),
    lockExpiresAt: new Date(NOW.getTime() - 30_000),
    databaseNow: NOW,
  };
}

function canonicalProjectRow(
  overrides: Partial<{
    durationPreset: StoryDurationPreset | null;
    visualStyle: StoryVisualStyle | null;
    visualStyleSkillId: string | null;
    visualStyleSkillVersionId: string | null;
    creativeProfileConfirmedAt: Date | null;
  }> = {},
) {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Dream',
    frameProfile: StoryFrameProfile.landscape_16_9,
    durationPreset: StoryDurationPreset.short_5_15,
    visualStyle: 'cinematic-realism',
    visualStyleSkillId: CINEMATIC_REALISM_SKILL.skillId,
    visualStyleSkillVersionId: CINEMATIC_REALISM_SKILL.versionId,
    creativeProfileConfirmedAt: NOW,
    defaultLocale: 'en-US',
    draft: {
      revision: 7,
      schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
      content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      contentHash: canonicalJsonHash(EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT),
    },
    chapters: [
      {
        id: CHAPTER_ID,
        title: 'Chapter 1',
        nodeIds: [],
        entryNodeId: null,
        canvasLayout: {
          revision: 3,
          schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
          nodePositions: {},
        },
      },
    ],
    ...overrides,
  };
}

function briefInput(overrides: Record<string, unknown> = {}) {
  return {
    chapterId: CHAPTER_ID,
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    brief: BRIEF_TEXT,
    idempotencyKey: 'tool-call-1',
    ...overrides,
  };
}

function briefRecord(): StoryPatchBrief {
  return {
    schemaVersion: 'story-patch-brief-v1',
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    brief: BRIEF_TEXT,
  };
}

function briefFingerprint(overrides: Record<string, unknown> = {}): string {
  return canonicalJsonHash({
    kind: 'apply-brief',
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    initiatedByUserId: USER.userId,
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    brief: BRIEF_TEXT,
    documentId: null,
    initiatedBySessionId: null,
    conversationId: null,
    sourceAgentRunId: null,
    sourceAgentTurnId: null,
    sourceAgentToolCallId: null,
    sourceStartedMessage: null,
    sourceCompletionMessage: null,
    sourceContinuationPlan: null,
    ...overrides,
  });
}

function proposal(): StoryPatchProposal {
  return {
    schemaVersion: 'story-patch-v1',
    draftSchemaVersion: 'interactive-story-draft-v1',
    baseDraftRevision: 7,
    baseContentHash: canonicalJsonHash(EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT),
    baseLayoutRevision: 3,
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    operations: [changedOverviewOperation],
  };
}

function authoringRunRow(overrides: Record<string, unknown> = {}) {
  return runRow({
    status: StoryAgentRunStatus.authoring,
    proposal: briefRecord(),
    leaseOwner: WORKER_ID,
    leaseAcquiredAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    expiresAt: new Date(NOW.getTime() + AUTHORING_TTL_MS),
    ...overrides,
  });
}

function authoringFailedRunRow(overrides: Record<string, unknown> = {}) {
  return runRow({
    status: StoryAgentRunStatus.authoring_failed,
    proposal: briefRecord(),
    errorCode: 'STORY_AGENT_AUTHORING_FAILED',
    errorDetail: 'The author model rejected the brief.',
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    expiresAt: new Date(NOW.getTime() + AUTHORING_TTL_MS),
    ...overrides,
  });
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    storyProjectId: PROJECT_ID,
    storyChapterId: CHAPTER_ID,
    workspaceId: WORKSPACE_ID,
    kind: StoryAgentRunKind.apply,
    status: StoryAgentRunStatus.proposed,
    authoringMode: null,
    authoringStages: null,
    initiatedByUserId: USER.userId,
    initiatedBySessionId: null,
    conversationId: null,
    sourceAgentRunId: null,
    sourceAgentTurnId: null,
    sourceAgentToolCallId: null,
    sourceStartedMessage: null,
    sourceCompletionMessage: null,
    decisionContractVersion: 1,
    sourceProposalReadyDeliveredAt: null,
    sourceTerminalDeliveredAt: null,
    sourceApprovalId: null,
    sourceApprovalResponseId: null,
    sourceApprovalResponseText: null,
    sourceApprovalLocale: null,
    sourceApprovalDecisionTurnId: null,
    sourceApprovalDecision: null,
    sourceApprovalDecidedAt: null,
    sourceApprovalDecidedByUserId: null,
    sourceResultDeliveredAt: null,
    sourceResultDeliveryAttempts: 0,
    sourceResultDeliveryNextAttemptAt: null,
    sourceResultDeliveryLeaseOwner: null,
    sourceResultDeliveryLeaseExpiresAt: null,
    sourceResultDeliveryLastError: null,
    baseDraftRevision: 7,
    baseLayoutRevision: 3,
    resultDraftRevision: null,
    resultLayoutRevision: null,
    proposal: proposal(),
    beforeDraftSnapshot: null,
    beforeDraftHash: null,
    afterDraftSnapshot: null,
    afterDraftHash: null,
    beforeLayoutSnapshot: null,
    beforeLayoutHash: null,
    afterLayoutSnapshot: null,
    afterLayoutHash: null,
    affectedNodeIds: [],
    createdNodeIds: [],
    summary: 'Establish the premise.',
    errorCode: null,
    errorDetail: null,
    idempotencyKey: `story-agent:proposal:${PROJECT_ID}:tool-call-1`,
    requestFingerprint: canonicalJsonHash({ request: 'original' }),
    revertsRunId: null,
    fencingToken: null,
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    proposedAt: NOW,
    expiresAt: new Date(NOW.getTime() + PROPOSAL_TTL_MS),
    confirmedByUserId: null,
    cancelledByUserId: null,
    confirmedAt: null,
    applyingAt: null,
    revealStartedAt: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    activeWriteState: null,
    ...overrides,
  };
}

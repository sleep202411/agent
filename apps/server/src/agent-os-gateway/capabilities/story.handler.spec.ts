import {
  StoryAddBranchInputSchema,
  StoryAddSceneInputSchema,
  StoryPutInteractionInputSchema,
  StoryRemoveInteractionInputSchema,
} from '@repo/agent-tools';
import {
  STORY_VISUAL_STYLE_SKILL_SLUGS,
  storyVisualStyleSkillBySlug,
} from '@repo/shared';
import { storyAutoExit } from '@repo/shared/story-stats';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  type InteractiveStoryDraftContent,
} from '../../story-studio/interactive-film.schema';
import { canonicalJsonHash } from '../../story-studio/canonical-json';
import { executeStoryPatch } from '../../story-studio/story-agent-patch.executor';
import {
  StoryAgentCapabilityHandler,
  buildAddBranchOperations,
  buildAddSceneOperations,
  buildPutInteractionOperations,
  buildRemoveInteractionOperations,
  buildRemoveSubtreeOperations,
  creativeProfileValuesFromJournal,
} from './story.handler';

function node(
  nodeId: string,
  exit: InteractiveStoryDraftContent['graph']['nodes'][number]['exit'] = storyAutoExit(
    null,
  ),
): Extract<
  InteractiveStoryDraftContent['graph']['nodes'][number],
  { kind: 'clip' }
> {
  return {
    kind: 'clip',
    nodeId,
    clipKey: nodeId.toUpperCase().replaceAll('.', '_'),
    name: nodeId,
    description: '',
    interactions: [],
    exit,
  };
}

function draft(
  nodes: InteractiveStoryDraftContent['graph']['nodes'],
  entryNodeId = nodes[0]?.nodeId ?? null,
): InteractiveStoryDraftContent {
  return {
    ...structuredClone(EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT),
    graph: { entryNodeId, nodes },
  };
}

const CREATIVE_PROFILE_QUESTIONS = [
  {
    id: 'aspect_ratio',
    options: [{ value: 'portrait_9_16' }, { value: 'landscape_16_9' }],
  },
  {
    id: 'target_runtime',
    options: [
      { value: 'short_5_15' },
      { value: 'medium_15_30' },
      { value: 'long_30_60' },
    ],
  },
  {
    id: 'visual_direction',
    options: STORY_VISUAL_STYLE_SKILL_SLUGS.map((value) => ({ value })),
  },
  {
    id: 'story_language',
    options: [{ value: 'zh-CN' }, { value: 'zh-HK' }, { value: 'en-US' }],
  },
] as const;
const STYLIZED_3D_SKILL = storyVisualStyleSkillBySlug('stylized-3d-cinema')!;
const CINEMATIC_REALISM_SKILL =
  storyVisualStyleSkillBySlug('cinematic-realism')!;

function canonicalProductionState(
  scriptStatus: 'missing' | 'current' | 'stale' = 'missing',
) {
  return {
    projectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
    chapterId: '019a034d-397a-7dac-8d77-fad8dd15038e',
    profile: { status: 'current' as const },
    script: {
      status: scriptStatus,
      documentId:
        scriptStatus === 'missing'
          ? null
          : '019a034d-4000-7000-8000-000000000001',
      sequence: scriptStatus === 'missing' ? null : 1,
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
}

describe('StoryAgentCapabilityHandler', () => {
  const handler = new StoryAgentCapabilityHandler(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('claims only the new Story capability family', () => {
    expect(handler.supports('story.read')).toBe(true);
    expect(handler.supports('story.confirmCreativeProfile')).toBe(true);
    expect(handler.supports('story.updateStateVariables')).toBe(true);
    expect(handler.supports('story.addBranch')).toBe(true);
    expect(handler.supports('story.putInteraction')).toBe(true);
    expect(handler.supports('story.removeInteraction')).toBe(true);
    expect(handler.supports('story.storyboard.read')).toBe(true);
    expect(handler.supports('story.storyboard.putTimeline')).toBe(true);
    expect(handler.supports('story.storyboard.patchClip')).toBe(true);
    expect(handler.supports('story.generation.quoteAssets')).toBe(true);
    expect(handler.supports('story.generation.quoteStoryboard')).toBe(true);
    expect(handler.supports('story.generation.confirmBatch')).toBe(true);
    expect(handler.supports('story.generation.resumeBatch')).toBe(true);
    expect(handler.supports('characters.upsert')).toBe(false);
    expect(handler.supports('canvas.applyPatch')).toBe(false);
  });

  it('repairs legacy ownership and commits an Agent OS patch through the shared graph primitive', async () => {
    const projectId = '0197f4a2-0800-7000-8000-0000000000c5';
    const chapterId = '0197f4a2-0800-7000-8000-0000000000c7';
    const content = draft([node('scene.gate')]);
    let latestWrittenContent: InteractiveStoryDraftContent | undefined;
    const tx = {
      storyProject: {
        findFirst: jest.fn().mockResolvedValue({
          id: projectId,
          frameProfile: 'landscape_16_9',
          durationPreset: null,
          visualStyle: null,
          defaultLocale: 'en-US',
          creativeProfileConfirmedAt: null,
          draft: {
            schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
            revision: 3,
            content,
            contentHash: canonicalJsonHash(content),
          },
          chapters: [
            {
              id: chapterId,
              rank: 0,
              nodeIds: [],
              entryNodeId: null,
              canvasLayout: null,
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      storyDraft: {
        updateMany: jest
          .fn()
          .mockImplementation(
            (input: { data: { content: InteractiveStoryDraftContent } }) => {
              latestWrittenContent = input.data.content;
              return Promise.resolve({ count: 1 });
            },
          ),
      },
      storyChapter: { update: jest.fn().mockResolvedValue({}) },
      storyChapterGraphRepair: { upsert: jest.fn().mockResolvedValue({}) },
      storyStoryboardSequence: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const receipts = {
      fenceBusinessMutationInTx: jest.fn().mockResolvedValue(undefined),
      completeSuccessInTx: jest.fn().mockResolvedValue(undefined),
    };
    const scoped = new StoryAgentCapabilityHandler(
      prisma as never,
      {} as never,
      { authorizeWrite: jest.fn().mockResolvedValue(undefined) } as never,
      {
        acquireAgentOsMutationFence: jest.fn().mockResolvedValue({
          fencingToken: BigInt(1),
        }),
      } as never,
      {} as never,
      receipts as never,
      {} as never,
      {} as never,
    );

    await expect(
      scoped.execute({
        ...storyboardExecuteInput('story.updateBible', {
          baseDraftRevision: 3,
          logline: 'A courier reaches a sealed gate.',
        }),
        projectId,
        workbenchContext: { chapterId },
      }),
    ).resolves.toMatchObject({ draftRevision: 4 });

    await expect(
      scoped.execute({
        ...storyboardExecuteInput('story.updateStateVariables', {
          baseDraftRevision: 3,
          upsert: [
            {
              key: 'courage',
              name: { 'en-US': 'Courage' },
              valueType: 'number',
              initialValue: 0,
            },
          ],
        }),
        projectId,
        workbenchContext: { chapterId },
      }),
    ).resolves.toMatchObject({ draftRevision: 4 });

    expect(latestWrittenContent?.storyBible.stateVariables).toEqual([
      expect.objectContaining({ key: 'courage' }),
    ]);

    expect(tx.storyChapter.update).toHaveBeenCalledWith({
      where: { id: chapterId },
      data: { nodeIds: ['scene.gate'], entryNodeId: 'scene.gate' },
    });
    expect(tx.storyChapterGraphRepair.upsert).toHaveBeenCalledTimes(2);
    expect(tx.storyStoryboardSequence.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          storyProjectId: projectId,
          storyChapterId: chapterId,
          plotNodeId: 'scene.gate',
        }) as unknown,
      ],
    });
  });

  function storyboardExecuteInput(
    toolId: string,
    args: unknown,
  ): Parameters<StoryAgentCapabilityHandler['execute']>[0] {
    return {
      toolId,
      runId: '0197f4a2-0800-7000-8000-0000000000c1',
      conversationId: '0197f4a2-0800-7000-8000-0000000000c2',
      turnId: '0197f4a2-0800-7000-8000-0000000000c3',
      toolCallId: '0197f4a2-0800-7000-8000-0000000000c4',
      actorId: 'creator-1',
      projectId: '0197f4a2-0800-7000-8000-0000000000c5',
      skillResolutionId: '0197f4a2-0800-7000-8000-0000000000c6',
      skillVersionIds: [],
      workbenchContext: {
        chapterId: '0197f4a2-0800-7000-8000-0000000000c7',
      },
      idempotencyKey: 'project-1:run-1:call-1:v1',
      arguments: args,
    };
  }

  const SEQUENCE_DTO = {
    id: '0197f4a2-0800-7000-8000-0000000000d1',
    projectId: '0197f4a2-0800-7000-8000-0000000000c5',
    chapterId: '0197f4a2-0800-7000-8000-0000000000c7',
    plotNodeId: 'scene.gate',
    stableKey: 'scene.gate',
    title: null,
    description: 'The courier reaches the gate.',
    suggestedDurationMs: 8_000,
    durationMs: 8_000,
    sourceFingerprint: 'a'.repeat(64),
    status: 'current',
    version: 3,
    userModifiedAt: '2026-09-05T12:00:00.000Z',
    clips: [
      {
        id: '0197f4a2-0800-7000-8000-0000000000d2',
        stableKey: 'shot.scene.gate.opening',
        title: 'Opening frame',
        rank: 0,
        kind: 'image',
        track: 'visual',
        startMs: 0,
        durationMs: 2_000,
        description: 'A sealed gate in rain.',
        imagePrompt: 'A sealed gate in rain.',
        videoPrompt: null,
        negativePrompt: null,
        userModifiedAt: null,
      },
    ],
    cues: [
      {
        id: '0197f4a2-0800-7000-8000-0000000000d3',
        stableKey: 'cue.scene.gate.route',
        kind: 'decision',
        plotDecisionId: 'decision.route',
        atMs: 8_000,
      },
    ],
  };

  function scopedStoryboardHandler(
    production: Record<string, jest.Mock>,
    requireWrite = jest.fn().mockResolvedValue(undefined),
  ) {
    return new StoryAgentCapabilityHandler(
      {} as never,
      {} as never,
      { requireWrite } as never,
      {} as never,
      {} as never,
      {} as never,
      production as never,
      {} as never,
    );
  }

  it('serves the slim agent Storyboard projection', async () => {
    const getStoryboardForAgent = jest.fn().mockResolvedValue({
      chapterId: '0197f4a2-0800-7000-8000-0000000000c7',
      sequences: [],
    });
    const scoped = scopedStoryboardHandler({ getStoryboardForAgent });

    await scoped.execute(storyboardExecuteInput('story.storyboard.read', {}));

    expect(getStoryboardForAgent).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '0197f4a2-0800-7000-8000-0000000000c5',
      '0197f4a2-0800-7000-8000-0000000000c7',
    );
  });

  it('puts a version-free Agent timeline through the production service', async () => {
    const putTimeline = jest.fn().mockResolvedValue(SEQUENCE_DTO);
    const requireWrite = jest.fn().mockResolvedValue(undefined);
    const scoped = scopedStoryboardHandler({ putTimeline }, requireWrite);

    const result = await scoped.execute(
      storyboardExecuteInput('story.storyboard.putTimeline', {
        sequenceId: '0197f4a2-0800-7000-8000-0000000000d1',
        durationMs: 2_000,
        clips: [
          {
            stableKey: 'shot.scene.gate.opening',
            title: 'Opening frame',
            description: 'A sealed gate in rain.',
            startMs: 0,
            durationMs: 2_000,
            kind: 'image',
            imagePrompt: 'A sealed gate in rain.',
          },
        ],
      }),
    );

    expect(requireWrite).toHaveBeenCalledWith(
      'creator-1',
      '0197f4a2-0800-7000-8000-0000000000c5',
    );
    expect(putTimeline).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '0197f4a2-0800-7000-8000-0000000000c5',
      '0197f4a2-0800-7000-8000-0000000000c7',
      '0197f4a2-0800-7000-8000-0000000000d1',
      'project-1:run-1:call-1:v1',
      expect.objectContaining({
        durationMs: 2_000,
        clips: [expect.any(Object)],
      }),
    );
    expect(result).toEqual({
      chapterId: '0197f4a2-0800-7000-8000-0000000000c7',
      sequence: {
        sequenceId: '0197f4a2-0800-7000-8000-0000000000d1',
        plotNodeId: 'scene.gate',
        description: 'The courier reaches the gate.',
        durationMs: 8_000,
        suggestedDurationMs: 8_000,
        userModifiedAt: '2026-09-05T12:00:00.000Z',
        clips: [
          {
            clipId: '0197f4a2-0800-7000-8000-0000000000d2',
            stableKey: 'shot.scene.gate.opening',
            kind: 'image',
            title: 'Opening frame',
            description: 'A sealed gate in rain.',
            startMs: 0,
            durationMs: 2_000,
            imagePrompt: 'A sealed gate in rain.',
            videoPrompt: null,
            negativePrompt: null,
            userModifiedAt: null,
          },
        ],
        cues: [
          {
            cueId: '0197f4a2-0800-7000-8000-0000000000d3',
            stableKey: 'cue.scene.gate.route',
            kind: 'decision',
            atMs: 8_000,
            decisionId: 'decision.route',
          },
        ],
      },
    });
  });

  it('patches one clip by its unique id without a sequence address', async () => {
    const patchClip = jest.fn().mockResolvedValue(SEQUENCE_DTO.clips[0]);
    const requireWrite = jest.fn().mockResolvedValue(undefined);
    const scoped = scopedStoryboardHandler({ patchClip }, requireWrite);

    const result = await scoped.execute(
      storyboardExecuteInput('story.storyboard.patchClip', {
        clipId: '0197f4a2-0800-7000-8000-0000000000d2',
        imagePrompt: 'A sealed gate in heavier rain.',
      }),
    );

    expect(patchClip).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '0197f4a2-0800-7000-8000-0000000000c5',
      '0197f4a2-0800-7000-8000-0000000000c7',
      null,
      '0197f4a2-0800-7000-8000-0000000000d2',
      'project-1:run-1:call-1:v1',
      expect.objectContaining({
        clipId: '0197f4a2-0800-7000-8000-0000000000d2',
        imagePrompt: 'A sealed gate in heavier rain.',
      }),
    );
    expect(result).toEqual({
      chapterId: '0197f4a2-0800-7000-8000-0000000000c7',
      clip: {
        clipId: '0197f4a2-0800-7000-8000-0000000000d2',
        stableKey: 'shot.scene.gate.opening',
        kind: 'image',
        title: 'Opening frame',
        description: 'A sealed gate in rain.',
        startMs: 0,
        durationMs: 2_000,
        imagePrompt: 'A sealed gate in rain.',
        videoPrompt: null,
        negativePrompt: null,
        userModifiedAt: null,
      },
    });
  });

  it('rejects paid batch confirmation when the approved count or points no longer match', async () => {
    const requireWrite = jest.fn().mockResolvedValue({
      workspaceId: '11111111-1111-4111-8111-111111111111',
    });
    const confirm = jest.fn();
    const scoped = new StoryAgentCapabilityHandler(
      {} as never,
      {} as never,
      { requireWrite } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        get: jest.fn().mockResolvedValue({ itemCount: 3, totalPoints: 180 }),
        confirm,
      } as never,
    );

    await expect(
      scoped.execute({
        toolId: 'story.generation.confirmBatch',
        runId: '22222222-2222-4222-8222-222222222222',
        conversationId: '33333333-3333-4333-8333-333333333333',
        turnId: '44444444-4444-4444-8444-444444444444',
        toolCallId: 'confirm-generation-batch-1',
        actorId: 'creator-1',
        projectId: '55555555-5555-4555-8555-555555555555',
        skillResolutionId: '66666666-6666-4666-8666-666666666666',
        skillVersionIds: [],
        workbenchContext: {
          chapterId: '77777777-7777-4777-8777-777777777777',
        },
        idempotencyKey: 'confirm-generation-batch-key-1',
        arguments: {
          batchId: '88888888-8888-4888-8888-888888888888',
          expectedVersion: 0,
          expectedItemCount: 3,
          expectedTotalPoints: 120,
        },
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_GENERATION_BATCH_APPROVAL_MISMATCH',
        actualItemCount: 3,
        actualTotalPoints: 180,
      },
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('resumes a paused batch through the guarded resume path after the creator asks to continue', async () => {
    const requireWrite = jest.fn().mockResolvedValue({
      workspaceId: '11111111-1111-4111-8111-111111111111',
    });
    const resume = jest
      .fn()
      .mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888' });
    const scoped = new StoryAgentCapabilityHandler(
      {} as never,
      {} as never,
      { requireWrite } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { resume } as never,
    );

    await expect(
      scoped.execute({
        toolId: 'story.generation.resumeBatch',
        runId: '22222222-2222-4222-8222-222222222222',
        conversationId: '33333333-3333-4333-8333-333333333333',
        turnId: '44444444-4444-4444-8444-444444444444',
        toolCallId: 'resume-generation-batch-1',
        actorId: 'creator-1',
        projectId: '55555555-5555-4555-8555-555555555555',
        skillResolutionId: '66666666-6666-4666-8666-666666666666',
        skillVersionIds: [],
        workbenchContext: {
          chapterId: '77777777-7777-4777-8777-777777777777',
        },
        idempotencyKey: 'resume-generation-batch-key-1',
        arguments: {
          batchId: '88888888-8888-4888-8888-888888888888',
        },
      }),
    ).resolves.toEqual({ id: '88888888-8888-4888-8888-888888888888' });
    expect(requireWrite).toHaveBeenCalledWith(
      'creator-1',
      '55555555-5555-4555-8555-555555555555',
    );
    expect(resume).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '55555555-5555-4555-8555-555555555555',
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
    );
  });

  it('quotes only the requested asset kind without forwarding absent model fields', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111', version: 2 },
      { id: '22222222-2222-4222-8222-222222222222', version: 4 },
    ]);
    const quoteAssets = jest.fn().mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
    });
    const scoped = new StoryAgentCapabilityHandler(
      { storyAssetSpec: { findMany } } as never,
      {} as never,
      {
        requireWrite: jest.fn().mockResolvedValue({
          workspaceId: '44444444-4444-4444-8444-444444444444',
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { quoteAssets } as never,
    );

    await expect(
      scoped.execute({
        toolId: 'story.generation.quoteAssets',
        runId: '55555555-5555-4555-8555-555555555555',
        conversationId: '66666666-6666-4666-8666-666666666666',
        turnId: '77777777-7777-4777-8777-777777777777',
        toolCallId: 'quote-character-assets-1',
        actorId: 'creator-1',
        projectId: '88888888-8888-4888-8888-888888888888',
        skillResolutionId: '99999999-9999-4999-8999-999999999999',
        skillVersionIds: [],
        workbenchContext: {
          chapterId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          experience: 'mobile_h5',
        },
        idempotencyKey: 'quote-character-assets-key-1',
        arguments: {
          assetKinds: ['character'],
          outputKind: 'image',
        },
      }),
    ).resolves.toEqual({ id: '33333333-3333-4333-8333-333333333333' });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        storyProjectId: '88888888-8888-4888-8888-888888888888',
        storyChapterId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'current',
        kind: { in: ['character'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, version: true },
    });
    expect(quoteAssets).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '88888888-8888-4888-8888-888888888888',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'quote-character-assets-key-1',
      {
        targets: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            expectedVersion: 2,
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            expectedVersion: 4,
          },
        ],
        outputKind: 'image',
        options: {},
      },
      { dispatchMode: 'sequential', experience: 'mobile_h5' },
    );
  });

  it('returns the stable external-job handoff when an idempotent retry already reached proposed', async () => {
    const createAuthoringRun = jest.fn().mockResolvedValue({
      id: '019a034d-2af8-71e2-b961-b18ca7590a9f',
      status: 'proposed',
    });
    const requireWrite = jest.fn().mockResolvedValue({
      workspaceId: '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
    });
    const getInitialUserMessageText = jest
      .fn()
      .mockResolvedValue(
        'Create the complete interactive film and review every stage through Storyboard.',
      );
    const scoped = new StoryAgentCapabilityHandler(
      {
        agentOsExternalHandoffRegistration: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as never,
      { getInitialUserMessageText } as never,
      { requireWrite } as never,
      {} as never,
      { createAuthoringRun } as never,
      { fenceBusinessMutationInTx: jest.fn() } as never,
      {
        getProductionState: jest
          .fn()
          .mockResolvedValue(canonicalProductionState()),
      } as never,
      {} as never,
    );
    const input = {
      toolId: 'story.author',
      runId: '019a034d-31a5-7d7f-8329-a91739a701b0',
      conversationId: '019a034d-3334-765c-a055-a40cd5ae6403',
      turnId: '019a034d-34a7-7542-a554-4a7dbdb247dd',
      toolCallId: 'call_story_author_1',
      actorId: 'creator-1',
      projectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
      skillResolutionId: '019a034d-37f5-7d82-9075-a502131a0a69',
      skillVersionIds: [],
      workbenchContext: {
        chapterId: '019a034d-397a-7dac-8d77-fad8dd15038e',
        experience: 'mobile_h5',
      },
      idempotencyKey:
        '019a034d-36a6-70df-91b1-1d030480f7d4:019a034d-31a5-7d7f-8329-a91739a701b0:call_story_author_1:v1',
      arguments: {
        title: 'The Last Watch',
        summary: 'A final imperial guard chooses whom to save.',
        brief:
          'Create an interactive film set on the final night of Ming rule.',
        sourceAttachmentId: '33333333-3333-4333-8333-333333333333',
        continueThrough: 'storyboard',
        startedMessage:
          'I have the direction and am shaping the interactive-film proposal now.',
        completionMessage:
          'The Last Watch proposal is ready for you to review.',
      },
    } as const;

    await expect(scoped.execute(input)).resolves.toEqual({
      runId: '019a034d-2af8-71e2-b961-b18ca7590a9f',
      status: 'authoring',
      agentHandoff: {
        kind: 'external_job',
        jobId: '019a034d-2af8-71e2-b961-b18ca7590a9f',
        startedMessage:
          'I have the direction and am shaping the interactive-film proposal now.',
      },
    });
    expect(createAuthoringRun).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
      '019a034d-36a6-70df-91b1-1d030480f7d4',
      expect.objectContaining({
        idempotencyKey: input.idempotencyKey,
        conversationId: input.conversationId,
        sourceAttachmentId: input.arguments.sourceAttachmentId,
        sourceAgentRunId: input.runId,
        sourceAgentTurnId: input.turnId,
        sourceAgentToolCallId: input.toolCallId,
        sourceStartedMessage: input.arguments.startedMessage,
        sourceCompletionMessage: input.arguments.completionMessage,
        sourceContinuationPlan: {
          continueThrough: 'storyboard',
          title: input.arguments.title,
          summary: input.arguments.summary,
          brief: input.arguments.brief,
          experience: 'mobile_h5',
        },
      }),
      expect.objectContaining({
        canonicalizeAndFence: expect.any(Function) as (
          ...args: unknown[]
        ) => unknown,
      }),
    );
    expect(getInitialUserMessageText).toHaveBeenCalledWith(input.runId);
  });

  it('atomically applies server-owned H5 profile defaults before the first authoring job', async () => {
    const tx = {
      skillCatalogItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: CINEMATIC_REALISM_SKILL.skillId,
        }),
      },
      storyProject: {
        findUnique: jest.fn().mockResolvedValue({
          defaultLocale: 'zh-CN',
          creativeProfileConfirmedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const fenceBusinessMutationInTx = jest.fn().mockResolvedValue(undefined);
    const createAuthoringRun = jest.fn().mockImplementation(
      async (
        _user: unknown,
        _workspaceId: unknown,
        _projectId: unknown,
        request: {
          title: string;
          summary: string;
          brief: string;
        },
        authority: {
          canonicalizeAndFence: (
            transaction: typeof tx,
            input: {
              proposal: { title: string; summary: string; brief: string };
            },
          ) => Promise<unknown>;
        },
      ) => {
        await authority.canonicalizeAndFence(tx, {
          proposal: {
            title: request.title,
            summary: request.summary,
            brief: request.brief,
          },
        });
        return {
          id: '019a034d-2af8-71e2-b961-b18ca7590a9f',
          status: 'authoring',
        };
      },
    );
    const scoped = new StoryAgentCapabilityHandler(
      {
        agentOsExternalHandoffRegistration: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as never,
      {
        getInitialUserMessageText: jest.fn().mockResolvedValue('一只小猫'),
      } as never,
      {
        requireWrite: jest.fn().mockResolvedValue({
          workspaceId: '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
        }),
      } as never,
      {} as never,
      { createAuthoringRun } as never,
      { fenceBusinessMutationInTx } as never,
      {
        getProductionState: jest
          .fn()
          .mockResolvedValue(canonicalProductionState()),
      } as never,
      {} as never,
    );

    await scoped.execute({
      toolId: 'story.author',
      runId: '019a034d-31a5-7d7f-8329-a91739a701b0',
      conversationId: '019a034d-3334-765c-a055-a40cd5ae6403',
      turnId: '019a034d-34a7-7542-a554-4a7dbdb247dd',
      toolCallId: 'call_story_author_h5_defaults',
      actorId: 'creator-1',
      projectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
      skillResolutionId: '019a034d-37f5-7d82-9075-a502131a0a69',
      skillVersionIds: [],
      workbenchContext: {
        chapterId: '019a034d-397a-7dac-8d77-fad8dd15038e',
        experience: 'mobile_h5',
      },
      idempotencyKey: 'story-author-h5-defaults-test',
      arguments: {
        title: '一只小猫',
        summary: '一只小猫开始一段意外的旅程。',
        brief: '一只小猫',
        continueThrough: 'storyboard',
        startedMessage: '正在起草剧本。',
        completionMessage: '剧本已起草。',
      },
    });

    expect(fenceBusinessMutationInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ toolId: 'story.author' }),
    );
    expect(tx.skillCatalogItem.findFirst).toHaveBeenCalledWith({
      where: {
        id: CINEMATIC_REALISM_SKILL.skillId,
        slug: CINEMATIC_REALISM_SKILL.slug,
        category: 'style',
        status: 'published',
        latestPublishedVersionId: CINEMATIC_REALISM_SKILL.versionId,
      },
      select: { id: true },
    });
    expect(tx.storyProject.updateMany).toHaveBeenCalledWith({
      where: {
        id: '019a034d-36a6-70df-91b1-1d030480f7d4',
        creativeProfileConfirmedAt: null,
      },
      data: expect.objectContaining({
        durationPreset: 'short_5_15',
        visualStyle: 'cinematic-realism',
        visualStyleSkillId: CINEMATIC_REALISM_SKILL.skillId,
        visualStyleSkillVersionId: CINEMATIC_REALISM_SKILL.versionId,
        defaultLocale: 'zh-CN',
        creativeProfileConfirmedAt: expect.any(Date) as Date,
        version: { increment: 1 },
      }) as unknown,
    });
  });

  it('carries creator-authorized H5 auto-apply policy into the next Story authoring job', async () => {
    const createAuthoringRun = jest.fn().mockResolvedValue({
      id: '019a034d-2af8-71e2-b961-b18ca7590a9f',
      status: 'authoring',
    });
    const previousPlan = {
      continueThrough: 'storyboard',
      title: '雨夜归途',
      summary: '一只小猫在雨夜寻找回家的路。',
      brief: '完成剧本、情节树、资产与分镜。',
      experience: 'mobile_h5',
      autoApplyAssetSpecs: true,
      autoGenerateAssetImages: true,
    } as const;
    const findFirst = jest.fn().mockResolvedValue({
      continuationPlan: previousPlan,
    });
    const scoped = new StoryAgentCapabilityHandler(
      {
        agentOsExternalHandoffRegistration: { findFirst },
      } as never,
      {
        getInitialUserMessageText: jest
          .fn()
          .mockResolvedValue('请完整创作到可游玩的分镜。'),
      } as never,
      {
        requireWrite: jest.fn().mockResolvedValue({
          workspaceId: '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
        }),
      } as never,
      {} as never,
      { createAuthoringRun } as never,
      { fenceBusinessMutationInTx: jest.fn() } as never,
      {
        getProductionState: jest
          .fn()
          .mockResolvedValue(canonicalProductionState('current')),
      } as never,
      {} as never,
    );

    await scoped.execute({
      toolId: 'story.author',
      runId: '019a034d-31a5-7d7f-8329-a91739a701b0',
      conversationId: '019a034d-3334-765c-a055-a40cd5ae6403',
      turnId: '019a034d-34a7-7542-a554-4a7dbdb247dd',
      toolCallId: 'call_story_author_assets',
      actorId: 'creator-1',
      projectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
      skillResolutionId: '019a034d-37f5-7d82-9075-a502131a0a69',
      skillVersionIds: [],
      workbenchContext: {
        chapterId: '019a034d-397a-7dac-8d77-fad8dd15038e',
        experience: 'mobile_h5',
      },
      idempotencyKey: 'story-author-assets-continuation-test',
      arguments: {
        title: previousPlan.title,
        summary: previousPlan.summary,
        brief: previousPlan.brief,
        continueThrough: 'storyboard',
        startedMessage: '正在准备资产规格。',
        completionMessage: '资产规格已准备好。',
      },
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        sourceAgentRunId: '019a034d-31a5-7d7f-8329-a91739a701b0',
        storyAgentRun: {
          storyProjectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
          storyChapterId: '019a034d-397a-7dac-8d77-fad8dd15038e',
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { continuationPlan: true },
    });
    expect(createAuthoringRun).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
      '019a034d-36a6-70df-91b1-1d030480f7d4',
      expect.objectContaining({
        sourceContinuationPlan: expect.objectContaining({
          experience: 'mobile_h5',
          autoApplyAssetSpecs: true,
          autoGenerateAssetImages: true,
        }) as unknown,
      }),
      expect.any(Object),
    );
  });

  it('persists the creator-authorized multi-stage scope when the model proposes only Script', async () => {
    const createAuthoringRun = jest.fn().mockResolvedValue({
      id: '019a034d-2af8-71e2-b961-b18ca7590a9f',
      status: 'authoring',
    });
    const scoped = new StoryAgentCapabilityHandler(
      {} as never,
      {
        getInitialUserMessageText: jest
          .fn()
          .mockResolvedValue(
            '请逐阶段提供剧本、情节树、资产规格和分镜规格供我分别审核。',
          ),
      } as never,
      {
        requireWrite: jest.fn().mockResolvedValue({
          workspaceId: '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
        }),
      } as never,
      {} as never,
      { createAuthoringRun } as never,
      { fenceBusinessMutationInTx: jest.fn() } as never,
      {
        getProductionState: jest
          .fn()
          .mockResolvedValue(canonicalProductionState()),
      } as never,
      {} as never,
    );

    await scoped.execute({
      toolId: 'story.author',
      runId: '019a034d-31a5-7d7f-8329-a91739a701b0',
      conversationId: '019a034d-3334-765c-a055-a40cd5ae6403',
      turnId: '019a034d-34a7-7542-a554-4a7dbdb247dd',
      toolCallId: 'call_story_author_scope',
      actorId: 'creator-1',
      projectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
      skillResolutionId: '019a034d-37f5-7d82-9075-a502131a0a69',
      skillVersionIds: [],
      workbenchContext: {
        chapterId: '019a034d-397a-7dac-8d77-fad8dd15038e',
      },
      idempotencyKey: 'story-author-scope-test',
      arguments: {
        title: '断电之城',
        summary: '海上城市停电。',
        brief: '创作一部互动影游。',
        continueThrough: 'script',
        startedMessage: '开始创作。',
        completionMessage: '提案已就绪。',
      },
    });

    expect(createAuthoringRun).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
      '019a034d-36a6-70df-91b1-1d030480f7d4',
      expect.objectContaining({
        sourceContinuationPlan: expect.objectContaining({
          continueThrough: 'storyboard',
        }) as unknown,
      }),
      expect.any(Object),
    );
  });

  it('defaults an empty chapter with a referenced screenplay to the full review path', async () => {
    const createAuthoringRun = jest.fn().mockResolvedValue({
      id: '019a034d-2af8-71e2-b961-b18ca7590a9f',
      status: 'authoring',
    });
    const getProductionState = jest
      .fn()
      .mockResolvedValue(canonicalProductionState());
    const scoped = new StoryAgentCapabilityHandler(
      {} as never,
      {
        getInitialUserMessageText: jest
          .fn()
          .mockResolvedValue('根据这个剧本生成'),
      } as never,
      {
        requireWrite: jest.fn().mockResolvedValue({
          workspaceId: '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
        }),
      } as never,
      {} as never,
      { createAuthoringRun } as never,
      { fenceBusinessMutationInTx: jest.fn() } as never,
      { getProductionState } as never,
      {} as never,
    );

    await scoped.execute({
      toolId: 'story.author',
      runId: '019a034d-31a5-7d7f-8329-a91739a701b0',
      conversationId: '019a034d-3334-765c-a055-a40cd5ae6403',
      turnId: '019a034d-34a7-7542-a554-4a7dbdb247dd',
      toolCallId: 'call_story_author_from_screenplay',
      actorId: 'creator-1',
      projectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
      skillResolutionId: '019a034d-37f5-7d82-9075-a502131a0a69',
      skillVersionIds: [],
      workbenchContext: {
        chapterId: '019a034d-397a-7dac-8d77-fad8dd15038e',
      },
      idempotencyKey: 'story-author-from-screenplay-test',
      arguments: {
        title: '虎豹花园',
        summary: '一部互动影游。',
        brief: '根据上传的剧本完成互动影游制作。',
        continueThrough: 'script',
        startedMessage: '开始创作。',
        completionMessage: '提案已就绪。',
      },
    });

    expect(getProductionState).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '019a034d-36a6-70df-91b1-1d030480f7d4',
      '019a034d-397a-7dac-8d77-fad8dd15038e',
    );
    expect(createAuthoringRun).toHaveBeenCalledWith(
      { userId: 'creator-1' },
      '019a034d-2dbd-760b-bec6-dcc9fc5fc724',
      '019a034d-36a6-70df-91b1-1d030480f7d4',
      expect.objectContaining({
        sourceContinuationPlan: expect.objectContaining({
          continueThrough: 'storyboard',
        }) as unknown,
      }),
      expect.any(Object),
    );
  });

  it('validates creative-profile answers from the append-only run journal', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    const getRunEvents = jest.fn().mockResolvedValue([
      {
        sequence: 1,
        type: 'UserInputRequired',
        data: {
          requestId,
          formId: 'story_creative_profile',
          knownValues: {},
          questions: CREATIVE_PROFILE_QUESTIONS,
        },
      },
      {
        sequence: 2,
        type: 'UserInputResolved',
        data: {
          requestId,
          answers: {
            aspect_ratio: 'landscape_16_9',
            target_runtime: 'medium_15_30',
            visual_direction: 'stylized-3d-cinema',
            story_language: 'zh-CN',
          },
        },
      },
    ]);
    const tx = {
      skillCatalogItem: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: STYLIZED_3D_SKILL.skillId }),
      },
      storyProject: {
        findUnique: jest.fn().mockResolvedValue({
          frameProfile: 'landscape_16_9',
          durationPreset: null,
          visualStyle: null,
          visualStyleSkillId: null,
          visualStyleSkillVersionId: null,
          defaultLocale: 'en-US',
          creativeProfileConfirmedAt: null,
          builds: [],
          videoSelections: [],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      agentOsRun: {
        findFirst: jest.fn().mockResolvedValue({
          id: '019a034d-31a5-7d7f-8329-a91739a701b0',
        }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((callback: (value: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const authorizeWrite = jest.fn().mockResolvedValue(undefined);
    const acquireAgentOsMutationFence = jest.fn().mockResolvedValue(undefined);
    const scoped = new StoryAgentCapabilityHandler(
      prisma as never,
      { getRunEvents } as never,
      { authorizeWrite } as never,
      { acquireAgentOsMutationFence } as never,
      {} as never,
      {
        fenceBusinessMutationInTx: jest.fn().mockResolvedValue(undefined),
        completeSuccessInTx: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      scoped.execute({
        toolId: 'story.confirmCreativeProfile',
        runId: '019a034d-31a5-7d7f-8329-a91739a701b0',
        conversationId: '019a034d-3334-765c-a055-a40cd5ae6403',
        turnId: '019a034d-34a7-7542-a554-4a7dbdb247dd',
        toolCallId: 'call_confirm_profile_1',
        actorId: 'creator-1',
        projectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
        skillResolutionId: '019a034d-37f5-7d82-9075-a502131a0a69',
        skillVersionIds: [],
        idempotencyKey: 'confirm-profile-key-1',
        arguments: {
          requestId,
          aspectRatio: 'landscape_16_9',
          targetRuntime: 'medium_15_30',
          visualDirection: 'stylized-3d-cinema',
          storyLanguage: 'zh-CN',
        },
      }),
    ).resolves.toMatchObject({
      frameProfile: 'landscape_16_9',
      durationPreset: 'medium_15_30',
      visualStyle: 'stylized-3d-cinema',
      storyLanguage: 'zh-CN',
    });
    expect(prisma.agentOsRun.findFirst).toHaveBeenCalledWith({
      where: {
        id: '019a034d-31a5-7d7f-8329-a91739a701b0',
        projectId: '019a034d-36a6-70df-91b1-1d030480f7d4',
        conversationId: '019a034d-3334-765c-a055-a40cd5ae6403',
        actorId: 'creator-1',
      },
      select: { id: true },
    });
    expect(getRunEvents).toHaveBeenCalledWith(
      '019a034d-31a5-7d7f-8329-a91739a701b0',
    );
  });

  it('accepts creative profile values only from the matching resolved Agent request', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    expect(
      creativeProfileValuesFromJournal(
        [
          {
            sequence: 1,
            type: 'UserInputRequired',
            data: {
              requestId,
              formId: 'story_creative_profile',
              knownValues: {},
              questions: CREATIVE_PROFILE_QUESTIONS,
            },
          },
          {
            sequence: 2,
            type: 'UserInputResolved',
            data: {
              requestId,
              answers: {
                aspect_ratio: 'landscape_16_9',
                target_runtime: 'medium_15_30',
                visual_direction: 'stylized-3d-cinema',
                story_language: 'zh-CN',
              },
            },
          },
        ] as never,
        requestId,
      ),
    ).toEqual({
      aspect_ratio: 'landscape_16_9',
      target_runtime: 'medium_15_30',
      visual_direction: 'stylized-3d-cinema',
      story_language: 'zh-CN',
    });
  });

  it('rejects a creative-profile request when the model omits formId', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    expect(() =>
      creativeProfileValuesFromJournal(
        [
          {
            sequence: 1,
            type: 'UserInputRequired',
            data: {
              requestId,
              knownValues: {},
              questions: CREATIVE_PROFILE_QUESTIONS,
            },
          },
          {
            sequence: 2,
            type: 'UserInputResolved',
            data: {
              requestId,
              answers: {
                aspect_ratio: 'landscape_16_9',
                target_runtime: 'medium_15_30',
                visual_direction: 'stylized-3d-cinema',
                story_language: 'zh-HK',
              },
            },
          },
        ] as never,
        requestId,
      ),
    ).toThrow('creative profile must come from a resolved');
  });

  it('accepts only the missing creative-profile questions in canonical order', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    expect(
      creativeProfileValuesFromJournal(
        [
          {
            sequence: 1,
            type: 'UserInputRequired',
            data: {
              requestId,
              formId: 'story_creative_profile',
              knownValues: {
                aspect_ratio: 'landscape_16_9',
                visual_direction: 'stylized-3d-cinema',
              },
              questions: [
                CREATIVE_PROFILE_QUESTIONS[1],
                CREATIVE_PROFILE_QUESTIONS[3],
              ],
            },
          },
          {
            sequence: 2,
            type: 'UserInputResolved',
            data: {
              requestId,
              answers: {
                target_runtime: 'medium_15_30',
                story_language: 'en-US',
              },
            },
          },
        ] as never,
        requestId,
      ),
    ).toEqual({
      aspect_ratio: 'landscape_16_9',
      target_runtime: 'medium_15_30',
      visual_direction: 'stylized-3d-cinema',
      story_language: 'en-US',
    });
  });

  it('rejects creative-profile questions that are out of canonical order', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    expect(() =>
      creativeProfileValuesFromJournal(
        [
          {
            sequence: 1,
            type: 'UserInputRequired',
            data: {
              requestId,
              formId: 'story_creative_profile',
              knownValues: {
                aspect_ratio: 'landscape_16_9',
                visual_direction: 'stylized-3d-cinema',
              },
              questions: [
                CREATIVE_PROFILE_QUESTIONS[3],
                CREATIVE_PROFILE_QUESTIONS[1],
              ],
            },
          },
          {
            sequence: 2,
            type: 'UserInputResolved',
            data: {
              requestId,
              answers: {
                story_language: 'en-US',
                target_runtime: 'medium_15_30',
              },
            },
          },
        ] as never,
        requestId,
      ),
    ).toThrow('creative profile must come from a resolved');
  });

  it('rejects answers that were not preceded by the matching operation-card request', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    expect(() =>
      creativeProfileValuesFromJournal(
        [
          {
            sequence: 1,
            type: 'UserInputResolved',
            data: {
              requestId,
              answers: {
                aspect_ratio: 'landscape_16_9',
                target_runtime: 'medium_15_30',
                visual_direction: 'stylized-3d-cinema',
                story_language: 'en-US',
              },
            },
          },
        ] as never,
        requestId,
      ),
    ).toThrow('creative profile must come from a resolved');
  });

  it('creates a complete branch atomically with no dangling targets', () => {
    const current = draft([node('opening')]);
    const args = StoryAddBranchInputSchema.parse({
      baseDraftRevision: 0,
      afterNodeId: 'opening',
      decisionId: 'decision.opening',
      prompt: { 'en-US': 'Which way?' },
      branches: [
        {
          choiceId: 'choice.left',
          label: { 'en-US': 'Left' },
          scene: {
            nodeId: 'scene.left',
            clipKey: 'SCENE_LEFT',
            name: 'Left path',
          },
        },
        {
          choiceId: 'choice.right',
          label: { 'en-US': 'Right' },
          scene: {
            nodeId: 'scene.right',
            clipKey: 'SCENE_RIGHT',
            name: 'Right path',
          },
        },
      ],
    });

    const result = executeStoryPatch({
      draft: current,
      layout: { nodePositions: {} },
      operations: buildAddBranchOperations(current, args),
    });

    expect(result.createdNodeIds).toEqual(['scene.left', 'scene.right']);
    expect(
      result.draft.graph.nodes.find((value) => value.nodeId === 'opening')
        ?.exit,
    ).toEqual({
      kind: 'choice',
      decisionId: 'decision.opening',
      prompt: { 'en-US': 'Which way?' },
      choices: [
        {
          choiceId: 'choice.left',
          label: { 'en-US': 'Left' },
          target: { kind: 'node', nodeId: 'scene.left' },
        },
        {
          choiceId: 'choice.right',
          label: { 'en-US': 'Right' },
          target: { kind: 'node', nodeId: 'scene.right' },
        },
      ],
    });
  });

  it('adds the first scene and makes it the entry in one mutation', () => {
    const current = draft([]);
    const args = StoryAddSceneInputSchema.parse({
      baseDraftRevision: 0,
      scene: { nodeId: 'opening', clipKey: 'OPENING', name: 'Opening' },
    });
    const result = executeStoryPatch({
      draft: current,
      layout: { nodePositions: {} },
      operations: buildAddSceneOperations(current, args),
    });
    expect(result.draft.graph.entryNodeId).toBe('opening');
    expect(result.createdNodeIds).toEqual(['opening']);
  });

  it('removes only the orphaned subtree and preserves shared descendants', () => {
    const current = draft([
      node('outside', {
        kind: 'choice',
        decisionId: 'decision.outside',
        prompt: { 'en-US': 'Shared?' },
        choices: [
          {
            choiceId: 'choice.shared',
            label: { 'en-US': 'Shared' },
            target: { kind: 'node', nodeId: 'shared' },
          },
        ],
      }),
      node('root', {
        kind: 'auto',
        routes: [{ target: { kind: 'node', nodeId: 'child' } }],
      }),
      node('child', {
        kind: 'auto',
        routes: [{ target: { kind: 'node', nodeId: 'shared' } }],
      }),
      node('shared'),
    ]);
    const result = executeStoryPatch({
      draft: current,
      layout: { nodePositions: {} },
      operations: buildRemoveSubtreeOperations(current, 'root'),
    });
    expect(result.draft.graph.nodes.map((value) => value.nodeId)).toEqual([
      'outside',
      'shared',
    ]);
  });

  it('creates and replaces an interaction by stable id without duplicates', () => {
    const current = draft([node('opening'), node('ending')]);
    current.storyBible.stateVariables = [
      {
        key: 'courage',
        name: { 'en-US': 'Courage' },
        valueType: 'number',
        initialValue: 0,
      },
    ];
    const opening = current.graph.nodes[0];
    if (opening?.kind !== 'clip') throw new Error('Expected clip');
    opening.onEnterEffects = [{ kind: 'add', key: 'courage', amount: 1 }];
    const create = StoryPutInteractionInputSchema.parse({
      baseDraftRevision: 0,
      nodeId: 'opening',
      interaction: {
        kind: 'hotspot',
        timing: 'window',
        interactionId: 'interaction.dodge',
        label: { 'zh-CN': '向右闪避' },
        trigger: { kind: 'swipe', direction: 'right' },
        rect: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
        startMs: 500,
        endMs: 1_500,
        outcomes: {
          success: {
            kind: 'continue',
            effects: [{ kind: 'add', key: 'courage', amount: 1 }],
          },
          timeout: { kind: 'goto', nodeId: 'ending' },
        },
      },
    });
    const created = executeStoryPatch({
      draft: current,
      layout: { nodePositions: {} },
      operations: buildPutInteractionOperations(current, create),
    }).draft;
    const replace = StoryPutInteractionInputSchema.parse({
      ...create,
      interaction: {
        ...create.interaction,
        trigger: { kind: 'press-hold', durationMs: 700 },
      },
    });
    const replaced = executeStoryPatch({
      draft: created,
      layout: { nodePositions: {} },
      operations: buildPutInteractionOperations(created, replace),
    }).draft;
    const replacedOpening = replaced.graph.nodes[0];
    expect(replacedOpening?.kind).toBe('clip');
    if (replacedOpening?.kind !== 'clip') throw new Error('Expected clip');
    expect(replacedOpening.interactions).toHaveLength(1);
    expect(replacedOpening.interactions[0]?.trigger).toEqual({
      kind: 'press-hold',
      durationMs: 700,
      controlTimeline: false,
    });
    expect(replacedOpening.onEnterEffects).toEqual([
      { kind: 'add', key: 'courage', amount: 1 },
    ]);
    expect(replacedOpening.interactions[0]?.outcomes.success).toMatchObject({
      effects: [{ kind: 'add', key: 'courage', amount: 1 }],
    });
  });

  it('removes one interaction without changing the scene', () => {
    const current = draft([node('opening')]);
    const opening = current.graph.nodes[0];
    if (opening?.kind !== 'clip') throw new Error('Expected clip');
    opening.interactions = [
      {
        kind: 'hotspot',
        timing: 'window',
        interactionId: 'interaction.tap',
        label: { 'en-US': 'Continue' },
        trigger: { kind: 'tap' },
        rect: { x: 0, y: 0, width: 1, height: 1 },
        startMs: 0,
        endMs: 1_000,
        outcomes: { success: { kind: 'continue' } },
      },
    ];
    const args = StoryRemoveInteractionInputSchema.parse({
      baseDraftRevision: 0,
      nodeId: 'opening',
      interactionId: 'interaction.tap',
    });
    const result = executeStoryPatch({
      draft: current,
      layout: { nodePositions: {} },
      operations: buildRemoveInteractionOperations(current, args),
    });
    expect(result.draft.graph.nodes[0]).toMatchObject({
      nodeId: 'opening',
      interactions: [],
    });
  });

  it('preserves a subtree referenced only by an interaction outcome', () => {
    const outside = node('outside');
    outside.interactions = [
      {
        kind: 'hotspot',
        timing: 'window',
        interactionId: 'interaction.escape',
        label: { 'en-US': 'Escape' },
        trigger: { kind: 'tap' },
        rect: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
        startMs: 0,
        endMs: 1_000,
        outcomes: {
          success: { kind: 'goto', target: { kind: 'node', nodeId: 'shared' } },
        },
      },
    ];
    const current = draft([
      outside,
      node('root', {
        kind: 'auto',
        routes: [{ target: { kind: 'node', nodeId: 'shared' } }],
      }),
      node('shared', {
        kind: 'auto',
        routes: [{ target: { kind: 'node', nodeId: 'tail' } }],
      }),
      node('tail'),
    ]);
    const result = executeStoryPatch({
      draft: current,
      layout: { nodePositions: {} },
      operations: buildRemoveSubtreeOperations(current, 'root'),
    });
    expect(result.draft.graph.nodes.map((value) => value.nodeId)).toEqual([
      'outside',
      'shared',
      'tail',
    ]);
  });
});

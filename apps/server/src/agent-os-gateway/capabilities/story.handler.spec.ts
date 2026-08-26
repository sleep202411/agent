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
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  type InteractiveStoryDraftContent,
} from '../../story-studio/interactive-film.schema';
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
  exit: InteractiveStoryDraftContent['graph']['nodes'][number]['exit'] = {
    kind: 'auto',
    nextNodeId: null,
  },
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
    expect(handler.supports('story.addBranch')).toBe(true);
    expect(handler.supports('story.putInteraction')).toBe(true);
    expect(handler.supports('story.removeInteraction')).toBe(true);
    expect(handler.supports('story.generation.quoteAssets')).toBe(true);
    expect(handler.supports('story.generation.confirmBatch')).toBe(true);
    expect(handler.supports('characters.upsert')).toBe(false);
    expect(handler.supports('canvas.applyPatch')).toBe(false);
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
    const scoped = new StoryAgentCapabilityHandler(
      {} as never,
      {} as never,
      { requireWrite } as never,
      {} as never,
      { createAuthoringRun } as never,
      { fenceBusinessMutationInTx: jest.fn() } as never,
      {} as never,
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
      },
      idempotencyKey:
        '019a034d-36a6-70df-91b1-1d030480f7d4:019a034d-31a5-7d7f-8329-a91739a701b0:call_story_author_1:v1',
      arguments: {
        title: 'The Last Watch',
        summary: 'A final imperial guard chooses whom to save.',
        brief:
          'Create an interactive film set on the final night of Ming rule.',
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
        },
      }),
      expect.objectContaining({
        canonicalizeAndFence: expect.any(Function) as (
          ...args: unknown[]
        ) => unknown,
      }),
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
          nextNodeId: 'scene.left',
        },
        {
          choiceId: 'choice.right',
          label: { 'en-US': 'Right' },
          nextNodeId: 'scene.right',
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
            nextNodeId: 'shared',
          },
        ],
      }),
      node('root', { kind: 'auto', nextNodeId: 'child' }),
      node('child', { kind: 'auto', nextNodeId: 'shared' }),
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
    const create = StoryPutInteractionInputSchema.parse({
      baseDraftRevision: 0,
      nodeId: 'opening',
      interaction: {
        kind: 'hotspot',
        interactionId: 'interaction.dodge',
        label: { 'zh-CN': '向右闪避' },
        trigger: { kind: 'swipe', direction: 'right' },
        rect: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
        startMs: 500,
        endMs: 1_500,
        outcomes: {
          success: { kind: 'continue' },
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
  });

  it('removes one interaction without changing the scene', () => {
    const current = draft([node('opening')]);
    const opening = current.graph.nodes[0];
    if (opening?.kind !== 'clip') throw new Error('Expected clip');
    opening.interactions = [
      {
        kind: 'hotspot',
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
        interactionId: 'interaction.escape',
        label: { 'en-US': 'Escape' },
        trigger: { kind: 'tap' },
        rect: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
        startMs: 0,
        endMs: 1_000,
        outcomes: { success: { kind: 'goto', nodeId: 'shared' } },
      },
    ];
    const current = draft([
      outside,
      node('root', { kind: 'auto', nextNodeId: 'shared' }),
      node('shared', { kind: 'auto', nextNodeId: 'tail' }),
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

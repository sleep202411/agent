import {
  StoryAddBranchInputSchema,
  StoryAddSceneInputSchema,
  StoryPutInteractionInputSchema,
  StoryRemoveInteractionInputSchema,
} from '@repo/agent-tools';
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

describe('StoryAgentCapabilityHandler', () => {
  const handler = new StoryAgentCapabilityHandler(
    {} as never,
    {} as never,
    {} as never,
  );

  it('claims only the new Story capability family', () => {
    expect(handler.supports('story.read')).toBe(true);
    expect(handler.supports('story.addBranch')).toBe(true);
    expect(handler.supports('story.putInteraction')).toBe(true);
    expect(handler.supports('story.removeInteraction')).toBe(true);
    expect(handler.supports('characters.upsert')).toBe(false);
    expect(handler.supports('canvas.applyPatch')).toBe(false);
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

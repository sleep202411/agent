import {
  StoryAddBranchInputSchema,
  StoryAddSceneInputSchema,
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
  buildRemoveSubtreeOperations,
} from './story.handler';

function node(
  nodeId: string,
  exit: InteractiveStoryDraftContent['graph']['nodes'][number]['exit'] = {
    kind: 'auto',
    nextNodeId: null,
  },
): InteractiveStoryDraftContent['graph']['nodes'][number] {
  return {
    kind: 'clip',
    nodeId,
    clipKey: nodeId.toUpperCase().replaceAll('.', '_'),
    name: nodeId,
    description: '',
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
});

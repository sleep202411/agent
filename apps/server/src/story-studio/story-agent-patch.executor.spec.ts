import type { StoryPatchOperation } from '@repo/shared/story-agent';
import {
  executeStoryPatch,
  StoryPatchExecutionError,
} from './story-agent-patch.executor';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

const UUIDS = [
  '0197f4a2-0800-7000-8000-000000000001',
  '0197f4a2-0800-7000-8000-000000000002',
  '0197f4a2-0800-7000-8000-000000000003',
  '0197f4a2-0800-7000-8000-000000000004',
] as const;

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: 'A gate opens.',
      synopsis: 'A visitor crosses a sealed gate.',
      characters: [],
    },
    graph: {
      entryNodeId: 'opening',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'opening',
          clipKey: 'OPENING',
          exit: { kind: 'auto', nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  };
}

function operation(
  value: Omit<StoryPatchOperation, 'operationId' | 'summary'>,
  index = 0,
): StoryPatchOperation {
  return {
    operationId: UUIDS[index],
    summary: value.kind,
    ...value,
  } as StoryPatchOperation;
}

describe('executeStoryPatch', () => {
  it('creates, wires, and reorders film clips deterministically', () => {
    const result = executeStoryPatch({
      draft: draft(),
      layout: { nodePositions: { opening: { x: 0, y: 0 } } },
      operations: [
        operation({
          kind: 'story_graph.put_node',
          payload: {
            intent: 'create',
            node: {
              kind: 'clip',
              nodeId: 'inside',
              clipKey: 'INSIDE',
              exit: { kind: 'auto', nextNodeId: null },
            },
          },
        }),
        operation(
          {
            kind: 'story_graph.put_node',
            payload: {
              intent: 'replace',
              node: {
                kind: 'clip',
                nodeId: 'opening',
                clipKey: 'OPENING',
                exit: { kind: 'auto', nextNodeId: 'inside' },
              },
            },
          },
          1,
        ),
        operation(
          {
            kind: 'story_graph.reorder_nodes',
            payload: { nodeIds: ['inside', 'opening'] },
          },
          2,
        ),
      ],
    });

    expect(result.draft.graph.nodes.map((node) => node.nodeId)).toEqual([
      'inside',
      'opening',
    ]);
    expect(result.createdNodeIds).toEqual(['inside']);
    expect(result.affectedNodeIds).toEqual(['inside', 'opening']);
    expect(result.draftChanged).toBe(true);
  });

  it('removes references and orphaned canvas positions with a deleted clip', () => {
    const current = draft();
    current.graph.nodes.push({
      kind: 'clip',
      nodeId: 'inside',
      clipKey: 'INSIDE',
      exit: { kind: 'auto', nextNodeId: null },
    });
    current.graph.nodes[0].exit = {
      kind: 'choice',
      decisionId: 'gate',
      prompt: { 'en-US': 'Enter?' },
      choices: [
        { choiceId: 'yes', label: { 'en-US': 'Yes' }, nextNodeId: 'inside' },
      ],
    };
    const result = executeStoryPatch({
      draft: current,
      layout: {
        nodePositions: {
          opening: { x: 0, y: 0 },
          inside: { x: 10, y: 10 },
          '__decision__:opening': { x: 5, y: 5 },
        },
      },
      operations: [
        operation({
          kind: 'story_graph.remove_node',
          payload: { nodeId: 'inside' },
        }),
      ],
    });
    expect(result.draft.graph.nodes).toHaveLength(1);
    expect(result.draft.graph.nodes[0]?.exit).toMatchObject({
      kind: 'choice',
      choices: [],
    });
    expect(result.layout.nodePositions).not.toHaveProperty('inside');
  });

  it('preserves human-authored character media when the agent replaces narrative fields', () => {
    const current = draft();
    current.storyBible.characters.push({
      id: 'hero',
      name: { 'en-US': 'Old name' },
      summary: 'Old summary',
      images: [
        {
          mediaAssetId: UUIDS[3],
          url: 'https://cdn.example/hero.png',
          label: 'reference',
        },
      ],
      voice: null,
    });
    const result = executeStoryPatch({
      draft: current,
      layout: { nodePositions: {} },
      operations: [
        operation({
          kind: 'story_bible.put_character',
          payload: {
            intent: 'replace',
            character: {
              id: 'hero',
              name: { 'en-US': 'New name' },
              summary: 'New summary',
            },
          },
        }),
      ],
    });
    expect(result.draft.storyBible.characters[0]).toMatchObject({
      name: { 'en-US': 'New name' },
      images: current.storyBible.characters[0].images,
    });
  });

  it('fails loud on create conflicts and dangling graph targets', () => {
    expect(() =>
      executeStoryPatch({
        draft: draft(),
        layout: { nodePositions: {} },
        operations: [
          operation({
            kind: 'story_graph.put_node',
            payload: {
              intent: 'create',
              node: {
                kind: 'clip',
                nodeId: 'opening',
                clipKey: 'OTHER',
                exit: { kind: 'auto', nextNodeId: null },
              },
            },
          }),
        ],
      }),
    ).toThrow(StoryPatchExecutionError);

    expect(() =>
      executeStoryPatch({
        draft: draft(),
        layout: { nodePositions: {} },
        operations: [
          operation({
            kind: 'story_graph.put_node',
            payload: {
              intent: 'replace',
              node: {
                kind: 'clip',
                nodeId: 'opening',
                clipKey: 'OPENING',
                exit: { kind: 'auto', nextNodeId: 'missing' },
              },
            },
          }),
        ],
      }),
    ).toThrow(StoryPatchExecutionError);
  });
});

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
          interactions: [],
          exit: { kind: 'auto', routes: [{ target: null }] },
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
  it('atomically executes a long compiled screenplay while keeping public patches bounded', () => {
    const operations: StoryPatchOperation[] = Array.from(
      { length: 136 },
      (_, index) => ({
        operationId: `0197f4a2-0800-7000-8000-${String(index).padStart(12, '0')}`,
        summary: 'Write a compiled scene.',
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'clip',
            nodeId: `scene_${index}`,
            clipKey: `SCENE_${index}`,
            interactions: [],
            exit: {
              kind: 'auto',
              nextNodeId: index < 135 ? `scene_${index + 1}` : null,
            },
          },
        },
      }),
    );
    const input = { draft: draft(), layout: { nodePositions: {} }, operations };
    expect(() => executeStoryPatch(input)).toThrow();
    const result = executeStoryPatch({ ...input, compiledScreenplay: true });
    expect(result.createdNodeIds).toHaveLength(136);
    expect(result.draft.graph.nodes).toHaveLength(137);
    expect(input.draft.graph.nodes).toHaveLength(1);

    const invalid = structuredClone(operations);
    const first = invalid[0];
    if (first.kind !== 'story_graph.put_node') throw new Error('Expected node');
    first.payload.node.exit = { kind: 'auto', nextNodeId: 'missing' };
    expect(() =>
      executeStoryPatch({
        ...input,
        operations: invalid,
        compiledScreenplay: true,
      }),
    ).toThrow(StoryPatchExecutionError);
    expect(input.draft.graph.nodes).toHaveLength(1);
  });

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
              interactions: [],
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
                interactions: [],
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

  it('disconnects a deleted clip while preserving option text and ids', () => {
    const current = draft();
    current.graph.nodes.push({
      kind: 'clip',
      nodeId: 'inside',
      clipKey: 'INSIDE',
      interactions: [],
      exit: { kind: 'auto', routes: [{ target: null }] },
    });
    current.graph.nodes[0].exit = {
      kind: 'choice',
      decisionId: 'gate',
      prompt: { 'en-US': 'Enter?' },
      choices: [
        {
          choiceId: 'yes',
          label: { 'en-US': 'Yes' },
          target: { kind: 'node', nodeId: 'inside' },
        },
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
      decisionId: 'gate',
      prompt: { 'en-US': 'Enter?' },
      choices: [{ choiceId: 'yes', label: { 'en-US': 'Yes' }, target: null }],
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

  it('creates typed state variables and validates graph effects atomically', () => {
    const result = executeStoryPatch({
      draft: draft(),
      layout: { nodePositions: {} },
      operations: [
        operation({
          kind: 'story_bible.put_state_variable',
          payload: {
            intent: 'create',
            variable: {
              key: 'courage',
              name: { 'en-US': 'Courage' },
              valueType: 'number',
              initialValue: 0,
              note: 'Confidence under pressure.',
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
                interactions: [],
                onEnterEffects: [{ kind: 'add', key: 'courage', amount: 1 }],
                exit: { kind: 'auto', routes: [{ target: null }] },
              },
            },
          },
          1,
        ),
      ],
    });

    expect(result.draft.storyBible.stateVariables).toEqual([
      {
        key: 'courage',
        name: { 'en-US': 'Courage' },
        valueType: 'number',
        initialValue: 0,
        note: 'Confidence under pressure.',
      },
    ]);
    expect(result.draft.graph.nodes[0]).toMatchObject({
      onEnterEffects: [{ kind: 'add', key: 'courage', amount: 1 }],
    });

    expect(() =>
      executeStoryPatch({
        draft: result.draft,
        layout: { nodePositions: {} },
        operations: [
          operation({
            kind: 'story_bible.remove_state_variable',
            payload: { key: 'courage' },
          }),
        ],
      }),
    ).toThrow(StoryPatchExecutionError);
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
                interactions: [],
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
                interactions: [],
                exit: { kind: 'auto', nextNodeId: 'missing' },
              },
            },
          }),
        ],
      }),
    ).toThrow(StoryPatchExecutionError);
  });
});

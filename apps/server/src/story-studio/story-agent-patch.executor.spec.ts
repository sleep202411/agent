import {
  StoryPatchOperationSchema,
  type StoryPatchOperation,
} from '@repo/shared/story-agent';

import {
  executeStoryPatch,
  StoryPatchExecutionError,
  type StoryAgentCanvasLayoutSnapshot,
} from './story-agent-patch.executor';
import {
  InteractiveFilmDraftContentSchema,
  type InteractiveFilmDraftContent,
} from './interactive-film.schema';

const ROOT_NODE_ID = '__story_root__';

describe('executeStoryPatch', () => {
  it('rejects hostile recursive operations with a structured error before Zod recursion', () => {
    let condition: Record<string, unknown> = {
      kind: 'flag',
      flag: 'seen_truth',
      equals: true,
    };
    for (let depth = 0; depth < 5_000; depth += 1) {
      condition = { kind: 'not', condition };
    }
    const maliciousOperations = [
      {
        operationId: '0197f4a2-0800-7000-8000-000000009999',
        summary: 'Deep route.',
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'router',
            nodeId: 'router:deep',
            exit: {
              kind: 'auto',
              routes: [
                {
                  nextNodeId: 'clip:start',
                  when: condition,
                  priority: 0,
                },
              ],
            },
          },
        },
      },
    ] as unknown as StoryPatchOperation[];
    const draft = buildDraft();

    const error = captureExecutionError(() =>
      executeStoryPatch({
        draft,
        layout: buildLayout(draft),
        operations: maliciousOperations,
      }),
    );

    expect(error.code).toBe('STORY_PATCH_INPUT_TOO_COMPLEX');
    expect(error.message).toContain('product limit');
  });

  it('applies a sequential typed patch without mutating its inputs', () => {
    const draft = buildDraft();
    const layout = buildLayout(draft, {
      ghost: { x: 9_999, y: 9_999 },
    });
    const originalDraft = structuredClone(draft);
    const originalLayout = structuredClone(layout);
    const operations = [
      operation(1, {
        kind: 'story_bible.put_state_variable',
        payload: {
          intent: 'create',
          stateVariable: {
            key: 'secret',
            type: 'boolean',
            initialValue: false,
          },
        },
      }),
      operation(2, {
        kind: 'story_bible.put_ending',
        payload: {
          intent: 'create',
          ending: {
            id: 'ending:hidden',
            title: { 'en-US': 'Hidden ending' },
            summary: { 'en-US': 'The secret is revealed.' },
            kind: 'hidden',
          },
        },
      }),
      operation(3, {
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'clip',
            nodeId: 'clip:bonus',
            clipKey: 'BONUS',
            exit: { kind: 'ending', endingId: 'ending:hidden' },
          },
        },
      }),
      operation(4, {
        kind: 'story_graph.set_entry_node',
        payload: { nodeId: 'clip:bonus' },
      }),
      operation(5, {
        kind: 'story_graph.reorder_nodes',
        payload: {
          nodeIds: ['clip:bonus', 'clip:start', 'router:gate', 'clip:ending'],
        },
      }),
      operation(6, {
        kind: 'story_bible.update_overview',
        payload: { logline: 'A choice reveals a hidden ending.' },
      }),
    ];

    const result = executeStoryPatch({ draft, layout, operations });

    expect(result.draft.graph.entryNodeId).toBe('clip:bonus');
    expect(result.draft.graph.nodes.map((node) => node.nodeId)).toEqual([
      'clip:bonus',
      'clip:start',
      'router:gate',
      'clip:ending',
    ]);
    expect(result.draft.storyBible.stateVariables).toContainEqual({
      key: 'secret',
      type: 'boolean',
      initialValue: false,
    });
    expect(result.draft.storyBible.endings).toContainEqual(
      expect.objectContaining({ id: 'ending:hidden' }),
    );
    expect(result.draft.storyBible.logline).toBe(
      'A choice reveals a hidden ending.',
    );
    expect(result.affectedNodeIds).toEqual([
      'clip:bonus',
      'clip:ending',
      'clip:start',
      'ending:hidden',
      'router:gate',
    ]);
    expect(result.createdNodeIds).toEqual(['clip:bonus', 'ending:hidden']);
    expect(result.draftChanged).toBe(true);
    expect(result.layoutChanged).toBe(true);
    expect(result.layout.nodePositions).not.toHaveProperty('ghost');
    expect(result.layout.nodePositions).toHaveProperty(ROOT_NODE_ID);
    expect(draft).toEqual(originalDraft);
    expect(layout).toEqual(originalLayout);
  });

  it.each([
    {
      label: 'character',
      operation: operation(10, {
        kind: 'story_bible.remove_character',
        payload: { characterId: 'hero' },
      }),
    },
    {
      label: 'state variable',
      operation: operation(11, {
        kind: 'story_bible.remove_state_variable',
        payload: { key: 'courage' },
      }),
    },
    {
      label: 'ending',
      operation: operation(12, {
        kind: 'story_bible.remove_ending',
        payload: { endingId: 'ending:truth' },
      }),
    },
  ])('rejects removal of a referenced $label', ({ operation }) => {
    const draft = buildDraft();

    const error = captureExecutionError(() =>
      executeStoryPatch({
        draft,
        layout: buildLayout(draft),
        operations: [operation],
      }),
    );

    expect(error.code).toBe('STORY_PATCH_ENTITY_REFERENCED');
    expect(error.operationId).toBe(operation.operationId);
    expect(draft).toEqual(buildDraft());
  });

  it('rejects a newly-created node with dangling domain references', () => {
    const draft = buildDraft();
    const invalidNode = operation(20, {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'create',
        node: {
          kind: 'clip',
          nodeId: 'clip:broken',
          clipKey: 'BROKEN',
          exit: { kind: 'auto', nextNodeId: 'clip:missing' },
        },
      },
    });

    const error = captureExecutionError(() =>
      executeStoryPatch({
        draft,
        layout: buildLayout(draft),
        operations: [invalidNode],
      }),
    );

    expect(error.code).toBe('STORY_PATCH_DANGLING_NODE_REFERENCE');
    expect(error.message).toContain('clip:missing');
    expect(draft.graph.nodes).toHaveLength(3);
  });

  it('cascades graph-node deletion through every incoming edge shape and layout projection', () => {
    const draft = buildCascadeDraft();
    const layout = buildLayout(draft, {
      '__decision__:clip:target': { x: 700, y: 40 },
      ghost: { x: 9_999, y: 9_999 },
    });
    const removeTarget = operation(30, {
      kind: 'story_graph.remove_node',
      payload: { nodeId: 'clip:target' },
    });

    const result = executeStoryPatch({
      draft,
      layout,
      operations: [removeTarget],
    });

    expect(result.draft.graph.entryNodeId).toBeNull();
    expect(result.draft.graph.nodes.map((node) => node.nodeId)).not.toContain(
      'clip:target',
    );
    expect(requiredClip(result.draft, 'clip:choice').exit).toEqual(
      expect.objectContaining({
        kind: 'choice',
        choices: [
          expect.objectContaining({
            choiceId: 'choice:reaction',
            nextNodeId: 'clip:survivor',
            afterSelect: { kind: 'immediate' },
          }),
        ],
      }),
    );
    expect(requiredRouter(result.draft, 'router:source').exit.routes).toEqual(
      [],
    );
    expect(requiredClip(result.draft, 'clip:auto').exit).toEqual({
      kind: 'auto',
      nextNodeId: null,
    });
    expect(requiredClip(result.draft, 'clip:checkpoint').exit).toEqual({
      kind: 'auto',
      nextNodeId: null,
    });
    expect(result.affectedNodeIds).toEqual([
      'clip:auto',
      'clip:checkpoint',
      'clip:choice',
      'clip:target',
      'router:source',
    ]);
    expect(result.layout.nodePositions).not.toHaveProperty('clip:target');
    expect(result.layout.nodePositions).not.toHaveProperty(
      '__decision__:clip:target',
    );
    expect(result.layout.nodePositions).not.toHaveProperty('ghost');
  });

  it.each([
    {
      label: 'create over an existing entity',
      expectedCode: 'STORY_PATCH_CREATE_CONFLICT',
      operation: operation(40, {
        kind: 'story_bible.put_character',
        payload: {
          intent: 'create',
          character: buildCharacter('hero'),
        },
      }),
    },
    {
      label: 'replace a missing entity',
      expectedCode: 'STORY_PATCH_REPLACE_MISSING',
      operation: operation(41, {
        kind: 'story_bible.put_character',
        payload: {
          intent: 'replace',
          character: buildCharacter('missing'),
        },
      }),
    },
  ])('enforces put intent: $label', ({ expectedCode, operation }) => {
    const draft = buildDraft();
    const error = captureExecutionError(() =>
      executeStoryPatch({
        draft,
        layout: buildLayout(draft),
        operations: [operation],
      }),
    );

    expect(error.code).toBe(expectedCode);
    expect(error.operationId).toBe(operation.operationId);
  });

  it.each([
    ['missing one node', ['clip:start', 'router:gate']],
    ['containing a duplicate', ['clip:start', 'router:gate', 'router:gate']],
    [
      'containing an unknown node',
      ['clip:start', 'router:gate', 'clip:ending', 'clip:unknown'],
    ],
  ])('rejects a reorder %s', (_label, nodeIds) => {
    const draft = buildDraft();
    const reorder = operation(50, {
      kind: 'story_graph.reorder_nodes',
      payload: { nodeIds },
    });

    const error = captureExecutionError(() =>
      executeStoryPatch({
        draft,
        layout: buildLayout(draft),
        operations: [reorder],
      }),
    );

    expect(error.code).toBe('STORY_PATCH_INVALID_NODE_ORDER');
    expect(error.operationId).toBe(reorder.operationId);
  });
});

function operation(
  sequence: number,
  input: Omit<StoryPatchOperation, 'operationId' | 'summary'>,
): StoryPatchOperation {
  return StoryPatchOperationSchema.parse({
    ...input,
    operationId: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    summary: `Operation ${sequence}`,
  });
}

function buildDraft(): InteractiveFilmDraftContent {
  return InteractiveFilmDraftContentSchema.parse({
    storyBible: {
      logline: 'A hero chooses whether to enter the gate.',
      synopsis: 'The hero reaches a gate and makes a consequential choice.',
      worldview: 'Choices are binding.',
      storyRules: ['Every choice changes the world.'],
      characters: [buildCharacter('hero')],
      locations: ['The gate'],
      props: ['A key'],
      stateVariables: [
        {
          key: 'courage',
          type: 'number',
          initialValue: 0,
          minimum: 0,
        },
      ],
      endings: [
        {
          id: 'ending:truth',
          title: { 'en-US': 'The truth' },
          summary: { 'en-US': 'The hero learns the truth.' },
          kind: 'truth',
        },
      ],
    },
    graph: {
      entryNodeId: 'clip:start',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'clip:start',
          clipKey: 'START',
          exit: {
            kind: 'choice',
            decisionId: 'decision:gate',
            prompt: { 'en-US': 'Enter the gate?' },
            trigger: { kind: 'media-ended' },
            choices: [
              {
                choiceId: 'choice:enter',
                label: { 'en-US': 'Enter' },
                visibleWhen: {
                  kind: 'all',
                  conditions: [
                    {
                      kind: 'relationship-at-least',
                      characterId: 'hero',
                      value: 0,
                    },
                    {
                      kind: 'variable',
                      key: 'courage',
                      operator: 'at_least',
                      value: 0,
                    },
                  ],
                },
                effects: [
                  {
                    kind: 'adjust_relationship',
                    characterId: 'hero',
                    amount: 1,
                  },
                  {
                    kind: 'increment_variable',
                    key: 'courage',
                    amount: 1,
                  },
                ],
                nextNodeId: 'router:gate',
                afterSelect: { kind: 'immediate' },
              },
            ],
          },
        },
        {
          kind: 'router',
          nodeId: 'router:gate',
          exit: {
            kind: 'auto',
            routes: [
              {
                nextNodeId: 'clip:ending',
                when: {
                  kind: 'variable',
                  key: 'courage',
                  operator: 'at_least',
                  value: 1,
                },
                priority: 0,
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'clip:ending',
          clipKey: 'ENDING',
          exit: { kind: 'ending', endingId: 'ending:truth' },
        },
      ],
    },
    productionNotes: [],
  });
}

function buildCascadeDraft(): InteractiveFilmDraftContent {
  const base = buildDraft();
  return InteractiveFilmDraftContentSchema.parse({
    ...base,
    graph: {
      entryNodeId: 'clip:target',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'clip:choice',
          clipKey: 'CHOICE',
          exit: {
            kind: 'choice',
            decisionId: 'decision:source',
            prompt: { 'en-US': 'Continue?' },
            trigger: { kind: 'media-ended' },
            choices: [
              {
                choiceId: 'choice:target',
                label: { 'en-US': 'Continue' },
                nextNodeId: 'clip:target',
                afterSelect: { kind: 'immediate' },
                effects: [],
              },
              {
                choiceId: 'choice:reaction',
                label: { 'en-US': 'Play the reaction' },
                nextNodeId: 'clip:survivor',
                afterSelect: {
                  kind: 'play',
                  reactionClipKey: 'TARGET',
                },
                effects: [],
              },
            ],
          },
        },
        {
          kind: 'router',
          nodeId: 'router:source',
          exit: {
            kind: 'auto',
            routes: [{ nextNodeId: 'clip:target', priority: 0 }],
          },
        },
        {
          kind: 'clip',
          nodeId: 'clip:auto',
          clipKey: 'AUTO',
          exit: { kind: 'auto', nextNodeId: 'clip:target' },
        },
        {
          kind: 'clip',
          nodeId: 'clip:checkpoint',
          clipKey: 'CHECKPOINT',
          exit: { kind: 'checkpoint', nextNodeId: 'clip:target' },
        },
        {
          kind: 'clip',
          nodeId: 'clip:target',
          clipKey: 'TARGET',
          exit: {
            kind: 'choice',
            decisionId: 'decision:target',
            prompt: { 'en-US': 'Finish?' },
            trigger: { kind: 'media-ended' },
            choices: [
              {
                choiceId: 'choice:finish',
                label: { 'en-US': 'Finish' },
                nextNodeId: 'clip:survivor',
                afterSelect: { kind: 'immediate' },
                effects: [],
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'clip:survivor',
          clipKey: 'SURVIVOR',
          exit: { kind: 'ending', endingId: 'ending:truth' },
        },
      ],
    },
  });
}

function buildCharacter(id: string) {
  return {
    id,
    name: { 'en-US': id === 'hero' ? 'Hero' : 'Missing' },
    role: 'protagonist',
    summary: 'Must make a choice.',
    playable: true,
    continuityRules: [],
  };
}

function buildLayout(
  draft: InteractiveFilmDraftContent,
  extraPositions: Record<string, { x: number; y: number }> = {},
): StoryAgentCanvasLayoutSnapshot {
  return {
    storyWorldNodePresent: true,
    nodePositions: {
      [ROOT_NODE_ID]: { x: -600, y: 0 },
      ...Object.fromEntries(
        draft.graph.nodes.map((node, index) => [
          node.nodeId,
          { x: index * 300, y: 0 },
        ]),
      ),
      ...Object.fromEntries(
        draft.storyBible.endings.map((ending, index) => [
          `__ending__:${ending.id}`,
          { x: 1_200, y: index * 200 },
        ]),
      ),
      ...extraPositions,
    },
  };
}

function requiredClip(draft: InteractiveFilmDraftContent, nodeId: string) {
  const node = draft.graph.nodes.find(
    (candidate) => candidate.kind === 'clip' && candidate.nodeId === nodeId,
  );
  if (!node || node.kind !== 'clip') throw new Error(`Missing ${nodeId}.`);
  return node;
}

function requiredRouter(draft: InteractiveFilmDraftContent, nodeId: string) {
  const node = draft.graph.nodes.find(
    (candidate) => candidate.kind === 'router' && candidate.nodeId === nodeId,
  );
  if (!node || node.kind !== 'router') throw new Error(`Missing ${nodeId}.`);
  return node;
}

function captureExecutionError(run: () => unknown): StoryPatchExecutionError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(StoryPatchExecutionError);
  if (!(thrown instanceof StoryPatchExecutionError)) {
    throw new Error('Expected StoryPatchExecutionError.');
  }
  return thrown;
}

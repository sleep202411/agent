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
  InteractiveStoryDraftContentSchema,
  type InteractiveStoryDraftContent,
} from './interactive-film.schema';

const ROOT_NODE_ID = '__story_root__';
const MUSIC_ASSET_ID = '0197f4a2-0800-7000-8000-0000000000a1';
const OTHER_MUSIC_ASSET_ID = '0197f4a2-0800-7000-8000-0000000000a2';

describe('executeStoryPatch', () => {
  it('rejects hostile recursive operations with a structured error before Zod recursion', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 5_000; depth += 1) {
      deep = { nested: deep };
    }
    const maliciousOperations = [
      {
        operationId: '0197f4a2-0800-7000-8000-000000009999',
        summary: 'Deeply nested payload.',
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: deep,
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
      operation(2, {
        kind: 'story_bible.put_ending',
        payload: {
          intent: 'create',
          ending: {
            id: 'ending:hidden',
            title: { 'en-US': 'Hidden ending' },
            summary: { 'en-US': 'The secret is revealed.' },
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
          nodeIds: ['clip:bonus', 'clip:start', 'clip:gate', 'clip:ending'],
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
      'clip:gate',
      'clip:ending',
    ]);
    expect(result.draft.storyBible.endings).toContainEqual(
      expect.objectContaining({ id: 'ending:hidden' }),
    );
    expect(result.draft.storyBible.logline).toBe(
      'A choice reveals a hidden ending.',
    );
    expect(result.affectedNodeIds).toEqual([
      'clip:bonus',
      'clip:ending',
      'clip:gate',
      'clip:start',
      'ending:hidden',
    ]);
    expect(result.createdNodeIds).toEqual(['clip:bonus', 'ending:hidden']);
    expect(result.draftChanged).toBe(true);
    expect(result.layoutChanged).toBe(true);
    expect(result.layout.nodePositions).not.toHaveProperty('ghost');
    expect(result.layout.nodePositions).not.toHaveProperty(ROOT_NODE_ID);
    expect(draft).toEqual(originalDraft);
    expect(layout).toEqual(originalLayout);
  });

  it('rejects removal of a referenced ending', () => {
    const draft = buildDraft();
    const removeEnding = operation(12, {
      kind: 'story_bible.remove_ending',
      payload: { endingId: 'ending:truth' },
    });

    const error = captureExecutionError(() =>
      executeStoryPatch({
        draft,
        layout: buildLayout(draft),
        operations: [removeEnding],
      }),
    );

    expect(error.code).toBe('STORY_PATCH_ENTITY_REFERENCED');
    expect(error.operationId).toBe(removeEnding.operationId);
    expect(draft).toEqual(buildDraft());
  });

  it('removes a character unconditionally now that the state system is gone', () => {
    const draft = buildDraft();

    const result = executeStoryPatch({
      draft,
      layout: buildLayout(draft),
      operations: [
        operation(10, {
          kind: 'story_bible.remove_character',
          payload: { characterId: 'hero' },
        }),
      ],
    });

    expect(result.draft.storyBible.characters).toEqual([]);
    expect(result.draftChanged).toBe(true);
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
          }),
        ],
      }),
    );
    expect(requiredClip(result.draft, 'clip:auto').exit).toEqual({
      kind: 'auto',
      nextNodeId: null,
    });
    expect(result.affectedNodeIds).toEqual([
      'clip:auto',
      'clip:choice',
      'clip:target',
    ]);
    expect(result.layout.nodePositions).not.toHaveProperty('clip:target');
    expect(result.layout.nodePositions).not.toHaveProperty(
      '__decision__:clip:target',
    );
    expect(result.layout.nodePositions).not.toHaveProperty('ghost');
  });

  it('puts text choice and ending nodes while preserving their canvas layout projection', () => {
    const draft = buildDraft();
    const layout = buildLayout(draft, {
      'text:choice': { x: 900, y: 240 },
      '__decision__:text:choice': { x: 1_200, y: 240 },
      'text:ending': { x: 1_500, y: 240 },
      ghost: { x: 9_999, y: 9_999 },
    });
    const operations = [
      operation(31, {
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'text',
            nodeId: 'text:choice',
            title: { 'en-US': 'The written gate' },
            body: { 'en-US': 'The page asks which path to take.' },
            exit: {
              kind: 'choice',
              decisionId: 'decision:text-gate',
              prompt: { 'en-US': 'Which path?' },
              choices: [
                {
                  choiceId: 'choice:text-start',
                  label: { 'en-US': 'Return to the gate' },
                  nextNodeId: 'clip:start',
                },
                {
                  choiceId: 'choice:text-ending',
                  label: { 'en-US': 'Read the final line' },
                  nextNodeId: 'text:ending',
                },
              ],
            },
          },
        },
      }),
      operation(32, {
        kind: 'story_graph.put_node',
        payload: {
          intent: 'create',
          node: {
            kind: 'text',
            nodeId: 'text:ending',
            title: { 'en-US': 'The final line' },
            body: { 'en-US': 'The truth remains after the page closes.' },
            exit: { kind: 'ending', endingId: 'ending:truth' },
          },
        },
      }),
      operation(33, {
        kind: 'story_graph.set_entry_node',
        payload: { nodeId: 'text:choice' },
      }),
    ];

    const result = executeStoryPatch({ draft, layout, operations });

    expect(result.draft.graph.entryNodeId).toBe('text:choice');
    expect(requiredText(result.draft, 'text:choice').exit).toEqual(
      expect.objectContaining({
        kind: 'choice',
        decisionId: 'decision:text-gate',
      }),
    );
    expect(requiredText(result.draft, 'text:ending').exit).toEqual({
      kind: 'ending',
      endingId: 'ending:truth',
    });
    expect(result.createdNodeIds).toEqual(['text:choice', 'text:ending']);
    expect(result.layout.nodePositions).toMatchObject({
      'text:choice': { x: 900, y: 240 },
      '__decision__:text:choice': { x: 1_200, y: 240 },
      'text:ending': { x: 1_500, y: 240 },
    });
    expect(result.layout.nodePositions).not.toHaveProperty('ghost');
  });

  it('enforces ending integrity for a text node', () => {
    const draft = buildDraft();
    const putTextEnding = operation(35, {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'create',
        node: {
          kind: 'text',
          nodeId: 'text:broken-ending',
          title: { 'en-US': 'Unknown ending' },
          body: { 'en-US': 'This ending was never authored.' },
          exit: { kind: 'ending', endingId: 'ending:missing' },
        },
      },
    });

    const error = captureExecutionError(() =>
      executeStoryPatch({
        draft,
        layout: buildLayout(draft),
        operations: [putTextEnding],
      }),
    );

    expect(error.code).toBe('STORY_PATCH_DANGLING_ENDING_REFERENCE');
    expect(error.message).toContain('ending:missing');
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
    ['missing one node', ['clip:start', 'clip:gate']],
    ['containing a duplicate', ['clip:start', 'clip:gate', 'clip:gate']],
    [
      'containing an unknown node',
      ['clip:start', 'clip:gate', 'clip:ending', 'clip:unknown'],
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
  /**
   * Music is a file a human uploaded, and `put_node` replaces a node whole. If
   * the binding did not survive a replace, asking the Copilot to reword one
   * line would silently unbind the creator's track.
   */
  it("preserves a scene's music binding across an agent node replace", () => {
    const draft = buildDraft();
    const bound = draft.graph.nodes[1];
    bound.music = { mediaAssetId: MUSIC_ASSET_ID };
    const rewrite = operation(41, {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'replace',
        node: {
          kind: 'clip',
          nodeId: 'clip:gate',
          clipKey: 'GATE',
          description: 'The gate groans open.',
          exit: { kind: 'auto', nextNodeId: 'clip:ending' },
        },
      },
    });

    const result = executeStoryPatch({
      draft,
      layout: buildLayout(draft),
      operations: [rewrite],
    });

    const replaced = requiredClip(result.draft, 'clip:gate');
    expect(replaced.description).toBe('The gate groans open.');
    expect(replaced.music).toEqual({ mediaAssetId: MUSIC_ASSET_ID });
  });

  it('lets an explicit binding in the patch replace the existing one', () => {
    const draft = buildDraft();
    draft.graph.nodes[1].music = { mediaAssetId: MUSIC_ASSET_ID };
    const rebind = operation(42, {
      kind: 'story_graph.put_node',
      payload: {
        intent: 'replace',
        node: {
          kind: 'clip',
          nodeId: 'clip:gate',
          clipKey: 'GATE',
          music: { mediaAssetId: OTHER_MUSIC_ASSET_ID },
          exit: { kind: 'auto', nextNodeId: 'clip:ending' },
        },
      },
    });

    const result = executeStoryPatch({
      draft,
      layout: buildLayout(draft),
      operations: [rebind],
    });

    expect(requiredClip(result.draft, 'clip:gate').music).toEqual({
      mediaAssetId: OTHER_MUSIC_ASSET_ID,
    });
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

function buildDraft(): InteractiveStoryDraftContent {
  return InteractiveStoryDraftContentSchema.parse({
    storyBible: {
      logline: 'A hero chooses whether to enter the gate.',
      synopsis: 'The hero reaches a gate and makes a consequential choice.',
      worldview: 'Choices are binding.',
      characters: [buildCharacter('hero')],
      endings: [
        {
          id: 'ending:truth',
          title: { 'en-US': 'The truth' },
          summary: { 'en-US': 'The hero learns the truth.' },
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
            choices: [
              {
                choiceId: 'choice:enter',
                label: { 'en-US': 'Enter' },
                nextNodeId: 'clip:gate',
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'clip:gate',
          clipKey: 'GATE',
          exit: { kind: 'auto', nextNodeId: 'clip:ending' },
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

function buildCascadeDraft(): InteractiveStoryDraftContent {
  const base = buildDraft();
  return InteractiveStoryDraftContentSchema.parse({
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
            choices: [
              {
                choiceId: 'choice:target',
                label: { 'en-US': 'Continue' },
                nextNodeId: 'clip:target',
              },
              {
                choiceId: 'choice:reaction',
                label: { 'en-US': 'Play the reaction' },
                nextNodeId: 'clip:survivor',
              },
            ],
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
          nodeId: 'clip:target',
          clipKey: 'TARGET',
          exit: {
            kind: 'choice',
            decisionId: 'decision:target',
            prompt: { 'en-US': 'Finish?' },
            choices: [
              {
                choiceId: 'choice:finish',
                label: { 'en-US': 'Finish' },
                nextNodeId: 'clip:survivor',
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
    summary: 'Must make a choice.',
  };
}

function buildLayout(
  draft: InteractiveStoryDraftContent,
  extraPositions: Record<string, { x: number; y: number }> = {},
): StoryAgentCanvasLayoutSnapshot {
  return {
    nodePositions: {
      // The retired story-world root is seeded deliberately: the executor must
      // now sweep it out like any other position with no node behind it.
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

function requiredClip(draft: InteractiveStoryDraftContent, nodeId: string) {
  const node = draft.graph.nodes.find(
    (candidate) => candidate.kind === 'clip' && candidate.nodeId === nodeId,
  );
  if (!node || node.kind !== 'clip') throw new Error(`Missing ${nodeId}.`);
  return node;
}

function requiredText(draft: InteractiveStoryDraftContent, nodeId: string) {
  const node = draft.graph.nodes.find(
    (candidate) => candidate.kind === 'text' && candidate.nodeId === nodeId,
  );
  if (!node || node.kind !== 'text') throw new Error(`Missing ${nodeId}.`);
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

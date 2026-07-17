import {
  collectInteractiveFilmRuntimeLocales,
  createLockableInteractiveFilmDraftContentSchema,
  InteractiveFilmDraftContentSchema,
  LockableInteractiveFilmDraftContentSchema,
  type FilmCondition,
  type FilmEffect,
  type InteractiveFilmDraftContent,
} from './interactive-film.schema';
import { buildInteractiveFilmTestBundle } from './__tests__/interactive-film-test-bundle';

type GraphNode = InteractiveFilmDraftContent['graph']['nodes'][number];
type ChoiceExit = Extract<
  Extract<GraphNode, { kind: 'clip' }>['exit'],
  { kind: 'choice' }
>;

describe('interactive-film choice exit prompt contract', () => {
  it('rejects a choice exit without its explicit graph-level prompt', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const exit = firstChoiceExit(draft);
    const mutableExit: { prompt?: Record<string, string> } = exit;
    delete mutableExit.prompt;

    const result = InteractiveFilmDraftContentSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (issue) => issue.path.includes('exit') && issue.path.includes('prompt'),
      ),
    ).toBe(true);
  });

  it('allows an empty prompt while authoring but rejects it at revision lock', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    firstChoiceExit(draft).prompt = { 'zh-CN': '   ' };

    expect(InteractiveFilmDraftContentSchema.safeParse(draft).success).toBe(
      true,
    );
    const result = LockableInteractiveFilmDraftContentSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (issue) =>
          issue.path.includes('exit') &&
          issue.path.includes('prompt') &&
          issue.message === 'Provide at least one non-empty localized value.',
      ),
    ).toBe(true);
  });

  it('locks a choice exit with a non-empty localized prompt', () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    expect(firstChoiceExit(draft).prompt).toEqual({
      'en-US': 'Which track should play first?',
      'zh-CN': '先播放哪一轨？',
      'zh-HK': '先播放哪一軌？',
    });
    expect(
      LockableInteractiveFilmDraftContentSchema.safeParse(draft).success,
    ).toBe(true);
  });
});

describe('interactive-film runtime locale coverage', () => {
  it('derives locales only from runtime-visible copy and locks complete coverage', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    draft.storyBible.characters[0].name['fr-FR'] = 'Visiteuse';

    expect(collectInteractiveFilmRuntimeLocales(draft, 'zh-CN')).toEqual([
      'zh-CN',
      'en-US',
      'zh-HK',
    ]);
    expect(
      createLockableInteractiveFilmDraftContentSchema('zh-CN').safeParse(draft)
        .success,
    ).toBe(true);
  });

  it('rejects any missing runtime copy for an authored or project-default locale', () => {
    const missingAuthoredLocale = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    delete missingAuthoredLocale.storyBible.endings[0].summary['en-US'];
    const authoredResult = createLockableInteractiveFilmDraftContentSchema(
      'zh-CN',
    ).safeParse(missingAuthoredLocale);
    expect(authoredResult.success).toBe(false);
    if (!authoredResult.success) {
      expect(authoredResult.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['storyBible', 'endings', 0, 'summary', 'en-US'],
          message: 'Provide non-empty en-US runtime copy.',
        }),
      );
    }

    const missingDefaultLocale = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const defaultResult =
      createLockableInteractiveFilmDraftContentSchema('ja-JP').safeParse(
        missingDefaultLocale,
      );
    expect(defaultResult.success).toBe(false);
    if (!defaultResult.success) {
      expect(
        defaultResult.error.issues.some(
          (issue) =>
            issue.path.at(-1) === 'ja-JP' &&
            issue.message === 'Provide non-empty ja-JP runtime copy.',
        ),
      ).toBe(true);
    }
  });
});

describe('interactive-film mutable draft structural identity', () => {
  it('rejects duplicate character identifiers before revision lock', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const duplicate = structuredClone(draft.storyBible.characters[0]);
    draft.storyBible.characters.push(duplicate);

    const result = InteractiveFilmDraftContentSchema.safeParse(draft);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: 'custom',
        path: [
          'storyBible',
          'characters',
          draft.storyBible.characters.length - 1,
          'id',
        ],
        message: `Duplicate stable identifier ${duplicate.id}.`,
      }),
    );
  });

  it('rejects duplicate state-variable keys before revision lock', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const duplicate = structuredClone(draft.storyBible.stateVariables[0]);
    draft.storyBible.stateVariables.push(duplicate);

    const result = InteractiveFilmDraftContentSchema.safeParse(draft);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: 'custom',
        path: [
          'storyBible',
          'stateVariables',
          draft.storyBible.stateVariables.length - 1,
          'key',
        ],
        message: `Duplicate stable identifier ${duplicate.key}.`,
      }),
    );
  });
});

describe('interactive-film checkpoint exit contract', () => {
  it('locks the four finale checkpoints without counting them as decisions', () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const checkpoints = draft.graph.nodes.flatMap((node) =>
      node.kind === 'clip' && node.exit.kind === 'checkpoint'
        ? [node.exit]
        : [],
    );

    expect(checkpoints).toHaveLength(4);
    expect(checkpoints.map((checkpoint) => checkpoint.nextNodeId)).toEqual([
      'clip:E01',
      'clip:E02',
      'clip:E03',
      'clip:E04',
    ]);
    expect(
      new Set(
        draft.graph.nodes.flatMap((node) =>
          node.exit.kind === 'choice' ? [node.exit.decisionId] : [],
        ),
      ).size,
    ).toBe(6);
    expect(
      LockableInteractiveFilmDraftContentSchema.safeParse(draft).success,
    ).toBe(true);
  });

  it('rejects an unknown checkpoint continuation at revision lock', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const checkpointNode = draft.graph.nodes.find(
      (node) => node.kind === 'clip' && node.exit.kind === 'checkpoint',
    );
    if (!checkpointNode || checkpointNode.exit.kind !== 'checkpoint') {
      throw new Error('Fixture checkpoint missing.');
    }
    checkpointNode.exit.nextNodeId = 'clip:UNKNOWN';

    expectLockIssue(draft, {
      path: [
        'graph',
        'nodes',
        draft.graph.nodes.indexOf(checkpointNode),
        'exit',
        'nextNodeId',
      ],
      message: 'Unknown target node clip:UNKNOWN.',
    });
  });
});

describe('interactive-film canonical decision identity', () => {
  it('allows one semantically identical decision after multiple predecessors with context-specific targets', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const { canonical, repeated } =
      repeatFirstDecisionAtSecondPredecessor(draft);

    expect(repeated.decisionId).toBe(canonical.decisionId);
    expect(repeated.choices.map((choice) => choice.nextNodeId)).not.toEqual(
      canonical.choices.map((choice) => choice.nextNodeId),
    );
    expect(InteractiveFilmDraftContentSchema.safeParse(draft).success).toBe(
      true,
    );
    expect(
      LockableInteractiveFilmDraftContentSchema.safeParse(draft).success,
    ).toBe(true);
  });

  it.each<{
    field: string;
    mutate: (exit: ChoiceExit) => void;
  }>([
    {
      field: 'prompt',
      mutate: (exit) => {
        exit.prompt = { 'zh-CN': '冲突的决策提示' };
      },
    },
    {
      field: 'trigger',
      mutate: (exit) => {
        exit.trigger = { kind: 'timecode', atMs: 1_000 };
      },
    },
    {
      field: 'choiceId set',
      mutate: (exit) => {
        exit.choices[0].choiceId = 'C1:CONFLICT';
      },
    },
    {
      field: 'label',
      mutate: (exit) => {
        exit.choices[0].label = { 'zh-CN': '冲突的选项' };
      },
    },
    {
      field: 'accessibilityLabel',
      mutate: (exit) => {
        exit.choices[0].accessibilityLabel = { 'zh-CN': '冲突的辅助标签' };
      },
    },
    {
      field: 'visibleWhen',
      mutate: (exit) => {
        exit.choices[0].visibleWhen = {
          kind: 'variable',
          key: 'truth',
          operator: 'equals',
          value: 0,
        };
      },
    },
    {
      field: 'effects',
      mutate: (exit) => {
        exit.choices[0].effects.push({
          kind: 'increment_variable',
          key: 'truth',
          amount: 1,
        });
      },
    },
    {
      field: 'afterSelect',
      mutate: (exit) => {
        exit.choices[0].afterSelect = {
          kind: 'play',
          reactionClipKey: 'S00',
        };
      },
    },
  ])(
    'rejects conflicting repeated-decision $field in the mutable draft',
    ({ field, mutate }) => {
      const draft = structuredClone(
        buildInteractiveFilmTestBundle().draftContent,
      );
      const { repeated } = repeatFirstDecisionAtSecondPredecessor(draft);
      mutate(repeated);

      const result = InteractiveFilmDraftContentSchema.safeParse(draft);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) =>
            issue.path.includes('graph') &&
            issue.path.includes('nodes') &&
            issue.path.includes('exit') &&
            issue.path.includes('decisionId') &&
            issue.message.includes(`${field} must match`),
        ),
      ).toBe(true);
    },
  );
});

describe('interactive-film state-variable semantic contract', () => {
  it.each<{
    name: string;
    condition: FilmCondition;
    message: string;
  }>([
    {
      name: 'equals with a mismatched value type',
      condition: {
        kind: 'variable',
        key: 'truth',
        operator: 'equals',
        value: '0',
      },
      message:
        'equals value must match the number type of state variable truth.',
    },
    {
      name: 'a numeric operator on a string variable',
      condition: {
        kind: 'variable',
        key: 'finalAction',
        operator: 'greater_than',
        value: 0,
      },
      message: 'greater_than requires a numeric state variable.',
    },
    {
      name: 'a non-numeric comparison value',
      condition: {
        kind: 'variable',
        key: 'truth',
        operator: 'at_least',
        value: '0',
      },
      message: 'at_least requires a numeric comparison value.',
    },
    {
      name: 'null for a non-nullable declaration',
      condition: {
        kind: 'variable',
        key: 'finalAction',
        operator: 'not_equals',
        value: null,
      },
      message:
        'not_equals value must match the string type of state variable finalAction.',
    },
  ])('rejects $name at revision lock', ({ condition, message }) => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    firstChoiceExit(draft).choices[0].visibleWhen = condition;

    expectLockIssue(draft, {
      path: expect.arrayContaining(['visibleWhen']) as unknown as PropertyKey[],
      message,
    });
  });

  it.each<{
    name: string;
    prepare?: (draft: InteractiveFilmDraftContent) => void;
    effect: FilmEffect;
    message: string;
  }>([
    {
      name: 'set_variable with a mismatched value type',
      effect: { kind: 'set_variable', key: 'truth', value: '1' },
      message:
        'set_variable value must match the number type of state variable truth.',
    },
    {
      name: 'set_variable below a numeric minimum',
      effect: { kind: 'set_variable', key: 'truth', value: -1 },
      message: 'set_variable value is below the minimum for truth.',
    },
    {
      name: 'set_variable above a numeric maximum',
      prepare: (draft) => {
        const truth = draft.storyBible.stateVariables.find(
          (variable) => variable.key === 'truth',
        );
        if (truth?.type === 'number') truth.maximum = 2;
      },
      effect: { kind: 'set_variable', key: 'truth', value: 3 },
      message: 'set_variable value is above the maximum for truth.',
    },
    {
      name: 'set_variable outside string allowedValues',
      effect: { kind: 'set_variable', key: 'finalAction', value: 'burn' },
      message:
        'set_variable value must be one of the allowedValues for finalAction.',
    },
    {
      name: 'increment_variable on a non-number declaration',
      effect: {
        kind: 'increment_variable',
        key: 'finalAction',
        amount: 1,
      },
      message: 'increment_variable requires a numeric state variable.',
    },
  ])('rejects $name at revision lock', ({ prepare, effect, message }) => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    prepare?.(draft);
    firstChoiceExit(draft).choices[0].effects = [effect];

    expectLockIssue(draft, {
      path: expect.arrayContaining(['effects']) as unknown as PropertyKey[],
      message,
    });
  });
});

describe('interactive-film v3 authoring boundary', () => {
  it('contains only storyBible, graph, and productionNotes', () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    expect(Object.keys(draft).sort()).toEqual([
      'graph',
      'productionNotes',
      'storyBible',
    ]);
  });

  it('strictly rejects fields outside the v3 story document', () => {
    const draft: Record<string, unknown> = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    draft.directorDesign = {};

    const result = InteractiveFilmDraftContentSchema.safeParse(draft);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: 'unrecognized_keys',
        keys: ['directorDesign'],
      }),
    );
  });

  it('derives clip count solely from graph clip nodes', () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    expect(
      draft.graph.nodes.filter((node) => node.kind === 'clip'),
    ).toHaveLength(21);
  });
});

function expectLockIssue(
  draft: InteractiveFilmDraftContent,
  issue: { path: PropertyKey[]; message: string },
): void {
  const result = LockableInteractiveFilmDraftContentSchema.safeParse(draft);
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues).toContainEqual(expect.objectContaining(issue));
}

function firstChoiceExit(draft: InteractiveFilmDraftContent): ChoiceExit {
  for (const node of draft.graph.nodes) {
    if (node.kind === 'clip' && node.exit.kind === 'choice') return node.exit;
  }
  throw new Error('Expected at least one choice exit.');
}

function allChoiceExits(draft: InteractiveFilmDraftContent): ChoiceExit[] {
  return draft.graph.nodes.flatMap((node) =>
    node.kind === 'clip' && node.exit.kind === 'choice' ? [node.exit] : [],
  );
}

function repeatFirstDecisionAtSecondPredecessor(
  draft: InteractiveFilmDraftContent,
): { canonical: ChoiceExit; repeated: ChoiceExit } {
  const [canonical, repeated] = allChoiceExits(draft);
  if (!canonical || !repeated) {
    throw new Error('Expected at least two choice exits.');
  }
  const predecessorTargets = repeated.choices.map(
    (choice) => choice.nextNodeId,
  );
  const canonicalCopy = structuredClone(canonical);
  repeated.decisionId = canonicalCopy.decisionId;
  repeated.prompt = canonicalCopy.prompt;
  repeated.trigger = canonicalCopy.trigger;
  repeated.choices = canonicalCopy.choices
    .map((choice, index) => ({
      ...choice,
      nextNodeId: predecessorTargets[index] ?? predecessorTargets[0],
    }))
    .reverse();
  return { canonical, repeated };
}

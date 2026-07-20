import {
  collectInteractiveStoryRuntimeLocales,
  createLockableInteractiveStoryDraftContentSchema,
  InteractiveStoryDraftContentSchema,
  LockableInteractiveStoryDraftContentSchema,
  type InteractiveStoryDraftContent,
} from './interactive-film.schema';
import { buildInteractiveFilmTestBundle } from './__tests__/interactive-film-test-bundle';

type GraphNode = InteractiveStoryDraftContent['graph']['nodes'][number];
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

    const result = InteractiveStoryDraftContentSchema.safeParse(draft);
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

    expect(InteractiveStoryDraftContentSchema.safeParse(draft).success).toBe(
      true,
    );
    const result = LockableInteractiveStoryDraftContentSchema.safeParse(draft);
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
      LockableInteractiveStoryDraftContentSchema.safeParse(draft).success,
    ).toBe(true);
  });
});

describe('unified-story text node contract', () => {
  it('allows 20,000-character text bodies while keeping titles at 4,000', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const endingId = draft.storyBible.endings[0]?.id;
    if (!endingId) throw new Error('Fixture ending missing.');
    draft.graph.nodes.push({
      kind: 'text',
      nodeId: 'text:long-body',
      title: { 'zh-CN': 'T'.repeat(4_000) },
      body: { 'zh-CN': 'B'.repeat(20_000) },
      exit: { kind: 'ending', endingId },
    });

    expect(InteractiveStoryDraftContentSchema.safeParse(draft).success).toBe(
      true,
    );

    const oversizedBody = structuredClone(draft);
    const textNode = oversizedBody.graph.nodes.at(-1);
    if (textNode?.kind !== 'text') throw new Error('Text fixture missing.');
    textNode.body['zh-CN'] = 'B'.repeat(20_001);
    expect(
      InteractiveStoryDraftContentSchema.safeParse(oversizedBody).success,
    ).toBe(false);

    const oversizedTitle = structuredClone(draft);
    const titledNode = oversizedTitle.graph.nodes.at(-1);
    if (titledNode?.kind !== 'text' || !titledNode.title) {
      throw new Error('Titled text fixture missing.');
    }
    titledNode.title['zh-CN'] = 'T'.repeat(4_001);
    expect(
      InteractiveStoryDraftContentSchema.safeParse(oversizedTitle).success,
    ).toBe(false);
  });

  it('locks a minimal body-only text story without world metadata or characters', () => {
    const result = createLockableInteractiveStoryDraftContentSchema(
      'zh-CN',
    ).safeParse({
      storyBible: {
        logline: '',
        synopsis: '',
        worldview: '',
        characters: [],
        endings: [
          {
            id: 'ending.truth',
            title: { 'zh-CN': '真相' },
            kind: 'truth',
          },
        ],
      },
      graph: {
        entryNodeId: 'text.entry',
        nodes: [
          {
            kind: 'text',
            nodeId: 'text.entry',
            body: { 'zh-CN': '你在一封未署名的信旁醒来。' },
            exit: { kind: 'ending', endingId: 'ending.truth' },
          },
        ],
      },
      productionNotes: [],
    });

    expect(result.success).toBe(true);
  });

  it('accepts strict text nodes for auto, choice, checkpoint, and ending exits', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const targetNodeId = draft.graph.nodes[0]?.nodeId;
    const endingId = draft.storyBible.endings[0]?.id;
    if (!targetNodeId || !endingId) {
      throw new Error('Fixture target node or ending missing.');
    }

    draft.graph.nodes.push(
      {
        kind: 'text',
        nodeId: 'text:auto',
        title: localized('A quiet threshold'),
        body: localized('The traveller pauses before the door.'),
        exit: { kind: 'auto', nextNodeId: targetNodeId },
      },
      {
        kind: 'text',
        nodeId: 'text:choice',
        title: localized('A written choice'),
        body: localized('Two possibilities remain on the page.'),
        exit: {
          kind: 'choice',
          decisionId: 'decision:text-path',
          prompt: localized('Which path should the traveller take?'),
          choices: [
            {
              choiceId: 'choice:text-left',
              label: localized('Take the left path'),
              nextNodeId: targetNodeId,
            },
            {
              choiceId: 'choice:text-right',
              label: localized('Take the right path'),
              nextNodeId: targetNodeId,
            },
          ],
        },
      },
      {
        kind: 'text',
        nodeId: 'text:checkpoint',
        title: localized('Turn the page'),
        body: localized('The next chapter waits for the reader.'),
        exit: { kind: 'checkpoint', nextNodeId: targetNodeId },
      },
      {
        kind: 'text',
        nodeId: 'text:ending',
        title: localized('The final line'),
        body: localized('The story closes where it began.'),
        exit: { kind: 'ending', endingId },
      },
    );

    expect(InteractiveStoryDraftContentSchema.safeParse(draft).success).toBe(
      true,
    );
    expect(
      LockableInteractiveStoryDraftContentSchema.safeParse(draft).success,
    ).toBe(true);
  });

  it.each(['title', 'body'] as const)(
    'requires complete localized %s copy when locking',
    (field) => {
      const draft = structuredClone(
        buildInteractiveFilmTestBundle().draftContent,
      );
      const targetNodeId = draft.graph.nodes[0]?.nodeId;
      if (!targetNodeId) throw new Error('Fixture target node missing.');
      const textNode = {
        kind: 'text' as const,
        nodeId: `text:missing-${field}`,
        title: localized('Localized title'),
        body: localized('Localized body'),
        exit: { kind: 'auto' as const, nextNodeId: targetNodeId },
      };
      textNode[field]['zh-HK'] = '   ';
      draft.graph.nodes.push(textNode);

      expect(InteractiveStoryDraftContentSchema.safeParse(draft).success).toBe(
        true,
      );
      const result =
        LockableInteractiveStoryDraftContentSchema.safeParse(draft);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: [
            'graph',
            'nodes',
            draft.graph.nodes.length - 1,
            field,
            'zh-HK',
          ],
          message: 'Provide non-empty zh-HK runtime copy.',
        }),
      );
    },
  );
});

describe('interactive-film runtime locale coverage', () => {
  it('derives locales only from runtime-visible copy and locks complete coverage', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    draft.storyBible.characters[0].name['fr-FR'] = 'Visiteuse';

    expect(collectInteractiveStoryRuntimeLocales(draft, 'zh-CN')).toEqual([
      'zh-CN',
      'en-US',
      'zh-HK',
    ]);
    expect(
      createLockableInteractiveStoryDraftContentSchema('zh-CN').safeParse(draft)
        .success,
    ).toBe(true);
  });

  it('rejects any missing runtime copy for an authored or project-default locale', () => {
    const missingAuthoredLocale = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    if (!missingAuthoredLocale.storyBible.endings[0].summary) {
      throw new Error('Fixture ending summary missing.');
    }
    delete missingAuthoredLocale.storyBible.endings[0].summary['en-US'];
    const authoredResult = createLockableInteractiveStoryDraftContentSchema(
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
      createLockableInteractiveStoryDraftContentSchema('ja-JP').safeParse(
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

    const result = InteractiveStoryDraftContentSchema.safeParse(draft);

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
      LockableInteractiveStoryDraftContentSchema.safeParse(draft).success,
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
    expect(InteractiveStoryDraftContentSchema.safeParse(draft).success).toBe(
      true,
    );
    expect(
      LockableInteractiveStoryDraftContentSchema.safeParse(draft).success,
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
  ])(
    'rejects conflicting repeated-decision $field in the mutable draft',
    ({ field, mutate }) => {
      const draft = structuredClone(
        buildInteractiveFilmTestBundle().draftContent,
      );
      const { repeated } = repeatFirstDecisionAtSecondPredecessor(draft);
      mutate(repeated);

      const result = InteractiveStoryDraftContentSchema.safeParse(draft);

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

describe('unified-story authoring boundary', () => {
  it('contains only storyBible, graph, and productionNotes', () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    expect(Object.keys(draft).sort()).toEqual([
      'graph',
      'productionNotes',
      'storyBible',
    ]);
  });

  it('strictly rejects fields outside the unified story document', () => {
    const draft: Record<string, unknown> = structuredClone(
      buildInteractiveFilmTestBundle().draftContent,
    );
    draft.directorDesign = {};

    const result = InteractiveStoryDraftContentSchema.safeParse(draft);

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
  draft: InteractiveStoryDraftContent,
  issue: { path: PropertyKey[]; message: string },
): void {
  const result = LockableInteractiveStoryDraftContentSchema.safeParse(draft);
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues).toContainEqual(expect.objectContaining(issue));
}

function firstChoiceExit(draft: InteractiveStoryDraftContent): ChoiceExit {
  for (const node of draft.graph.nodes) {
    if (node.kind === 'clip' && node.exit.kind === 'choice') return node.exit;
  }
  throw new Error('Expected at least one choice exit.');
}

function allChoiceExits(draft: InteractiveStoryDraftContent): ChoiceExit[] {
  return draft.graph.nodes.flatMap((node) =>
    node.kind === 'clip' && node.exit.kind === 'choice' ? [node.exit] : [],
  );
}

function repeatFirstDecisionAtSecondPredecessor(
  draft: InteractiveStoryDraftContent,
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
  repeated.choices = canonicalCopy.choices
    .map((choice, index) => ({
      ...choice,
      nextNodeId: predecessorTargets[index] ?? predecessorTargets[0],
    }))
    .reverse();
  return { canonical, repeated };
}

function localized(value: string): Record<string, string> {
  return {
    'en-US': value,
    'zh-CN': value,
    'zh-HK': value,
  };
}

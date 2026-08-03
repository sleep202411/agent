import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  InteractiveStoryDraftContentSchema,
  collectInteractiveStoryRuntimeLocales,
  createLockableInteractiveStoryDraftContentSchema,
  createPlayableInteractiveStoryDraftContentSchema,
  findInteractiveStoryRuntimeLocaleCoverageIssues,
  type InteractiveStoryDraftContent,
} from './interactive-film.schema';

function filmDraft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: 'A sealed gate opens once.',
      synopsis: 'A visitor chooses whether to cross the gate.',
      characters: [],
    },
    graph: {
      entryNodeId: 'opening',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'opening',
          clipKey: 'OPENING',
          exit: {
            kind: 'choice',
            decisionId: 'gate-choice',
            prompt: { 'en-US': 'Cross the gate?' },
            choices: [
              {
                choiceId: 'cross',
                label: { 'en-US': 'Cross' },
                nextNodeId: 'inside',
              },
              {
                choiceId: 'leave',
                label: { 'en-US': 'Leave' },
                nextNodeId: 'outside',
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'inside',
          clipKey: 'INSIDE',
          exit: { kind: 'auto', nextNodeId: null },
        },
        {
          kind: 'clip',
          nodeId: 'outside',
          clipKey: 'OUTSIDE',
          exit: { kind: 'auto', nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  };
}

describe('interactive film draft contract', () => {
  it('accepts only fully identified film clips and natural terminal exits', () => {
    expect(
      InteractiveStoryDraftContentSchema.safeParse(filmDraft()).success,
    ).toBe(true);
    expect(
      InteractiveStoryDraftContentSchema.safeParse({
        ...filmDraft(),
        graph: {
          entryNodeId: 'opening',
          nodes: [
            {
              kind: 'clip',
              nodeId: 'opening',
              exit: { kind: 'auto', nextNodeId: null },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('keeps the mutable empty draft valid but requires a connected film to play or lock', () => {
    expect(
      InteractiveStoryDraftContentSchema.safeParse(
        EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      ).success,
    ).toBe(true);
    expect(
      createPlayableInteractiveStoryDraftContentSchema('en-US').safeParse(
        EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      ).success,
    ).toBe(false);
    expect(
      createLockableInteractiveStoryDraftContentSchema('en-US').safeParse(
        filmDraft(),
      ).success,
    ).toBe(true);
  });

  it('turns unfinished routing into a safe cinematic continuation', () => {
    const dangling = structuredClone(filmDraft());
    const first = dangling.graph.nodes[0];
    if (first?.exit.kind === 'choice')
      first.exit.choices[0].nextNodeId = 'missing';
    const normalized =
      createLockableInteractiveStoryDraftContentSchema('en-US').parse(dangling);
    expect(normalized.graph.nodes[0]?.exit).toEqual({
      kind: 'auto',
      nextNodeId: 'outside',
    });

    const unfinished = structuredClone(filmDraft());
    const unfinishedFirst = unfinished.graph.nodes[0];
    if (unfinishedFirst?.exit.kind === 'choice') {
      unfinishedFirst.exit.prompt = {};
      unfinishedFirst.exit.choices[0].label = {};
    }
    expect(
      createPlayableInteractiveStoryDraftContentSchema('en-US').parse(
        unfinished,
      ).graph.nodes[0]?.exit,
    ).toEqual({ kind: 'auto', nextNodeId: 'inside' });
  });

  it('still rejects duplicate stable film identities', () => {
    const duplicate = structuredClone(filmDraft());

    duplicate.graph.nodes.push({
      kind: 'clip',
      nodeId: 'inside',
      clipKey: 'OTHER',
      exit: { kind: 'auto', nextNodeId: null },
    });
    expect(
      createLockableInteractiveStoryDraftContentSchema('en-US').safeParse(
        duplicate,
      ).success,
    ).toBe(false);
  });

  it('derives runtime locales only from choice copy and reports missing translations', () => {
    const draft = filmDraft();
    expect(collectInteractiveStoryRuntimeLocales(draft, 'zh-CN')).toEqual([
      'en-US',
    ]);
    expect(
      findInteractiveStoryRuntimeLocaleCoverageIssues(draft, [
        'en-US',
        'zh-CN',
      ]),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ locale: 'zh-CN' })]),
    );
  });
});

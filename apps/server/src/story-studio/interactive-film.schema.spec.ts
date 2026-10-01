import { PutStoryDraftSchema } from './dto';
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
  return InteractiveStoryDraftContentSchema.parse({
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
          interactions: [],
          exit: {
            kind: 'choice',
            decisionId: 'gate-choice',
            prompt: { 'en-US': 'Cross the gate?' },
            choices: [
              {
                choiceId: 'cross',
                label: { 'en-US': 'Cross' },
                target: { kind: 'node', nodeId: 'inside' },
              },
              {
                choiceId: 'leave',
                label: { 'en-US': 'Leave' },
                target: { kind: 'node', nodeId: 'outside' },
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'inside',
          clipKey: 'INSIDE',
          interactions: [],
          exit: { kind: 'auto', nextNodeId: null },
        },
        {
          kind: 'clip',
          nodeId: 'outside',
          clipKey: 'OUTSIDE',
          interactions: [],
          exit: { kind: 'auto', nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  });
}

describe('interactive film draft contract', () => {
  it('only accepts Community Points prices on story nodes', () => {
    const draft = filmDraft();
    const node = draft.graph.nodes[0];
    if (node.kind !== 'clip') throw new Error('Expected clip');
    node.communityPointPrice = 30;
    expect(
      InteractiveStoryDraftContentSchema.parse(draft).graph.nodes[0],
    ).toMatchObject({ communityPointPrice: 30 });
    for (const price of [-1, 1.5, 2_147_483_648]) {
      node.communityPointPrice = price;
      expect(InteractiveStoryDraftContentSchema.safeParse(draft).success).toBe(
        false,
      );
    }
    node.communityPointPrice = 30;
    if (node.exit.kind !== 'choice') throw new Error('Expected choice');
    Object.assign(node.exit.choices[0], { communityPointPrice: 20 });
    expect(InteractiveStoryDraftContentSchema.safeParse(draft).success).toBe(
      false,
    );
    expect(
      InteractiveStoryDraftContentSchema.safeParse({
        ...filmDraft(),
        graph: {
          entryNodeId: 'decision',
          nodes: [
            {
              kind: 'decision',
              nodeId: 'decision',
              communityPointPrice: 20,
              exit: node.exit,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

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

  it('drops an ending name that no line points at', () => {
    const draft = filmDraft();
    draft.storyBible.endings = [
      {
        endingId: 'ending:1',
        kind: 'neutral',
        title: { 'en-US': 'Untitled ending' },
      },
    ];
    const normalized =
      createLockableInteractiveStoryDraftContentSchema('en-US').parse(draft);
    expect(normalized.storyBible.endings).toEqual([]);
  });

  it('keeps every labelled option when the choice question is blank', () => {
    const draft = filmDraft();
    const opening = draft.graph.nodes[0];
    if (opening?.exit.kind !== 'choice') throw new Error('Expected a choice.');
    opening.exit.prompt = { 'en-US': '\n' };
    const normalized =
      createLockableInteractiveStoryDraftContentSchema('en-US').parse(draft);
    expect(normalized.graph.nodes[0]?.exit).toMatchObject({
      kind: 'choice',
      choices: [
        expect.objectContaining({ choiceId: 'cross' }),
        expect.objectContaining({ choiceId: 'leave' }),
      ],
    });
  });

  it('turns unfinished routing into a safe cinematic continuation', () => {
    const dangling = structuredClone(filmDraft());
    const first = dangling.graph.nodes[0];
    if (first?.exit.kind === 'choice')
      first.exit.choices[0].target = { kind: 'node', nodeId: 'missing' };
    const normalized =
      createLockableInteractiveStoryDraftContentSchema('en-US').parse(dangling);
    expect(normalized.graph.nodes[0]?.exit).toEqual({
      kind: 'auto',
      routes: [{ target: { kind: 'node', nodeId: 'outside' } }],
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
    ).toEqual({
      kind: 'auto',
      routes: [{ target: { kind: 'node', nodeId: 'inside' } }],
    });
  });

  it('keeps playable choices when another locale can supply the runtime copy', () => {
    const englishDraft = filmDraft();
    const normalized =
      createPlayableInteractiveStoryDraftContentSchema('zh-CN').parse(
        englishDraft,
      );

    expect(normalized.graph.nodes[0]?.exit).toMatchObject({
      kind: 'choice',
      decisionId: 'gate-choice',
    });
  });

  it('repairs conflicting repeated decision identities only in the runtime projection', () => {
    const mutable = filmDraft();
    const outside = mutable.graph.nodes[2];
    if (!outside || outside.kind !== 'clip') {
      throw new Error('Expected outside clip fixture.');
    }
    outside.exit = {
      kind: 'choice',
      decisionId: 'gate-choice',
      prompt: { 'en-US': 'Stay outside?' },
      choices: [
        {
          choiceId: 'cross',
          label: { 'en-US': 'Stay' },
          target: { kind: 'node', nodeId: 'inside' },
        },
        {
          choiceId: 'leave',
          label: { 'en-US': 'Go' },
          target: { kind: 'node', nodeId: 'opening' },
        },
      ],
    };

    expect(InteractiveStoryDraftContentSchema.safeParse(mutable).success).toBe(
      true,
    );
    const runtime =
      createPlayableInteractiveStoryDraftContentSchema('en-US').parse(mutable);
    const runtimeOutside = runtime.graph.nodes[2];
    expect(
      runtimeOutside?.kind === 'clip' && runtimeOutside.exit.kind === 'choice'
        ? runtimeOutside.exit.decisionId
        : null,
    ).toBe('decision-1');
  });

  it('still rejects duplicate stable film identities', () => {
    const duplicate = structuredClone(filmDraft());

    duplicate.graph.nodes.push({
      kind: 'clip',
      nodeId: 'inside',
      clipKey: 'OTHER',
      interactions: [],
      exit: { kind: 'auto', routes: [{ target: null }] },
    });
    expect(
      createLockableInteractiveStoryDraftContentSchema('en-US').safeParse(
        duplicate,
      ).success,
    ).toBe(false);
  });

  it('accepts every hotspot trigger and repairs unavailable outcome targets without blocking playback', () => {
    const valid = filmDraft();
    const validClip = valid.graph.nodes[0];
    if (validClip.kind !== 'clip') throw new Error('Expected clip fixture.');
    validClip.interactions = [
      {
        kind: 'hotspot',
        interactionId: 'inspect-gate',
        label: { 'en-US': 'Inspect gate' },
        trigger: { kind: 'tap' },
        rect: { x: 0.1, y: 0.1, width: 0.25, height: 0.25 },
        startMs: 500,
        endMs: 1_500,
        outcomes: { success: { kind: 'continue' } },
      },
      {
        kind: 'hotspot',
        interactionId: 'rewind-gate',
        label: { 'en-US': 'Look again' },
        trigger: {
          kind: 'press-hold',
          durationMs: 800,
          controlTimeline: false,
        },
        rect: { x: 0.4, y: 0.1, width: 0.25, height: 0.25 },
        startMs: 500,
        endMs: 1_500,
        outcomes: {
          success: { kind: 'seek', timeMs: 250 },
          failure: { kind: 'continue' },
        },
      },
      {
        kind: 'hotspot',
        interactionId: 'enter-gate',
        label: { 'en-US': 'Enter' },
        trigger: { kind: 'swipe', direction: 'right' },
        rect: { x: 0.7, y: 0.1, width: 0.2, height: 0.25 },
        startMs: 500,
        endMs: 1_500,
        outcomes: {
          success: { kind: 'goto', target: { kind: 'node', nodeId: 'inside' } },
          timeout: { kind: 'seek', timeMs: 500 },
        },
      },
    ];
    expect(
      createPlayableInteractiveStoryDraftContentSchema('en-US').safeParse(valid)
        .success,
    ).toBe(true);

    const invalid = structuredClone(valid);
    const invalidClip = invalid.graph.nodes[0];
    if (invalidClip.kind !== 'clip') throw new Error('Expected clip fixture.');
    invalidClip.interactions[2].outcomes.success = {
      kind: 'goto',
      target: { kind: 'node', nodeId: 'missing' },
    };
    const normalized =
      createPlayableInteractiveStoryDraftContentSchema('en-US').parse(invalid);
    const normalizedClip = normalized.graph.nodes[0];
    if (normalizedClip.kind !== 'clip') {
      throw new Error('Expected normalized clip fixture.');
    }
    expect(normalizedClip.interactions[2].outcomes.success).toEqual({
      kind: 'continue',
    });
  });

  it('rejects hotspot geometry that escapes the normalized video frame', () => {
    const invalid = filmDraft();
    const invalidClip = invalid.graph.nodes[0];
    if (invalidClip.kind !== 'clip') throw new Error('Expected clip fixture.');
    invalidClip.interactions = [
      {
        kind: 'hotspot',
        interactionId: 'outside-frame',
        label: { 'en-US': 'Outside frame' },
        trigger: { kind: 'tap' },
        rect: { x: 0.9, y: 0.1, width: 0.25, height: 0.25 },
        startMs: 500,
        endMs: 1_500,
        outcomes: { success: { kind: 'continue' } },
      },
    ];
    expect(
      createPlayableInteractiveStoryDraftContentSchema('en-US').safeParse(
        invalid,
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

  it('defaults press-hold timeline control off and accepts the explicit flag', () => {
    const draft = filmDraft();
    const clip = draft.graph.nodes[0];
    if (clip.kind !== 'clip') throw new Error('Expected clip fixture.');
    clip.interactions = [
      {
        kind: 'hotspot',
        interactionId: 'charge-gate',
        label: { 'en-US': 'Hold' },
        trigger: {
          kind: 'press-hold',
          durationMs: 1_000,
          controlTimeline: false,
        },
        rect: { x: 0.35, y: 0.35, width: 0.3, height: 0.3 },
        startMs: 500,
        endMs: 2_500,
        outcomes: { success: { kind: 'continue' } },
      },
    ];
    const parsed = InteractiveStoryDraftContentSchema.parse(draft);
    const parsedClip = parsed.graph.nodes[0];
    if (parsedClip.kind !== 'clip') throw new Error('Expected clip fixture.');
    expect(parsedClip.interactions[0].trigger).toEqual({
      kind: 'press-hold',
      durationMs: 1_000,
      controlTimeline: false,
    });

    const explicit = structuredClone(draft);
    const explicitClip = explicit.graph.nodes[0];
    if (explicitClip.kind !== 'clip') throw new Error('Expected clip fixture.');
    (
      explicitClip.interactions[0].trigger as { controlTimeline: boolean }
    ).controlTimeline = true;
    const parsedExplicit = InteractiveStoryDraftContentSchema.parse(explicit);
    const parsedExplicitClip = parsedExplicit.graph.nodes[0];
    if (parsedExplicitClip.kind !== 'clip') {
      throw new Error('Expected clip fixture.');
    }
    expect(
      (
        parsedExplicitClip.interactions[0].trigger as {
          controlTimeline: boolean;
        }
      ).controlTimeline,
    ).toBe(true);
  });

  it('accepts a safe branch frame at or after the window end and rejects earlier cuts', () => {
    const withBranchAt = (branchAtMs: number) => {
      const draft = filmDraft();
      const clip = draft.graph.nodes[0];
      if (clip.kind !== 'clip') throw new Error('Expected clip fixture.');
      clip.interactions = [
        {
          kind: 'hotspot',
          interactionId: 'dodge-gate',
          label: { 'en-US': 'Dodge' },
          trigger: { kind: 'swipe', direction: 'right' },
          rect: { x: 0.35, y: 0.35, width: 0.3, height: 0.3 },
          startMs: 500,
          endMs: 1_500,
          branchAtMs,
          outcomes: { success: { kind: 'continue' } },
        },
      ];
      return draft;
    };

    expect(
      InteractiveStoryDraftContentSchema.safeParse(withBranchAt(1_500)).success,
    ).toBe(true);
    expect(
      InteractiveStoryDraftContentSchema.safeParse(withBranchAt(4_000)).success,
    ).toBe(true);
    expect(
      InteractiveStoryDraftContentSchema.safeParse(withBranchAt(1_200)).success,
    ).toBe(false);
  });
});

describe('editable decision contract', () => {
  it('accepts disconnected choices but rejects runtime-only auto decisions on draft writes', () => {
    const content = filmDraft();
    content.graph.nodes.push({
      kind: 'decision',
      nodeId: 'D',
      exit: { kind: 'choice', decisionId: 'D', prompt: {}, choices: [] },
    });
    const request = {
      expectedRevision: 0,
      schemaVersion: 'interactive-story-draft-v1',
      content,
      sessionId: 'test',
    };
    expect(PutStoryDraftSchema.safeParse(request).success).toBe(true);
    const runtimeOnly = {
      ...request,
      content: {
        ...content,
        graph: {
          ...content.graph,
          nodes: [
            ...content.graph.nodes.slice(0, -1),
            {
              kind: 'decision',
              nodeId: 'D',
              exit: { kind: 'auto', nextNodeId: null },
            },
          ],
        },
      },
    };
    expect(PutStoryDraftSchema.safeParse(runtimeOnly).success).toBe(false);
    expect(
      createPlayableInteractiveStoryDraftContentSchema('en-US').safeParse(
        content,
      ).success,
    ).toBe(true);
  });
});

describe('interactive film stats contract', () => {
  it('drops retired variable bounds from a saved draft before validation', () => {
    const legacy = {
      ...filmDraft(),
      storyBible: {
        ...filmDraft().storyBible,
        stateVariables: [
          {
            key: 'gold',
            name: { 'en-US': 'Gold' },
            valueType: 'number',
            initialValue: 0,
            minimum: 10,
            maximum: 5,
          },
        ],
      },
    };
    const parsed = InteractiveStoryDraftContentSchema.parse(legacy);
    expect(parsed.storyBible.stateVariables).toEqual([
      {
        key: 'gold',
        name: { 'en-US': 'Gold' },
        valueType: 'number',
        initialValue: 0,
      },
    ]);
    expect(legacy.storyBible.stateVariables[0].minimum).toBe(10);
  });

  it('fills the project locale for runtime variable and ending copy without changing the draft', () => {
    const draft = filmDraft();
    draft.storyBible.stateVariables = [
      {
        key: 'courage',
        name: { 'zh-CN': '勇气' },
        valueType: 'number',
        initialValue: 0,
      },
    ];
    draft.storyBible.endings = [
      {
        endingId: 'ending.brave',
        title: { 'zh-CN': '勇者结局' },
        kind: 'success',
      },
    ];
    const opening = draft.graph.nodes[0];
    if (opening?.exit.kind === 'choice') {
      opening.exit.choices[1] = {
        ...opening.exit.choices[1]!,
        target: { kind: 'ending', endingId: 'ending.brave' },
      };
    }
    const playable =
      createPlayableInteractiveStoryDraftContentSchema('en-US').parse(draft);
    expect(playable.storyBible.stateVariables?.[0]?.name).toEqual({
      'zh-CN': '勇气',
      'en-US': '勇气',
    });
    expect(playable.storyBible.endings?.[0]?.title).toEqual({
      'zh-CN': '勇者结局',
      'en-US': '勇者结局',
    });
    expect(collectInteractiveStoryRuntimeLocales(playable, 'en-US')).toContain(
      'en-US',
    );
    expect(draft.storyBible.stateVariables?.[0]?.name).toEqual({
      'zh-CN': '勇气',
    });
  });

  it('migrates nextNodeId drafts and compiles number thresholds', () => {
    const parsed = InteractiveStoryDraftContentSchema.parse({
      ...filmDraft(),
      storyBible: {
        ...filmDraft().storyBible,
        stateVariables: [
          {
            key: 'favorability.lin',
            name: { 'en-US': 'Lin' },
            valueType: 'number',
            initialValue: 0,
          },
        ],
        endings: [
          {
            endingId: 'ending.together',
            title: { 'en-US': 'Together' },
            kind: 'success',
          },
        ],
      },
    });
    const opening = parsed.graph.nodes[0];
    if (opening?.exit.kind !== 'choice') throw new Error('Expected choice');
    opening.exit.choices[0].effects = [
      { kind: 'add', key: 'favorability.lin', amount: 20 },
    ];
    opening.exit.choices[0].target = {
      kind: 'ending',
      endingId: 'ending.together',
    };
    opening.exit.choices[1].visibleWhen = {
      kind: 'compare',
      variableKey: 'favorability.lin',
      operator: 'at-least',
      value: 10,
    };
    expect(
      createLockableInteractiveStoryDraftContentSchema('en-US').safeParse(
        parsed,
      ).success,
    ).toBe(true);
  });

  it('rejects boolean ordering and routes without a trailing fallback', () => {
    const draft = filmDraft();
    draft.storyBible.stateVariables = [
      {
        key: 'met.lin',
        name: { 'en-US': 'Met Lin' },
        valueType: 'boolean',
        initialValue: false,
      },
    ];
    const inside = draft.graph.nodes[1];
    if (inside?.exit.kind !== 'auto') throw new Error('Expected auto');
    inside.exit.routes = [
      {
        when: {
          kind: 'compare',
          variableKey: 'met.lin',
          operator: 'at-least',
          value: 1,
        },
        target: { kind: 'node', nodeId: 'opening' },
      },
      { target: null },
    ];
    expect(
      createLockableInteractiveStoryDraftContentSchema('en-US').safeParse(draft)
        .success,
    ).toBe(false);
    inside.exit.routes = [
      {
        when: {
          kind: 'compare',
          variableKey: 'met.lin',
          operator: 'equals',
          value: true,
        },
        target: { kind: 'node', nodeId: 'opening' },
      },
    ];
    const normalized =
      createLockableInteractiveStoryDraftContentSchema('en-US').parse(draft);
    const normalizedInside = normalized.graph.nodes[1];
    expect(normalizedInside?.exit).toEqual({
      kind: 'auto',
      routes: [
        {
          when: {
            kind: 'compare',
            variableKey: 'met.lin',
            operator: 'equals',
            value: true,
          },
          target: { kind: 'node', nodeId: 'opening' },
        },
        { target: null },
      ],
    });
  });
});

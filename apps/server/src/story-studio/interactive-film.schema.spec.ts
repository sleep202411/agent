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
          interactions: [],
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
          nextNodeId: 'inside',
        },
        {
          choiceId: 'leave',
          label: { 'en-US': 'Go' },
          nextNodeId: 'opening',
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
      exit: { kind: 'auto', nextNodeId: null },
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
          success: { kind: 'goto', nodeId: 'inside' },
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
      nodeId: 'missing',
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

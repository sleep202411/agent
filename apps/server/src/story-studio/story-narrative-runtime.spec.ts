import { generateObject } from 'ai';
import { StoryTextExperienceController } from './story-text-play.controller';
import { StoryNarrativeSessionService } from './story-narrative-session.service';
import type { StoryNarrativeSession } from './story-narrative-session.service';
import { StoryTextPlayService } from './story-text-play.service';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

const GAME_ID = 'game-1';
const CONTENT_VERSION = 'v1';

/**
 * The narrator is stubbed, not skipped.
 *
 * Every pace narrates now — an authored beat is a direction marker, not a step
 * the player is marched to — so there is no model-free path through a turn. The
 * stub owns the narrator's two decisions (its prose and its `converged`
 * verdict) and the tests assert what the runtime does with them.
 */
jest.mock('./story-authoring-model', () => ({
  createStoryAuthoringModel: () => ({}),
}));
jest.mock('ai', () => ({ generateObject: jest.fn() }));

const narrator = generateObject as unknown as jest.Mock;
const NARRATION = '夜风穿过廊下。';

function narratorConverges(converged: boolean): void {
  narrator.mockReset();
  narrator.mockResolvedValue({
    object: { narration: NARRATION, converged, suggestions: ['等待', '叩门'] },
  });
}

beforeEach(() => narratorConverges(true));

function published(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: '一个访客叩响了封闭别墅的门。',
      synopsis: '一夜、一门、一个真相。',
      worldview: '夜色中的别墅。',
      characters: [],
      endings: [
        {
          id: 'ending.truth',
          title: { 'zh-CN': '真相' },
          summary: { 'zh-CN': '门开了。' },
        },
      ],
    },
    graph: {
      entryNodeId: 'node.opening',
      nodes: [
        {
          kind: 'text',
          nodeId: 'node.opening',
          title: { 'zh-CN': '夜访' },
          body: { 'zh-CN': '你站在别墅门前。' },
          exit: { kind: 'auto', nextNodeId: 'node.gate' },
        },
        {
          kind: 'text',
          nodeId: 'node.gate',
          body: { 'zh-CN': '守门人拦住了你。' },
          exit: {
            kind: 'choice',
            decisionId: 'decision.gate',
            prompt: { 'zh-CN': '怎么办?' },
            choices: [
              {
                choiceId: 'choice.push',
                label: { 'zh-CN': '硬闯' },
                nextNodeId: 'node.truth',
              },
              {
                choiceId: 'choice.leave',
                label: { 'zh-CN': '离开' },
                nextNodeId: 'node.truth',
              },
            ],
          },
        },
        {
          kind: 'text',
          nodeId: 'node.truth',
          body: { 'zh-CN': '门后是真相。' },
          exit: { kind: 'ending', endingId: 'ending.truth' },
        },
      ],
    },
    productionNotes: [],
  };
}

function serviceWith(
  content: InteractiveStoryDraftContent,
  runtimeJson: unknown = null,
) {
  const prisma = {
    storyExperiencePublication: {
      findFirst: jest.fn().mockResolvedValue({
        build: { sourceRevision: { content }, runtimeJson },
        project: { format: 'text_adventure', defaultLocale: 'zh-CN' },
      }),
    },
  };
  return new StoryTextPlayService(prisma as never, {} as never);
}

const THEME_TRACK_ID = 'audio:0197f4a2-0800-7000-8000-000000000008';
const GATE_TRACK_ID = 'audio:0197f4a2-0800-7000-8000-000000000009';
// Plain public media URLs — unguessable, cacheable, no expiry. A bed loops for
// a whole run, which a short-lived signed URL could not serve.
const THEME_URL = 'https://media.example.com/ws/audio/theme.mp3';
const GATE_URL = 'https://media.example.com/ws/audio/gate.mp3';
const TRACK_URLS: Record<string, string> = {
  [THEME_TRACK_ID]: THEME_URL,
  [GATE_TRACK_ID]: GATE_URL,
};

/**
 * The shape the Build compiler writes into `runtimeJson`, cut down to what the
 * narrative runtime reads: the scenes and their music. A bed is a plain media
 * reference carried inline on the scene — there is no `assets` entry for it,
 * which is exactly why nothing about music can fail a publish.
 */
function publishedManifest(bindings: Record<string, string>) {
  return {
    assets: [
      { assetId: 'theme:core.film-dark:1', kind: 'data', format: 'json' },
    ],
    graph: {
      entrySceneId: 'node.opening',
      nodes: ['node.opening', 'node.gate', 'node.truth'].map((sceneId) => ({
        kind: 'scene',
        sceneId,
        ...(bindings[sceneId]
          ? {
              music: {
                trackId: bindings[sceneId],
                url: TRACK_URLS[bindings[sceneId]],
              },
            }
          : {}),
      })),
    },
  };
}

const CONCEPT_MARKDOWN = [
  '【高概念 HC-01】\nLogline：守门人认得你，而你不认得他。',
  '类型标签：悬疑 / 家族 / 夜行',
  '核心冲突：门内的人比门外的你更害怕。',
  '视觉钩子：铜环上凝着一层白霜。',
  '反差与颠覆：闯入者其实是归人。',
  '一句宣传语：门开时，你已经不是访客。',
].join('\n\n');

function sessionFor(
  service: StoryTextPlayService,
  markdown = CONCEPT_MARKDOWN,
): Promise<StoryNarrativeSession> {
  return service
    .narrativeEnter({
      gameId: GAME_ID,
      contentVersion: CONTENT_VERSION,
      locale: 'zh-CN',
      conceptId: 'HC-01',
      conceptMarkdown: markdown,
    })
    .then((entry) => ({
      gameId: GAME_ID,
      contentVersion: CONTENT_VERSION,
      locale: 'zh-CN',
      conceptId: 'HC-01',
      conceptMarkdown: markdown,
      direction: entry.direction,
      pace: 'standard' as const,
      runawayTurnGuard: 18,
      started: false,
      musicTrackId: null,
      play: {
        nodeId: null,
        direction: entry.direction,
        freeTurnsUsed: 0,
        transcript: [],
      },
      endedAt: null,
      createdAt: Date.now(),
    }));
}

describe('narrative enter', () => {
  it('frames the setup screen with the authored logline', async () => {
    const service = serviceWith(published());
    const entry = await service.narrativeEnter({
      gameId: GAME_ID,
      contentVersion: CONTENT_VERSION,
      locale: 'zh-CN',
      conceptId: 'HC-01',
      conceptMarkdown: CONCEPT_MARKDOWN,
    });

    expect(entry.prologue).toBe('一个访客叩响了封闭别墅的门。');
  });

  it('rebuilds the structured direction from the picked concept markdown', async () => {
    const service = serviceWith(published());
    const entry = await service.narrativeEnter({
      gameId: GAME_ID,
      contentVersion: CONTENT_VERSION,
      locale: 'zh-CN',
      conceptId: 'HC-01',
      conceptMarkdown: CONCEPT_MARKDOWN,
    });

    expect(entry.direction).toMatchObject({
      id: 'HC-01',
      logline: '守门人认得你，而你不认得他。',
      tags: ['悬疑', '家族', '夜行'],
      conflict: '门内的人比门外的你更害怕。',
      hook: '铜环上凝着一层白霜。',
      twist: '闯入者其实是归人。',
      tagline: '门开时，你已经不是访客。',
      title: '门开时，你已经不是访客。',
    });
  });

  it('refuses an empty concept', async () => {
    const service = serviceWith(published());

    await expect(
      service.narrativeEnter({
        gameId: GAME_ID,
        contentVersion: CONTENT_VERSION,
        locale: 'zh-CN',
        conceptId: 'HC-01',
        conceptMarkdown: '   ',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CONCEPT' } });
  });

  it('answers RELEASE_NOT_FOUND when nothing is published', async () => {
    const service = new StoryTextPlayService(
      {
        storyExperiencePublication: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as never,
      {} as never,
    );

    await expect(
      service.narrativeEnter({
        gameId: GAME_ID,
        contentVersion: CONTENT_VERSION,
        locale: 'zh-CN',
        conceptId: 'HC-01',
        conceptMarkdown: CONCEPT_MARKDOWN,
      }),
    ).rejects.toMatchObject({ response: { code: 'RELEASE_NOT_FOUND' } });
  });
});

describe('narrative turns', () => {
  it('flattens anchors, the authored prompt and choices into one turn', async () => {
    const service = serviceWith(published());
    const session = await sessionFor(service);

    const start = await service.playNarrativeTurn(session, { kind: 'start' });
    expect(start).toMatchObject({
      narrative: '夜访\n你站在别墅门前。',
      options: [],
      finished: false,
    });

    // One turn reads as one continuous passage: what the narrator invented on
    // the way, then the beat it arrived at, then the authored question.
    const atGate = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });
    expect(atGate.narrative).toBe(
      `${NARRATION}\n\n守门人拦住了你。\n\n怎么办?`,
    );
    expect(atGate.options).toEqual([
      { id: 'choice.push', label: '硬闯', kind: 'choice' },
      { id: 'choice.leave', label: '离开', kind: 'choice' },
    ]);
  });

  it('closes the run on an authored ending', async () => {
    const service = serviceWith(published());
    const session = await sessionFor(service);
    await service.playNarrativeTurn(session, { kind: 'start' });
    await service.playNarrativeTurn(session, { kind: 'continue' });

    const ended = await service.playNarrativeTurn(session, {
      kind: 'choice',
      choiceId: 'choice.push',
    });

    expect(ended.finished).toBe(true);
    expect(ended.options).toEqual([]);
    expect(ended.ending).toEqual({
      endingId: 'ending.truth',
      title: '真相',
      summary: '门开了。',
    });
  });

  it('maps an engine refusal to ACTION_NOT_ALLOWED and leaves the run playable', async () => {
    const service = serviceWith(published());
    const session = await sessionFor(service);
    await service.playNarrativeTurn(session, { kind: 'start' });
    const nodeBeforeRefusal = session.play.nodeId;

    // The opening node has an `auto` exit, so a choice there is not on offer.
    await expect(
      service.playNarrativeTurn(session, {
        kind: 'choice',
        choiceId: 'choice.push',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_NOT_ALLOWED' } });

    expect(session.play.nodeId).toBe(nodeBeforeRefusal);
    const resumed = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });
    expect(resumed.narrative).toContain('守门人拦住了你。');
  });

  it('maps an unavailable choice to ACTION_NOT_ALLOWED', async () => {
    const service = serviceWith(published());
    const session = await sessionFor(service);
    await service.playNarrativeTurn(session, { kind: 'start' });
    await service.playNarrativeTurn(session, { kind: 'continue' });

    await expect(
      service.playNarrativeTurn(session, {
        kind: 'choice',
        choiceId: 'choice.forged',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_NOT_ALLOWED' } });
  });

  it('keeps narrating at a decision point instead of forcing the choice', async () => {
    const service = serviceWith(published());
    const session = await sessionFor(service);
    await service.playNarrativeTurn(session, { kind: 'start' });
    await service.playNarrativeTurn(session, { kind: 'continue' });
    narratorConverges(false);

    // The authored choices are on screen and they WAIT. Free input and
    // `continue` keep working there and keep narrating — a decision point is
    // not a gate the player is rationed through.
    const lingered = await service.playNarrativeTurn(session, {
      kind: 'free',
      text: '打量守门人的靴子',
    });
    expect(lingered.finished).toBe(false);
    expect(session.play.nodeId).toBe('node.gate');
    expect(lingered.narrative).toContain(NARRATION);
    // The wire carries one option list, so this is the whole of "they wait":
    // typing something must never hand the player the narrator's suggestions
    // in place of the decision they are parked at.
    expect(lingered.options).toEqual([
      { id: 'choice.push', label: '硬闯', kind: 'choice' },
      { id: 'choice.leave', label: '离开', kind: 'choice' },
    ]);

    const stillThere = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });
    expect(session.play.nodeId).toBe('node.gate');
    expect(stillThere.narrative).toContain(NARRATION);
    expect(stillThere.options).toEqual(lingered.options);

    // And the authored exit is still exactly where it was.
    narratorConverges(true);
    const ended = await service.playNarrativeTurn(session, {
      kind: 'choice',
      choiceId: 'choice.push',
    });
    expect(ended.finished).toBe(true);
  });

  it('offers the narrator suggestions where no authored decision is pending', async () => {
    const service = serviceWith(published());
    const session = await sessionFor(service);
    await service.playNarrativeTurn(session, { kind: 'start' });
    narratorConverges(false);

    const lingered = await service.playNarrativeTurn(session, {
      kind: 'free',
      text: '推门',
    });

    // The opening beat exits automatically — nothing authored is waiting on an
    // answer, so the free-action hints are the only options there are.
    expect(session.play.nodeId).toBe('node.opening');
    expect(lingered.options).toEqual([
      { id: 'suggestion:1', label: '等待', kind: 'suggestion' },
      { id: 'suggestion:2', label: '叩门', kind: 'suggestion' },
    ]);
  });

  it('reads a locale whose entry is explicitly empty as the non-empty one', async () => {
    const content = published();
    const gate = content.graph.nodes[1];
    if (gate.kind !== 'text' || gate.exit.kind !== 'choice') {
      throw new Error('fixture drifted: node.gate must offer authored choices');
    }
    // Publishable content: the revision gate only demands one non-empty locale.
    gate.exit.choices[0].label = { 'zh-CN': '硬闯', 'en-US': '' };
    const service = serviceWith(content);
    const session = await sessionFor(service);
    session.locale = 'en-US';

    await service.playNarrativeTurn(session, { kind: 'start' });
    const atGate = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });

    expect(atGate.options[0].label).toBe('硬闯');
  });

  it('maps a vanished node to SESSION_EXPIRED', async () => {
    const service = serviceWith(published());
    const session = await sessionFor(service);
    await service.playNarrativeTurn(session, { kind: 'start' });
    session.play.nodeId = 'node.deleted';

    await expect(
      service.playNarrativeTurn(session, { kind: 'continue' }),
    ).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
  });
});

/**
 * Music is authored per node and frozen into the published manifest, so the
 * runtime's whole job is: hand the player every track at enter, then cue a
 * crossfade exactly when the bed actually changes.
 */
describe('narrative music', () => {
  function enter(service: StoryTextPlayService) {
    return service.narrativeEnter({
      gameId: GAME_ID,
      contentVersion: CONTENT_VERSION,
      locale: 'zh-CN',
      conceptId: 'HC-01',
      conceptMarkdown: CONCEPT_MARKDOWN,
    });
  }

  it('stays dark for a story with no bound tracks', async () => {
    const service = serviceWith(published());
    const session = await sessionFor(service);

    expect((await enter(service)).music).toEqual({
      enabled: false,
      tracks: [],
    });
    const start = await service.playNarrativeTurn(session, { kind: 'start' });
    const atGate = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });

    expect(start).not.toHaveProperty('music');
    expect(atGate).not.toHaveProperty('music');
    expect(session.musicTrackId).toBeNull();
  });

  it('hands the player every referenced track to preload at enter', async () => {
    const service = serviceWith(
      published(),
      publishedManifest({
        'node.opening': THEME_TRACK_ID,
        'node.truth': GATE_TRACK_ID,
      }),
    );

    expect((await enter(service)).music).toEqual({
      enabled: true,
      // Every DISTINCT bound track, so a later cue is a crossfade rather than
      // a download — and the list is derived from the same bindings the cues
      // are, so it can never disagree with them.
      tracks: [
        { trackId: THEME_TRACK_ID, url: THEME_URL, gain: 0.6 },
        { trackId: GATE_TRACK_ID, url: GATE_URL, gain: 0.6 },
      ],
    });
  });

  it('ignores a binding the manifest carries no URL for', async () => {
    const manifest = publishedManifest({ 'node.opening': THEME_TRACK_ID });
    const scene = manifest.graph.nodes[0] as { music?: unknown };
    // What a deleted or unresolvable asset leaves behind: nothing at all. The
    // release is still perfectly playable, just silent.
    delete scene.music;
    const service = serviceWith(published(), manifest);
    const session = await sessionFor(service);

    expect((await enter(service)).music).toEqual({
      enabled: false,
      tracks: [],
    });
    const start = await service.playNarrativeTurn(session, { kind: 'start' });
    expect(start).not.toHaveProperty('music');
  });

  it('cues a crossfade when play enters a node bound to another track', async () => {
    const service = serviceWith(
      published(),
      publishedManifest({
        'node.opening': THEME_TRACK_ID,
        'node.gate': GATE_TRACK_ID,
      }),
    );
    const session = await sessionFor(service);

    const start = await service.playNarrativeTurn(session, { kind: 'start' });
    expect(start.music).toEqual({
      action: 'play',
      trackId: THEME_TRACK_ID,
      fadeMs: 1_500,
    });

    const atGate = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });
    expect(atGate.music).toEqual({
      action: 'play',
      trackId: GATE_TRACK_ID,
      fadeMs: 1_500,
    });
    expect(session.musicTrackId).toBe(GATE_TRACK_ID);
  });

  it('says nothing when the next node asks for the track already playing', async () => {
    const service = serviceWith(
      published(),
      publishedManifest({
        'node.opening': THEME_TRACK_ID,
        'node.gate': THEME_TRACK_ID,
      }),
    );
    const session = await sessionFor(service);
    await service.playNarrativeTurn(session, { kind: 'start' });

    const atGate = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });

    expect(atGate).not.toHaveProperty('music');
    expect(session.musicTrackId).toBe(THEME_TRACK_ID);
  });

  it('leaves the bed playing across a node that binds nothing', async () => {
    const service = serviceWith(
      published(),
      publishedManifest({ 'node.opening': THEME_TRACK_ID }),
    );
    const session = await sessionFor(service);
    await service.playNarrativeTurn(session, { kind: 'start' });

    const atGate = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });

    // A theme is meant to carry across the scenes between two bindings, so an
    // unbound node must not stop it.
    expect(atGate).not.toHaveProperty('music');
    expect(session.musicTrackId).toBe(THEME_TRACK_ID);
  });
});

class FakeRedis {
  readonly store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(
    key: string,
    value: string,
    _ex: string,
    _ttl: number,
    nx?: string,
  ): Promise<'OK' | null> {
    if (nx === 'NX' && this.store.has(key)) return Promise.resolve(null);
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  eval(
    _script: string,
    _keys: number,
    key: string,
    token: string,
  ): Promise<number> {
    if (this.store.get(key) === token) this.store.delete(key);
    return Promise.resolve(1);
  }
}

/**
 * Pace is a prompt bias, not a metronome. A pace whose guard were zero would be
 * pure authored playback — the anchor-slideshow this runtime exists to avoid —
 * so the floor is what keeps every pace narrating.
 */
describe('narrative pace', () => {
  const service = () => serviceWith(published());

  it('leaves every pace room for the narrator', () => {
    for (const option of service().narrativePaceOptions('zh-CN')) {
      expect(service().runawayTurnGuardForPace(option.key)).toBeGreaterThan(0);
      // Generous enough that normal play never reaches it: a beat that takes
      // ten turns is already unusual.
      expect(service().runawayTurnGuardForPace(option.key)).toBeGreaterThan(10);
    }
  });

  it('ships pace as key and label only', () => {
    const options = service().narrativePaceOptions('zh-CN');

    // No budget on the wire: every pace narrates, offers free input and honours
    // `continue`, so there is nothing for a client to gate an affordance on.
    expect(options.map((option) => option.key)).toEqual([
      'slow',
      'standard',
      'compact',
    ]);
    options.forEach((option) => {
      expect(Object.keys(option).sort()).toEqual(['key', 'label']);
      expect(option.label.length).toBeGreaterThan(0);
    });
  });
});

describe('narrative sessions', () => {
  const seed = {
    gameId: GAME_ID,
    contentVersion: CONTENT_VERSION,
    locale: 'zh-CN',
    conceptId: 'HC-01',
    conceptMarkdown: CONCEPT_MARKDOWN,
    direction: {
      id: 'HC-01',
      title: '门开时',
      logline: '守门人认得你。',
      tags: [],
      conflict: '',
      hook: '',
      twist: '',
      tagline: '',
    },
    pace: 'standard' as const,
    runawayTurnGuard: 18,
  };

  it('round-trips a run and persists handler mutations', async () => {
    const sessions = new StoryNarrativeSessionService(new FakeRedis() as never);
    const { sessionId } = await sessions.create(seed);

    await sessions.withSession(sessionId, (session) => {
      session.started = true;
      session.play.nodeId = 'node.opening';
      return Promise.resolve(null);
    });

    const reloaded = await sessions.get(sessionId);
    expect(reloaded).toMatchObject({
      started: true,
      play: { nodeId: 'node.opening' },
    });
  });

  it('leaves the run untouched when a turn fails', async () => {
    const sessions = new StoryNarrativeSessionService(new FakeRedis() as never);
    const { sessionId } = await sessions.create(seed);

    await expect(
      sessions.withSession(sessionId, (session) => {
        session.started = true;
        return Promise.reject(new Error('narration failed'));
      }),
    ).rejects.toThrow('narration failed');

    expect((await sessions.get(sessionId)).started).toBe(false);
  });

  it('refuses a second turn while one is in flight', async () => {
    const sessions = new StoryNarrativeSessionService(new FakeRedis() as never);
    const { sessionId } = await sessions.create(seed);

    await sessions.withSession(sessionId, async () => {
      await expect(
        sessions.withSession(sessionId, () => Promise.resolve(null)),
      ).rejects.toMatchObject({ response: { code: 'TURN_IN_FLIGHT' } });
    });
  });

  it('reads an unknown run as expired', async () => {
    const sessions = new StoryNarrativeSessionService(new FakeRedis() as never);

    await expect(sessions.get('sess_missing')).rejects.toMatchObject({
      response: { code: 'SESSION_EXPIRED' },
    });
  });
});

/**
 * The public routes end to end, because the terminal-vs-recoverable split only
 * exists where the controller's state guard and the engine's refusals meet: the
 * client throws a run away on INVALID_ACTION, so nothing recoverable may reach
 * that code.
 */
describe('narrative action taxonomy', () => {
  const request = {
    header: () => undefined,
    ip: '203.0.113.7',
    socket: {},
  } as never;

  function controllerWith(content: InteractiveStoryDraftContent) {
    const sessions = new StoryNarrativeSessionService(new FakeRedis() as never);
    const controller = new StoryTextExperienceController(
      serviceWith(content),
      sessions,
      { guard: jest.fn().mockResolvedValue({}) } as never,
    );
    return { controller, sessions };
  }

  function openRun(controller: StoryTextExperienceController): Promise<string> {
    return controller
      .enter(request, {
        gameId: GAME_ID,
        contentVersion: CONTENT_VERSION,
        locale: 'zh-CN',
        selectedConceptId: 'HC-01',
        selectedConceptMarkdown: CONCEPT_MARKDOWN,
      })
      .then((entered) => entered.data.sessionId);
  }

  it('answers INVALID_ACTION only once the run has ENDED', async () => {
    const { controller } = controllerWith(published());
    const sessionId = await openRun(controller);
    await controller.turns(request, {
      sessionId,
      action: 'start',
      setup: { pace: 'compact' },
    });
    await controller.turns(request, { sessionId, action: 'continue' });
    const ended = await controller.turns(request, {
      sessionId,
      action: 'choice',
      choiceId: 'choice.push',
    });
    expect(ended.data.finished).toBe(true);

    // The one truly terminal state: no action can ever apply again, so the
    // client is right to throw the session away.
    await expect(
      controller.turns(request, { sessionId, action: 'continue' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_ACTION' } });
  });

  it('answers RUN_ALREADY_STARTED and keeps the started run playable', async () => {
    const { controller, sessions } = controllerWith(published());
    const sessionId = await openRun(controller);
    await controller.turns(request, {
      sessionId,
      action: 'start',
      setup: { pace: 'compact' },
    });

    // Reachable whenever the first start's answer is lost in flight: the player
    // presses start again and a perfectly healthy run must survive it.
    await expect(
      controller.turns(request, { sessionId, action: 'start' }),
    ).rejects.toMatchObject({ response: { code: 'RUN_ALREADY_STARTED' } });

    expect(await sessions.get(sessionId)).toMatchObject({
      started: true,
      endedAt: null,
    });
    const resumed = await controller.turns(request, {
      sessionId,
      action: 'continue',
    });
    expect(resumed.data.narrative).toContain('守门人拦住了你。');
  });

  it('answers RUN_NOT_STARTED and leaves the run startable', async () => {
    const { controller, sessions } = controllerWith(published());
    const sessionId = await openRun(controller);

    await expect(
      controller.turns(request, { sessionId, action: 'continue' }),
    ).rejects.toMatchObject({ response: { code: 'RUN_NOT_STARTED' } });

    expect(await sessions.get(sessionId)).toMatchObject({ started: false });
    const started = await controller.turns(request, {
      sessionId,
      action: 'start',
      setup: { pace: 'compact' },
    });
    expect(started.data.narrative).toBe('夜访\n你站在别墅门前。');
  });

  it('answers ACTION_NOT_ALLOWED for an engine refusal and keeps the run', async () => {
    const { controller, sessions } = controllerWith(published());
    const sessionId = await openRun(controller);
    await controller.turns(request, {
      sessionId,
      action: 'start',
      setup: { pace: 'compact' },
    });

    // The opening beat has an `auto` exit, so no authored choice is on offer.
    await expect(
      controller.turns(request, {
        sessionId,
        action: 'choice',
        choiceId: 'choice.push',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_NOT_ALLOWED' } });

    const survived = await sessions.get(sessionId);
    expect(survived).toMatchObject({
      started: true,
      endedAt: null,
      play: { nodeId: 'node.opening' },
    });
    const resumed = await controller.turns(request, {
      sessionId,
      action: 'continue',
    });
    expect(resumed.data.narrative).toContain('守门人拦住了你。');
  });
});

/**
 * A turn that says nothing is indistinguishable from a broken response to the
 * client, which throws the run away — so the turn most worth keeping (the one
 * that just ended the story) is the one most at risk. The runtime must never
 * produce that answer.
 */
describe('narrative turn prose', () => {
  it('still answers with prose when the graph simply stops', async () => {
    const content = published();
    const truth = content.graph.nodes[2];
    // A legal published shape: `nextNodeId` is nullable in the runtime schema,
    // so content locked before the readiness gate can still stop dead here.
    truth.exit = { kind: 'auto', nextNodeId: null };
    const service = serviceWith(content);
    const session = await sessionFor(service);

    await service.playNarrativeTurn(session, { kind: 'start' });
    await service.playNarrativeTurn(session, { kind: 'continue' });
    await service.playNarrativeTurn(session, {
      kind: 'choice',
      choiceId: 'choice.push',
    });
    const stopped = await service.playNarrativeTurn(session, {
      kind: 'continue',
    });

    expect(stopped.finished).toBe(true);
    // A bare stop is not an authored ending — there is no endingId to name —
    // so the run ends on prose, without an invented ending card.
    expect(stopped.ending).toBeUndefined();
    expect(stopped.narrative).toBe(NARRATION);
  });

  it('writes the closing passage for an ending reached on the very first turn', async () => {
    const content = published();
    // A one-beat story: the entry node IS the ending. Rare, but the shortest
    // run in the catalogue must still read like a story, not like a card.
    content.graph.nodes[0].exit = { kind: 'ending', endingId: 'ending.truth' };
    const service = serviceWith(content);
    const session = await sessionFor(service);

    const started = await service.playNarrativeTurn(session, { kind: 'start' });

    expect(started.finished).toBe(true);
    expect(started.ending).toMatchObject({ endingId: 'ending.truth' });
    expect(started.narrative).toBe(`夜访\n你站在别墅门前。\n\n${NARRATION}`);
  });

  it('closes on the ending summary rather than nothing', async () => {
    const content = published();
    const truth = content.graph.nodes[2];
    if (truth.kind !== 'text') {
      throw new Error('fixture drifted: node.truth must be a text node');
    }
    // Publishable: the revision gate only demands one non-empty locale, and the
    // run is played in a locale this beat has no copy for.
    truth.body = { 'zh-CN': '' };
    const service = serviceWith(content);
    const session = await sessionFor(service);

    await service.playNarrativeTurn(session, { kind: 'start' });
    await service.playNarrativeTurn(session, { kind: 'continue' });
    // The closing passage fails to generate — a reached ending must never be
    // swallowed by the prose that was meant to decorate it.
    narrator.mockRejectedValue(new Error('narrator unavailable'));
    const ended = await service.playNarrativeTurn(session, {
      kind: 'choice',
      choiceId: 'choice.push',
    });

    expect(ended.finished).toBe(true);
    expect(ended.narrative).toBe('门开了。');
  });
});

/**
 * Who a play request is rate limited AS.
 *
 * Behind Azure Front Door ingress-nginx overwrites `x-forwarded-for` with the
 * edge IP, so reading that chain first would collapse every player behind one
 * POP into a single bucket — and `concepts` fires on mount, so the visitors
 * past the cap could not start a run at all.
 */
describe('narrative rate-limit actor', () => {
  type GuardCall = { bucket: string; actorId: string };

  /** Stops a route right after its guard, before it can reach for a model. */
  class GuardStop extends Error {}

  function controllerWithGuard() {
    const calls: GuardCall[] = [];
    const control = { stopAfterGuard: false };
    const controller = new StoryTextExperienceController(
      serviceWith(published()),
      new StoryNarrativeSessionService(new FakeRedis() as never),
      {
        guard: jest.fn((args: GuardCall) => {
          calls.push({ bucket: args.bucket, actorId: args.actorId });
          return control.stopAfterGuard
            ? Promise.reject(new GuardStop())
            : Promise.resolve({});
        }),
      } as never,
    );
    return { controller, calls, control };
  }

  /**
   * `concepts` writes a full pitch set with the narrator model, which no unit
   * test may call — the guard runs first, so stopping there still proves what
   * the bucket was keyed on.
   */
  async function conceptsAs(
    controller: StoryTextExperienceController,
    control: { stopAfterGuard: boolean },
    req: ReturnType<typeof requestWith>,
    gameId: string,
  ): Promise<void> {
    control.stopAfterGuard = true;
    try {
      await controller.concepts(req, {
        gameId,
        contentVersion: CONTENT_VERSION,
        locale: 'zh-CN',
        count: 3,
      });
      throw new Error('the guard should have stopped this call');
    } catch (error) {
      if (!(error instanceof GuardStop)) throw error;
    } finally {
      control.stopAfterGuard = false;
    }
  }

  function requestWith(headers: Record<string, string>, ip?: string) {
    return {
      header: (name: string) => headers[name.toLowerCase()],
      ip,
      socket: {},
    } as never;
  }

  function enterAs(
    controller: StoryTextExperienceController,
    req: ReturnType<typeof requestWith>,
  ) {
    return controller.enter(req, {
      gameId: GAME_ID,
      contentVersion: CONTENT_VERSION,
      locale: 'zh-CN',
      selectedConceptId: 'HC-01',
      selectedConceptMarkdown: CONCEPT_MARKDOWN,
    });
  }

  it("keys on Front Door's client-IP header when it is present", async () => {
    const { controller, calls } = controllerWithGuard();

    await enterAs(
      controller,
      requestWith(
        {
          // What nginx leaves behind on the Front Door hosts: the chain is the
          // edge, the Azure header is the player.
          'x-azure-clientip': '203.0.113.9',
          'x-forwarded-for': '10.4.0.7',
        },
        '10.4.0.7',
      ),
    );

    expect(calls[0].actorId).toBe('203.0.113.9');
  });

  it('falls back to the first forwarded hop on the direct hosts', async () => {
    const { controller, calls } = controllerWithGuard();

    await enterAs(
      controller,
      requestWith(
        { 'x-forwarded-for': '198.51.100.4, 10.4.0.7, 10.4.0.8' },
        '10.4.0.8',
      ),
    );

    expect(calls[0].actorId).toBe('198.51.100.4');
  });

  it("answers 'unknown' rather than an empty actor when nothing names the caller", async () => {
    const { controller, calls } = controllerWithGuard();

    await enterAs(controller, requestWith({}));

    expect(calls[0].actorId).toBe('unknown');
  });

  it('scopes the concepts bucket per story so one cannot starve another', async () => {
    const { controller, calls, control } = controllerWithGuard();
    const req = requestWith({ 'x-azure-clientip': '203.0.113.9' });

    await conceptsAs(controller, control, req, GAME_ID);
    await conceptsAs(controller, control, req, 'game-2');

    expect(calls.map((call) => call.actorId)).toEqual([
      '203.0.113.9#game-1',
      '203.0.113.9#game-2',
    ]);
  });

  it('counts the three public routes in separate buckets', async () => {
    const { controller, calls, control } = controllerWithGuard();
    const req = requestWith({ 'x-azure-clientip': '203.0.113.9' });
    const entered = await enterAs(controller, req);
    await controller.turns(req, {
      sessionId: entered.data.sessionId,
      action: 'start',
      setup: { pace: 'compact' },
    });
    await conceptsAs(controller, control, req, GAME_ID);

    expect(calls.map((call) => call.bucket)).toEqual([
      'text-play:enter',
      'text-play:turns',
      'text-play:concepts',
    ]);
  });
});

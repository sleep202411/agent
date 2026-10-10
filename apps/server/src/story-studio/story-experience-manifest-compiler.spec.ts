import {
  InteractiveFilmReleaseSchema,
  type InteractiveFilmRelease,
} from '@repo/shared/interactive-film-runtime';
import {
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceRuntimeManifestSchema,
} from '@repo/shared/experience-runtime';
import {
  compileStoryExperienceManifest,
  STORY_CORE_THEME_CONFIG_ASSET_ID,
} from './story-experience-manifest-compiler';

const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const BUILD_ID = '0197f4a2-0800-7000-8000-000000000004';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000006';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000007';
const CHECKSUM = 'a'.repeat(64);

function release(): InteractiveFilmRelease {
  return InteractiveFilmReleaseSchema.parse({
    schemaVersion: 2,
    channel: 'production',
    gameId: PROJECT_ID,
    releaseId: BUILD_ID,
    contentVersion: BUILD_ID,
    entryNodeId: 'clip.start',
    defaultLocale: 'en-US',
    locales: ['en-US'],
    media: [
      {
        assetId: 'video:START',
        kind: 'video',
        orientationPolicy: 'single-master',
        variants: {
          landscape: {
            sourceAssetId: ASSET_ID,
            sha256: CHECKSUM,
            src: `/aurora/story-projects/${PROJECT_ID}/builds/${BUILD_ID}/assets/${ASSET_ID}/variants/${VARIANT_ID}/content`,
            width: 1920,
            height: 1080,
            durationSeconds: 7,
          },
        },
      },
    ],
    nodes: [
      {
        nodeId: 'clip.start',
        presentation: {
          kind: 'video',
          sequence: [
            {
              clipId: 'clip.start',
              assetId: 'video:START',
              endBehavior: { behavior: 'advance' },
            },
          ],
          fit: 'cover',
        },
        overlays: [],
        exit: {
          kind: 'choice',
          decisionId: 'decision.path',
          prompt: { 'en-US': 'Choose.' },
          choices: [
            {
              choiceId: 'choose.truth',
              label: { 'en-US': 'Truth' },
              target: { kind: 'node', nodeId: 'clip.truth' },
            },
            {
              choiceId: 'choose.echo',
              label: { 'en-US': 'Echo' },
              target: { kind: 'node', nodeId: 'clip.echo' },
            },
          ],
        },
      },
      {
        nodeId: 'clip.truth',
        presentation: {
          kind: 'video',
          sequence: [
            {
              clipId: 'clip.truth',
              assetId: 'video:START',
              endBehavior: { behavior: 'advance' },
            },
          ],
          fit: 'cover',
        },
        overlays: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
      {
        nodeId: 'clip.echo',
        presentation: {
          kind: 'video',
          sequence: [
            {
              clipId: 'clip.echo',
              assetId: 'video:START',
              endBehavior: { behavior: 'advance' },
            },
          ],
          fit: 'cover',
        },
        overlays: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
    ],
  });
}

function compile(value = release()) {
  return compileStoryExperienceManifest({
    release: value,
    experienceProfile: 'cinematic',
    metadata: { title: 'Story', summary: 'A branching story.' },
    mediaIdentities: [
      {
        runtimeAssetId: 'video:START',
        variantId: VARIANT_ID,
        mediaType: 'video/mp4',
      },
    ],
  });
}

describe('Story Runtime Manifest v2 compiler', () => {
  it('freezes shot subtitles and requires a host that supports timed captions', () => {
    const value = release();
    const first = value.nodes[0].presentation;
    if (first.kind !== 'video') throw new Error('Expected video fixture');
    first.sequence[0].subtitles = [
      {
        language: 'zh-HK',
        cues: [{ startMs: 500, endMs: 1800, text: 'Welcome' }],
      },
    ];
    const result = compile(value);
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest?.compatibility.requiredCapabilities).toContain(
      'core.video.subtitles',
    );
    const scene = result.manifest?.graph.nodes.find(
      (node) => node.sceneId === 'clip.start',
    );
    expect(
      scene?.kind === 'scene' && scene.renderers[0].config.sequence,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subtitles: first.sequence[0].subtitles }),
      ]),
    );
    expect(
      compile().manifest?.compatibility.requiredCapabilities,
    ).not.toContain('core.video.subtitles');
  });
  it('is deterministic and preserves raw UUID release identity', () => {
    const first = compile();
    const second = compile();

    expect(first.diagnostics).toEqual([]);
    expect(first.manifest).toEqual(second.manifest);
    expect(
      ExperienceRuntimeManifestSchema.safeParse(first.manifest).success,
    ).toBe(true);
    expect(first.manifest).toMatchObject({
      manifestType: 'fizzdragon.experience',
      schemaVersion: 2,
      channel: 'production',
      gameId: PROJECT_ID,
      buildId: BUILD_ID,
      contentVersion: BUILD_ID,
    });
  });

  it('freezes the exact media variant and core theme identities', () => {
    const result = compile();
    const video = result.manifest?.assets.find(
      (asset) => asset.assetId === 'video:START',
    );
    if (!video || video.kind !== 'video') {
      throw new Error('Compiled video asset is missing.');
    }

    expect(video.variants[0]).toMatchObject({
      sourceAssetId: ASSET_ID,
      sha256: CHECKSUM,
      mediaType: 'video/mp4',
    });
    expect(video.variants[0]?.variantId).toContain(VARIANT_ID);
    expect(result.manifest?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: STORY_CORE_THEME_CONFIG_ASSET_ID,
          kind: 'data',
        }),
      ]),
    );
  });

  it('lowers choice semantics to core renderers', () => {
    const result = compile();
    const rendererIds = result.manifest?.rendererRequirements.map(
      (requirement) => requirement.rendererId,
    );

    expect(rendererIds).toEqual(
      expect.arrayContaining([
        EXPERIENCE_CORE_VIDEO_RENDERER_ID,
        EXPERIENCE_CORE_CHOICE_RENDERER_ID,
      ]),
    );
    expect(
      result.manifest?.graph.nodes.some((node) =>
        node.eventBindings.some((binding) =>
          binding.routes.some((route) =>
            route.actions.some((action) => action.kind === 'scene.goto'),
          ),
        ),
      ),
    ).toBe(true);
  });

  it('passes timeline control and safe branch frames through to compiled gestures', () => {
    const value = release();
    value.nodes[0].interactions = [
      {
        kind: 'hotspot',
        timing: 'window',
        interactionId: 'charge',
        label: { 'en-US': 'Charge' },
        trigger: {
          kind: 'press-hold',
          durationMs: 1_000,
          controlTimeline: true,
        },
        rect: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
        startMs: 500,
        endMs: 2_000,
        branchAtMs: 2_200,
        outcomes: {
          success: {
            kind: 'goto',
            target: { kind: 'node', nodeId: 'clip.truth' },
          },
          failure: { kind: 'continue' },
        },
      },
      {
        kind: 'hotspot',
        timing: 'window',
        interactionId: 'dodge',
        label: { 'en-US': 'Dodge' },
        trigger: { kind: 'swipe', direction: 'right' },
        rect: { x: 0.7, y: 0.1, width: 0.2, height: 0.2 },
        startMs: 2_000,
        endMs: 3_000,
        outcomes: { success: { kind: 'continue' } },
      },
    ];

    const result = compile(value);
    const scene = result.manifest?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'clip.start',
    );
    if (!scene || scene.kind !== 'scene') {
      throw new Error(
        `Scene is missing: ${JSON.stringify(result.diagnostics)}`,
      );
    }
    expect(scene.gestures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'press-hold',
          durationMs: 1_000,
          timelineControl: true,
          activeWindow: { startMs: 500, endMs: 2_000 },
          branchAtMs: 2_200,
        }),
      ]),
    );
    const swipe = scene.gestures.find((gesture) => gesture.kind === 'swipe');
    expect(swipe).toBeDefined();
    expect(swipe && 'branchAtMs' in swipe).toBe(false);
  });

  it('pauses a hold hotspot at its start and drops the timeout route', () => {
    const value = release();
    value.nodes[0].interactions = [
      {
        kind: 'hotspot',
        interactionId: 'wait',
        label: { 'en-US': 'Wait' },
        trigger: { kind: 'tap' },
        rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        startMs: 1_000,
        endMs: 2_000,
        timing: 'hold',
        outcomes: {
          success: { kind: 'continue' },
          timeout: { kind: 'continue' },
        },
      },
    ];
    const result = compile(value);
    const scene = result.manifest?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'clip.start',
    );
    if (!scene || scene.kind !== 'scene') {
      throw new Error(
        `Scene is missing: ${JSON.stringify(result.diagnostics)}`,
      );
    }
    expect(scene.gestures[0]).toMatchObject({
      kind: 'tap',
      holdFrame: true,
      activeWindow: { startMs: 1_000, endMs: 2_000 },
    });
    expect(scene.gestures[0]).not.toHaveProperty('branchAtMs');
    expect(
      scene.eventBindings.some(
        (binding) => binding.on.type === 'gesture.timed-out',
      ),
    ).toBe(false);
  });

  it('lowers hotspot triggers and outcome routes without fake scene branches', () => {
    const value = release();
    value.nodes[0].interactions = [
      {
        kind: 'hotspot',
        timing: 'window',
        interactionId: 'continue',
        label: { 'en-US': 'Continue' },
        trigger: { kind: 'tap' },
        rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        startMs: 100,
        endMs: 1_000,
        outcomes: { success: { kind: 'continue' } },
      },
      {
        kind: 'hotspot',
        timing: 'window',
        interactionId: 'rewind',
        label: { 'en-US': 'Rewind' },
        trigger: {
          kind: 'press-hold',
          durationMs: 800,
          controlTimeline: false,
        },
        rect: { x: 0.4, y: 0.1, width: 0.2, height: 0.2 },
        startMs: 1_000,
        endMs: 2_000,
        outcomes: {
          success: { kind: 'seek', timeMs: 500 },
          failure: { kind: 'continue' },
        },
      },
      {
        kind: 'hotspot',
        timing: 'window',
        interactionId: 'branch',
        label: { 'en-US': 'Branch' },
        trigger: { kind: 'swipe', direction: 'right' },
        rect: { x: 0.7, y: 0.1, width: 0.2, height: 0.2 },
        startMs: 2_000,
        endMs: 3_000,
        outcomes: {
          success: {
            kind: 'goto',
            target: { kind: 'node', nodeId: 'clip.truth' },
          },
          timeout: { kind: 'seek', timeMs: 1_500 },
        },
      },
    ];

    const result = compile(value);
    const scene = result.manifest?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'clip.start',
    );
    if (!scene || scene.kind !== 'scene') {
      throw new Error(
        `Scene is missing: ${JSON.stringify(result.diagnostics)}`,
      );
    }
    expect(scene.anchors).toHaveLength(3);
    expect(scene.gestures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tap',
          activeWindow: { startMs: 100, endMs: 1_000 },
        }),
        expect.objectContaining({ kind: 'press-hold', durationMs: 800 }),
        expect.objectContaining({
          kind: 'swipe',
          directions: ['right'],
        }),
      ]),
    );
    expect(scene.eventBindings.map((binding) => binding.on.type)).toEqual(
      expect.arrayContaining([
        'gesture.completed',
        'gesture.cancelled',
        'gesture.timed-out',
      ]),
    );
    const actions = scene.eventBindings.flatMap((binding) =>
      binding.routes.flatMap((route) => route.actions),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'renderer.command',
          commandType: 'play',
        }),
        expect.objectContaining({
          kind: 'renderer.command',
          commandType: 'seek',
        }),
        expect.objectContaining({ kind: 'scene.goto', sceneId: 'clip.truth' }),
      ]),
    );
    const rewindSuccess = scene.eventBindings.find(
      (binding) =>
        binding.bindingId === 'binding:clip.start:interaction:rewind:success',
    );
    expect(rewindSuccess?.routes[0]?.actions).toEqual([
      expect.objectContaining({
        kind: 'renderer.command',
        commandType: 'seek',
      }),
      expect.objectContaining({
        kind: 'renderer.command',
        commandType: 'play',
      }),
    ]);
  });

  it('keeps a story with no cover free of any cover key', () => {
    const result = compile();

    expect(result.manifest?.metadata).not.toHaveProperty('coverAssetId');
    expect(
      result.manifest?.assets.some((asset) => asset.kind === 'image'),
    ).toBe(false);
  });

  it('fails when a runtime asset has no exact frozen variant identity', () => {
    const result = compileStoryExperienceManifest({
      release: release(),
      experienceProfile: 'cinematic',
      metadata: { title: 'Story', summary: null },
      mediaIdentities: [],
    });

    expect(result.manifest).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_EXPERIENCE_MEDIA_IDENTITY_MISSING',
        }),
      ]),
    );
  });

  it('emits session state, choice effects, visibleWhen, and named endings', () => {
    const value = release();
    value.stateVariables = [
      {
        key: 'favorability.lin',
        name: { 'en-US': 'Lin' },
        valueType: 'number',
        initialValue: 0,
      },
    ];
    value.endings = [
      {
        endingId: 'ending.together',
        title: { 'en-US': 'Together' },
        kind: 'success',
      },
    ];
    const start = value.nodes[0];
    if (!start || start.exit.kind !== 'choice') {
      throw new Error('Expected choice start');
    }
    start.exit.choices[0] = {
      ...start.exit.choices[0],
      effects: [{ kind: 'add', key: 'favorability.lin', amount: 20 }],
    };
    start.exit.choices[1] = {
      ...start.exit.choices[1],
      visibleWhen: {
        kind: 'compare',
        variableKey: 'favorability.lin',
        operator: 'at-least',
        value: 10,
      },
    };
    start.onEnterEffects = [{ kind: 'set', key: 'favorability.lin', value: 1 }];
    const echo = value.nodes[2];
    if (!echo || echo.exit.kind !== 'auto') {
      throw new Error('Expected auto echo');
    }
    echo.exit.routes = [
      { target: { kind: 'ending', endingId: 'ending.together' } },
    ];
    const result = compile(value);
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest?.stateDefinitions).toEqual([
      {
        key: 'favorability.lin',
        name: { 'en-US': 'Lin' },
        valueType: 'number',
        scope: 'session',
        initialValue: 0,
        sensitive: false,
      },
    ]);
    expect(result.manifest?.endings.map((ending) => ending.endingId)).toEqual(
      expect.arrayContaining(['ending.together', 'film.complete']),
    );
    const startNode = result.manifest?.graph.nodes.find(
      (node) => node.sceneId === 'clip.start',
    );
    const enter = startNode?.eventBindings.find(
      (binding) => binding.bindingId === 'binding:clip.start:enter',
    );
    expect(enter?.routes[0]?.actions[0]).toMatchObject({
      kind: 'state.set',
      path: 'favorability.lin',
    });
    const selected = startNode?.eventBindings.find(
      (binding) => binding.bindingId === 'binding:clip.start:choice-selected',
    );
    expect(selected?.routes[0]?.actions).toEqual([
      expect.objectContaining({
        kind: 'state.increment',
        path: 'favorability.lin',
      }),
      expect.objectContaining({
        kind: 'scene.goto',
        sceneId: 'clip.truth',
      }),
    ]);
    const echoNode = result.manifest?.graph.nodes.find(
      (node) => node.sceneId === 'clip.echo',
    );
    const echoEnded = echoNode?.eventBindings.find((binding) =>
      binding.routes.some((route) =>
        route.actions.some(
          (action) =>
            action.kind === 'ending.complete' &&
            action.endingId === 'ending.together',
        ),
      ),
    );
    expect(echoEnded).toBeDefined();
    const choiceRenderer =
      startNode?.kind === 'scene'
        ? startNode.renderers.find(
            (renderer) => renderer.instanceId === 'renderer:clip.start:choice',
          )
        : undefined;
    expect(choiceRenderer?.config).toMatchObject({
      choices: [
        expect.objectContaining({ choiceId: 'choose.truth' }),
        expect.objectContaining({
          choiceId: 'choose.echo',
          visibleWhen: {
            kind: 'compare',
            operator: 'at-least',
            left: { kind: 'state', path: 'favorability.lin' },
            right: { kind: 'literal', value: 10 },
          },
        }),
      ],
    });
  });
});

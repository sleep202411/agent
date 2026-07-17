import {
  canonicalizeExperienceJson,
  ExperienceGameDetailResponseSchema,
  ExperienceGameListResponseSchema,
  ExperiencePlayerEventBatchSchema,
  ExperienceReleaseRequestSchema,
  ExperienceReleaseResponseSchema,
  ExperienceRuntimeManifestSchema,
  parseExperienceRuntimeManifest,
  type ExperienceStateDefinition,
} from '@repo/shared/experience-runtime';
import {
  createExperienceManifestIntegrity,
  hashCanonicalExperienceManifest,
} from './experience-manifest-integrity';
import {
  createExperienceReleaseRequest,
  parseAndVerifyExperienceReleaseRequest,
} from './experience-release-request';

const HASH = 'a'.repeat(64);

const localized = (
  english: string,
  simplified: string,
  traditional = simplified,
) => ({
  'en-US': english,
  'zh-CN': simplified,
  'zh-HK': traditional,
});

function themeAsset() {
  return {
    assetId: 'theme.default.config',
    kind: 'data' as const,
    sourceAssetId: 'source.theme.default.config',
    sha256: HASH,
    uri: '/runtime-assets/theme.default.json',
    mediaType: 'application/json',
    format: 'json' as const,
  };
}

function textExperienceFixture() {
  return {
    manifestType: 'fizzdragon.experience' as const,
    schemaVersion: 2 as const,
    channel: 'preview' as const,
    gameId: 'experience.text.mystery',
    buildId: 'build.text.001',
    contentVersion: '2026.07.15.1',
    completionPolicy: 'finite' as const,
    metadata: {
      title: localized('The Last Letter', '最后一封信', '最後一封信'),
      summary: localized(
        'A text-first mystery.',
        '一段文字悬疑。',
        '一段文字懸疑。',
      ),
    },
    compatibility: {
      engineApiVersion: '2.0.0',
      experienceApiVersion: '1.0.0',
      semanticRulesVersion: 1 as const,
      requiredCapabilities: ['core.text'],
    },
    localization: {
      defaultLocale: 'en-US',
      locales: ['en-US', 'zh-CN', 'zh-HK'],
    },
    stateDefinitions: [],
    inputActions: [],
    rendererRequirements: [
      {
        rendererId: 'core.text',
        apiVersion: '1.0.0',
        configSchemaVersion: '1.0.0',
        requiredCapabilities: ['core.text'],
        outcomes: [],
        commands: [],
      },
    ],
    assets: [themeAsset()],
    theme: {
      themeId: 'theme.default',
      apiVersion: '1.0.0',
      configAssetId: 'theme.default.config',
    },
    telemetryDefinitions: [],
    endings: [
      {
        endingId: 'ending.complete',
        title: localized('Complete', '完成'),
        kind: 'success' as const,
      },
    ],
    graph: {
      entrySceneId: 'scene.page-one',
      nodes: [
        {
          kind: 'scene' as const,
          sceneId: 'scene.page-one',
          clock: { kind: 'none' as const },
          renderers: [
            {
              instanceId: 'text.page-one',
              rendererId: 'core.text',
              layer: 0,
              config: {
                body: localized(
                  'Read the letter.',
                  '阅读这封信。',
                  '閱讀這封信。',
                ),
              },
              bindings: {},
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: 'complete.on-enter',
              on: { type: 'scene.entered' },
              routes: [
                {
                  routeId: 'complete',
                  actions: [
                    { kind: 'ending.complete', endingId: 'ending.complete' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function holdToLightFixture() {
  return {
    manifestType: 'fizzdragon.experience' as const,
    schemaVersion: 2 as const,
    channel: 'production' as const,
    gameId: 'experience.lantern',
    buildId: 'build.lantern.001',
    contentVersion: '2026.07.15.1',
    completionPolicy: 'finite' as const,
    metadata: {
      title: localized('Light the Lantern', '点亮灯笼', '點亮燈籠'),
    },
    compatibility: {
      engineApiVersion: '2.0.0',
      experienceApiVersion: '1.0.0',
      semanticRulesVersion: 1 as const,
      requiredCapabilities: [
        'core.video',
        'input.press-hold',
        'audio.sfx',
        'audio.core',
        'audio.spatial',
        'spatial.anchor',
        'spatial.renderer-content',
        'renderer.content-transform',
      ],
    },
    localization: {
      defaultLocale: 'en-US',
      locales: ['en-US', 'zh-CN', 'zh-HK'],
    },
    stateDefinitions: [
      {
        key: 'world.lanternLit',
        valueType: 'boolean' as const,
        scope: 'session' as const,
        initialValue: false,
        sensitive: false,
      },
    ],
    inputActions: [
      {
        actionId: 'interact.primary',
        label: localized('Interact', '互动', '互動'),
        accessibilityDescription: localized(
          'Hold to charge the interaction.',
          '长按以完成蓄力。',
          '長按以完成蓄力。',
        ),
        required: true,
      },
    ],
    rendererRequirements: [
      {
        rendererId: 'core.video',
        apiVersion: '1.0.0',
        configSchemaVersion: '1.0.0',
        requiredCapabilities: ['core.video', 'renderer.content-transform'],
        outcomes: [{ outcomeType: 'media-ended' }],
        commands: [],
      },
      {
        rendererId: 'core.charge-feedback',
        apiVersion: '1.0.0',
        configSchemaVersion: '1.0.0',
        requiredCapabilities: ['input.press-hold'],
        outcomes: [],
        commands: [{ commandType: 'complete' }],
      },
    ],
    assets: [
      themeAsset(),
      {
        assetId: 'video.lantern',
        kind: 'video' as const,
        orientationPolicy: 'single-master' as const,
        audioMode: 'none' as const,
        variants: [
          {
            variantId: 'landscape',
            sourceAssetId: 'source.video.lantern',
            sha256: HASH,
            uri: '/runtime-assets/lantern.mp4',
            mediaType: 'video/mp4',
            orientation: 'landscape' as const,
            width: 1920,
            height: 1080,
            durationMs: 12_000,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: 'h264',
          },
        ],
      },
      {
        assetId: 'audio.lantern-ignite',
        kind: 'audio' as const,
        variants: [
          {
            variantId: 'default',
            sourceAssetId: 'source.audio.lantern-ignite',
            sha256: HASH,
            uri: '/runtime-assets/lantern-ignite.mp3',
            mediaType: 'audio/mpeg',
            durationMs: 900,
            channels: 2,
          },
        ],
      },
    ],
    theme: {
      themeId: 'theme.default',
      apiVersion: '1.0.0',
      configAssetId: 'theme.default.config',
    },
    audio: {
      buses: [
        {
          busId: 'audio.master',
          role: 'master' as const,
          defaultGain: 1,
          defaultMuted: false,
        },
        {
          busId: 'audio.sfx',
          role: 'sfx' as const,
          parentBusId: 'audio.master',
          defaultGain: 1,
          defaultMuted: false,
        },
      ],
      cues: [
        {
          cueId: 'lantern.ignite',
          busId: 'audio.sfx',
          assetIds: ['audio.lantern-ignite'],
          selection: 'single' as const,
          loop: false,
          gain: 1,
          playbackRate: { minimum: 1, maximum: 1 },
          fadeInMs: 0,
          fadeOutMs: 120,
          spatialAnchorId: 'anchor.lantern',
        },
      ],
      snapshots: [],
      duckingRules: [],
    },
    telemetryDefinitions: [
      {
        eventName: 'interaction.lantern-lit',
        fields: [
          {
            field: 'holdDurationMs',
            valueType: 'duration-ms' as const,
            required: true,
            classification: 'analytics' as const,
          },
        ],
      },
    ],
    endings: [
      {
        endingId: 'ending.lantern-lit',
        title: localized('The lantern is lit', '灯笼亮了', '燈籠亮了'),
        kind: 'success' as const,
      },
    ],
    graph: {
      entrySceneId: 'scene.lantern',
      nodes: [
        {
          kind: 'scene' as const,
          sceneId: 'scene.lantern',
          clock: {
            kind: 'renderer' as const,
            rendererInstanceId: 'video.lantern',
          },
          renderers: [
            {
              instanceId: 'video.lantern',
              rendererId: 'core.video',
              layer: 0,
              config: { assetId: 'video.lantern', fit: 'cover' },
              bindings: {},
            },
            {
              instanceId: 'feedback.lantern-charge',
              rendererId: 'core.charge-feedback',
              layer: 10,
              config: { appearance: 'ring' },
              bindings: {},
              anchorId: 'anchor.lantern',
            },
          ],
          anchors: [
            {
              anchorId: 'anchor.lantern',
              space: {
                kind: 'renderer-content' as const,
                rendererInstanceId: 'video.lantern',
              },
              geometry: {
                default: {
                  kind: 'ellipse' as const,
                  bounds: { x: 0.67, y: 0.3, width: 0.12, height: 0.18 },
                },
              },
              motion: { kind: 'fixed' as const },
            },
          ],
          gestures: [
            {
              gestureId: 'gesture.light-lantern',
              anchorId: 'anchor.lantern',
              inputActionId: 'interact.primary',
              feedbackRendererInstanceId: 'feedback.lantern-charge',
              kind: 'press-hold' as const,
              durationMs: 1_600,
              releaseBehavior: 'decay' as const,
              decayPerSecond: 1,
              cancelOnPointerExit: true,
              activeWindow: { startMs: 4_200, endMs: 9_000 },
            },
          ],
          timeline: {
            cues: [{ cueId: 'lantern.available', atMs: 4_200, once: true }],
          },
          eventBindings: [
            {
              bindingId: 'lantern.on-completed',
              on: {
                type: 'gesture.completed',
                sourceId: 'gesture.light-lantern',
              },
              routes: [
                {
                  routeId: 'lantern.complete',
                  actions: [
                    {
                      kind: 'state.set',
                      path: 'world.lanternLit',
                      value: { kind: 'literal', value: true },
                    },
                    { kind: 'audio.play', cueId: 'lantern.ignite' },
                    {
                      kind: 'renderer.command',
                      instanceId: 'feedback.lantern-charge',
                      commandType: 'complete',
                      payload: {},
                    },
                    {
                      kind: 'telemetry.emit',
                      eventName: 'interaction.lantern-lit',
                      payload: {
                        holdDurationMs: {
                          kind: 'event',
                          path: 'holdDurationMs',
                        },
                      },
                    },
                    { kind: 'ending.complete', endingId: 'ending.lantern-lit' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('Experience Runtime Manifest v2', () => {
  it('supports a text-only finite experience without video or audio', () => {
    const parsed = parseExperienceRuntimeManifest(textExperienceFixture());

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.audio).toBeUndefined();
    expect(parsed.graph.nodes[0]?.kind).toBe('scene');
  });

  it('models a media-anchored press-and-hold interaction with audio and telemetry', () => {
    const parsed = parseExperienceRuntimeManifest(holdToLightFixture());
    const node = parsed.graph.nodes[0];

    expect(node?.kind).toBe('scene');
    if (node?.kind !== 'scene') throw new Error('Expected a scene');
    expect(node.gestures[0]?.kind).toBe('press-hold');
    expect(node.anchors[0]?.space).toEqual({
      kind: 'renderer-content',
      rendererInstanceId: 'video.lantern',
    });
    expect(parsed.audio?.cues[0]?.spatialAnchorId).toBe('anchor.lantern');
  });

  it('rejects hit geometry that extends beyond its authored media space', () => {
    const fixture = holdToLightFixture();
    const node = fixture.graph.nodes[0];
    const anchor = node.anchors[0];
    if (anchor?.geometry.default?.kind !== 'ellipse')
      throw new Error('Expected ellipse');
    anchor.geometry.default.bounds.x = 0.95;

    const parsed = ExperienceRuntimeManifestSchema.safeParse(fixture);
    expect(parsed.success).toBe(false);
  });

  it('rejects state actions that target undeclared paths', () => {
    const fixture = holdToLightFixture();
    const node = fixture.graph.nodes[0];
    const action = node.eventBindings[0]?.routes[0]?.actions[0];
    if (action?.kind !== 'state.set') throw new Error('Expected state.set');
    action.path = 'world.unknown';

    const parsed = ExperienceRuntimeManifestSchema.safeParse(fixture);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.message.includes('world.unknown'),
        ),
      ).toBe(true);
    }
  });

  it('rejects mixed-session or duplicate telemetry events in one Java batch', () => {
    const event = {
      protocolVersion: 1 as const,
      eventId: 'event.1',
      sequence: 1,
      eventType: 'interaction.completed',
      occurredAt: '2026-07-15T12:00:00.000Z',
      gameId: 'experience.lantern',
      manifestHash: HASH,
      buildId: 'build.lantern.001',
      contentVersion: '2026.07.15.1',
      sessionId: 'session.1',
      sceneId: 'scene.lantern',
      sourceId: 'gesture.light-lantern',
      platform: 'web' as const,
      payload: { holdDurationMs: 1_650 },
    };

    const parsed = ExperiencePlayerEventBatchSchema.safeParse({
      protocolVersion: 1,
      events: [event, { ...event, eventId: 'event.2', sessionId: 'session.2' }],
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects overlapping wildcard and concrete event selectors', () => {
    const fixture = textExperienceFixture();
    const node = fixture.graph.nodes[0];
    node.eventBindings.push({
      bindingId: 'complete.specific',
      on: { type: 'scene.entered', sourceId: 'scene.page-one' },
      routes: [
        {
          routeId: 'complete.specific',
          actions: [{ kind: 'ending.complete', endingId: 'ending.complete' }],
        },
      ],
    });

    const parsed = ExperienceRuntimeManifestSchema.safeParse(fixture);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.message.includes('overlaps binding'),
        ),
      ).toBe(true);
    }
  });

  it('rejects state paths that could mutate object prototypes', () => {
    const fixture = holdToLightFixture();
    fixture.stateDefinitions[0].key = 'world.__proto__.polluted';
    expect(ExperienceRuntimeManifestSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it('rejects state-definition prefix overlap regardless of declaration order', () => {
    const fixture = holdToLightFixture();
    (fixture.stateDefinitions as ExperienceStateDefinition[]).push(
      {
        key: 'world.profile.name',
        valueType: 'string',
        scope: 'session',
        initialValue: '',
        sensitive: false,
      },
      {
        key: 'world.profile',
        valueType: 'json',
        scope: 'player',
        initialValue: {},
        sensitive: false,
      },
    );
    const parsed = ExperienceRuntimeManifestSchema.safeParse(fixture);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.message.includes('overlaps JSON root world.profile'),
        ),
      ).toBe(true);
    }
  });

  it('rejects a literal array assigned to an object state root', () => {
    const fixture = holdToLightFixture();
    (fixture.stateDefinitions as ExperienceStateDefinition[]).push({
      key: 'world.profile',
      valueType: 'json',
      scope: 'player',
      initialValue: {},
      sensitive: false,
    });
    const action = fixture.graph.nodes[0].eventBindings[0].routes[0].actions[0];
    if (action.kind !== 'state.set') throw new Error('Expected state.set');
    action.path = 'world.profile';
    action.value = { kind: 'literal', value: [] };
    const parsed = ExperienceRuntimeManifestSchema.safeParse(fixture);
    expect(parsed.success).toBe(false);
  });

  it('rejects keyframes whose orientation fallback changes geometry kind', () => {
    const fixture = holdToLightFixture();
    const anchor = fixture.graph.nodes[0].anchors[0];
    anchor.motion = {
      kind: 'keyframes',
      keyframes: [
        {
          atMs: 0,
          geometry: {
            default: {
              kind: 'rect',
              rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
            },
          },
          easing: 'linear',
        },
        {
          atMs: 1_000,
          geometry: {
            landscape: {
              kind: 'ellipse',
              bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
            },
            portrait: {
              kind: 'ellipse',
              bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
            },
            square: {
              kind: 'ellipse',
              bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
            },
          },
          easing: 'linear',
        },
      ],
    };
    fixture.compatibility.requiredCapabilities.push('spatial.keyframes');
    expect(ExperienceRuntimeManifestSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it('rejects a press-hold that cannot finish inside its active window', () => {
    const fixture = holdToLightFixture();
    const gesture = fixture.graph.nodes[0].gestures[0];
    if (gesture.kind !== 'press-hold') throw new Error('Expected press-hold');
    gesture.durationMs = 6_000;
    expect(ExperienceRuntimeManifestSchema.safeParse(fixture).success).toBe(
      false,
    );
  });

  it('materializes and verifies the exact Java release request body', () => {
    const request = createExperienceReleaseRequest(
      {
        gameId: 'experience.lantern',
        contentVersion: '2026.07.15.1',
        title: 'Light the Lantern',
        subtitle: 'Interaction acceptance experience',
        coverUrl: 'https://media.example.com/lantern/cover.jpg',
        status: 'published',
        setCurrent: true,
      },
      holdToLightFixture(),
    );
    expect(parseAndVerifyExperienceReleaseRequest(request)).toEqual(request);
    expect(request).not.toHaveProperty('integrity');
    expect(request).not.toHaveProperty('publicationId');

    const tampered = structuredClone(request);
    tampered.manifest.contentVersion = '2026.07.15.2';
    expect(() => parseAndVerifyExperienceReleaseRequest(tampered)).toThrow(
      'does not match manifest contentVersion',
    );

    const incomplete = structuredClone(request);
    if (!incomplete.manifest.audio?.cues[0])
      throw new Error('Expected audio cue');
    delete (incomplete.manifest.audio.cues[0] as { loop?: boolean }).loop;
    expect(() => parseAndVerifyExperienceReleaseRequest(incomplete)).toThrow(
      'fully materialized',
    );

    const reorderedManifest = Object.fromEntries(
      Object.entries(request.manifest).reverse(),
    );
    expect(createExperienceManifestIntegrity(reorderedManifest)).toEqual(
      createExperienceManifestIntegrity(request.manifest),
    );
  });

  it('keeps the Java release transport opaque while validating publisher output', () => {
    const opaqueTransport = {
      gameId: 'future.game',
      contentVersion: 'v1',
      manifest: { futureManifestDialect: true },
      status: 'draft',
    };
    const parsed = ExperienceReleaseRequestSchema.parse(opaqueTransport);
    expect(parsed.setCurrent).toBeUndefined();
    expect(parsed.manifest).toEqual({ futureManifestDialect: true });
    expect(() =>
      parseAndVerifyExperienceReleaseRequest(opaqueTransport),
    ).toThrow();
  });

  it('validates the agreed Java release and discovery responses', () => {
    expect(
      ExperienceReleaseResponseSchema.parse({
        gameId: 'branching-film',
        contentVersion: 'v2',
        status: 'published',
        manifestUrl:
          'https://media.example.com/interactive-film/branching-film/v2/manifest.json',
      }),
    ).toMatchObject({ gameId: 'branching-film', contentVersion: 'v2' });

    expect(
      ExperienceGameListResponseSchema.parse([
        {
          gameId: 'branching-film',
          title: 'Branching Film Test',
          subtitle: '第一季 · 无字来客',
          coverUrl: 'https://media.example.com/branching-film/cover.jpg',
          currentVersion: 'v2',
          updatedAt: '2026-07-16T12:00:00.000Z',
        },
      ]),
    ).toHaveLength(1);

    expect(
      ExperienceGameDetailResponseSchema.parse({
        gameId: 'branching-film',
        title: 'Branching Film Test',
        coverUrl: 'https://media.example.com/branching-film/cover.jpg',
        currentVersion: 'v2',
        manifestUrl:
          'https://media.example.com/interactive-film/branching-film/v2/manifest.json',
      }),
    ).toMatchObject({ currentVersion: 'v2' });
  });

  it('rejects invalid Unicode before RFC 8785 manifest hashing', () => {
    expect(() => canonicalizeExperienceJson('\ud800')).toThrow(
      'unpaired high surrogate',
    );
  });

  it('matches the shared RFC 8785 number and Unicode hash vector', () => {
    const canonical = canonicalizeExperienceJson({
      numbers: [333333333.3333333, 1e30, 4.5, 0.002, 1e-27],
      string: `€$\u000f\nA'B"\\"/`,
    });
    expect(canonical).toBe(
      `{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA'B\\"\\\\\\"/"}`,
    );
    expect(hashCanonicalExperienceManifest(canonical)).toBe(
      '403d784f350bb2be03115e785fb01dd696a0957b9fbf8c5b98519dc16b6536d9',
    );
  });
});

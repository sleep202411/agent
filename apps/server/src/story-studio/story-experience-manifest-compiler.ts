import {
  type InteractiveFilmRelease,
  type InteractiveFilmRuntimeNode,
  type RuntimeMediaAsset,
} from '@repo/shared/interactive-film-runtime';
import {
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_RENDERER_API_VERSION,
  EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_STILL_CAPABILITY,
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID,
  EXPERIENCE_GESTURE_CAPABILITY,
  ExperienceRuntimeManifestSchema,
  type ExperienceCoreChoiceRendererConfig,
  type ExperienceCoreRendererId,
  type ExperienceCoreVideoRendererConfig,
  type ExperienceCoreWorldModelRendererConfig,
  type ExperienceCondition,
  type ExperienceEventBinding,
  type ExperienceGraphNode,
  type ExperienceRendererInstance,
  type ExperienceRendererRequirement,
  type ExperienceRuntimeAction,
  type ExperienceRuntimeAsset,
  type ExperienceRuntimeManifest,
  type ExperienceScene,
} from '@repo/shared/experience-runtime';

export const STORY_CORE_THEME_CONFIG_ASSET_ID =
  'theme:core.film-dark:1' as const;
export const STORY_EXPERIENCE_COMPLETION_ID = 'film.complete' as const;

const STORY_CORE_THEME_CONFIG_URI =
  '/experience-runtime/themes/core.film-dark.v1.json';
const STORY_CORE_THEME_CONFIG_SHA256 =
  'c5fd632a6dcba38e80c84a1bc771c37e791af6bca73421a9c357f859610e6272';

export interface StoryExperienceMediaIdentity {
  runtimeAssetId: string;
  variantId: string;
  mediaType: string;
}

export interface StoryExperienceManifestCompilerInput {
  release: InteractiveFilmRelease;
  experienceProfile: 'cinematic';
  metadata: {
    title: string;
    summary?: string | null;
  };
  mediaIdentities: readonly StoryExperienceMediaIdentity[];
}

export interface StoryExperienceManifestDiagnostic {
  code:
    | 'STORY_EXPERIENCE_MEDIA_IDENTITY_MISSING'
    | 'STORY_EXPERIENCE_MEDIA_UNSUPPORTED'
    | 'STORY_EXPERIENCE_OVERLAY_UNSUPPORTED'
    | 'STORY_EXPERIENCE_PRESENTATION_UNSUPPORTED'
    | 'STORY_EXPERIENCE_MANIFEST_SCHEMA_INVALID';
  message: string;
  path: PropertyKey[];
}

export interface StoryExperienceManifestCompilerResult {
  manifest: ExperienceRuntimeManifest | null;
  diagnostics: StoryExperienceManifestDiagnostic[];
}

interface NodeCompilationContext {
  experienceProfile: 'cinematic';
  projectId: string;
  usedRendererIds: Set<ExperienceCoreRendererId>;
  syntheticScenes: ExperienceScene[];
  diagnostics: StoryExperienceManifestDiagnostic[];
}

type RuntimeInteraction = InteractiveFilmRuntimeNode['interactions'][number];
type RuntimeInteractionOutcomeName = keyof RuntimeInteraction['outcomes'];
type RuntimeInteractionAction = RuntimeInteraction['outcomes']['success'];

/**
 * Lowers the already validated unified Story Build product into the single
 * cross-platform Runtime Manifest v2 contract. This layer is deterministic,
 * has no database access, and never invents missing media identities.
 */
export function compileStoryExperienceManifest(
  input: StoryExperienceManifestCompilerInput,
): StoryExperienceManifestCompilerResult {
  const diagnostics: StoryExperienceManifestDiagnostic[] = [];
  const identityByRuntimeAssetId = new Map(
    input.mediaIdentities.map((identity) => [
      identity.runtimeAssetId,
      identity,
    ]),
  );
  const assets = input.release.media.flatMap((asset, index) => {
    const compiled = compileRuntimeAsset(
      asset,
      identityByRuntimeAssetId,
      diagnostics,
      ['media', index],
    );
    return compiled ? [compiled] : [];
  });
  assets.push(coreThemeConfigAsset());

  const usedRendererIds = new Set<ExperienceCoreRendererId>();
  const syntheticScenes: ExperienceScene[] = [];
  const context: NodeCompilationContext = {
    experienceProfile: input.experienceProfile,
    projectId: input.release.gameId,
    usedRendererIds,
    syntheticScenes,
    diagnostics,
  };
  const graphNodes: ExperienceGraphNode[] = input.release.nodes.flatMap(
    (node, index) => {
      const compiled = compileGraphNode(node, context, ['nodes', index]);
      return compiled ? [compiled] : [];
    },
  );
  graphNodes.push(...syntheticScenes);
  const hasSpatialInteractions = input.release.nodes.some(
    (node) => node.interactions.length > 0,
  );
  // A sequence that plays stills needs a host that can render one. Declaring
  // it only when a still is actually present keeps video-only experiences
  // playable on hosts that predate stills, and makes a host that cannot render
  // one refuse by name instead of showing an empty frame.
  const stillAssetIds = new Set(
    assets
      .filter((asset) =>
        asset.kind === 'video'
          ? asset.variants.some((variant) =>
              variant.mediaType.toLowerCase().startsWith('image/'),
            )
          : false,
      )
      .map((asset) => asset.assetId),
  );
  const hasStillSegments = input.release.nodes.some(
    (node) =>
      node.presentation.kind === 'video' &&
      node.presentation.sequence.some((clip) =>
        stillAssetIds.has(clip.assetId),
      ),
  );
  const interactionCapabilities = new Set(
    input.release.nodes.flatMap((node) =>
      node.interactions.map(
        (interaction) =>
          EXPERIENCE_GESTURE_CAPABILITY[interaction.trigger.kind],
      ),
    ),
  );
  const hasTerminalScene = input.release.nodes.some(
    (node) => node.exit.kind === 'auto' && node.exit.nextNodeId === null,
  );

  if (diagnostics.length > 0) return { manifest: null, diagnostics };

  const candidate = {
    manifestType: 'fizzdragon.experience',
    schemaVersion: 2,
    channel: input.release.channel,
    gameId: input.release.gameId,
    buildId: input.release.releaseId,
    // Build compilation owns the release identity. Preserve the exact raw
    // UUID here so local persistence, Java authority queries, and the runtime
    // manifest all compare the same value without hidden normalization.
    contentVersion: input.release.contentVersion,
    completionPolicy: hasTerminalScene ? 'finite' : 'open-ended',
    metadata: {
      title: localizeScalar(input.metadata.title, input.release.locales),
      experienceProfile: input.experienceProfile,
      ...(input.metadata.summary?.trim()
        ? {
            summary: localizeScalar(
              input.metadata.summary.trim(),
              input.release.locales,
            ),
          }
        : {}),
    },
    compatibility: {
      engineApiVersion: '2.0.0',
      experienceApiVersion: '1.0.0',
      semanticRulesVersion: 1,
      requiredCapabilities: [
        ...usedRendererIds,
        ...(hasStillSegments ? [EXPERIENCE_CORE_VIDEO_STILL_CAPABILITY] : []),
        ...(hasSpatialInteractions
          ? [
              'spatial.anchor',
              'spatial.renderer-content',
              'renderer.content-transform',
            ]
          : []),
        ...interactionCapabilities,
      ].sort(),
    },
    localization: {
      defaultLocale: input.release.defaultLocale,
      locales: input.release.locales,
    },
    stateDefinitions: [],
    inputActions: input.release.nodes.flatMap((node) =>
      node.interactions.map((interaction) => ({
        actionId: interactionInputActionId(
          node.nodeId,
          interaction.interactionId,
        ),
        label: interaction.label,
        required: true,
      })),
    ),
    rendererRequirements: compileRendererRequirements(
      usedRendererIds,
      hasSpatialInteractions,
    ),
    assets,
    theme: {
      themeId: 'core.film-dark',
      apiVersion: '1.0.0',
      configAssetId: STORY_CORE_THEME_CONFIG_ASSET_ID,
    },
    telemetryDefinitions: [],
    // Closed films use one technical completion marker. Retry loops and other
    // deliberately open-ended films declare no synthetic ending; their exit is
    // owned by a later interaction or the player chrome.
    endings: hasTerminalScene
      ? [
          {
            endingId: STORY_EXPERIENCE_COMPLETION_ID,
            title: localizeScalar(input.metadata.title, input.release.locales),
            kind: 'custom' as const,
          },
        ]
      : [],
    graph: {
      entrySceneId: input.release.entryNodeId,
      nodes: graphNodes,
    },
  };

  const parsed = ExperienceRuntimeManifestSchema.safeParse(candidate);
  if (parsed.success) return { manifest: parsed.data, diagnostics: [] };
  return {
    manifest: null,
    diagnostics: parsed.error.issues.map((issue) => ({
      code: 'STORY_EXPERIENCE_MANIFEST_SCHEMA_INVALID' as const,
      message: `${issue.path.join('.') || 'manifest'}: ${issue.message}`,
      path: issue.path,
    })),
  };
}

function compileRuntimeAsset(
  asset: RuntimeMediaAsset,
  identities: ReadonlyMap<string, StoryExperienceMediaIdentity>,
  diagnostics: StoryExperienceManifestDiagnostic[],
  path: PropertyKey[],
): ExperienceRuntimeAsset | null {
  if (asset.kind === 'data') {
    return {
      assetId: asset.assetId,
      kind: 'data',
      sourceAssetId: asset.sourceAssetId,
      sha256: asset.sha256,
      uri: asset.src,
      mediaType:
        asset.format === 'json'
          ? 'application/json'
          : asset.format === 'vtt'
            ? 'text/vtt'
            : 'image/svg+xml',
      format: asset.format,
    };
  }
  const identity = identities.get(asset.assetId);
  if (!identity) {
    diagnostics.push({
      code: 'STORY_EXPERIENCE_MEDIA_IDENTITY_MISSING',
      message: `Runtime media ${asset.assetId} has no frozen variant identity.`,
      path: [...path, 'assetId'],
    });
    return null;
  }
  if (asset.kind === 'image') {
    const variants = Object.entries(asset.variants).flatMap(
      ([orientation, variant]) =>
        variant
          ? [
              {
                variantId: visualVariantId(asset, identity, orientation),
                sourceAssetId: variant.sourceAssetId,
                sha256: variant.sha256,
                uri: variant.src,
                mediaType: identity.mediaType,
                orientation: orientation as 'landscape' | 'portrait',
                width: variant.width,
                height: variant.height,
              },
            ]
          : [],
    );
    if (variants.length === 0) {
      diagnostics.push({
        code: 'STORY_EXPERIENCE_MEDIA_UNSUPPORTED',
        message: `Runtime media ${asset.assetId} has no visual variant.`,
        path: [...path, 'variants'],
      });
      return null;
    }
    return {
      assetId: asset.assetId,
      kind: 'image',
      orientationPolicy: asset.orientationPolicy,
      variants,
    };
  }
  const variants = Object.entries(asset.variants).flatMap(
    ([orientation, variant]) =>
      variant
        ? [
            {
              variantId: visualVariantId(asset, identity, orientation),
              sourceAssetId: variant.sourceAssetId,
              uri: variant.src,
              mediaType: identity.mediaType,
              orientation: orientation as 'landscape' | 'portrait',
              ...(variant.sha256 ? { sha256: variant.sha256 } : {}),
              ...(variant.width ? { width: variant.width } : {}),
              ...(variant.height ? { height: variant.height } : {}),
              ...(variant.durationSeconds
                ? {
                    durationMs: Math.round(variant.durationSeconds * 1_000),
                  }
                : {}),
              ...(variant.framesPerSecond
                ? { framesPerSecond: variant.framesPerSecond }
                : {}),
              ...(variant.codec ? { codec: variant.codec } : {}),
            },
          ]
        : [],
  );
  if (variants.length === 0) {
    diagnostics.push({
      code: 'STORY_EXPERIENCE_MEDIA_UNSUPPORTED',
      message: `Runtime media ${asset.assetId} has no visual variant.`,
      path: [...path, 'variants'],
    });
    return null;
  }
  // No `audioMode`: the manifest schema still tolerates the key so already
  // published films keep parsing, but nothing emits or reads it any more.
  return {
    assetId: asset.assetId,
    kind: 'video',
    orientationPolicy: asset.orientationPolicy,
    variants,
  };
}

function visualVariantId(
  asset: Extract<RuntimeMediaAsset, { kind: 'image' | 'video' }>,
  identity: StoryExperienceMediaIdentity,
  orientation: string,
): string {
  return Object.values(asset.variants).filter(Boolean).length === 1
    ? identity.variantId
    : `${identity.variantId}:${orientation}`;
}

function coreThemeConfigAsset(): ExperienceRuntimeAsset {
  return {
    assetId: STORY_CORE_THEME_CONFIG_ASSET_ID,
    kind: 'data',
    sourceAssetId: 'builtin:theme:core.film-dark:1',
    sha256: STORY_CORE_THEME_CONFIG_SHA256,
    uri: STORY_CORE_THEME_CONFIG_URI,
    mediaType: 'application/json',
    format: 'json',
  };
}

function compileGraphNode(
  node: InteractiveFilmRuntimeNode,
  context: NodeCompilationContext,
  path: PropertyKey[],
): ExperienceGraphNode | null {
  if (node.overlays.length > 0) {
    context.diagnostics.push({
      code: 'STORY_EXPERIENCE_OVERLAY_UNSUPPORTED',
      message: `Scene ${node.nodeId} still contains legacy overlays that have no Runtime Manifest v2 renderer.`,
      path: [...path, 'overlays'],
    });
    return null;
  }
  if (node.presentation.kind === 'decision') {
    const renderers: ExperienceRendererInstance[] = [];
    const eventBindings: ExperienceEventBinding[] = [];
    if (node.exit.kind === 'choice') {
      compileChoiceExit(node, '', '', renderers, eventBindings, context, true);
    } else {
      eventBindings.push({
        bindingId: `binding:${node.nodeId}:enter`,
        on: { type: 'scene.entered' },
        routes: [
          {
            routeId: `route:${node.nodeId}:auto`,
            actions: node.exit.nextNodeId
              ? [{ kind: 'scene.goto', sceneId: node.exit.nextNodeId }]
              : [
                  {
                    kind: 'ending.complete',
                    endingId: STORY_EXPERIENCE_COMPLETION_ID,
                  },
                ],
          },
        ],
      });
    }
    return {
      kind: 'scene',
      sceneId: node.nodeId,
      clock: { kind: 'none' },
      renderers,
      eventBindings,
      anchors: [],
      gestures: [],
      timeline: { cues: [] },
    };
  }
  if (node.presentation.kind === 'world') {
    return compileWorldGraphNode(node, context);
  }
  if (node.presentation.kind !== 'video') {
    context.diagnostics.push({
      code: 'STORY_EXPERIENCE_PRESENTATION_UNSUPPORTED',
      message: `Scene ${node.nodeId} uses unsupported ${node.presentation.kind} presentation.`,
      path: [...path, 'presentation'],
    });
    return null;
  }

  const primaryRendererId = EXPERIENCE_CORE_VIDEO_RENDERER_ID;
  const primaryInstanceId = `renderer:${node.nodeId}:video`;
  const primaryOutcomeType = 'media-ended';
  context.usedRendererIds.add(primaryRendererId);
  const primaryRenderer: ExperienceRendererInstance = {
    instanceId: primaryInstanceId,
    rendererId: EXPERIENCE_CORE_VIDEO_RENDERER_ID,
    layer: 0,
    config: {
      fit: node.presentation.fit,
      sequence: node.presentation.sequence,
      ...(node.presentation.posterAssetId
        ? { posterAssetId: node.presentation.posterAssetId }
        : {}),
      autoplay: true,
    } satisfies ExperienceCoreVideoRendererConfig,
    bindings: {},
  };
  const renderers: ExperienceRendererInstance[] = [primaryRenderer];
  const eventBindings: ExperienceEventBinding[] = [];
  const anchors: ExperienceScene['anchors'] = node.interactions.map(
    (interaction) => ({
      anchorId: interactionAnchorId(node.nodeId, interaction.interactionId),
      space: {
        kind: 'renderer-content',
        rendererInstanceId: primaryInstanceId,
      },
      geometry: { default: { kind: 'rect', rect: interaction.rect } },
      motion: { kind: 'fixed' },
    }),
  );
  const gestures: ExperienceScene['gestures'] = node.interactions.map(
    (interaction) => compileInteractionGesture(node.nodeId, interaction),
  );
  node.interactions.forEach((interaction) => {
    const gestureId = interactionGestureId(
      node.nodeId,
      interaction.interactionId,
    );
    interactionOutcomeEntries(interaction.outcomes).forEach(
      ([outcome, action]) => {
        eventBindings.push({
          bindingId: `binding:${node.nodeId}:interaction:${interaction.interactionId}:${outcome}`,
          on: {
            type: interactionOutcomeEventType(outcome),
            sourceId: gestureId,
          },
          routes: [
            {
              routeId: `route:${node.nodeId}:interaction:${interaction.interactionId}:${outcome}`,
              actions: compileInteractionAction(action, primaryInstanceId),
            },
          ],
        });
      },
    );
  });

  if (node.exit.kind === 'auto') {
    const actions: ExperienceRuntimeAction[] =
      node.exit.nextNodeId === null
        ? [
            {
              kind: 'ending.complete',
              endingId: STORY_EXPERIENCE_COMPLETION_ID,
            },
          ]
        : [{ kind: 'scene.goto', sceneId: node.exit.nextNodeId }];
    eventBindings.push(
      rendererOutcomeBinding(
        node.nodeId,
        primaryInstanceId,
        primaryOutcomeType,
        [
          {
            routeId: `route:${node.nodeId}:auto`,
            actions,
          },
        ],
      ),
    );
  } else {
    compileChoiceExit(
      node,
      primaryInstanceId,
      primaryOutcomeType,
      renderers,
      eventBindings,
      context,
    );
  }

  return {
    kind: 'scene',
    sceneId: node.nodeId,
    clock: { kind: 'renderer', rendererInstanceId: primaryInstanceId },
    renderers,
    anchors,
    gestures,
    timeline: { cues: [] },
    eventBindings,
  };
}

function compileWorldGraphNode(
  node: InteractiveFilmRuntimeNode,
  context: NodeCompilationContext,
): ExperienceGraphNode {
  if (node.presentation.kind !== 'world' || node.exit.kind !== 'auto') {
    throw new Error(
      'World runtime nodes require a world presentation and automatic exit.',
    );
  }
  const rendererId = EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID;
  const instanceId = `renderer:${node.nodeId}:world`;
  context.usedRendererIds.add(rendererId);
  const actions: ExperienceRuntimeAction[] =
    node.exit.nextNodeId === null
      ? [{ kind: 'ending.complete', endingId: STORY_EXPERIENCE_COMPLETION_ID }]
      : [{ kind: 'scene.goto', sceneId: node.exit.nextNodeId }];
  return {
    kind: 'scene',
    sceneId: node.nodeId,
    clock: { kind: 'renderer', rendererInstanceId: instanceId },
    renderers: [
      {
        instanceId,
        rendererId,
        layer: 0,
        config: {
          projectId: context.projectId,
          worldId: node.presentation.worldId,
          ...(node.presentation.entryInstruction
            ? { entryInstruction: node.presentation.entryInstruction }
            : {}),
          maxExperienceSeconds: node.presentation.maxExperienceSeconds,
          autoplay: true,
        } satisfies ExperienceCoreWorldModelRendererConfig,
        bindings: {},
      },
    ],
    anchors: [],
    gestures: [],
    timeline: { cues: [] },
    eventBindings: [
      rendererOutcomeBinding(node.nodeId, instanceId, 'world-completed', [
        { routeId: `route:${node.nodeId}:auto`, actions },
      ]),
    ],
  };
}

function interactionAnchorId(nodeId: string, interactionId: string): string {
  return `anchor:${nodeId}:${interactionId}`;
}

function interactionGestureId(nodeId: string, interactionId: string): string {
  return `gesture:${nodeId}:${interactionId}`;
}

function interactionInputActionId(
  nodeId: string,
  interactionId: string,
): string {
  return `input:${nodeId}:${interactionId}`;
}

function compileInteractionGesture(
  nodeId: string,
  interaction: RuntimeInteraction,
): ExperienceScene['gestures'][number] {
  const common = {
    gestureId: interactionGestureId(nodeId, interaction.interactionId),
    anchorId: interactionAnchorId(nodeId, interaction.interactionId),
    inputActionId: interactionInputActionId(nodeId, interaction.interactionId),
    activeWindow: {
      startMs: interaction.startMs,
      endMs: interaction.endMs,
    },
    ...(interaction.branchAtMs !== undefined
      ? { branchAtMs: interaction.branchAtMs }
      : {}),
  };
  if (interaction.trigger.kind === 'swipe') {
    return {
      ...common,
      kind: 'swipe',
      directions: [interaction.trigger.direction],
      minimumDistance: 0.08,
      maximumDurationMs: 1_000,
    };
  }
  if (interaction.trigger.kind === 'press-hold') {
    return {
      ...common,
      kind: 'press-hold',
      durationMs: interaction.trigger.durationMs,
      releaseBehavior: 'reset',
      cancelOnPointerExit: true,
      timelineControl: interaction.trigger.controlTimeline,
    };
  }
  return { ...common, kind: 'tap', maxDurationMs: 500 };
}

function interactionOutcomeEntries(
  outcomes: RuntimeInteraction['outcomes'],
): Array<[RuntimeInteractionOutcomeName, RuntimeInteractionAction]> {
  return (['success', 'failure', 'timeout'] as const).flatMap((outcome) => {
    const action = outcomes[outcome];
    return action ? [[outcome, action]] : [];
  });
}

function interactionOutcomeEventType(
  outcome: RuntimeInteractionOutcomeName,
): 'gesture.completed' | 'gesture.cancelled' | 'gesture.timed-out' {
  if (outcome === 'failure') return 'gesture.cancelled';
  if (outcome === 'timeout') return 'gesture.timed-out';
  return 'gesture.completed';
}

function compileInteractionAction(
  action: RuntimeInteractionAction,
  primaryInstanceId: string,
): ExperienceRuntimeAction[] {
  if (action.kind === 'goto') {
    return [{ kind: 'scene.goto', sceneId: action.nodeId }];
  }
  if (action.kind === 'seek') {
    return [
      {
        kind: 'renderer.command',
        instanceId: primaryInstanceId,
        commandType: 'seek',
        payload: { timeMs: { kind: 'literal', value: action.timeMs } },
      },
      {
        kind: 'renderer.command',
        instanceId: primaryInstanceId,
        commandType: 'play',
        payload: {},
      },
    ];
  }
  return [
    {
      kind: 'renderer.command',
      instanceId: primaryInstanceId,
      commandType: 'play',
      payload: {},
    },
  ];
}

function compileChoiceExit(
  node: Extract<InteractiveFilmRuntimeNode, { presentation: unknown }>,
  primaryInstanceId: string,
  primaryOutcomeType: string,
  renderers: ExperienceRendererInstance[],
  eventBindings: ExperienceEventBinding[],
  context: NodeCompilationContext,
  initiallyOpen = false,
): void {
  if (node.exit.kind !== 'choice') return;
  context.usedRendererIds.add(EXPERIENCE_CORE_CHOICE_RENDERER_ID);
  const choiceInstanceId = `renderer:${node.nodeId}:choice`;
  renderers.push({
    instanceId: choiceInstanceId,
    rendererId: EXPERIENCE_CORE_CHOICE_RENDERER_ID,
    layer: 100,
    config: {
      decisionId: node.exit.decisionId,
      prompt: node.exit.prompt,
      choices: node.exit.choices.map((choice) => ({
        choiceId: choice.choiceId,
        label: choice.label,
      })),
      initiallyOpen,
    } satisfies ExperienceCoreChoiceRendererConfig,
    bindings: {},
  });
  const openActions: ExperienceRuntimeAction[] = [
    {
      kind: 'renderer.command' as const,
      instanceId: choiceInstanceId,
      commandType: 'open',
      payload: {},
    },
  ];
  if (!initiallyOpen)
    eventBindings.push(
      rendererOutcomeBinding(
        node.nodeId,
        primaryInstanceId,
        primaryOutcomeType,
        [{ routeId: `route:${node.nodeId}:choice-open`, actions: openActions }],
      ),
    );
  eventBindings.push({
    bindingId: `binding:${node.nodeId}:choice-selected`,
    on: {
      type: 'renderer.outcome',
      sourceId: choiceInstanceId,
      qualifierId: 'choice-selected',
    },
    routes: node.exit.choices.map((choice) => ({
      routeId: `route:${node.nodeId}:choice:${choice.choiceId}`,
      when: eventValueEquals('choiceId', choice.choiceId),
      actions: [{ kind: 'scene.goto' as const, sceneId: choice.nextNodeId }],
    })),
  });
}

function rendererOutcomeBinding(
  sceneId: string,
  instanceId: string,
  outcomeType: string,
  routes: ExperienceEventBinding['routes'],
): ExperienceEventBinding {
  return {
    bindingId: `binding:${sceneId}:${outcomeType}`,
    on: {
      type: 'renderer.outcome',
      sourceId: instanceId,
      qualifierId: outcomeType,
    },
    routes,
  };
}

function compileRendererRequirements(
  usedRendererIds: ReadonlySet<ExperienceCoreRendererId>,
  hasSpatialInteractions: boolean,
): ExperienceRendererRequirement[] {
  return [...usedRendererIds].sort().map((rendererId) => {
    if (rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID) {
      return {
        rendererId,
        apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
        configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
        requiredCapabilities: [
          rendererId,
          ...(hasSpatialInteractions ? ['renderer.content-transform'] : []),
        ],
        outcomes: [{ outcomeType: 'media-ended' }],
        commands: [{ commandType: 'play' }, { commandType: 'seek' }],
      };
    }
    if (rendererId === EXPERIENCE_CORE_CHOICE_RENDERER_ID) {
      return {
        rendererId,
        apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
        configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
        requiredCapabilities: [rendererId],
        outcomes: [{ outcomeType: 'choice-selected' }],
        commands: [{ commandType: 'open' }],
      };
    }
    if (rendererId === EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID) {
      return {
        rendererId,
        apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
        configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
        requiredCapabilities: [rendererId, 'input.press-hold'],
        outcomes: [],
        commands: [{ commandType: 'complete' }],
      };
    }
    if (rendererId === EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID) {
      return {
        rendererId,
        apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
        configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
        requiredCapabilities: [rendererId],
        outcomes: [{ outcomeType: 'world-completed' }],
        commands: [{ commandType: 'end' }],
      };
    }
    throw new Error(`Unsupported Story renderer requirement: ${rendererId}`);
  });
}

function eventValueEquals(path: string, value: string): ExperienceCondition {
  return {
    kind: 'compare',
    left: { kind: 'event', path },
    operator: 'equals',
    right: { kind: 'literal', value },
  };
}

function localizeScalar(
  value: string,
  locales: readonly string[],
): Record<string, string> {
  return Object.fromEntries(locales.map((locale) => [locale, value]));
}

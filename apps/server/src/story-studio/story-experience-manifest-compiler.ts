import {
  type InteractiveFilmRelease,
  type InteractiveFilmRuntimeNode,
  type RuntimeMediaAsset,
} from '@repo/shared/interactive-film-runtime';
import {
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
  EXPERIENCE_CORE_RENDERER_API_VERSION,
  EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_STILL_CAPABILITY,
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID,
  EXPERIENCE_GESTURE_CAPABILITY,
  ExperienceRuntimeManifestSchema,
  type ExperienceCoreChoiceRendererConfig,
  type ExperienceCoreTextRendererConfig,
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
  type ExperienceAppearance,
  type ExperienceScene,
} from '@repo/shared/experience-runtime';
import {
  compileStoryCondition,
  compileStoryEffects,
  storyRouteNodeId,
  type StoryExitRoute,
  type StoryRouteTarget,
  type StoryStateEffect,
} from '@repo/shared/story-stats';
import { STORY_PREVIEW_SCENE_DURATION_MS } from './story-playback-copy';

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
  appearance?: ExperienceAppearance;
  experienceProfile: 'cinematic';
  metadata: {
    title: string;
    summary?: string | null;
  };
  mediaIdentities: readonly StoryExperienceMediaIdentity[];
  /** Draft preview copy for scenes whose timeline has no playable media. */
  previewSceneCopy?: ReadonlyMap<
    string,
    { title: string; description: string }
  >;
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
  nodeId?: string;
}

export interface StoryExperienceManifestCompilerResult {
  manifest: ExperienceRuntimeManifest | null;
  diagnostics: StoryExperienceManifestDiagnostic[];
}

interface NodeCompilationContext {
  nodesById: Map<string, InteractiveFilmRuntimeNode>;
  experienceProfile: 'cinematic';
  projectId: string;
  usedRendererIds: Set<ExperienceCoreRendererId>;
  syntheticScenes: ExperienceScene[];
  diagnostics: StoryExperienceManifestDiagnostic[];
  previewSceneCopy?: StoryExperienceManifestCompilerInput['previewSceneCopy'];
  locales: readonly string[];
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
    nodesById: new Map(input.release.nodes.map((node) => [node.nodeId, node])),
    experienceProfile: input.experienceProfile,
    projectId: input.release.gameId,
    usedRendererIds,
    syntheticScenes,
    diagnostics,
    previewSceneCopy:
      input.release.channel === 'preview' ? input.previewSceneCopy : undefined,
    locales: input.release.locales,
  };
  const graphNodes: ExperienceGraphNode[] = input.release.nodes.flatMap(
    (node, index) => {
      const compiled = compileGraphNode(node, context, ['nodes', index]);
      if (
        compiled &&
        node.presentation.kind !== 'decision' &&
        node.communityPointPrice
      )
        compiled.access = {
          key: `node:${node.nodeId}`,
          communityPointPrice: node.communityPointPrice,
          title:
            node.title ?? localizeScalar(node.nodeId, input.release.locales),
        };
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
  const hasNaturalComplete = input.release.nodes.some(
    (node) =>
      node.exit.kind === 'auto' &&
      node.exit.routes.some((route) => route.target === null),
  );
  // An ending that nothing routes to must not turn a loop into a closed film.
  const hasNamedEnding = input.release.nodes.some((node) =>
    node.exit.kind === 'choice'
      ? node.exit.choices.some((choice) => choice.target.kind === 'ending')
      : node.exit.routes.some((route) => route.target?.kind === 'ending'),
  );
  const hasTerminalScene = hasNaturalComplete || hasNamedEnding;

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
        ...(graphNodes.some(
          (node) =>
            node.access ||
            node.eventBindings.some((binding) =>
              binding.routes.some((route) => route.access),
            ),
        )
          ? ['commerce.community-points']
          : []),
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
    stateDefinitions: (input.release.stateVariables ?? []).map((variable) => ({
      key: variable.key,
      name: variable.name,
      valueType: variable.valueType,
      scope: 'session' as const,
      initialValue: variable.initialValue,
    })),
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
    ...(input.appearance ? { appearance: input.appearance } : {}),
    telemetryDefinitions: [],
    // Closed films use one technical completion marker. Retry loops and other
    // deliberately open-ended films declare no synthetic ending; their exit is
    // owned by a later interaction or the player chrome.
    endings: [
      ...(input.release.endings ?? []).map((ending) => ({
        endingId: ending.endingId,
        title: ending.title,
        kind: ending.kind,
      })),
      ...(hasNaturalComplete ||
      (hasTerminalScene && (input.release.endings ?? []).length === 0)
        ? [
            {
              endingId: STORY_EXPERIENCE_COMPLETION_ID,
              title: localizeScalar(
                input.metadata.title,
                input.release.locales,
              ),
              kind: 'custom' as const,
            },
          ]
        : []),
    ],
    graph: {
      entrySceneId: input.release.entryNodeId,
      nodes: graphNodes,
    },
  };

  const parsed = ExperienceRuntimeManifestSchema.safeParse(candidate);
  if (parsed.success) return { manifest: parsed.data, diagnostics: [] };
  return {
    manifest: null,
    diagnostics: parsed.error.issues.map((issue) => {
      const nodeId = sceneIdFromIssuePath(issue.path, candidate.graph.nodes);
      return {
        code: 'STORY_EXPERIENCE_MANIFEST_SCHEMA_INVALID' as const,
        message: readableManifestIssue(issue.message, nodeId),
        path: issue.path,
        ...(nodeId ? { nodeId } : {}),
      };
    }),
  };
}

function sceneIdFromIssuePath(
  path: PropertyKey[],
  nodes: ReadonlyArray<{ sceneId: string }>,
): string | null {
  const index = path.indexOf('nodes');
  if (path[index - 1] !== 'graph') return null;
  const nodeIndex = path[index + 1];
  if (typeof nodeIndex !== 'number') return null;
  return nodes[nodeIndex]?.sceneId ?? null;
}

function readableManifestIssue(message: string, nodeId: string | null): string {
  if (message === 'Finite experiences must have a reachable ending action') {
    return 'This chapter must reach an ending, but no scene a player can get to actually ends the story.';
  }
  if (
    message.startsWith('Scene ') &&
    message.includes(' is unreachable from ')
  ) {
    return nodeId
      ? `${nodeId} cannot be reached from the chapter start.`
      : 'A scene cannot be reached from the chapter start.';
  }
  return nodeId ? `${nodeId}: ${message}` : message;
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

function compileNavigationActions(
  target: StoryRouteTarget | null,
): ExperienceRuntimeAction[] {
  if (!target) {
    return [
      {
        kind: 'ending.complete',
        endingId: STORY_EXPERIENCE_COMPLETION_ID,
      },
    ];
  }
  if (target.kind === 'ending') {
    return [
      { kind: 'progress.unlock-ending', endingId: target.endingId },
      { kind: 'ending.complete', endingId: target.endingId },
    ];
  }
  return [{ kind: 'scene.goto', sceneId: target.nodeId }];
}

function compileAutoEventRoutes(
  nodeId: string,
  routes: readonly StoryExitRoute[],
  context: NodeCompilationContext,
  prefixActions: ExperienceRuntimeAction[] = [],
): ExperienceEventBinding['routes'] {
  return routes.map((route, index) => {
    const targetNodeId = storyRouteNodeId(route.target);
    return {
      routeId: `route:${nodeId}:auto:${index}`,
      ...(targetNodeId ? choiceDestinationAccess(targetNodeId, context) : {}),
      ...(route.when ? { when: compileStoryCondition(route.when) } : {}),
      actions: [...prefixActions, ...compileNavigationActions(route.target)],
    };
  });
}

function attachOnEnterEffects(
  eventBindings: ExperienceEventBinding[],
  nodeId: string,
  effects: readonly StoryStateEffect[] | undefined,
): void {
  const actions = compileStoryEffects(effects ?? []);
  if (actions.length === 0) return;
  const enter = eventBindings.find(
    (binding) => binding.on.type === 'scene.entered',
  );
  if (enter) {
    enter.routes = enter.routes.map((route) => ({
      ...route,
      actions: [...actions, ...route.actions],
    }));
    return;
  }
  eventBindings.push({
    bindingId: `binding:${nodeId}:enter`,
    on: { type: 'scene.entered' },
    routes: [{ routeId: `route:${nodeId}:enter`, actions }],
  });
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
        routes: compileAutoEventRoutes(node.nodeId, node.exit.routes, context),
      });
    }
    attachOnEnterEffects(eventBindings, node.nodeId, node.onEnterEffects);
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

  const previewCopy = context.previewSceneCopy?.get(node.nodeId);
  if (node.presentation.sequence.length === 0 && previewCopy) {
    context.usedRendererIds.add(EXPERIENCE_CORE_TEXT_RENDERER_ID);
    const renderers: ExperienceRendererInstance[] = [
      {
        instanceId: `renderer:${node.nodeId}:text`,
        rendererId: EXPERIENCE_CORE_TEXT_RENDERER_ID,
        layer: 0,
        config: {
          ...(previewCopy.description.trim()
            ? { title: localizeScalar(previewCopy.title, context.locales) }
            : {}),
          body: localizeScalar(
            previewCopy.description.trim() || previewCopy.title,
            context.locales,
          ),
          completion: 'passive',
        } satisfies ExperienceCoreTextRendererConfig,
        bindings: {},
      },
    ];
    const eventBindings: ExperienceEventBinding[] = [];
    if (node.exit.kind === 'choice') {
      compileChoiceExit(
        node,
        '',
        'clock-ended',
        renderers,
        eventBindings,
        context,
        false,
        { type: 'scene.clock-ended', sourceId: node.nodeId },
      );
    } else {
      eventBindings.push({
        bindingId: `binding:${node.nodeId}:clock-ended`,
        on: { type: 'scene.clock-ended', sourceId: node.nodeId },
        routes: compileAutoEventRoutes(node.nodeId, node.exit.routes, context),
      });
    }
    attachOnEnterEffects(eventBindings, node.nodeId, node.onEnterEffects);
    return {
      kind: 'scene',
      sceneId: node.nodeId,
      clock: { kind: 'fixed', durationMs: STORY_PREVIEW_SCENE_DURATION_MS },
      renderers,
      eventBindings,
      anchors: [],
      gestures: [],
      timeline: { cues: [] },
    };
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
        if (outcome === 'timeout' && interaction.timing === 'hold') return;
        eventBindings.push({
          bindingId: `binding:${node.nodeId}:interaction:${interaction.interactionId}:${outcome}`,
          on: {
            type: interactionOutcomeEventType(outcome),
            sourceId: gestureId,
          },
          routes: [
            {
              routeId: `route:${node.nodeId}:interaction:${interaction.interactionId}:${outcome}`,
              ...(action.kind === 'goto' && storyRouteNodeId(action.target)
                ? choiceDestinationAccess(
                    storyRouteNodeId(action.target)!,
                    context,
                  )
                : {}),
              actions: compileInteractionAction(action, primaryInstanceId),
            },
          ],
        });
      },
    );
  });

  if (node.exit.kind === 'auto') {
    eventBindings.push(
      rendererOutcomeBinding(
        node.nodeId,
        primaryInstanceId,
        primaryOutcomeType,
        compileAutoEventRoutes(node.nodeId, node.exit.routes, context),
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
  attachOnEnterEffects(eventBindings, node.nodeId, node.onEnterEffects);

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
  const eventBindings: ExperienceEventBinding[] = [
    rendererOutcomeBinding(
      node.nodeId,
      instanceId,
      'world-completed',
      compileAutoEventRoutes(node.nodeId, node.exit.routes, context),
    ),
  ];
  attachOnEnterEffects(eventBindings, node.nodeId, node.onEnterEffects);
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
    eventBindings,
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
    ...(interaction.branchAtMs !== undefined && interaction.timing !== 'hold'
      ? { branchAtMs: interaction.branchAtMs }
      : {}),
    ...(interaction.timing === 'hold' ? { holdFrame: true } : {}),
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
      timelineControl:
        interaction.timing === 'hold'
          ? false
          : interaction.trigger.controlTimeline,
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
  const effects = compileStoryEffects(action.effects ?? []);
  if (action.kind === 'goto') {
    return [...effects, ...compileNavigationActions(action.target)];
  }
  if (action.kind === 'seek') {
    return [
      ...effects,
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
  if (action.kind === 'pause') {
    return [
      ...effects,
      {
        kind: 'renderer.command',
        instanceId: primaryInstanceId,
        commandType: 'pause',
        payload: {},
      },
    ];
  }
  return [
    ...effects,
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
  openOn?: ExperienceEventBinding['on'],
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
      ...(node.exit.prompt ? { prompt: node.exit.prompt } : {}),
      choices: node.exit.choices.map((choice) => ({
        choiceId: choice.choiceId,
        label: choice.label,
        ...(choice.visibleWhen
          ? { visibleWhen: compileStoryCondition(choice.visibleWhen) }
          : {}),
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
    eventBindings.push({
      ...rendererOutcomeBinding(
        node.nodeId,
        primaryInstanceId,
        primaryOutcomeType,
        [{ routeId: `route:${node.nodeId}:choice-open`, actions: openActions }],
      ),
      ...(openOn ? { on: openOn } : {}),
    });
  eventBindings.push({
    bindingId: `binding:${node.nodeId}:choice-selected`,
    on: {
      type: 'renderer.outcome',
      sourceId: choiceInstanceId,
      qualifierId: 'choice-selected',
    },
    routes: node.exit.choices.map((choice) => {
      const targetNodeId = storyRouteNodeId(choice.target);
      return {
        routeId: `route:${node.nodeId}:choice:${choice.choiceId}`,
        ...(targetNodeId ? choiceDestinationAccess(targetNodeId, context) : {}),
        when: eventValueEquals('choiceId', choice.choiceId),
        actions: [
          ...compileStoryEffects(choice.effects ?? []),
          ...compileNavigationActions(choice.target),
        ],
      };
    }),
  });
}

function choiceDestinationAccess(
  nodeId: string,
  context: NodeCompilationContext,
) {
  const target = context.nodesById.get(nodeId);
  if (
    !target ||
    target.presentation.kind === 'decision' ||
    !target.communityPointPrice
  )
    return {};
  return {
    access: {
      key: `node:${target.nodeId}`,
      communityPointPrice: target.communityPointPrice,
      title: target.title ?? localizeScalar(target.nodeId, context.locales),
    },
  };
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
    if (rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID) {
      return {
        rendererId,
        apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
        configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
        requiredCapabilities: [rendererId],
        outcomes: [{ outcomeType: 'text-completed' }],
        commands: [],
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
    throw new Error(
      `Unsupported Story renderer requirement: ${String(rendererId)}`,
    );
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

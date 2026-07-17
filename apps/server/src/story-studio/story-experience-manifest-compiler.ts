import {
  STORY_CHECKPOINT_RENDERER_ID,
  type FilmCondition,
  type InteractiveFilmRelease,
  type InteractiveFilmRuntimeNode,
  type RuntimeMediaAsset,
  type RuntimeSessionEffect,
} from '@repo/shared/interactive-film-runtime';
import {
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_RENDERER_API_VERSION,
  EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceRuntimeManifestSchema,
  type ExperienceCoreCheckpointRendererConfig,
  type ExperienceCoreChoiceRendererConfig,
  type ExperienceCoreRendererId,
  type ExperienceCoreVideoRendererConfig,
  type ExperienceCondition,
  type ExperienceEventBinding,
  type ExperienceGraphNode,
  type ExperienceRendererInstance,
  type ExperienceRendererRequirement,
  type ExperienceRuntimeAction,
  type ExperienceRuntimeAsset,
  type ExperienceRuntimeManifest,
  type ExperienceScene,
  type ExperienceStateDefinition,
} from '@repo/shared/experience-runtime';
import type { StoryStateVariable } from './interactive-film.schema';

export const STORY_CORE_THEME_CONFIG_ASSET_ID =
  'theme:core.film-dark:1' as const;

const STORY_CORE_THEME_CONFIG_URI =
  '/experience-runtime/themes/core.film-dark.v1.json';
const STORY_CORE_THEME_CONFIG_SHA256 =
  'c5fd632a6dcba38e80c84a1bc771c37e791af6bca73421a9c357f859610e6272';

type ExperienceTimelineCue = ExperienceScene['timeline']['cues'][number];

export interface StoryExperienceMediaIdentity {
  runtimeAssetId: string;
  variantId: string;
  mediaType: string;
}

export interface StoryExperienceManifestCompilerInput {
  release: InteractiveFilmRelease;
  metadata: {
    title: string;
    summary?: string | null;
  };
  stateVariables: readonly StoryStateVariable[];
  mediaIdentities: readonly StoryExperienceMediaIdentity[];
}

export interface StoryExperienceManifestDiagnostic {
  code:
    | 'STORY_EXPERIENCE_MEDIA_IDENTITY_MISSING'
    | 'STORY_EXPERIENCE_MEDIA_UNSUPPORTED'
    | 'STORY_EXPERIENCE_OVERLAY_UNSUPPORTED'
    | 'STORY_EXPERIENCE_PRESENTATION_UNSUPPORTED'
    | 'STORY_EXPERIENCE_CHECKPOINT_UNSUPPORTED'
    | 'STORY_EXPERIENCE_STATE_CONTRACT_INVALID'
    | 'STORY_EXPERIENCE_MANIFEST_SCHEMA_INVALID';
  message: string;
  path: PropertyKey[];
}

export interface StoryExperienceManifestCompilerResult {
  manifest: ExperienceRuntimeManifest | null;
  diagnostics: StoryExperienceManifestDiagnostic[];
}

interface StatePaths {
  variables: ReadonlyMap<string, string>;
  flags: ReadonlyMap<string, string>;
  relationships: ReadonlyMap<string, string>;
}

interface NodeCompilationContext {
  statePaths: StatePaths;
  checkpointOutcomeIds: Set<string>;
  usedRendererIds: Set<ExperienceCoreRendererId>;
  syntheticScenes: ExperienceScene[];
  diagnostics: StoryExperienceManifestDiagnostic[];
}

/**
 * Lowers the already validated interactive-film Build product into the single
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

  const state = compileStateDefinitions(
    input.release,
    input.stateVariables,
    diagnostics,
  );
  const checkpointOutcomeIds = new Set<string>();
  const usedRendererIds = new Set<ExperienceCoreRendererId>();
  const syntheticScenes: ExperienceScene[] = [];
  const context: NodeCompilationContext = {
    statePaths: state.paths,
    checkpointOutcomeIds,
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
    completionPolicy: 'finite',
    metadata: {
      title: localizeScalar(input.metadata.title, input.release.locales),
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
      requiredCapabilities: [...usedRendererIds].sort(),
    },
    localization: {
      defaultLocale: input.release.defaultLocale,
      locales: input.release.locales,
    },
    stateDefinitions: state.definitions,
    inputActions: [],
    rendererRequirements: compileRendererRequirements(
      usedRendererIds,
      checkpointOutcomeIds,
    ),
    assets,
    theme: {
      themeId: 'core.film-dark',
      apiVersion: '1.0.0',
      configAssetId: STORY_CORE_THEME_CONFIG_ASSET_ID,
    },
    telemetryDefinitions: [],
    endings: input.release.endings.map((ending) => ({
      endingId: ending.endingId,
      title: ending.title,
      ...(ending.summary ? { summary: ending.summary } : {}),
      kind: compileEndingKind(ending.kind),
    })),
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
              sha256: variant.sha256,
              uri: variant.src,
              mediaType: identity.mediaType,
              orientation: orientation as 'landscape' | 'portrait',
              width: variant.width,
              height: variant.height,
              durationMs: Math.round(variant.durationSeconds * 1_000),
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
  return {
    assetId: asset.assetId,
    kind: 'video',
    orientationPolicy: asset.orientationPolicy,
    variants,
    audioMode: asset.audio,
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

function compileStateDefinitions(
  release: InteractiveFilmRelease,
  authoredVariables: readonly StoryStateVariable[],
  diagnostics: StoryExperienceManifestDiagnostic[],
): { definitions: ExperienceStateDefinition[]; paths: StatePaths } {
  const variables = new Map<string, string>();
  const flags = new Set(Object.keys(release.initialState.flags));
  const relationships = new Set(
    Object.keys(release.initialState.relationships),
  );
  collectRuntimeStateReferences(release.nodes, flags, relationships);
  authoredVariables.forEach((variable) =>
    variables.set(variable.key, statePath('variables', variable.key)),
  );

  const definitions: ExperienceStateDefinition[] = authoredVariables.flatMap(
    (variable, index) => {
      const initialValue = release.initialState.variables[variable.key];
      if (initialValue === undefined || initialValue === null) {
        diagnostics.push({
          code: 'STORY_EXPERIENCE_STATE_CONTRACT_INVALID',
          message: `Runtime variable ${variable.key} has no non-null initial value.`,
          path: ['initialState', 'variables', variable.key],
        });
        return [];
      }
      const valueType = typeof initialValue;
      if (valueType !== variable.type) {
        diagnostics.push({
          code: 'STORY_EXPERIENCE_STATE_CONTRACT_INVALID',
          message: `Runtime variable ${variable.key} does not match its authored ${variable.type} type.`,
          path: ['stateVariables', index],
        });
        return [];
      }
      const constraints =
        variable.type === 'number'
          ? {
              ...(variable.minimum !== undefined
                ? { minimum: variable.minimum }
                : {}),
              ...(variable.maximum !== undefined
                ? { maximum: variable.maximum }
                : {}),
            }
          : variable.type === 'string' && variable.allowedValues
            ? { allowedValues: variable.allowedValues }
            : undefined;
      return [
        {
          key: variables.get(variable.key) as string,
          valueType: variable.type,
          scope: 'session' as const,
          initialValue,
          ...(constraints && Object.keys(constraints).length > 0
            ? { constraints }
            : {}),
          sensitive: false,
        },
      ];
    },
  );
  Object.keys(release.initialState.variables).forEach((key) => {
    if (variables.has(key)) return;
    diagnostics.push({
      code: 'STORY_EXPERIENCE_STATE_CONTRACT_INVALID',
      message: `Runtime variable ${key} has no authored state definition.`,
      path: ['initialState', 'variables', key],
    });
  });

  const flagPaths = new Map(
    [...flags].sort().map((flag) => [flag, statePath('flags', flag)]),
  );
  flagPaths.forEach((path, flag) =>
    definitions.push({
      key: path,
      valueType: 'boolean',
      scope: 'session',
      initialValue: release.initialState.flags[flag] ?? false,
      sensitive: false,
    }),
  );
  const relationshipPaths = new Map(
    [...relationships]
      .sort()
      .map((characterId) => [
        characterId,
        statePath('relationships', characterId),
      ]),
  );
  relationshipPaths.forEach((path, characterId) =>
    definitions.push({
      key: path,
      valueType: 'number',
      scope: 'session',
      initialValue: release.initialState.relationships[characterId] ?? 0,
      sensitive: false,
    }),
  );
  definitions.sort((left, right) => left.key.localeCompare(right.key));
  return {
    definitions,
    paths: {
      variables,
      flags: flagPaths,
      relationships: relationshipPaths,
    },
  };
}

function collectRuntimeStateReferences(
  nodes: readonly InteractiveFilmRuntimeNode[],
  flags: Set<string>,
  relationships: Set<string>,
): void {
  const condition = (value: FilmCondition): void => {
    if (value.kind === 'flag') flags.add(value.flag);
    if (value.kind === 'relationship-at-least') {
      relationships.add(value.characterId);
    }
    if (value.kind === 'all' || value.kind === 'any') {
      value.conditions.forEach(condition);
    }
    if (value.kind === 'not') condition(value.condition);
  };
  const effect = (value: RuntimeSessionEffect): void => {
    if (value.kind === 'set_flag') flags.add(value.flag);
    if (value.kind === 'adjust_relationship') {
      relationships.add(value.characterId);
    }
  };
  nodes.forEach((node) => {
    if (node.exit.kind === 'auto') {
      node.exit.routes.forEach((route) => route.when && condition(route.when));
    }
    if (node.exit.kind === 'choice') {
      node.exit.choices.forEach((choice) => {
        if (choice.visibleWhen) condition(choice.visibleWhen);
        choice.effects.forEach(effect);
      });
    }
    if (node.exit.kind === 'external-overlay') {
      node.exit.routes.forEach((route) => route.effects.forEach(effect));
    }
  });
}

function compileGraphNode(
  node: InteractiveFilmRuntimeNode,
  context: NodeCompilationContext,
  path: PropertyKey[],
): ExperienceGraphNode | null {
  if (!('presentation' in node)) {
    const routes = orderAutoRoutes(node.exit.routes).map((route, index) => ({
      routeId: `route:${node.nodeId}:${index}`,
      ...(route.when
        ? { when: compileCondition(route.when, context.statePaths) }
        : {}),
      actions: [{ kind: 'scene.goto' as const, sceneId: route.nextNodeId }],
    }));
    return {
      kind: 'router',
      sceneId: node.nodeId,
      eventBindings: [
        {
          bindingId: `binding:${node.nodeId}:entered`,
          on: { type: 'scene.entered' },
          routes,
        },
      ],
    };
  }
  if (node.overlays.length > 0) {
    context.diagnostics.push({
      code: 'STORY_EXPERIENCE_OVERLAY_UNSUPPORTED',
      message: `Scene ${node.nodeId} still contains legacy overlays that have no Runtime Manifest v2 renderer.`,
      path: [...path, 'overlays'],
    });
    return null;
  }
  if (node.presentation.kind !== 'video') {
    context.diagnostics.push({
      code: 'STORY_EXPERIENCE_PRESENTATION_UNSUPPORTED',
      message: `Scene ${node.nodeId} uses unsupported ${node.presentation.kind} presentation.`,
      path: [...path, 'presentation'],
    });
    return null;
  }

  context.usedRendererIds.add(EXPERIENCE_CORE_VIDEO_RENDERER_ID);
  const videoInstanceId = `renderer:${node.nodeId}:video`;
  const renderers: ExperienceRendererInstance[] = [
    {
      instanceId: videoInstanceId,
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
    },
  ];
  const timelineCues: ExperienceTimelineCue[] = [];
  const eventBindings: ExperienceEventBinding[] = [];

  if (node.exit.kind === 'auto') {
    eventBindings.push(
      rendererOutcomeBinding(
        node.nodeId,
        videoInstanceId,
        'media-ended',
        orderAutoRoutes(node.exit.routes).map((route, index) => ({
          routeId: `route:${node.nodeId}:auto:${index}`,
          ...(route.when
            ? { when: compileCondition(route.when, context.statePaths) }
            : {}),
          actions: [{ kind: 'scene.goto' as const, sceneId: route.nextNodeId }],
        })),
      ),
    );
  } else if (node.exit.kind === 'ending') {
    eventBindings.push(
      rendererOutcomeBinding(node.nodeId, videoInstanceId, 'media-ended', [
        {
          routeId: `route:${node.nodeId}:ending`,
          actions: [
            {
              kind: 'ending.complete' as const,
              endingId: node.exit.endingId,
            },
          ],
        },
      ]),
    );
  } else if (node.exit.kind === 'choice') {
    compileChoiceExit(
      node,
      videoInstanceId,
      renderers,
      timelineCues,
      eventBindings,
      context,
    );
  } else {
    compileCheckpointExit(
      node,
      videoInstanceId,
      renderers,
      eventBindings,
      context,
      path,
    );
  }

  return {
    kind: 'scene',
    sceneId: node.nodeId,
    clock: { kind: 'renderer', rendererInstanceId: videoInstanceId },
    renderers,
    anchors: [],
    gestures: [],
    timeline: { cues: timelineCues },
    eventBindings,
  };
}

function compileChoiceExit(
  node: Extract<InteractiveFilmRuntimeNode, { presentation: unknown }>,
  videoInstanceId: string,
  renderers: ExperienceRendererInstance[],
  timelineCues: ExperienceTimelineCue[],
  eventBindings: ExperienceEventBinding[],
  context: NodeCompilationContext,
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
        ...(choice.accessibilityLabel
          ? { accessibilityLabel: choice.accessibilityLabel }
          : {}),
        ...(choice.visibleWhen
          ? {
              visibleWhen: compileCondition(
                choice.visibleWhen,
                context.statePaths,
              ),
            }
          : {}),
      })),
      initiallyOpen: false,
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
  if (node.exit.trigger.kind === 'timecode') {
    const cueId = `cue:${node.nodeId}:choice-open`;
    timelineCues.push({
      cueId,
      atMs: Math.round(node.exit.trigger.atSeconds * 1_000),
      once: true,
    });
    eventBindings.push({
      bindingId: `binding:${node.nodeId}:choice-timecode`,
      on: { type: 'timeline.cue', qualifierId: cueId },
      routes: [
        { routeId: `route:${node.nodeId}:choice-open`, actions: openActions },
      ],
    });
  } else {
    eventBindings.push(
      rendererOutcomeBinding(node.nodeId, videoInstanceId, 'media-ended', [
        {
          routeId: `route:${node.nodeId}:choice-open`,
          actions: openActions,
        },
      ]),
    );
  }
  eventBindings.push({
    bindingId: `binding:${node.nodeId}:choice-selected`,
    on: {
      type: 'renderer.outcome',
      sourceId: choiceInstanceId,
      qualifierId: 'choice-selected',
    },
    routes: node.exit.choices.map((choice) => {
      const targetSceneId =
        choice.afterSelect.kind === 'play'
          ? reactionSceneId(node.nodeId, choice.choiceId)
          : choice.nextNodeId;
      if (choice.afterSelect.kind === 'play') {
        context.syntheticScenes.push(
          compileReactionScene(
            node.nodeId,
            choice.choiceId,
            choice.afterSelect.reactionAssetId,
            choice.nextNodeId,
            context,
          ),
        );
      }
      const selected = eventValueEquals('choiceId', choice.choiceId);
      const when = choice.visibleWhen
        ? {
            kind: 'all' as const,
            conditions: [
              selected,
              compileCondition(choice.visibleWhen, context.statePaths),
            ],
          }
        : selected;
      return {
        routeId: `route:${node.nodeId}:choice:${choice.choiceId}`,
        when,
        actions: [
          ...choice.effects.map((effect) =>
            compileEffect(effect, context.statePaths),
          ),
          { kind: 'scene.goto' as const, sceneId: targetSceneId },
        ],
      };
    }),
  });
}

function compileCheckpointExit(
  node: Extract<InteractiveFilmRuntimeNode, { presentation: unknown }>,
  videoInstanceId: string,
  renderers: ExperienceRendererInstance[],
  eventBindings: ExperienceEventBinding[],
  context: NodeCompilationContext,
  path: PropertyKey[],
): void {
  if (node.exit.kind !== 'external-overlay') return;
  if (node.exit.rendererId !== STORY_CHECKPOINT_RENDERER_ID) {
    context.diagnostics.push({
      code: 'STORY_EXPERIENCE_CHECKPOINT_UNSUPPORTED',
      message: `Scene ${node.nodeId} references unsupported legacy renderer ${node.exit.rendererId}.`,
      path: [...path, 'exit', 'rendererId'],
    });
    return;
  }
  context.usedRendererIds.add(EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID);
  const instanceId = `renderer:${node.nodeId}:checkpoint`;
  const actionIds = node.exit.routes.map((route) => route.actionId);
  actionIds.forEach((actionId) => context.checkpointOutcomeIds.add(actionId));
  renderers.push({
    instanceId,
    rendererId: EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID,
    layer: 100,
    config: {
      actionIds,
      initiallyOpen: false,
    } satisfies ExperienceCoreCheckpointRendererConfig,
    bindings: {},
  });
  eventBindings.push(
    rendererOutcomeBinding(node.nodeId, videoInstanceId, 'media-ended', [
      {
        routeId: `route:${node.nodeId}:checkpoint-open`,
        actions: [
          {
            kind: 'renderer.command' as const,
            instanceId,
            commandType: 'open',
            payload: {},
          },
        ],
      },
    ]),
  );
  node.exit.routes.forEach((route) => {
    eventBindings.push({
      bindingId: `binding:${node.nodeId}:checkpoint:${route.actionId}`,
      on: {
        type: 'renderer.outcome',
        sourceId: instanceId,
        qualifierId: route.actionId,
      },
      routes: [
        {
          routeId: `route:${node.nodeId}:checkpoint:${route.actionId}`,
          actions: [
            ...route.effects.map((effect) =>
              compileEffect(effect, context.statePaths),
            ),
            'nextNodeId' in route
              ? { kind: 'scene.goto' as const, sceneId: route.nextNodeId }
              : {
                  kind: 'ending.complete' as const,
                  endingId: route.endingId,
                },
          ],
        },
      ],
    });
  });
}

function compileReactionScene(
  ownerNodeId: string,
  choiceId: string,
  assetId: string,
  nextSceneId: string,
  context: NodeCompilationContext,
): ExperienceScene {
  context.usedRendererIds.add(EXPERIENCE_CORE_VIDEO_RENDERER_ID);
  const sceneId = reactionSceneId(ownerNodeId, choiceId);
  const instanceId = `renderer:${sceneId}:video`;
  return {
    kind: 'scene',
    sceneId,
    clock: { kind: 'renderer', rendererInstanceId: instanceId },
    renderers: [
      {
        instanceId,
        rendererId: EXPERIENCE_CORE_VIDEO_RENDERER_ID,
        layer: 0,
        config: {
          fit: 'cover',
          sequence: [
            {
              clipId: `reaction:${ownerNodeId}:${choiceId}`,
              assetId,
              endBehavior: { behavior: 'advance' },
            },
          ],
          autoplay: true,
        } satisfies ExperienceCoreVideoRendererConfig,
        bindings: {},
      },
    ],
    anchors: [],
    gestures: [],
    timeline: { cues: [] },
    eventBindings: [
      rendererOutcomeBinding(sceneId, instanceId, 'media-ended', [
        {
          routeId: `route:${sceneId}:complete`,
          actions: [{ kind: 'scene.goto', sceneId: nextSceneId }],
        },
      ]),
    ],
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
  checkpointOutcomeIds: ReadonlySet<string>,
): ExperienceRendererRequirement[] {
  return [...usedRendererIds].sort().map((rendererId) => {
    if (rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID) {
      return {
        rendererId,
        apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
        configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
        requiredCapabilities: [rendererId],
        outcomes: [{ outcomeType: 'media-ended' }],
        commands: [],
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
    if (rendererId === EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID) {
      return {
        rendererId,
        apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
        configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
        requiredCapabilities: [rendererId],
        outcomes: [...checkpointOutcomeIds]
          .sort()
          .map((outcomeType) => ({ outcomeType })),
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
    return rendererId satisfies never;
  });
}

function compileCondition(
  condition: FilmCondition,
  paths: StatePaths,
): ExperienceCondition {
  if (condition.kind === 'all' || condition.kind === 'any') {
    return {
      kind: condition.kind,
      conditions: condition.conditions.map((child) =>
        compileCondition(child, paths),
      ),
    };
  }
  if (condition.kind === 'not') {
    return {
      kind: 'not',
      condition: compileCondition(condition.condition, paths),
    };
  }
  if (condition.kind === 'flag') {
    return stateValueEquals(
      paths.flags.get(condition.flag) as string,
      condition.equals,
    );
  }
  if (condition.kind === 'relationship-at-least') {
    return {
      kind: 'compare',
      left: {
        kind: 'state',
        path: paths.relationships.get(condition.characterId) as string,
      },
      operator: 'at-least',
      right: { kind: 'literal', value: condition.value },
    };
  }
  const operators = {
    equals: 'equals',
    not_equals: 'not-equals',
    greater_than: 'greater-than',
    at_least: 'at-least',
    less_than: 'less-than',
    at_most: 'at-most',
  } as const;
  return {
    kind: 'compare',
    left: {
      kind: 'state',
      path: paths.variables.get(condition.key) as string,
    },
    operator: operators[condition.operator],
    right: { kind: 'literal', value: condition.value },
  };
}

function compileEffect(
  effect: RuntimeSessionEffect,
  paths: StatePaths,
): ExperienceRuntimeAction {
  if (effect.kind === 'set_variable') {
    return {
      kind: 'state.set',
      path: paths.variables.get(effect.key) as string,
      value: { kind: 'literal', value: effect.value },
    };
  }
  if (effect.kind === 'increment_variable') {
    return {
      kind: 'state.increment',
      path: paths.variables.get(effect.key) as string,
      amount: { kind: 'literal', value: effect.amount },
    };
  }
  if (effect.kind === 'set_flag') {
    return {
      kind: 'state.set',
      path: paths.flags.get(effect.flag) as string,
      value: { kind: 'literal', value: effect.value },
    };
  }
  if (effect.kind === 'adjust_relationship') {
    return {
      kind: 'state.increment',
      path: paths.relationships.get(effect.characterId) as string,
      amount: { kind: 'literal', value: effect.amount },
    };
  }
  if (effect.kind === 'mark_asset_watched') {
    return { kind: 'progress.mark-asset-watched', assetId: effect.assetId };
  }
  return { kind: 'progress.unlock-ending', endingId: effect.endingId };
}

function orderAutoRoutes<T extends { priority: number }>(
  routes: readonly T[],
): T[] {
  return routes
    .map((route, index) => ({ route, index }))
    .sort(
      (left, right) =>
        left.route.priority - right.route.priority || left.index - right.index,
    )
    .map(({ route }) => route);
}

function eventValueEquals(path: string, value: string): ExperienceCondition {
  return {
    kind: 'compare',
    left: { kind: 'event', path },
    operator: 'equals',
    right: { kind: 'literal', value },
  };
}

function stateValueEquals(path: string, value: boolean): ExperienceCondition {
  return {
    kind: 'compare',
    left: { kind: 'state', path },
    operator: 'equals',
    right: { kind: 'literal', value },
  };
}

function reactionSceneId(nodeId: string, choiceId: string): string {
  return `reaction:${nodeId}:${choiceId}`;
}

function statePath(bucket: string, stableId: string): string {
  return `story.${bucket}.id_${Buffer.from(stableId, 'utf8').toString('base64url')}`;
}

function localizeScalar(
  value: string,
  locales: readonly string[],
): Record<string, string> {
  return Object.fromEntries(locales.map((locale) => [locale, value]));
}

function compileEndingKind(
  kind: InteractiveFilmRelease['endings'][number]['kind'],
): ExperienceRuntimeManifest['endings'][number]['kind'] {
  if (kind === 'failure') return 'failure';
  if (kind === 'hidden') return 'hidden';
  if (kind === 'truth' || kind === 'bond') return 'success';
  if (kind === 'echo') return 'neutral';
  return 'custom';
}

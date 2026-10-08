import {
  STORY_CHAPTER_NODES_MAX,
  STORY_CHAPTER_ASSETS_MAX,
  STORY_AUTHORING_TEXT_MAX,
  STORY_AUTHORING_DESCRIPTION_MAX,
  STORY_AUTHORING_PROMPT_MAX,
  STORY_AUTHORING_NEGATIVE_PROMPT_MAX,
} from '@repo/shared/story-production';
import {
  MAX_STORY_STATE_VARIABLES,
  MAX_STORY_CONDITION_DEPTH,
  MAX_STORY_CONDITION_LEAVES,
  MAX_STORY_EXIT_ROUTES,
  MAX_STORY_STATE_NOTE_LENGTH,
  StoryConditionSchema,
  StoryStateEffectsSchema,
  StoryStateKeySchema,
  storyConditionTypeError,
  storyEffectTypeError,
  measureStoryCondition,
  storyNodeTarget,
  type StoryCondition,
  type StoryStateEffect,
  type StoryStateValueType,
} from '@repo/shared/story-stats';

export const MAX_PLOT_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_PLOT_IMPORT_NODES = STORY_CHAPTER_NODES_MAX;
export const MAX_PLOT_IMPORT_CHAPTER_NODES = STORY_CHAPTER_NODES_MAX;
export const MAX_PLOT_IMPORT_ASSETS = STORY_CHAPTER_ASSETS_MAX;
export const MAX_PLOT_IMPORT_CLIPS_PER_SCENE = 500;
export const MIN_PLOT_IMPORT_CLIP_DURATION_MS = 250;
export const MAX_PLOT_IMPORT_SEQUENCE_DURATION_MS = 3_600_000;

const NODE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:[.:-][A-Za-z0-9_]+)*$/;

type SceneClip = {
  id: string;
  kind: 'image' | 'video';
  title: string;
  durationMs: number;
  prompt: string;
  negativePrompt: string | null;
  videoFile?: string;
};

type Scene = {
  id: string;
  type: 'scene';
  title: string;
  description: string;
  next: string | null;
  routes: { when: StoryCondition; next: string | null }[];
  onEnterEffects?: StoryStateEffect[];
  storyboard: { clips: SceneClip[] };
};

type Decision = {
  id: string;
  type: 'decision';
  prompt: string;
  onEnterEffects?: StoryStateEffect[];
  choices: {
    label: string;
    next: string;
    effects?: StoryStateEffect[];
    visibleWhen?: StoryCondition;
  }[];
};

export type StoryPlotImportStateVariable = {
  key: string;
  name: string;
  valueType: StoryStateValueType;
  initialValue: number | boolean;
  note: string | null;
};

export type StoryPlotImportAsset = {
  id: string;
  kind: 'character' | 'location' | 'prop';
  name: string;
  description: string | null;
  imagePrompt: string;
  videoPrompt: string | null;
  negativePrompt: string | null;
};

export type StoryPlotImport = {
  entryNodeId: string;
  assets: StoryPlotImportAsset[];
  stateVariables: StoryPlotImportStateVariable[];
  nodes: (Scene | Decision)[];
};

export type StoryPlotImportMode = 'append' | 'replace';

export type StoryPlotImportClipWrite = {
  sourceNodeId: string;
  plotNodeId: string;
  durationMs: number;
  clips: Array<{
    stableKey: string;
    kind: 'image' | 'video';
    title: string;
    startMs: number;
    durationMs: number;
    imagePrompt: string | null;
    videoPrompt: string | null;
    negativePrompt: string | null;
  }>;
};

export type StoryPlotImportAssetWrite = {
  stableKey: string;
  kind: StoryPlotImportAsset['kind'];
  name: string;
  description: string | null;
  imagePrompt: string;
  videoPrompt: string | null;
  negativePrompt: string | null;
};

type ImportedClipNode = {
  kind: 'clip';
  nodeId: string;
  clipKey: string;
  name: string;
  description: string;
  interactions: [];
  onEnterEffects?: StoryStateEffect[];
  exit: {
    kind: 'auto';
    routes: Array<{
      when?: StoryCondition;
      target: ReturnType<typeof storyNodeTarget>;
    }>;
  };
};

type ImportedDecisionNode = {
  kind: 'decision';
  nodeId: string;
  onEnterEffects?: StoryStateEffect[];
  exit: {
    kind: 'choice';
    decisionId: string;
    prompt: Record<string, string>;
    choices: Array<{
      choiceId: string;
      label: Record<string, string>;
      effects?: StoryStateEffect[];
      visibleWhen?: StoryCondition;
      target: NonNullable<ReturnType<typeof storyNodeTarget>>;
    }>;
  };
};

type StoryPlotImportedNode = ImportedClipNode | ImportedDecisionNode;

export class StoryPlotImportError extends Error {
  constructor(
    readonly code:
      | 'json'
      | 'size'
      | 'object'
      | 'field'
      | 'text'
      | 'id'
      | 'nodes'
      | 'type'
      | 'kind'
      | 'choices'
      | 'duplicate'
      | 'target'
      | 'unreachable'
      | 'capacity'
      | 'assets'
      | 'state'
      | 'clips'
      | 'duration'
      | 'mention'
      | 'videoFile'
      | 'media',
    readonly path = '$',
  ) {
    super(`${path}: ${code}`);
  }
}

function fail(code: StoryPlotImportError['code'], path: string): never {
  throw new StoryPlotImportError(code, path);
}

function object(
  value: unknown,
  path: string,
  keys: string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('object', path);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail('field', `${path}.${key}`);
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  path: string,
  max: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  ) {
    fail('text', path);
  }
  return value;
}

function optionalText(
  value: unknown,
  path: string,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  return text(value, path, max);
}

function prompt(value: unknown, path: string, max: number): string {
  const next = text(value, path, max);
  if (next.includes('@')) fail('mention', path);
  return next;
}

function optionalPrompt(
  value: unknown,
  path: string,
  max: number,
): string | null {
  const next = optionalText(value, path, max);
  if (next?.includes('@')) fail('mention', path);
  return next;
}

function id(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !NODE_ID_PATTERN.test(value)
  ) {
    fail('id', path);
  }
  return value;
}

function stateIssuePath(path: string, issuePath: PropertyKey[]): string {
  return issuePath.reduce<string>(
    (current, part) =>
      typeof part === 'number'
        ? `${current}[${String(part)}]`
        : `${current}.${String(part)}`,
    path,
  );
}

function parseStateEffects(
  value: unknown,
  path: string,
): StoryStateEffect[] | undefined {
  if (value === undefined) return undefined;
  const parsed = StoryStateEffectsSchema.safeParse(value);
  if (!parsed.success) {
    fail('state', stateIssuePath(path, parsed.error.issues[0]?.path ?? []));
  }
  return parsed.data;
}

function parseCondition(
  value: unknown,
  path: string,
): StoryCondition | undefined {
  if (value === undefined) return undefined;
  const parsed = StoryConditionSchema.safeParse(value);
  if (!parsed.success) {
    fail('state', stateIssuePath(path, parsed.error.issues[0]?.path ?? []));
  }
  const bounds = measureStoryCondition(parsed.data);
  if (
    bounds.depth > MAX_STORY_CONDITION_DEPTH ||
    bounds.leaves > MAX_STORY_CONDITION_LEAVES
  ) {
    fail('state', path);
  }
  return parsed.data;
}

function parseStateVariable(
  value: unknown,
  path: string,
  keys: Set<string>,
): StoryPlotImportStateVariable {
  const variable = object(value, path, [
    'key',
    'name',
    'valueType',
    'initialValue',
    'note',
  ]);
  const parsedKey = StoryStateKeySchema.safeParse(variable.key);
  if (!parsedKey.success) fail('state', `${path}.key`);
  if (keys.has(parsedKey.data)) fail('duplicate', `${path}.key`);
  keys.add(parsedKey.data);
  if (variable.valueType !== 'number' && variable.valueType !== 'boolean') {
    fail('state', `${path}.valueType`);
  }
  if (typeof variable.initialValue !== variable.valueType) {
    fail('state', `${path}.initialValue`);
  }
  if (
    typeof variable.initialValue === 'number' &&
    !Number.isFinite(variable.initialValue)
  ) {
    fail('state', `${path}.initialValue`);
  }
  return {
    key: parsedKey.data,
    name: text(variable.name, `${path}.name`, STORY_AUTHORING_TEXT_MAX),
    valueType: variable.valueType,
    initialValue: variable.initialValue as number | boolean,
    note: optionalText(
      variable.note,
      `${path}.note`,
      MAX_STORY_STATE_NOTE_LENGTH,
    ),
  };
}

function durationMs(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_PLOT_IMPORT_CLIP_DURATION_MS ||
    value > MAX_PLOT_IMPORT_SEQUENCE_DURATION_MS
  ) {
    fail('duration', path);
  }
  return value;
}

function importedPlotNodeId(namespace: string, sourceId: string): string {
  return `import:${namespace}:${sourceId}`;
}

function importedAssetStableKey(namespace: string, sourceId: string): string {
  return `imp.${namespace}.${sourceId}`;
}

function parseClip(
  value: unknown,
  path: string,
  clipIds: Set<string>,
): SceneClip {
  const clip = object(value, path, [
    'id',
    'kind',
    'title',
    'durationMs',
    'prompt',
    'negativePrompt',
    'videoFile',
  ]);
  const clipId = id(clip.id, `${path}.id`);
  if (clipIds.has(clipId)) fail('duplicate', `${path}.id`);
  clipIds.add(clipId);
  if (clip.kind !== 'image' && clip.kind !== 'video')
    fail('kind', `${path}.kind`);
  const videoFile = optionalText(clip.videoFile, `${path}.videoFile`, 1_024);
  if (
    videoFile &&
    (clip.kind !== 'video' ||
      !/\.(mp4|mov|webm)$/i.test(videoFile) ||
      [...videoFile].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ))
  ) {
    fail('videoFile', `${path}.videoFile`);
  }
  return {
    id: clipId,
    kind: clip.kind,
    title: text(clip.title, `${path}.title`, 160),
    durationMs: durationMs(clip.durationMs, `${path}.durationMs`),
    prompt: prompt(clip.prompt, `${path}.prompt`, STORY_AUTHORING_PROMPT_MAX),
    ...(videoFile ? { videoFile } : {}),
    negativePrompt: optionalPrompt(
      clip.negativePrompt,
      `${path}.negativePrompt`,
      STORY_AUTHORING_NEGATIVE_PROMPT_MAX,
    ),
  };
}

function parseStoryboard(value: unknown, path: string): { clips: SceneClip[] } {
  if (value === undefined) return { clips: [] };
  const storyboard = object(value, path, ['clips']);
  if (!Array.isArray(storyboard.clips)) fail('clips', `${path}.clips`);
  if (storyboard.clips.length > MAX_PLOT_IMPORT_CLIPS_PER_SCENE) {
    fail('clips', `${path}.clips`);
  }
  const clipIds = new Set<string>();
  const clips = storyboard.clips.map((clip, index) =>
    parseClip(clip, `${path}.clips[${index}]`, clipIds),
  );
  let cursor = 0;
  for (const clip of clips) {
    cursor += clip.durationMs;
    if (cursor > MAX_PLOT_IMPORT_SEQUENCE_DURATION_MS) {
      fail('duration', `${path}.clips`);
    }
  }
  return { clips };
}

function parseAsset(
  value: unknown,
  path: string,
  assetIds: Set<string>,
): StoryPlotImportAsset {
  const asset = object(value, path, [
    'id',
    'kind',
    'name',
    'description',
    'imagePrompt',
    'videoPrompt',
    'negativePrompt',
  ]);
  const assetId = id(asset.id, `${path}.id`);
  if (assetIds.has(assetId)) fail('duplicate', `${path}.id`);
  assetIds.add(assetId);
  if (
    asset.kind !== 'character' &&
    asset.kind !== 'location' &&
    asset.kind !== 'prop'
  ) {
    fail('kind', `${path}.kind`);
  }
  const description =
    asset.description === undefined || asset.description === null
      ? null
      : text(
          asset.description,
          `${path}.description`,
          STORY_AUTHORING_DESCRIPTION_MAX,
          true,
        );
  return {
    id: assetId,
    kind: asset.kind,
    name: text(asset.name, `${path}.name`, 240),
    description: description?.trim() ? description : null,
    imagePrompt: prompt(
      asset.imagePrompt,
      `${path}.imagePrompt`,
      STORY_AUTHORING_PROMPT_MAX,
    ),
    videoPrompt: optionalPrompt(
      asset.videoPrompt,
      `${path}.videoPrompt`,
      STORY_AUTHORING_PROMPT_MAX,
    ),
    negativePrompt: optionalPrompt(
      asset.negativePrompt,
      `${path}.negativePrompt`,
      STORY_AUTHORING_NEGATIVE_PROMPT_MAX,
    ),
  };
}

export function parseStoryPlotImportValue(value: unknown): StoryPlotImport {
  if (
    new TextEncoder().encode(JSON.stringify(value)).length >
    MAX_PLOT_IMPORT_BYTES
  )
    fail('size', '$');
  const root = object(value, '$', [
    'entryNodeId',
    'assets',
    'stateVariables',
    'nodes',
  ]);
  const entryNodeId = id(root.entryNodeId, '$.entryNodeId');
  if (
    !Array.isArray(root.assets) ||
    root.assets.length > MAX_PLOT_IMPORT_ASSETS
  ) {
    fail('assets', '$.assets');
  }
  if (
    !Array.isArray(root.nodes) ||
    !root.nodes.length ||
    root.nodes.length > MAX_PLOT_IMPORT_NODES
  ) {
    fail('nodes', '$.nodes');
  }
  const assetIds = new Set<string>();
  const assets = root.assets.map((asset, index) =>
    parseAsset(asset, `$.assets[${index}]`, assetIds),
  );
  if (
    root.stateVariables !== undefined &&
    (!Array.isArray(root.stateVariables) ||
      root.stateVariables.length > MAX_STORY_STATE_VARIABLES)
  ) {
    fail('state', '$.stateVariables');
  }
  const stateKeys = new Set<string>();
  const stateVariables = Array.isArray(root.stateVariables)
    ? root.stateVariables.map((variable, index) =>
        parseStateVariable(variable, `$.stateVariables[${index}]`, stateKeys),
      )
    : [];
  const ids = new Set<string>();
  const nodes = root.nodes.map((nodeValue, index): Scene | Decision => {
    const path = `$.nodes[${index}]`;
    const node = object(nodeValue, path, [
      'id',
      'type',
      'title',
      'description',
      'next',
      'prompt',
      'choices',
      'routes',
      'onEnterEffects',
      'storyboard',
    ]);
    const nodeId = id(node.id, `${path}.id`);
    if (ids.has(nodeId)) fail('duplicate', `${path}.id`);
    ids.add(nodeId);
    if (node.type === 'scene') {
      object(node, path, [
        'id',
        'type',
        'title',
        'description',
        'next',
        'routes',
        'onEnterEffects',
        'storyboard',
      ]);
      if (node.routes !== undefined && !Array.isArray(node.routes)) {
        fail('state', `${path}.routes`);
      }
      if (
        Array.isArray(node.routes) &&
        node.routes.length >= MAX_STORY_EXIT_ROUTES
      ) {
        fail('state', `${path}.routes`);
      }
      const onEnterEffects = parseStateEffects(
        node.onEnterEffects,
        `${path}.onEnterEffects`,
      );
      return {
        id: nodeId,
        type: 'scene',
        title: text(node.title, `${path}.title`, 120),
        description:
          node.description === undefined
            ? ''
            : text(
                node.description,
                `${path}.description`,
                STORY_AUTHORING_DESCRIPTION_MAX,
                true,
              ),
        next: node.next === null ? null : id(node.next, `${path}.next`),
        routes: Array.isArray(node.routes)
          ? node.routes.map((routeValue, routeIndex) => {
              const routePath = `${path}.routes[${routeIndex}]`;
              const route = object(routeValue, routePath, ['when', 'next']);
              const when = parseCondition(route.when, `${routePath}.when`);
              if (!when) fail('state', `${routePath}.when`);
              return {
                when,
                next:
                  route.next === null
                    ? null
                    : id(route.next, `${routePath}.next`),
              };
            })
          : [],
        ...(onEnterEffects ? { onEnterEffects } : {}),
        storyboard: parseStoryboard(node.storyboard, `${path}.storyboard`),
      };
    }
    if (node.type !== 'decision') fail('type', `${path}.type`);
    object(node, path, ['id', 'type', 'prompt', 'choices', 'onEnterEffects']);
    if (
      !Array.isArray(node.choices) ||
      node.choices.length < 2 ||
      node.choices.length > 6
    ) {
      fail('choices', `${path}.choices`);
    }
    const onEnterEffects = parseStateEffects(
      node.onEnterEffects,
      `${path}.onEnterEffects`,
    );
    return {
      id: nodeId,
      type: 'decision',
      prompt: text(node.prompt, `${path}.prompt`, STORY_AUTHORING_TEXT_MAX),
      ...(onEnterEffects ? { onEnterEffects } : {}),
      choices: node.choices.map((choiceValue, choiceIndex) => {
        const choicePath = `${path}.choices[${choiceIndex}]`;
        const choice = object(choiceValue, choicePath, [
          'label',
          'next',
          'effects',
          'visibleWhen',
        ]);
        const effects = parseStateEffects(
          choice.effects,
          `${choicePath}.effects`,
        );
        const visibleWhen = parseCondition(
          choice.visibleWhen,
          `${choicePath}.visibleWhen`,
        );
        return {
          label: text(
            choice.label,
            `${choicePath}.label`,
            STORY_AUTHORING_TEXT_MAX,
          ),
          next: id(choice.next, `${choicePath}.next`),
          ...(effects ? { effects } : {}),
          ...(visibleWhen ? { visibleWhen } : {}),
        };
      }),
    };
  });
  if (!ids.has(entryNodeId)) fail('target', '$.entryNodeId');
  const adjacency = new Map<string, string[]>();
  nodes.forEach((node, index) => {
    const targets =
      node.type === 'scene'
        ? [
            ...node.routes.map((route, routeIndex) => ({
              target: route.next,
              path: `$.nodes[${index}].routes[${routeIndex}].next`,
            })),
            { target: node.next, path: `$.nodes[${index}].next` },
          ].filter(
            (route): route is { target: string; path: string } =>
              route.target !== null,
          )
        : node.choices.map((choice, i) => ({
            target: choice.next,
            path: `$.nodes[${index}].choices[${i}].next`,
          }));
    targets.forEach(({ target, path }) => {
      if (!ids.has(target)) fail('target', path);
    });
    adjacency.set(
      node.id,
      targets.map(({ target }) => target),
    );
  });
  const reachable = new Set<string>();
  const queue = [entryNodeId];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (reachable.has(current)) continue;
    reachable.add(current);
    queue.push(...adjacency.get(current)!);
  }
  nodes.forEach((node, index) => {
    if (!reachable.has(node.id)) fail('unreachable', `$.nodes[${index}].id`);
  });
  return { entryNodeId, assets, stateVariables, nodes };
}

export function parseStoryPlotImport(source: string): StoryPlotImport {
  if (
    source.length > MAX_PLOT_IMPORT_BYTES ||
    new TextEncoder().encode(source).length > MAX_PLOT_IMPORT_BYTES
  )
    fail('size', '$');
  let value: unknown;
  try {
    // AI exports often wrap otherwise valid JSON in a single Markdown fence.
    const cleaned = source.replace(/^\uFEFF/, '').trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(cleaned);
    value = JSON.parse(fenced?.[1] ?? cleaned);
  } catch {
    fail('json', '$');
  }
  return parseStoryPlotImportValue(value);
}

export function applyStoryPlotImport<
  T extends {
    storyBible: {
      stateVariables?: Array<{
        key: string;
        name: Record<string, string>;
        valueType: StoryStateValueType;
        initialValue: number | boolean;
        note?: string;
      }>;
    };
    graph: { entryNodeId: string | null; nodes: unknown[] };
  },
>(
  current: T,
  plot: StoryPlotImport,
  locale: string,
  mode: StoryPlotImportMode = 'append',
  namespace = crypto.randomUUID().replaceAll('-', ''),
): {
  content: T;
  importedNodes: StoryPlotImportedNode[];
  entryNodeId: string;
  namespace: string;
} {
  const retainedNodes = mode === 'replace' ? [] : current.graph.nodes;
  if (
    retainedNodes.length + plot.nodes.length >
    MAX_PLOT_IMPORT_CHAPTER_NODES
  ) {
    fail('capacity', '$.nodes');
  }
  const existingVariables = current.storyBible.stateVariables ?? [];
  const variablesByKey = new Map(
    existingVariables.map((variable) => [variable.key, variable]),
  );
  const addedVariables = plot.stateVariables.flatMap((variable, index) => {
    const existing = variablesByKey.get(variable.key);
    if (existing) {
      if (
        existing.valueType !== variable.valueType ||
        existing.initialValue !== variable.initialValue
      ) {
        fail('state', `$.stateVariables[${index}].key`);
      }
      return [];
    }
    const imported = {
      key: variable.key,
      name: { [locale]: variable.name },
      valueType: variable.valueType,
      initialValue: variable.initialValue,
      ...(variable.note ? { note: variable.note } : {}),
    };
    variablesByKey.set(variable.key, imported);
    return [imported];
  });
  if (
    existingVariables.length + addedVariables.length >
    MAX_STORY_STATE_VARIABLES
  ) {
    fail('state', '$.stateVariables');
  }
  const variableLookup = new Map(
    [...variablesByKey.values()].map((variable) => [
      variable.key,
      { valueType: variable.valueType },
    ]),
  );
  const validateEffects = (
    effects: StoryStateEffect[] | undefined,
    path: string,
  ) => {
    effects?.forEach((effect, index) => {
      if (storyEffectTypeError(effect, variableLookup)) {
        fail('state', `${path}[${index}]`);
      }
    });
  };
  const validateCondition = (
    condition: StoryCondition | undefined,
    path: string,
  ) => {
    if (condition && storyConditionTypeError(condition, variableLookup)) {
      fail('state', path);
    }
  };
  plot.nodes.forEach((node, nodeIndex) => {
    validateEffects(
      node.onEnterEffects,
      `$.nodes[${nodeIndex}].onEnterEffects`,
    );
    if (node.type === 'scene') {
      node.routes.forEach((route, routeIndex) =>
        validateCondition(
          route.when,
          `$.nodes[${nodeIndex}].routes[${routeIndex}].when`,
        ),
      );
      return;
    }
    node.choices.forEach((choice, choiceIndex) => {
      validateEffects(
        choice.effects,
        `$.nodes[${nodeIndex}].choices[${choiceIndex}].effects`,
      );
      validateCondition(
        choice.visibleWhen,
        `$.nodes[${nodeIndex}].choices[${choiceIndex}].visibleWhen`,
      );
    });
  });
  const importedNodes = plot.nodes.map((node, index): StoryPlotImportedNode => {
    const nodeId = importedPlotNodeId(namespace, node.id);
    if (node.type === 'scene') {
      return {
        kind: 'clip',
        nodeId,
        clipKey: `I${namespace.toUpperCase()}_${index}`,
        name: node.title,
        description: node.description,
        interactions: [],
        ...(node.onEnterEffects ? { onEnterEffects: node.onEnterEffects } : {}),
        exit: {
          kind: 'auto',
          routes: [
            ...node.routes.map((route) => ({
              when: route.when,
              target:
                route.next === null
                  ? null
                  : storyNodeTarget(importedPlotNodeId(namespace, route.next)),
            })),
            {
              target:
                node.next === null
                  ? null
                  : storyNodeTarget(importedPlotNodeId(namespace, node.next)),
            },
          ],
        },
      };
    }
    return {
      kind: 'decision',
      nodeId,
      ...(node.onEnterEffects ? { onEnterEffects: node.onEnterEffects } : {}),
      exit: {
        kind: 'choice',
        decisionId: nodeId,
        prompt: { [locale]: node.prompt },
        choices: node.choices.map((choice, i) => ({
          choiceId: `option:${i + 1}`,
          label: { [locale]: choice.label },
          ...(choice.effects ? { effects: choice.effects } : {}),
          ...(choice.visibleWhen ? { visibleWhen: choice.visibleWhen } : {}),
          target: storyNodeTarget(importedPlotNodeId(namespace, choice.next))!,
        })),
      },
    };
  });
  const entryNodeId = importedPlotNodeId(namespace, plot.entryNodeId);
  return {
    importedNodes,
    entryNodeId,
    namespace,
    content: {
      ...current,
      storyBible: {
        ...current.storyBible,
        stateVariables: [...existingVariables, ...addedVariables],
      },
      graph: {
        entryNodeId:
          mode === 'replace'
            ? entryNodeId
            : (current.graph.entryNodeId ?? entryNodeId),
        nodes: [...retainedNodes, ...importedNodes],
      },
    },
  };
}

export function storyPlotImportAssetWrites(
  plot: StoryPlotImport,
  namespace: string,
): StoryPlotImportAssetWrite[] {
  return plot.assets.map((asset) => ({
    stableKey: importedAssetStableKey(namespace, asset.id),
    kind: asset.kind,
    name: asset.name,
    description: asset.description,
    imagePrompt: asset.imagePrompt,
    videoPrompt: asset.videoPrompt,
    negativePrompt: asset.negativePrompt,
  }));
}

export function storyPlotImportClipWrites(
  plot: StoryPlotImport,
  namespace: string,
): StoryPlotImportClipWrite[] {
  return plot.nodes.flatMap((node) => {
    if (node.type !== 'scene' || node.storyboard.clips.length === 0) return [];
    let startMs = 0;
    const clips = node.storyboard.clips.map((clip) => {
      const write = {
        stableKey: clip.id,
        kind: clip.kind,
        title: clip.title,
        startMs,
        durationMs: clip.durationMs,
        imagePrompt: clip.kind === 'image' ? clip.prompt : null,
        videoPrompt: clip.kind === 'video' ? clip.prompt : null,
        negativePrompt: clip.negativePrompt,
      };
      startMs += clip.durationMs;
      return write;
    });
    return [
      {
        sourceNodeId: node.id,
        plotNodeId: importedPlotNodeId(namespace, node.id),
        durationMs: startMs,
        clips,
      },
    ];
  });
}

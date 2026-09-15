export const MAX_PLOT_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_PLOT_IMPORT_NODES = 500;
export const MAX_PLOT_IMPORT_CHAPTER_NODES = 500;
export const MAX_PLOT_IMPORT_ASSETS = 500;
export const MAX_PLOT_IMPORT_CLIPS_PER_SCENE = 100;
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
};

type Scene = {
  id: string;
  type: 'scene';
  title: string;
  description: string;
  next: string | null;
  storyboard: { clips: SceneClip[] };
};

type Decision = {
  id: string;
  type: 'decision';
  prompt: string;
  choices: { label: string; next: string }[];
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
  nodes: (Scene | Decision)[];
};

export type StoryPlotImportMode = 'append' | 'replace';

export type StoryPlotImportClipWrite = {
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
  exit: { kind: 'auto'; nextNodeId: string | null };
};

type ImportedDecisionNode = {
  kind: 'decision';
  nodeId: string;
  exit: {
    kind: 'choice';
    decisionId: string;
    prompt: Record<string, string>;
    choices: Array<{
      choiceId: string;
      label: Record<string, string>;
      nextNodeId: string;
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
      | 'clips'
      | 'duration'
      | 'mention',
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
  ]);
  const clipId = id(clip.id, `${path}.id`);
  if (clipIds.has(clipId)) fail('duplicate', `${path}.id`);
  clipIds.add(clipId);
  if (clip.kind !== 'image' && clip.kind !== 'video')
    fail('kind', `${path}.kind`);
  return {
    id: clipId,
    kind: clip.kind,
    title: text(clip.title, `${path}.title`, 160),
    durationMs: durationMs(clip.durationMs, `${path}.durationMs`),
    prompt: prompt(clip.prompt, `${path}.prompt`, 12_000),
    negativePrompt: optionalPrompt(
      clip.negativePrompt,
      `${path}.negativePrompt`,
      4_000,
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
      : text(asset.description, `${path}.description`, 4_000, true);
  return {
    id: assetId,
    kind: asset.kind,
    name: text(asset.name, `${path}.name`, 240),
    description: description?.trim() ? description : null,
    imagePrompt: prompt(asset.imagePrompt, `${path}.imagePrompt`, 12_000),
    videoPrompt: optionalPrompt(
      asset.videoPrompt,
      `${path}.videoPrompt`,
      12_000,
    ),
    negativePrompt: optionalPrompt(
      asset.negativePrompt,
      `${path}.negativePrompt`,
      4_000,
    ),
  };
}

export function parseStoryPlotImportValue(value: unknown): StoryPlotImport {
  const root = object(value, '$', ['entryNodeId', 'assets', 'nodes']);
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
        'storyboard',
      ]);
      return {
        id: nodeId,
        type: 'scene',
        title: text(node.title, `${path}.title`, 120),
        description:
          node.description === undefined
            ? ''
            : text(node.description, `${path}.description`, 4_000, true),
        next: node.next === null ? null : id(node.next, `${path}.next`),
        storyboard: parseStoryboard(node.storyboard, `${path}.storyboard`),
      };
    }
    if (node.type !== 'decision') fail('type', `${path}.type`);
    object(node, path, ['id', 'type', 'prompt', 'choices']);
    if (
      !Array.isArray(node.choices) ||
      node.choices.length < 2 ||
      node.choices.length > 6
    ) {
      fail('choices', `${path}.choices`);
    }
    return {
      id: nodeId,
      type: 'decision',
      prompt: text(node.prompt, `${path}.prompt`, 4_000),
      choices: node.choices.map((choiceValue, choiceIndex) => {
        const choicePath = `${path}.choices[${choiceIndex}]`;
        const choice = object(choiceValue, choicePath, ['label', 'next']);
        return {
          label: text(choice.label, `${choicePath}.label`, 4_000),
          next: id(choice.next, `${choicePath}.next`),
        };
      }),
    };
  });
  if (!ids.has(entryNodeId)) fail('target', '$.entryNodeId');
  const adjacency = new Map<string, string[]>();
  nodes.forEach((node, index) => {
    const targets =
      node.type === 'scene'
        ? node.next === null
          ? []
          : [{ target: node.next, path: `$.nodes[${index}].next` }]
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
    const current = queue[i]!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    queue.push(...adjacency.get(current)!);
  }
  nodes.forEach((node, index) => {
    if (!reachable.has(node.id)) fail('unreachable', `$.nodes[${index}].id`);
  });
  return { entryNodeId, assets, nodes };
}

export function parseStoryPlotImport(source: string): StoryPlotImport {
  if (new TextEncoder().encode(source).length > MAX_PLOT_IMPORT_BYTES)
    fail('size', '$');
  let value: unknown;
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    fail('json', '$');
  }
  return parseStoryPlotImportValue(value);
}

export function applyStoryPlotImport<
  T extends { graph: { entryNodeId: string | null; nodes: unknown[] } },
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
        exit: {
          kind: 'auto',
          nextNodeId:
            node.next === null
              ? null
              : importedPlotNodeId(namespace, node.next),
        },
      };
    }
    return {
      kind: 'decision',
      nodeId,
      exit: {
        kind: 'choice',
        decisionId: nodeId,
        prompt: { [locale]: node.prompt },
        choices: node.choices.map((choice, i) => ({
          choiceId: `option:${i + 1}`,
          label: { [locale]: choice.label },
          nextNodeId: importedPlotNodeId(namespace, choice.next),
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
        plotNodeId: importedPlotNodeId(namespace, node.id),
        durationMs: startMs,
        clips,
      },
    ];
  });
}

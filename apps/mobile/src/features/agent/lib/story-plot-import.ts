// Native counterpart of the official Story Studio plot-file validator.
// Keep limits and graph/state validation aligned with server/src/story-studio/story-plot-import.ts.
import {
  MAX_STORY_STATE_VARIABLES,
  MAX_STORY_CONDITION_DEPTH,
  MAX_STORY_CONDITION_LEAVES,
  MAX_STORY_EXIT_ROUTES,
  MAX_STORY_STATE_NOTE_LENGTH,
  StoryConditionSchema,
  StoryStateEffectsSchema,
  StoryStateKeySchema,
  measureStoryCondition,
  type StoryCondition,
  type StoryStateEffect,
  type StoryStateValueType,
} from "@repo/shared/story-stats";

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
  kind: "image" | "video";
  title: string;
  durationMs: number;
  prompt: string;
  negativePrompt: string | null;
};

type Scene = {
  id: string;
  type: "scene";
  title: string;
  description: string;
  next: string | null;
  routes: { when: StoryCondition; next: string | null }[];
  onEnterEffects?: StoryStateEffect[];
  storyboard: { clips: SceneClip[] };
};

type Decision = {
  id: string;
  type: "decision";
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
  kind: "character" | "location" | "prop";
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

export type StoryPlotImportMode = "append" | "replace";

export class StoryPlotImportError extends Error {
  constructor(
    readonly code:
      | "json"
      | "size"
      | "object"
      | "field"
      | "text"
      | "id"
      | "nodes"
      | "type"
      | "kind"
      | "choices"
      | "duplicate"
      | "target"
      | "unreachable"
      | "capacity"
      | "assets"
      | "state"
      | "clips"
      | "duration"
      | "mention",
    readonly path = "$"
  ) {
    super(`${path}: ${code}`);
  }
}

function fail(code: StoryPlotImportError["code"], path: string): never {
  throw new StoryPlotImportError(code, path);
}

function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("object", path);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail("field", `${path}.${key}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
    fail("text", path);
  }
  return value;
}

function optionalText(value: unknown, path: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  return text(value, path, max);
}

function prompt(value: unknown, path: string, max: number): string {
  const next = text(value, path, max);
  if (next.includes("@")) fail("mention", path);
  return next;
}

function optionalPrompt(value: unknown, path: string, max: number): string | null {
  const next = optionalText(value, path, max);
  if (next?.includes("@")) fail("mention", path);
  return next;
}

function id(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > 64 || !NODE_ID_PATTERN.test(value)) {
    fail("id", path);
  }
  return value;
}

function stateIssuePath(path: string, issuePath: PropertyKey[]): string {
  return issuePath.reduce<string>(
    (current, part) =>
      typeof part === "number" ? `${current}[${String(part)}]` : `${current}.${String(part)}`,
    path
  );
}

function parseStateEffects(value: unknown, path: string): StoryStateEffect[] | undefined {
  if (value === undefined) return undefined;
  const parsed = StoryStateEffectsSchema.safeParse(value);
  if (!parsed.success) {
    fail("state", stateIssuePath(path, parsed.error.issues[0]?.path ?? []));
  }
  return parsed.data;
}

function parseCondition(value: unknown, path: string): StoryCondition | undefined {
  if (value === undefined) return undefined;
  const parsed = StoryConditionSchema.safeParse(value);
  if (!parsed.success) {
    fail("state", stateIssuePath(path, parsed.error.issues[0]?.path ?? []));
  }
  const bounds = measureStoryCondition(parsed.data);
  if (bounds.depth > MAX_STORY_CONDITION_DEPTH || bounds.leaves > MAX_STORY_CONDITION_LEAVES) {
    fail("state", path);
  }
  return parsed.data;
}

function parseStateVariable(
  value: unknown,
  path: string,
  keys: Set<string>
): StoryPlotImportStateVariable {
  const variable = object(value, path, ["key", "name", "valueType", "initialValue", "note"]);
  const parsedKey = StoryStateKeySchema.safeParse(variable.key);
  if (!parsedKey.success) fail("state", `${path}.key`);
  if (keys.has(parsedKey.data)) fail("duplicate", `${path}.key`);
  keys.add(parsedKey.data);
  if (variable.valueType !== "number" && variable.valueType !== "boolean") {
    fail("state", `${path}.valueType`);
  }
  if (typeof variable.initialValue !== variable.valueType) {
    fail("state", `${path}.initialValue`);
  }
  if (typeof variable.initialValue === "number" && !Number.isFinite(variable.initialValue)) {
    fail("state", `${path}.initialValue`);
  }
  return {
    key: parsedKey.data,
    name: text(variable.name, `${path}.name`, 4_000),
    valueType: variable.valueType,
    initialValue: variable.initialValue as number | boolean,
    note: optionalText(variable.note, `${path}.note`, MAX_STORY_STATE_NOTE_LENGTH),
  };
}

function durationMs(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_PLOT_IMPORT_CLIP_DURATION_MS ||
    value > MAX_PLOT_IMPORT_SEQUENCE_DURATION_MS
  ) {
    fail("duration", path);
  }
  return value;
}

function parseClip(value: unknown, path: string, clipIds: Set<string>): SceneClip {
  const clip = object(value, path, [
    "id",
    "kind",
    "title",
    "durationMs",
    "prompt",
    "negativePrompt",
  ]);
  const clipId = id(clip.id, `${path}.id`);
  if (clipIds.has(clipId)) fail("duplicate", `${path}.id`);
  clipIds.add(clipId);
  if (clip.kind !== "image" && clip.kind !== "video") fail("kind", `${path}.kind`);
  return {
    id: clipId,
    kind: clip.kind,
    title: text(clip.title, `${path}.title`, 160),
    durationMs: durationMs(clip.durationMs, `${path}.durationMs`),
    prompt: prompt(clip.prompt, `${path}.prompt`, 12_000),
    negativePrompt: optionalPrompt(clip.negativePrompt, `${path}.negativePrompt`, 4_000),
  };
}

function parseStoryboard(value: unknown, path: string): { clips: SceneClip[] } {
  if (value === undefined) return { clips: [] };
  const storyboard = object(value, path, ["clips"]);
  if (!Array.isArray(storyboard.clips)) fail("clips", `${path}.clips`);
  if (storyboard.clips.length > MAX_PLOT_IMPORT_CLIPS_PER_SCENE) {
    fail("clips", `${path}.clips`);
  }
  const clipIds = new Set<string>();
  const clips = storyboard.clips.map((clip, index) =>
    parseClip(clip, `${path}.clips[${index}]`, clipIds)
  );
  let cursor = 0;
  for (const clip of clips) {
    cursor += clip.durationMs;
    if (cursor > MAX_PLOT_IMPORT_SEQUENCE_DURATION_MS) {
      fail("duration", `${path}.clips`);
    }
  }
  return { clips };
}

function parseAsset(value: unknown, path: string, assetIds: Set<string>): StoryPlotImportAsset {
  const asset = object(value, path, [
    "id",
    "kind",
    "name",
    "description",
    "imagePrompt",
    "videoPrompt",
    "negativePrompt",
  ]);
  const assetId = id(asset.id, `${path}.id`);
  if (assetIds.has(assetId)) fail("duplicate", `${path}.id`);
  assetIds.add(assetId);
  if (asset.kind !== "character" && asset.kind !== "location" && asset.kind !== "prop") {
    fail("kind", `${path}.kind`);
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
    videoPrompt: optionalPrompt(asset.videoPrompt, `${path}.videoPrompt`, 12_000),
    negativePrompt: optionalPrompt(asset.negativePrompt, `${path}.negativePrompt`, 4_000),
  };
}

export function parseStoryPlotImportValue(value: unknown): StoryPlotImport {
  const root = object(value, "$", ["entryNodeId", "assets", "stateVariables", "nodes"]);
  const entryNodeId = id(root.entryNodeId, "$.entryNodeId");
  if (!Array.isArray(root.assets) || root.assets.length > MAX_PLOT_IMPORT_ASSETS) {
    fail("assets", "$.assets");
  }
  if (
    !Array.isArray(root.nodes) ||
    !root.nodes.length ||
    root.nodes.length > MAX_PLOT_IMPORT_NODES
  ) {
    fail("nodes", "$.nodes");
  }
  const assetIds = new Set<string>();
  const assets = root.assets.map((asset, index) =>
    parseAsset(asset, `$.assets[${index}]`, assetIds)
  );
  if (
    root.stateVariables !== undefined &&
    (!Array.isArray(root.stateVariables) || root.stateVariables.length > MAX_STORY_STATE_VARIABLES)
  ) {
    fail("state", "$.stateVariables");
  }
  const stateKeys = new Set<string>();
  const stateVariables = Array.isArray(root.stateVariables)
    ? root.stateVariables.map((variable, index) =>
        parseStateVariable(variable, `$.stateVariables[${index}]`, stateKeys)
      )
    : [];
  const ids = new Set<string>();
  const nodes = root.nodes.map((nodeValue, index): Scene | Decision => {
    const path = `$.nodes[${index}]`;
    const node = object(nodeValue, path, [
      "id",
      "type",
      "title",
      "description",
      "next",
      "prompt",
      "choices",
      "routes",
      "onEnterEffects",
      "storyboard",
    ]);
    const nodeId = id(node.id, `${path}.id`);
    if (ids.has(nodeId)) fail("duplicate", `${path}.id`);
    ids.add(nodeId);
    if (node.type === "scene") {
      object(node, path, [
        "id",
        "type",
        "title",
        "description",
        "next",
        "routes",
        "onEnterEffects",
        "storyboard",
      ]);
      if (node.routes !== undefined && !Array.isArray(node.routes)) {
        fail("state", `${path}.routes`);
      }
      if (Array.isArray(node.routes) && node.routes.length >= MAX_STORY_EXIT_ROUTES) {
        fail("state", `${path}.routes`);
      }
      const onEnterEffects = parseStateEffects(node.onEnterEffects, `${path}.onEnterEffects`);
      return {
        id: nodeId,
        type: "scene",
        title: text(node.title, `${path}.title`, 120),
        description:
          node.description === undefined
            ? ""
            : text(node.description, `${path}.description`, 4_000, true),
        next: node.next === null ? null : id(node.next, `${path}.next`),
        routes: Array.isArray(node.routes)
          ? node.routes.map((routeValue, routeIndex) => {
              const routePath = `${path}.routes[${routeIndex}]`;
              const route = object(routeValue, routePath, ["when", "next"]);
              const when = parseCondition(route.when, `${routePath}.when`);
              if (!when) fail("state", `${routePath}.when`);
              return {
                when,
                next: route.next === null ? null : id(route.next, `${routePath}.next`),
              };
            })
          : [],
        ...(onEnterEffects ? { onEnterEffects } : {}),
        storyboard: parseStoryboard(node.storyboard, `${path}.storyboard`),
      };
    }
    if (node.type !== "decision") fail("type", `${path}.type`);
    object(node, path, ["id", "type", "prompt", "choices", "onEnterEffects"]);
    if (!Array.isArray(node.choices) || node.choices.length < 2 || node.choices.length > 6) {
      fail("choices", `${path}.choices`);
    }
    const onEnterEffects = parseStateEffects(node.onEnterEffects, `${path}.onEnterEffects`);
    return {
      id: nodeId,
      type: "decision",
      prompt: text(node.prompt, `${path}.prompt`, 4_000),
      ...(onEnterEffects ? { onEnterEffects } : {}),
      choices: node.choices.map((choiceValue, choiceIndex) => {
        const choicePath = `${path}.choices[${choiceIndex}]`;
        const choice = object(choiceValue, choicePath, ["label", "next", "effects", "visibleWhen"]);
        const effects = parseStateEffects(choice.effects, `${choicePath}.effects`);
        const visibleWhen = parseCondition(choice.visibleWhen, `${choicePath}.visibleWhen`);
        return {
          label: text(choice.label, `${choicePath}.label`, 4_000),
          next: id(choice.next, `${choicePath}.next`),
          ...(effects ? { effects } : {}),
          ...(visibleWhen ? { visibleWhen } : {}),
        };
      }),
    };
  });
  if (!ids.has(entryNodeId)) fail("target", "$.entryNodeId");
  const adjacency = new Map<string, string[]>();
  nodes.forEach((node, index) => {
    const targets =
      node.type === "scene"
        ? [
            ...node.routes.map((route, routeIndex) => ({
              target: route.next,
              path: `$.nodes[${index}].routes[${routeIndex}].next`,
            })),
            { target: node.next, path: `$.nodes[${index}].next` },
          ].filter((route): route is { target: string; path: string } => route.target !== null)
        : node.choices.map((choice, i) => ({
            target: choice.next,
            path: `$.nodes[${index}].choices[${i}].next`,
          }));
    targets.forEach(({ target, path }) => {
      if (!ids.has(target)) fail("target", path);
    });
    adjacency.set(
      node.id,
      targets.map(({ target }) => target)
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
    if (!reachable.has(node.id)) fail("unreachable", `$.nodes[${index}].id`);
  });
  return { entryNodeId, assets, stateVariables, nodes };
}

export function parseStoryPlotImport(source: string): StoryPlotImport {
  if (new TextEncoder().encode(source).length > MAX_PLOT_IMPORT_BYTES) fail("size", "$");
  let value: unknown;
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch {
    fail("json", "$");
  }
  return parseStoryPlotImportValue(value);
}

import type { InteractiveStoryDraftContent, StoryGraphNode } from "@/lib/story-projects-api";

export const MAX_PLOT_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_PLOT_IMPORT_NODES = 1_000;

type Scene = { id: string; type: "scene"; title: string; description: string; next: string | null };
type Decision = {
  id: string;
  type: "decision";
  prompt: string;
  choices: { label: string; next: string }[];
};
export type StoryPlotImport = { version: 1; entryNodeId: string; nodes: (Scene | Decision)[] };

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
      | "version"
      | "nodes"
      | "type"
      | "choices"
      | "duplicate"
      | "target"
      | "unreachable"
      | "capacity",
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

function id(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(value)) fail("id", path);
  return value;
}

/** Strict, lossless input boundary: never silently ignore an AI-authored field or broken link. */
export function parseStoryPlotImport(source: string): StoryPlotImport {
  if (new TextEncoder().encode(source).length > MAX_PLOT_IMPORT_BYTES) fail("size", "$");
  let value: unknown;
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch {
    fail("json", "$");
  }
  const root = object(value, "$", ["version", "entryNodeId", "nodes"]);
  if (root.version !== 1) fail("version", "$.version");
  const entryNodeId = id(root.entryNodeId, "$.entryNodeId");
  if (
    !Array.isArray(root.nodes) ||
    !root.nodes.length ||
    root.nodes.length > MAX_PLOT_IMPORT_NODES
  ) {
    fail("nodes", "$.nodes");
  }
  const ids = new Set<string>();
  const nodes = root.nodes.map((value, index): Scene | Decision => {
    const path = `$.nodes[${index}]`;
    const node = object(value, path, [
      "id",
      "type",
      "title",
      "description",
      "next",
      "prompt",
      "choices",
    ]);
    const nodeId = id(node.id, `${path}.id`);
    if (ids.has(nodeId)) fail("duplicate", `${path}.id`);
    ids.add(nodeId);
    if (node.type === "scene") {
      object(node, path, ["id", "type", "title", "description", "next"]);
      return {
        id: nodeId,
        type: "scene",
        title: text(node.title, `${path}.title`, 120),
        description:
          node.description === undefined
            ? ""
            : text(node.description, `${path}.description`, 4_000, true),
        next: node.next === null ? null : id(node.next, `${path}.next`),
      };
    }
    if (node.type !== "decision") fail("type", `${path}.type`);
    object(node, path, ["id", "type", "prompt", "choices"]);
    if (!Array.isArray(node.choices) || node.choices.length < 2 || node.choices.length > 6) {
      fail("choices", `${path}.choices`);
    }
    return {
      id: nodeId,
      type: "decision",
      prompt: text(node.prompt, `${path}.prompt`, 4_000),
      choices: node.choices.map((value, choiceIndex) => {
        const choicePath = `${path}.choices[${choiceIndex}]`;
        const choice = object(value, choicePath, ["label", "next"]);
        return {
          label: text(choice.label, `${choicePath}.label`, 4_000),
          next: id(choice.next, `${choicePath}.next`),
        };
      }),
    };
  });
  if (!ids.has(entryNodeId)) fail("target", "$.entryNodeId");
  const adjacency = new Map<string, string[]>();
  nodes.forEach((node, index) => {
    const targets =
      node.type === "scene"
        ? node.next === null
          ? []
          : [{ target: node.next, path: `$.nodes[${index}].next` }]
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
    const current = queue[i]!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    queue.push(...adjacency.get(current)!);
  }
  nodes.forEach((node, index) => {
    if (!reachable.has(node.id)) fail("unreachable", `$.nodes[${index}].id`);
  });
  return { version: 1, entryNodeId, nodes };
}

/** IDs are namespaced per import so copies and other chapters cannot steal media bindings. */
export function applyStoryPlotImport(
  current: InteractiveStoryDraftContent,
  plot: StoryPlotImport,
  locale: string,
  mode: StoryPlotImportMode = "append",
  namespace = crypto.randomUUID().replaceAll("-", "")
): { content: InteractiveStoryDraftContent; importedNodes: StoryGraphNode[]; entryNodeId: string } {
  const retainedNodes = mode === "replace" ? [] : current.graph.nodes;
  if (retainedNodes.length + plot.nodes.length > 10_000) fail("capacity", "$.nodes");
  const nodeId = (value: string) => `import:${namespace}:${value}`;
  const importedNodes = plot.nodes.map(
    (node, index): StoryGraphNode =>
      node.type === "scene"
        ? {
            kind: "clip",
            nodeId: nodeId(node.id),
            clipKey: `I${namespace.toUpperCase()}_${index}`,
            name: node.title,
            description: node.description,
            interactions: [],
            exit: { kind: "auto", nextNodeId: node.next === null ? null : nodeId(node.next) },
          }
        : {
            kind: "decision",
            nodeId: nodeId(node.id),
            exit: {
              kind: "choice",
              decisionId: nodeId(node.id),
              prompt: { [locale]: node.prompt },
              choices: node.choices.map((choice, i) => ({
                choiceId: `option:${i + 1}`,
                label: { [locale]: choice.label },
                nextNodeId: nodeId(choice.next),
              })),
            },
          }
  );
  const entryNodeId = nodeId(plot.entryNodeId);
  return {
    importedNodes,
    entryNodeId,
    content: {
      ...current,
      graph: {
        entryNodeId: mode === "replace" ? entryNodeId : (current.graph.entryNodeId ?? entryNodeId),
        nodes: [...retainedNodes, ...importedNodes],
      },
    },
  };
}

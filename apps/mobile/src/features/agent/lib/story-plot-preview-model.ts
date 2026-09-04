/**
 * Read-only Plot Tree preview for a proposal — same topology as H5
 * `buildStoryPlotPreviewModel` (scene → decision → destination).
 * Do not import `@repo/shared/story-agent` or `@xyflow/react` (Metro / RN).
 */

export const PLOT_PREVIEW_NODE_WIDTH = 248;
export const PLOT_PREVIEW_CHOICE_ROW_HEIGHT = 36;

const COLUMN_GAP = 328;
const ROW_GAP = 56;
const CANVAS_PAD = 48;
const HEADER_BLOCK = 70;
const SUMMARY_BLOCK = 42;

export type StoryPlotPreviewChoice = {
  choiceId: string;
  label: string;
  targetNodeId: string;
  targetTitle: string;
};

export type StoryPlotPreviewNode = {
  id: string;
  kind: "clip" | "decision";
  title: string;
  eyebrow: string;
  summary: string;
  isEntry: boolean;
  isEnding: boolean;
  continuationTargetId?: string;
  choices: StoryPlotPreviewChoice[];
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StoryPlotPreviewEdge = {
  id: string;
  kind: "continuation" | "decision" | "choice";
  sourceId: string;
  targetId: string;
  choiceId?: string;
};

export type StoryPlotPreviewModel = {
  nodes: StoryPlotPreviewNode[];
  edges: StoryPlotPreviewEdge[];
  metrics: {
    nodes: number;
    branches: number;
    endings: number;
  };
  entryTitle: string;
  canvasWidth: number;
  canvasHeight: number;
};

type PlotProposalSlice = {
  screenplay?: {
    entrySceneId?: string;
    scenes?: unknown[];
  };
};

type ParsedChoice = {
  choiceId: string;
  label: unknown;
  nextNodeId: string;
};

type ParsedExit =
  | { kind: "auto"; nextNodeId: string | null }
  | { kind: "choice"; decisionId: string; prompt: unknown; choices: ParsedChoice[] };

type ParsedScene = {
  nodeId: string;
  name: string;
  exit: ParsedExit;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function localizedText(value: unknown, locale: string, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (!isRecord(value)) return fallback;
  const exact = locale.trim() ? value[locale.trim()] : undefined;
  if (typeof exact === "string" && exact.trim()) return exact.trim();
  const language = locale.split("-")[0]?.toLowerCase();
  if (language) {
    const match = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .find(
        ([key, text]) =>
          key.split("-")[0]?.toLowerCase() === language && typeof text === "string" && text.trim()
      );
    if (match && typeof match[1] === "string") return match[1].trim();
  }
  for (const preferred of ["en-US", "zh-CN", "zh-HK"]) {
    const text = value[preferred];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  const first = Object.values(value).find((item) => typeof item === "string" && item.trim());
  return typeof first === "string" ? first.trim() : fallback;
}

function parseChoices(raw: unknown): ParsedChoice[] {
  if (!Array.isArray(raw)) return [];
  const choices: ParsedChoice[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.choiceId !== "string" || !item.choiceId.trim()) continue;
    if (typeof item.nextNodeId !== "string" || !item.nextNodeId.trim()) continue;
    choices.push({
      choiceId: item.choiceId.trim(),
      label: item.label,
      nextNodeId: item.nextNodeId.trim(),
    });
  }
  return choices;
}

function parseExit(raw: unknown): ParsedExit {
  if (!isRecord(raw)) return { kind: "auto", nextNodeId: null };
  if (raw.kind === "choice") {
    const choices = parseChoices(raw.choices);
    const decisionId =
      typeof raw.decisionId === "string" && raw.decisionId.trim()
        ? raw.decisionId.trim()
        : "decision";
    return { kind: "choice", decisionId, prompt: raw.prompt, choices };
  }
  if (typeof raw.nextNodeId === "string" && raw.nextNodeId.trim()) {
    return { kind: "auto", nextNodeId: raw.nextNodeId.trim() };
  }
  return { kind: "auto", nextNodeId: null };
}

function parseScenes(raw: unknown, locale: string): ParsedScene[] {
  if (!Array.isArray(raw)) return [];
  const scenes: ParsedScene[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.nodeId !== "string" || !item.nodeId.trim()) continue;
    scenes.push({
      nodeId: item.nodeId.trim(),
      name: localizedText(item.name, locale),
      exit: parseExit(item.exit),
    });
  }
  return scenes;
}

function decisionNodeId(sourceNodeId: string): string {
  return `__decision__:${sourceNodeId}`;
}

function sceneTitle(scene: ParsedScene, sceneLabel: string, ordinal: number): string {
  return scene.name.trim() || `${sceneLabel} ${ordinal}`;
}

function estimateHeight(node: {
  kind: "clip" | "decision";
  summary: string;
  choices: { choiceId: string }[];
  continuationTargetId?: string;
}): number {
  let height = HEADER_BLOCK;
  if (node.summary.trim()) height += SUMMARY_BLOCK;
  if (node.kind === "decision") height += PLOT_PREVIEW_CHOICE_ROW_HEIGHT * node.choices.length;
  else if (node.continuationTargetId) height += PLOT_PREVIEW_CHOICE_ROW_HEIGHT;
  return height;
}

function layoutNodes(
  nodes: Omit<StoryPlotPreviewNode, "x" | "y" | "width" | "height">[],
  edges: StoryPlotPreviewEdge[],
  entryId: string
): StoryPlotPreviewNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue;
    const targets = adjacency.get(edge.sourceId) ?? [];
    if (!targets.includes(edge.targetId)) targets.push(edge.targetId);
    adjacency.set(edge.sourceId, targets);
    incoming.set(edge.targetId, (incoming.get(edge.targetId) ?? 0) + 1);
  }

  const orderIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const byOrder = (left: string, right: string) =>
    (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0) || left.localeCompare(right);
  adjacency.forEach((targets) => targets.sort(byOrder));

  const layerById = new Map<string, number>();
  const visit = (seed: string) => {
    if (layerById.has(seed) || !byId.has(seed)) return;
    layerById.set(seed, 0);
    const queue = [seed];
    for (let index = 0; index < queue.length; index += 1) {
      const source = queue[index]!;
      const nextLayer = (layerById.get(source) ?? 0) + 1;
      for (const target of adjacency.get(source) ?? []) {
        if (layerById.has(target)) continue;
        layerById.set(target, nextLayer);
        queue.push(target);
      }
    }
  };

  visit(entryId);
  nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).forEach((node) => visit(node.id));
  nodes.forEach((node) => visit(node.id));

  const idsByLayer = new Map<number, string[]>();
  for (const node of nodes) {
    const layer = layerById.get(node.id) ?? 0;
    const ids = idsByLayer.get(layer) ?? [];
    ids.push(node.id);
    idsByLayer.set(layer, ids);
  }

  const raw = new Map<string, { x: number; y: number; height: number }>();
  idsByLayer.forEach((ids, layer) => {
    ids.sort(byOrder);
    const heights = ids.map((id) => estimateHeight(byId.get(id)!));
    const total =
      heights.reduce((sum, height) => sum + height, 0) + ROW_GAP * Math.max(0, ids.length - 1);
    let y = -total / 2;
    ids.forEach((id, row) => {
      raw.set(id, { x: layer * COLUMN_GAP, y: y === 0 ? 0 : Math.round(y), height: heights[row]! });
      y += heights[row]! + ROW_GAP;
    });
  });

  let minX = 0;
  let minY = 0;
  let maxX = PLOT_PREVIEW_NODE_WIDTH;
  let maxY = HEADER_BLOCK;
  raw.forEach((position) => {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + PLOT_PREVIEW_NODE_WIDTH);
    maxY = Math.max(maxY, position.y + position.height);
  });

  return nodes.map((node) => {
    const position = raw.get(node.id) ?? { x: 0, y: 0, height: estimateHeight(node) };
    return {
      ...node,
      x: position.x - minX + CANVAS_PAD,
      y: position.y - minY + CANVAS_PAD,
      width: PLOT_PREVIEW_NODE_WIDTH,
      height: position.height,
    };
  });
}

export function plotPreviewHandle(
  node: StoryPlotPreviewNode,
  kind: "in" | "completion" | "choice",
  choiceId?: string
): { x: number; y: number } {
  if (kind === "in") {
    return { x: node.x, y: node.y + node.height / 2 };
  }
  if (kind === "choice" && choiceId) {
    const index = Math.max(
      0,
      node.choices.findIndex((choice) => choice.choiceId === choiceId)
    );
    const sectionTop = node.y + node.height - PLOT_PREVIEW_CHOICE_ROW_HEIGHT * node.choices.length;
    return {
      x: node.x + node.width,
      y: sectionTop + PLOT_PREVIEW_CHOICE_ROW_HEIGHT * index + PLOT_PREVIEW_CHOICE_ROW_HEIGHT / 2,
    };
  }
  return {
    x: node.x + node.width,
    y: node.y + node.height - PLOT_PREVIEW_CHOICE_ROW_HEIGHT / 2,
  };
}

export function plotPreviewEdgePath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const dx = Math.max(48, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

export function buildStoryPlotPreviewModel(
  proposal: PlotProposalSlice,
  locale: string,
  sceneLabel: string,
  decisionLabel: string
): StoryPlotPreviewModel {
  const scenes = parseScenes(proposal.screenplay?.scenes, locale);
  const scenesById = new Map(scenes.map((scene) => [scene.nodeId, scene]));
  const entrySceneId =
    (typeof proposal.screenplay?.entrySceneId === "string" &&
      proposal.screenplay.entrySceneId.trim()) ||
    scenes[0]?.nodeId ||
    "";

  const titles = new Map<string, string>();
  scenes.forEach((scene, index) => {
    titles.set(scene.nodeId, sceneTitle(scene, sceneLabel, index + 1));
  });

  const draftNodes: Omit<StoryPlotPreviewNode, "x" | "y" | "width" | "height">[] = [];
  const edges: StoryPlotPreviewEdge[] = [];
  let branches = 0;
  let endings = 0;

  scenes.forEach((scene, index) => {
    const ordinal = String(index + 1).padStart(2, "0");
    const title = titles.get(scene.nodeId) ?? scene.nodeId;
    if (scene.exit.kind === "choice") {
      const decisionId = decisionNodeId(scene.nodeId);
      const choices = scene.exit.choices.map((choice) => ({
        choiceId: choice.choiceId,
        label: localizedText(choice.label, locale, choice.choiceId),
        targetNodeId: choice.nextNodeId,
        targetTitle: titles.get(choice.nextNodeId) ?? choice.nextNodeId,
      }));
      branches += choices.length;
      draftNodes.push({
        id: scene.nodeId,
        kind: "clip",
        title,
        eyebrow: `${sceneLabel} ${ordinal}`,
        summary: "",
        isEntry: scene.nodeId === entrySceneId,
        isEnding: false,
        continuationTargetId: decisionId,
        choices: [],
      });
      draftNodes.push({
        id: decisionId,
        kind: "decision",
        title: decisionLabel,
        eyebrow: decisionLabel,
        summary: localizedText(scene.exit.prompt, locale, ""),
        isEntry: false,
        isEnding: false,
        choices,
      });
      edges.push({
        id: `decision:${scene.nodeId}:${scene.exit.decisionId}`,
        kind: "decision",
        sourceId: scene.nodeId,
        targetId: decisionId,
      });
      for (const choice of scene.exit.choices) {
        if (!scenesById.has(choice.nextNodeId)) continue;
        edges.push({
          id: `choice:${scene.nodeId}:${choice.choiceId}:${choice.nextNodeId}`,
          kind: "choice",
          sourceId: decisionId,
          targetId: choice.nextNodeId,
          choiceId: choice.choiceId,
        });
      }
      return;
    }

    const nextId = scene.exit.nextNodeId;
    const isEnding = !nextId;
    if (isEnding) endings += 1;
    draftNodes.push({
      id: scene.nodeId,
      kind: "clip",
      title,
      eyebrow: `${sceneLabel} ${ordinal}`,
      summary: "",
      isEntry: scene.nodeId === entrySceneId,
      isEnding,
      continuationTargetId: nextId && scenesById.has(nextId) ? nextId : undefined,
      choices: [],
    });
    if (nextId && scenesById.has(nextId)) {
      edges.push({
        id: `continuation:${scene.nodeId}:${nextId}`,
        kind: "continuation",
        sourceId: scene.nodeId,
        targetId: nextId,
      });
    }
  });

  const nodes = layoutNodes(draftNodes, edges, entrySceneId);
  let maxX = CANVAS_PAD * 2 + PLOT_PREVIEW_NODE_WIDTH;
  let maxY = CANVAS_PAD * 2 + HEADER_BLOCK;
  for (const node of nodes) {
    maxX = Math.max(maxX, node.x + node.width + CANVAS_PAD);
    maxY = Math.max(maxY, node.y + node.height + CANVAS_PAD);
  }

  return {
    nodes,
    edges,
    metrics: {
      nodes: nodes.length,
      branches,
      endings,
    },
    entryTitle: nodes.find((node) => node.isEntry)?.title ?? entrySceneId,
    canvasWidth: Math.ceil(maxX),
    canvasHeight: Math.ceil(maxY),
  };
}

import type { Edge, Node } from "@xyflow/react";
import { CANVAS_NODE_DRAG_HANDLE_SELECTOR } from "../../../../../components/canvas/canvas-interaction-policy";
import type {
  StoryClipVideoSummary,
  InteractiveStoryDraftContent,
  StoryFrameProfile,
  StoryGraphNode,
} from "@/lib/story-projects-api";

type StoryCanvasNodeKind = "clip" | "decision" | "character";
type StoryCanvasExitKind = "auto" | "choice";

interface StoryCanvasChoiceData {
  choiceId: string;
  label: string;
  targetNodeId: string;
  targetTitle: string | null;
}

export interface StoryCanvasNodeData extends Record<string, unknown> {
  kind: StoryCanvasNodeKind;
  title: string;
  eyebrow: string;
  nodeId: string;
  sourceNodeId?: string;
  decisionId?: string;
  clipKey?: string;
  characterId?: string;
  /** First appearance-reference image, shown as the card avatar. */
  characterImageUrl?: string;
  exitKind?: StoryCanvasExitKind;
  continuationTargetNodeId?: string;
  choices?: StoryCanvasChoiceData[];
  clipVideo?: StoryClipVideoSummary;
  frameAspectRatio?: "16:9" | "9:16";
  summary?: string;
}

export type StoryCanvasNode = Node<StoryCanvasNodeData, "storyCanvas">;

type StoryCanvasEdgeData =
  | { kind: "membership" }
  | { kind: "continuation" }
  | { kind: "decision"; decisionId: string; sourceNodeId: string }
  | { kind: "choice"; sourceNodeId: string; choiceId: string };

export type StoryCanvasEdge = Edge & { data: StoryCanvasEdgeData };

interface CanvasProjection {
  id: string;
  data: StoryCanvasNodeData;
  order: number;
}

interface CanvasConnection {
  edge: StoryCanvasEdge;
  order: number;
}

const COLUMN_GAP = 420;
const ROW_GAP = 220;
// The cast lane is a dedicated column to the LEFT of the story entry,
// kept clear of the right-hand story-flow lane (COLUMN_GAP steps rightward).
const CAST_COLUMN_GAP = 480;
const CAST_ROW_GAP = 150;
const SYNTHETIC_DECISION_NODE_PREFIX = "__decision__:";
// Character nodes are a canvas projection of storyBible.characters. The
// "character:" prefix keeps their synthetic ids from colliding with graph node
// ids (which the membership tether and inspector map back through).
const SYNTHETIC_CHARACTER_NODE_PREFIX = "character:";

export interface StoryCanvasCopy {
  clip: string;
  decision?: string;
}

const DEFAULT_COPY: StoryCanvasCopy = {
  clip: "Clip",
  decision: "Decision",
};

/**
 * Projects the canonical interactive-story draft into a presentation-only
 * React Flow model. The source draft is never decorated or mutated.
 */
export function buildStoryCanvasModel(
  content: InteractiveStoryDraftContent,
  locale: string,
  clips: StoryClipVideoSummary[] = [],
  copy: StoryCanvasCopy = DEFAULT_COPY,
  frameProfile: StoryFrameProfile = "landscape_16_9"
): { nodes: StoryCanvasNode[]; edges: StoryCanvasEdge[] } {
  const frameAspectRatioOf = (profile: StoryFrameProfile): "16:9" | "9:16" =>
    profile === "portrait_9_16" ? "9:16" : "16:9";
  const graphNodesById = new Map(content.graph.nodes.map((node) => [node.nodeId, node]));
  const clipOrdinalsByNodeId = new Map<string, number>();
  let nextClipOrdinal = 0;
  content.graph.nodes.forEach((node) => {
    clipOrdinalsByNodeId.set(node.nodeId, ++nextClipOrdinal);
  });
  const clipsByGraphNodeId = indexClips(clips, (clip) => clip.graphNodeId);
  let clipOrdinal = 0;

  const projections: CanvasProjection[] = [
    ...content.graph.nodes.flatMap<CanvasProjection>((node, index) => {
      const choices =
        node.exit.kind === "choice"
          ? node.exit.choices.map((choice) => ({
              choiceId: choice.choiceId,
              label: localizedText(choice.label, locale, ""),
              targetNodeId: choice.nextNodeId,
              targetTitle: graphNodeDisplayTitle(
                graphNodesById.get(choice.nextNodeId),
                copy.clip,
                clipOrdinalsByNodeId.get(choice.nextNodeId)
              ),
            }))
          : undefined;

      clipOrdinal += 1;
      const clip = clipsByGraphNodeId.get(node.nodeId);
      const clipProjection: CanvasProjection = {
        id: node.nodeId,
        order: index * 2,
        data: {
          kind: "clip",
          title: node.name?.trim() || `${copy.clip} ${clipOrdinal}`,
          eyebrow: `${copy.clip} ${String(clipOrdinal).padStart(2, "0")}`,
          nodeId: node.nodeId,
          clipKey: node.clipKey,
          exitKind: node.exit.kind,
          continuationTargetNodeId:
            node.exit.kind === "auto" ? (node.exit.nextNodeId ?? undefined) : undefined,
          clipVideo: clip,
          frameAspectRatio: frameAspectRatioOf(frameProfile),
        },
      };

      if (node.exit.kind !== "choice") return [clipProjection];
      const decisionLabel = copy.decision ?? DEFAULT_COPY.decision!;
      const decisionNodeId = syntheticDecisionNodeId(node.nodeId);
      return [
        clipProjection,
        {
          id: decisionNodeId,
          order: index * 2 + 1,
          data: {
            kind: "decision",
            title: localizedText(node.exit.prompt, locale, ""),
            eyebrow: decisionLabel,
            nodeId: decisionNodeId,
            sourceNodeId: node.nodeId,
            decisionId: node.exit.decisionId,
            exitKind: "choice",
            choices,
          },
        },
      ];
    }),
  ];

  // Character cards are a projection of storyBible.characters. They never
  // enter the story-flow layout graph (below); they live in a dedicated cast
  // lane left of the entry scene.
  const characterProjections: CanvasProjection[] = content.storyBible.characters.map(
    (character, index) => ({
      id: characterCanvasNodeId(character.id),
      order: content.graph.nodes.length * 2 + index,
      data: {
        kind: "character",
        title: localizedText(character.name, locale, ""),
        eyebrow: "",
        nodeId: characterCanvasNodeId(character.id),
        characterId: character.id,
        characterImageUrl: character.images[0]?.url,
        summary: character.summary,
      },
    })
  );

  const connections = buildConnections(content.graph.nodes, graphNodesById, locale);
  const storyEdges = connections
    .sort((left, right) => left.order - right.order || left.edge.id.localeCompare(right.edge.id))
    .map(({ edge }) => edge);
  const layoutSeedNodeId = content.graph.entryNodeId;
  // Only story-flow projections and edges feed the layered layout; character
  // nodes are placed afterwards so the membership tethers never pull them into
  // the story-flow lane on the right.
  const positions = buildLayeredPositions(projections, storyEdges, layoutSeedNodeId);
  seedCastLanePositions(positions, characterProjections, layoutSeedNodeId);

  const edges = storyEdges;

  const nodes = [...projections, ...characterProjections]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map<StoryCanvasNode>((projection) => ({
      id: projection.id,
      type: "storyCanvas",
      position: positions.get(projection.id) ?? { x: 0, y: 0 },
      // Every projected element can be deleted from the canvas; characters may
      // also use their inspector's guarded delete.
      deletable: true,
      dragHandle: CANVAS_NODE_DRAG_HANDLE_SELECTOR,
      data: projection.data,
    }));

  return { nodes, edges };
}

/**
 * Places character cards in a tidy vertical column to the LEFT of the entry
 * scene, centred on the anchor's row. Manual drags still persist under the
 * `character:` layout keys; this is only the default auto-layout seed on first
 * appearance.
 */
function seedCastLanePositions(
  positions: Map<string, { x: number; y: number }>,
  characterProjections: CanvasProjection[],
  layoutSeedNodeId: string | null
): void {
  if (characterProjections.length === 0) return;
  const anchor = (layoutSeedNodeId ? positions.get(layoutSeedNodeId) : undefined) ?? { x: 0, y: 0 };
  const laneX = anchor.x - CAST_COLUMN_GAP;
  characterProjections.forEach((projection, index) => {
    positions.set(projection.id, {
      x: laneX,
      y: anchor.y + (index - (characterProjections.length - 1) / 2) * CAST_ROW_GAP,
    });
  });
}

function buildConnections(
  graphNodes: StoryGraphNode[],
  graphNodesById: ReadonlyMap<string, StoryGraphNode>,
  locale: string
): CanvasConnection[] {
  const connections: CanvasConnection[] = [];
  let order = 0;

  for (const node of graphNodes) {
    if (node.exit.kind === "auto") {
      if (!node.exit.nextNodeId || !graphNodesById.has(node.exit.nextNodeId)) continue;
      connections.push({
        order: order++,
        edge: {
          id: `continuation:${node.nodeId}:${node.exit.nextNodeId}`,
          source: node.nodeId,
          target: node.exit.nextNodeId,
          sourceHandle: "completion",
          targetHandle: "in",
          data: { kind: "continuation" },
        },
      });
      continue;
    }

    if (node.exit.kind === "choice") {
      const decisionNodeId = syntheticDecisionNodeId(node.nodeId);
      connections.push({
        order: order++,
        edge: {
          id: `decision:${node.nodeId}:${node.exit.decisionId}`,
          source: node.nodeId,
          target: decisionNodeId,
          sourceHandle: "completion",
          targetHandle: "decision-in",
          data: {
            kind: "decision",
            decisionId: node.exit.decisionId,
            sourceNodeId: node.nodeId,
          },
        },
      });
      for (const choice of node.exit.choices) {
        if (!graphNodesById.has(choice.nextNodeId)) continue;
        connections.push({
          order: order++,
          edge: {
            id: `choice:${node.nodeId}:${choice.choiceId}:${choice.nextNodeId}`,
            source: decisionNodeId,
            target: choice.nextNodeId,
            sourceHandle: `choice:${choice.choiceId}`,
            targetHandle: "in",
            label: localizedText(choice.label, locale, ""),
            data: {
              kind: "choice",
              sourceNodeId: node.nodeId,
              choiceId: choice.choiceId,
            },
          },
        });
      }
    }
  }

  return connections;
}

function buildLayeredPositions(
  projections: CanvasProjection[],
  edges: StoryCanvasEdge[],
  entryNodeId: string | null
): Map<string, { x: number; y: number }> {
  const projectionById = new Map(projections.map((projection) => [projection.id, projection]));
  const adjacency = new Map<string, string[]>();
  const incoming = new Map(projections.map((projection) => [projection.id, 0]));

  for (const edge of edges) {
    if (!projectionById.has(edge.source) || !projectionById.has(edge.target)) continue;
    const targets = adjacency.get(edge.source) ?? [];
    if (!targets.includes(edge.target)) targets.push(edge.target);
    adjacency.set(edge.source, targets);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const byProjectionOrder = (left: string, right: string) => {
    const leftProjection = projectionById.get(left)!;
    const rightProjection = projectionById.get(right)!;
    return leftProjection.order - rightProjection.order || left.localeCompare(right);
  };
  adjacency.forEach((targets) => targets.sort(byProjectionOrder));

  const layerById = new Map<string, number>();
  const visit = (seed: string) => {
    if (layerById.has(seed)) return;
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

  if (entryNodeId && projectionById.has(entryNodeId)) visit(entryNodeId);
  projections
    .filter((projection) => (incoming.get(projection.id) ?? 0) === 0)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .forEach((projection) => visit(projection.id));
  projections
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .forEach((projection) => visit(projection.id));

  const idsByLayer = new Map<number, string[]>();
  projections.forEach((projection) => {
    const layer = layerById.get(projection.id) ?? 0;
    const ids = idsByLayer.get(layer) ?? [];
    ids.push(projection.id);
    idsByLayer.set(layer, ids);
  });

  const positions = new Map<string, { x: number; y: number }>();
  idsByLayer.forEach((ids, layer) => {
    ids.sort(byProjectionOrder);
    // Advance by each card's own height. A uniform row gap silently buried the
    // bottom of every tall card — a decision with three options is nearly twice
    // a clip — and the default layout runs before React Flow can measure, so the
    // estimate has to come from the projection itself.
    // Every column is centred on one shared horizontal axis: a two-card column
    // and a nine-card column read as one balanced band instead of both hanging
    // from the top. Centring uses real card heights, so a tall decision card
    // still clears its neighbour.
    const heights = ids.map((id) => estimateStoryNodeHeight(projectionById.get(id)!.data));
    const total = heights.reduce((sum, height) => sum + height, 0) + ROW_GAP * (ids.length - 1);
    let y = -total / 2;
    ids.forEach((id, row) => {
      positions.set(id, { x: layer * COLUMN_GAP, y: normalizeZero(Math.round(y)) });
      y += heights[row]! + ROW_GAP;
    });
  });
  return positions;
}

/** `Math.round(-0)` is `-0`, which is not `0` to a deep-equality check. */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Rendered height of a story card, by kind. Deliberately generous: a gap that is
 * slightly too big only looks airy, while one that is too small overlaps.
 */
export function estimateStoryNodeHeight(data: StoryCanvasNodeData): number {
  switch (data.kind) {
    case "decision":
      // Prompt + one row per option + the "add option" affordance.
      return 168 + (data.choices?.length ?? 0) * 54 + 56;
    case "character":
      return 120;
    default:
      return 236;
  }
}

function indexClips(
  clips: StoryClipVideoSummary[],
  keyOf: (clip: StoryClipVideoSummary) => string
): Map<string, StoryClipVideoSummary> {
  const index = new Map<string, StoryClipVideoSummary>();
  clips.forEach((clip) => {
    const key = keyOf(clip);
    if (!index.has(key)) index.set(key, clip);
  });
  return index;
}

function localizedText(
  text: Record<string, string> | undefined,
  locale: string,
  fallback: string
): string {
  if (!text) return fallback;
  const normalizedLocale = locale.trim();
  const language = normalizedLocale.split("-")[0]?.toLowerCase();
  const exact = normalizedLocale ? text[normalizedLocale]?.trim() : undefined;
  if (exact) return exact;

  if (language) {
    const languageMatch = Object.entries(text)
      .sort(([left], [right]) => left.localeCompare(right))
      .find(([key, value]) => key.split("-")[0]?.toLowerCase() === language && value.trim());
    if (languageMatch) return languageMatch[1].trim();
  }

  for (const preferredLocale of ["en-US", "zh-CN", "zh-HK"]) {
    const preferred = text[preferredLocale]?.trim();
    if (preferred) return preferred;
  }

  const first = Object.entries(text)
    .sort(([left], [right]) => left.localeCompare(right))
    .find(([, value]) => value.trim());
  return first?.[1].trim() || fallback;
}

function graphNodeDisplayTitle(
  node: StoryGraphNode | undefined,
  clipLabel: string,
  clipOrdinal?: number
): string | null {
  if (!node) return null;
  return node.name?.trim() || (clipOrdinal ? `${clipLabel} ${clipOrdinal}` : node.clipKey);
}

export function syntheticDecisionNodeId(sourceNodeId: string): string {
  return `${SYNTHETIC_DECISION_NODE_PREFIX}${sourceNodeId}`;
}

export function isSyntheticDecisionNodeId(canvasNodeId: string): boolean {
  return canvasNodeId.startsWith(SYNTHETIC_DECISION_NODE_PREFIX);
}

export function characterCanvasNodeId(characterId: string): string {
  return `${SYNTHETIC_CHARACTER_NODE_PREFIX}${characterId}`;
}

/**
 * Resolves a `character:` canvas node id back to its Story Bible character id,
 * or null when the node is not a character projection.
 */
export function characterIdForCanvasNode(canvasNodeId: string): string | null {
  return canvasNodeId.startsWith(SYNTHETIC_CHARACTER_NODE_PREFIX)
    ? nonEmptySyntheticSource(canvasNodeId, SYNTHETIC_CHARACTER_NODE_PREFIX)
    : null;
}

/**
 * The cast red line. Character cards tether only to the film foundation's
 * cast anchor and must never participate in a story-flow connection in either
 * direction. Returns true for any connection touching a character node or a
 * cast handle, so both the connection guard and the live validator can reject
 * it. Story-flow connections (no character node, no cast handle) return false.
 */
export function rejectsStoryCastWiring(params: {
  sourceKind: StoryCanvasNodeData["kind"];
  targetKind: StoryCanvasNodeData["kind"];
  sourceHandle?: string | null;
  targetHandle?: string | null;
}): boolean {
  return (
    params.sourceKind === "character" ||
    params.targetKind === "character" ||
    params.sourceHandle === "cast" ||
    params.sourceHandle === "cast-in" ||
    params.targetHandle === "cast" ||
    params.targetHandle === "cast-in"
  );
}

function nonEmptySyntheticSource(canvasNodeId: string, prefix: string): string | null {
  const sourceId = canvasNodeId.slice(prefix.length);
  return sourceId.length > 0 ? sourceId : null;
}

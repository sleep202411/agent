import type { Edge, Node } from "@xyflow/react";
import { CANVAS_NODE_DRAG_HANDLE_SELECTOR } from "../../../../../components/canvas/canvas-interaction-policy";
import type {
  StoryClipVideoSummary,
  InteractiveStoryDraftContent,
  StoryFrameProfile,
  StoryGraphNode,
} from "@/lib/story-projects-api";

type StoryCanvasNodeKind = "clip" | "text" | "decision" | "ending" | "character";
type StoryCanvasExitKind = "auto" | "choice" | "checkpoint" | "ending";

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
  endingId?: string;
  characterId?: string;
  /** First appearance-reference image, shown as the card avatar. */
  characterImageUrl?: string;
  exitKind?: StoryCanvasExitKind;
  continuationTargetNodeId?: string;
  checkpointTargetNodeId?: string;
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
  | { kind: "choice"; sourceNodeId: string; choiceId: string }
  | { kind: "checkpoint" }
  | { kind: "ending"; endingId: string };

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
// The cast lane is a dedicated column to the LEFT of the Story World root,
// kept clear of the right-hand story-flow lane (COLUMN_GAP steps rightward).
const CAST_COLUMN_GAP = 480;
const CAST_ROW_GAP = 150;
const SYNTHETIC_DECISION_NODE_PREFIX = "__decision__:";
const SYNTHETIC_ENDING_NODE_PREFIX = "__ending__:";
// Character nodes are a canvas projection of storyBible.characters. The
// "character:" prefix keeps their synthetic ids from colliding with graph node
// ids (which the membership tether and inspector map back through).
const SYNTHETIC_CHARACTER_NODE_PREFIX = "character:";

export interface StoryCanvasCopy {
  clip: string;
  text: string;
  decision?: string;
  ending: string;
}

const DEFAULT_COPY: StoryCanvasCopy = {
  clip: "Clip",
  text: "Text scene",
  decision: "Decision",
  ending: "Ending",
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
  // A text-first project carries no frame profile: its cards keep a neutral
  // media box and never advertise a frame contract the project doesn't have.
  frameProfile: StoryFrameProfile | null = "landscape_16_9"
): { nodes: StoryCanvasNode[]; edges: StoryCanvasEdge[] } {
  // Null-profile (text-first) projects yield undefined so no card ever shows a
  // frame tag for a contract that doesn't exist.
  const frameAspectRatioOf = (profile: StoryFrameProfile | null): "16:9" | "9:16" | undefined =>
    profile === null ? undefined : profile === "portrait_9_16" ? "9:16" : "16:9";
  const graphNodesById = new Map(content.graph.nodes.map((node) => [node.nodeId, node]));
  const clipOrdinalsByNodeId = new Map<string, number>();
  let nextClipOrdinal = 0;
  content.graph.nodes.forEach((node) => {
    if (node.kind === "clip") clipOrdinalsByNodeId.set(node.nodeId, ++nextClipOrdinal);
  });
  const clipsByGraphNodeId = indexClips(clips, (clip) => clip.graphNodeId);
  const endingCanvasIds = new Map(
    content.storyBible.endings.map((ending) => [ending.id, syntheticEndingNodeId(ending.id)])
  );
  let clipOrdinal = 0;
  let textOrdinal = 0;

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
                locale,
                copy.clip,
                clipOrdinalsByNodeId.get(choice.nextNodeId)
              ),
            }))
          : undefined;

      if (node.kind === "text") {
        textOrdinal += 1;
        const textProjection: CanvasProjection = {
          id: node.nodeId,
          order: index * 2,
          data: {
            kind: "text",
            title: localizedText(node.title, locale, `${copy.text} ${textOrdinal}`),
            eyebrow: `${copy.text} ${String(textOrdinal).padStart(2, "0")}`,
            nodeId: node.nodeId,
            exitKind: node.exit.kind,
            checkpointTargetNodeId:
              node.exit.kind === "checkpoint" ? node.exit.nextNodeId : undefined,
            continuationTargetNodeId:
              node.exit.kind === "auto" ? (node.exit.nextNodeId ?? undefined) : undefined,
            summary: localizedText(node.body, locale, ""),
          },
        };
        if (node.exit.kind !== "choice") return [textProjection];
        const decisionNodeId = syntheticDecisionNodeId(node.nodeId);
        return [
          textProjection,
          {
            id: decisionNodeId,
            order: index * 2 + 1,
            data: {
              kind: "decision",
              title: localizedText(node.exit.prompt, locale, ""),
              eyebrow: copy.decision ?? DEFAULT_COPY.decision!,
              nodeId: decisionNodeId,
              sourceNodeId: node.nodeId,
              decisionId: node.exit.decisionId,
              exitKind: "choice",
              choices,
            },
          },
        ];
      }

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
          checkpointTargetNodeId:
            node.exit.kind === "checkpoint" ? node.exit.nextNodeId : undefined,
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

  content.storyBible.endings.forEach((ending, index) => {
    const id = endingCanvasIds.get(ending.id)!;
    projections.push({
      id,
      order: content.graph.nodes.length * 2 + index,
      data: {
        kind: "ending",
        title: localizedText(ending.title, locale, ending.id),
        eyebrow: `${copy.ending} ${String(index + 1).padStart(2, "0")}`,
        nodeId: id,
        endingId: ending.id,
      },
    });
  });

  // Character cards are a projection of storyBible.characters, exactly as the
  // root node projects the bible. They never enter the story-flow layout graph
  // (below); they live in a dedicated cast lane left of the root.
  const characterProjections: CanvasProjection[] = content.storyBible.characters.map(
    (character, index) => ({
      id: characterCanvasNodeId(character.id),
      order: content.graph.nodes.length * 2 + content.storyBible.endings.length + index,
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

  const connections = buildConnections(
    content.graph.nodes,
    graphNodesById,
    endingCanvasIds,
    locale
  );
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
      // Every projected element can be deleted from the canvas. Deleting the
      // Story World root is a layout-only presence flip (it can be summoned
      // back from the creator menu); characters may also use their inspector's
      // guarded delete.
      deletable: true,
      dragHandle: CANVAS_NODE_DRAG_HANDLE_SELECTOR,
      data: projection.data,
    }));

  return { nodes, edges };
}

/**
 * Places character cards in a tidy vertical column to the LEFT of the Story
 * World root (or the layout seed when the root is hidden), centred on the
 * anchor's row. Manual drags still persist under the `character:` layout keys;
 * this is only the default auto-layout seed on first appearance.
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
  endingCanvasIds: ReadonlyMap<string, string>,
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
      continue;
    }

    if (node.exit.kind === "checkpoint") {
      if (!graphNodesById.has(node.exit.nextNodeId)) continue;
      connections.push({
        order: order++,
        edge: {
          id: `checkpoint:${node.nodeId}:${node.exit.nextNodeId}`,
          source: node.nodeId,
          target: node.exit.nextNodeId,
          sourceHandle: "completion",
          targetHandle: "in",
          data: { kind: "checkpoint" },
        },
      });
      continue;
    }

    if (node.exit.kind !== "ending") continue;

    const target = endingCanvasIds.get(node.exit.endingId);
    if (!target) continue;
    connections.push({
      order: order++,
      edge: {
        id: `ending:${node.nodeId}:${node.exit.endingId}`,
        source: node.nodeId,
        target,
        sourceHandle: "completion",
        targetHandle: "ending-in",
        data: { kind: "ending", endingId: node.exit.endingId },
      },
    });
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
    .filter((projection) => projection.data.kind !== "ending")
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .forEach((projection) => visit(projection.id));

  const finalGraphLayer = Math.max(
    0,
    ...projections
      .filter((projection) => projection.data.kind !== "ending")
      .map((projection) => layerById.get(projection.id) ?? 0)
  );
  projections
    .filter((projection) => projection.data.kind === "ending" && !layerById.has(projection.id))
    .forEach((projection) => layerById.set(projection.id, finalGraphLayer + 1));

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
    ids.forEach((id, row) => {
      positions.set(id, {
        x: layer * COLUMN_GAP,
        y: (row - (ids.length - 1) / 2) * ROW_GAP,
      });
    });
  });
  return positions;
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
  locale: string,
  clipLabel: string,
  clipOrdinal?: number
): string | null {
  if (!node) return null;
  if (node.kind === "clip") {
    return node.name?.trim() || (clipOrdinal ? `${clipLabel} ${clipOrdinal}` : node.clipKey);
  }
  return localizedText(node.title, locale, "") || null;
}

export function syntheticDecisionNodeId(sourceNodeId: string): string {
  return `${SYNTHETIC_DECISION_NODE_PREFIX}${sourceNodeId}`;
}

export function isSyntheticDecisionNodeId(canvasNodeId: string): boolean {
  return canvasNodeId.startsWith(SYNTHETIC_DECISION_NODE_PREFIX);
}

export function syntheticEndingNodeId(endingId: string): string {
  return `${SYNTHETIC_ENDING_NODE_PREFIX}${endingId}`;
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
 * The cast red line. Character cards tether only to the Story World root's
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

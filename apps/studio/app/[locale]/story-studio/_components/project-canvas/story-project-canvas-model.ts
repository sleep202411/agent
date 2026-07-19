import type { Edge, Node } from "@xyflow/react";
import { CANVAS_NODE_DRAG_HANDLE_SELECTOR } from "../../../../../components/canvas/canvas-interaction-policy";
import type {
  StoryClipVideoSummary,
  StoryTrailerVideoSummary,
  InteractiveFilmDraftContent,
  StoryFrameProfile,
  StoryGraphNode,
} from "@/lib/story-projects-api";

type StoryCanvasNodeKind = "root" | "clip" | "decision" | "router" | "ending";
type StoryCanvasExitKind = "auto" | "choice" | "checkpoint" | "ending";

interface StoryCanvasChoiceData {
  choiceId: string;
  label: string;
  targetNodeId: string;
}

export interface StoryCanvasAutoRouteData {
  routeIndex: number;
  targetNodeId: string;
  priority: number;
  hasCondition: boolean;
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
  exitKind?: StoryCanvasExitKind;
  continuationTargetNodeId?: string;
  checkpointTargetNodeId?: string;
  choices?: StoryCanvasChoiceData[];
  autoRoutes?: StoryCanvasAutoRouteData[];
  clipVideo?: StoryClipVideoSummary;
  trailerVideo?: StoryTrailerVideoSummary;
  frameAspectRatio?: "16:9" | "9:16";
  summary?: string;
  rootStats?: {
    characters: number;
    locations: number;
    props: number;
  };
}

export type StoryCanvasNode = Node<StoryCanvasNodeData, "storyCanvas">;

type StoryCanvasEdgeData =
  | { kind: "root" }
  | { kind: "continuation" }
  | { kind: "auto"; priority: number; routeIndex: number }
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
const SYNTHETIC_DECISION_NODE_PREFIX = "__decision__:";
const SYNTHETIC_ENDING_NODE_PREFIX = "__ending__:";
export const STORY_ROOT_NODE_ID = "__story_root__";

export interface StoryCanvasCopy {
  rootTitle: string;
  rootEyebrow: string;
  rootSummary: string;
  clip: string;
  router: string;
  decision?: string;
  ending: string;
}

const DEFAULT_COPY: StoryCanvasCopy = {
  rootTitle: "Story World",
  rootEyebrow: "World Root",
  rootSummary: "Define the premise, world rules, characters, and narrative state here.",
  clip: "Clip",
  router: "Router",
  decision: "Decision",
  ending: "Ending",
};

/**
 * Projects the canonical interactive-film draft into a presentation-only
 * React Flow model. The source draft is never decorated or mutated.
 */
export function buildStoryCanvasModel(
  content: InteractiveFilmDraftContent,
  locale: string,
  clips: StoryClipVideoSummary[] = [],
  copy: StoryCanvasCopy = DEFAULT_COPY,
  frameProfile: StoryFrameProfile = "landscape_16_9",
  trailer: StoryTrailerVideoSummary | null = null,
  storyWorldNodePresent = true
): { nodes: StoryCanvasNode[]; edges: StoryCanvasEdge[] } {
  const graphNodesById = new Map(content.graph.nodes.map((node) => [node.nodeId, node]));
  const clipsByGraphNodeId = indexClips(clips, (clip) => clip.graphNodeId);
  const endingCanvasIds = new Map(
    content.storyBible.endings.map((ending) => [ending.id, syntheticEndingNodeId(ending.id)])
  );
  let clipOrdinal = 0;
  let routerOrdinal = 0;

  const storyWorldProjection: CanvasProjection[] = storyWorldNodePresent
    ? [
        {
          id: STORY_ROOT_NODE_ID,
          order: -1,
          data: {
            kind: "root",
            title: copy.rootTitle,
            eyebrow: copy.rootEyebrow,
            nodeId: STORY_ROOT_NODE_ID,
            summary: content.storyBible.logline.trim() || copy.rootSummary,
            rootStats: {
              characters: content.storyBible.characters.length,
              locations: content.storyBible.locations.length,
              props: content.storyBible.props.length,
            },
            frameAspectRatio: frameProfile === "portrait_9_16" ? "9:16" : "16:9",
            trailerVideo: trailer ?? undefined,
          },
        },
      ]
    : [];
  const projections: CanvasProjection[] = [
    ...storyWorldProjection,
    ...content.graph.nodes.flatMap<CanvasProjection>((node, index) => {
      if (node.kind === "router") {
        routerOrdinal += 1;
        return [
          {
            id: node.nodeId,
            order: index * 2,
            data: {
              kind: "router",
              title: `${copy.router} ${String(routerOrdinal).padStart(2, "0")}`,
              eyebrow: copy.router,
              nodeId: node.nodeId,
              exitKind: "auto",
              autoRoutes: projectAutoRoutes(node.exit.routes),
            },
          },
        ];
      }

      clipOrdinal += 1;
      const clip = clipsByGraphNodeId.get(node.nodeId);
      const choices =
        node.exit.kind === "choice"
          ? node.exit.choices.map((choice) => ({
              choiceId: choice.choiceId,
              label: localizedText(choice.label, locale, choice.choiceId),
              targetNodeId: choice.nextNodeId,
            }))
          : undefined;

      const clipProjection: CanvasProjection = {
        id: node.nodeId,
        order: index * 2,
        data: {
          kind: "clip",
          title: node.name?.trim() || node.clipKey,
          eyebrow: `${copy.clip} ${String(clipOrdinal).padStart(2, "0")}`,
          nodeId: node.nodeId,
          clipKey: node.clipKey,
          exitKind: node.exit.kind,
          checkpointTargetNodeId:
            node.exit.kind === "checkpoint" ? node.exit.nextNodeId : undefined,
          continuationTargetNodeId:
            node.exit.kind === "auto" ? (node.exit.nextNodeId ?? undefined) : undefined,
          clipVideo: clip,
          frameAspectRatio: frameProfile === "portrait_9_16" ? "9:16" : "16:9",
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
            title: localizedText(node.exit.prompt, locale, node.exit.decisionId),
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

  const connections = buildConnections(
    content.graph.nodes,
    graphNodesById,
    endingCanvasIds,
    locale
  );
  if (
    storyWorldNodePresent &&
    content.graph.entryNodeId &&
    graphNodesById.has(content.graph.entryNodeId)
  ) {
    connections.unshift({
      order: -1,
      edge: {
        id: `root:${content.graph.entryNodeId}`,
        source: STORY_ROOT_NODE_ID,
        target: content.graph.entryNodeId,
        sourceHandle: "entry",
        targetHandle: "in",
        data: { kind: "root" },
      },
    });
  }
  const edges = connections
    .sort((left, right) => left.order - right.order || left.edge.id.localeCompare(right.edge.id))
    .map(({ edge }) => edge);
  const layoutSeedNodeId = storyWorldNodePresent ? STORY_ROOT_NODE_ID : content.graph.entryNodeId;
  const positions = buildLayeredPositions(projections, edges, layoutSeedNodeId);
  const nodes = projections
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map<StoryCanvasNode>((projection) => ({
      id: projection.id,
      type: "storyCanvas",
      position: positions.get(projection.id) ?? { x: 0, y: 0 },
      deletable: true,
      dragHandle: CANVAS_NODE_DRAG_HANDLE_SELECTOR,
      data: projection.data,
    }));

  return { nodes, edges };
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
    if (node.kind === "clip" && node.exit.kind === "auto") {
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

    if (node.kind === "router") {
      const routes = node.exit.routes
        .map((route, routeIndex) => ({ route, routeIndex }))
        .sort(
          (left, right) =>
            left.route.priority - right.route.priority ||
            left.route.nextNodeId.localeCompare(right.route.nextNodeId) ||
            left.routeIndex - right.routeIndex
        );

      for (const { route, routeIndex } of routes) {
        if (!graphNodesById.has(route.nextNodeId)) continue;
        connections.push({
          order: order++,
          edge: {
            id: `auto:${node.nodeId}:${route.priority}:${routeIndex}:${route.nextNodeId}`,
            source: node.nodeId,
            target: route.nextNodeId,
            sourceHandle: `route:${routeIndex}`,
            targetHandle: "in",
            data: { kind: "auto", priority: route.priority, routeIndex },
          },
        });
      }
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
            label: localizedText(choice.label, locale, choice.choiceId),
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

    if (node.kind !== "clip" || node.exit.kind !== "ending") continue;

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

function projectAutoRoutes(
  routes: Extract<StoryGraphNode, { kind: "router" }>["exit"]["routes"]
): StoryCanvasAutoRouteData[] {
  return routes.map((route, routeIndex) => ({
    routeIndex,
    targetNodeId: route.nextNodeId,
    priority: route.priority,
    hasCondition: route.when !== undefined,
  }));
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

function localizedText(text: Record<string, string>, locale: string, fallback: string): string {
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

export function syntheticDecisionNodeId(sourceNodeId: string): string {
  return `${SYNTHETIC_DECISION_NODE_PREFIX}${sourceNodeId}`;
}

export function syntheticEndingNodeId(endingId: string): string {
  return `${SYNTHETIC_ENDING_NODE_PREFIX}${endingId}`;
}

/**
 * Resolves a presentation-only canvas projection back to its canonical Story
 * domain identifier. Synthetic decision nodes belong to their source graph
 * node, while synthetic ending nodes belong to their Story Bible ending.
 *
 * This direction is intentional: AgentRun DTOs remain domain-only and must
 * never persist React Flow's synthetic identifiers.
 */
export function storyDomainIdForCanvasProjection(canvasNodeId: string): string | null {
  if (canvasNodeId === STORY_ROOT_NODE_ID) return null;
  if (canvasNodeId.startsWith(SYNTHETIC_DECISION_NODE_PREFIX)) {
    return nonEmptySyntheticSource(canvasNodeId, SYNTHETIC_DECISION_NODE_PREFIX);
  }
  if (canvasNodeId.startsWith(SYNTHETIC_ENDING_NODE_PREFIX)) {
    return nonEmptySyntheticSource(canvasNodeId, SYNTHETIC_ENDING_NODE_PREFIX);
  }
  return canvasNodeId;
}

/**
 * Projects canonical AgentRun affected/created ids onto the canvas nodes that
 * currently exist. One graph-node id may intentionally select both its clip
 * or router projection and its presentation-only decision projection.
 */
export function projectStoryDomainIdsToCanvasNodeIds(
  domainIds: Iterable<string>,
  renderedCanvasNodeIds: Iterable<string>
): string[] {
  const domainIdSet = new Set(domainIds);
  const projectedIds: string[] = [];
  const seenCanvasIds = new Set<string>();

  for (const canvasNodeId of renderedCanvasNodeIds) {
    if (seenCanvasIds.has(canvasNodeId)) continue;
    seenCanvasIds.add(canvasNodeId);
    const domainId = storyDomainIdForCanvasProjection(canvasNodeId);
    if (domainId !== null && domainIdSet.has(domainId)) projectedIds.push(canvasNodeId);
  }

  return projectedIds;
}

function nonEmptySyntheticSource(canvasNodeId: string, prefix: string): string | null {
  const sourceId = canvasNodeId.slice(prefix.length);
  return sourceId.length > 0 ? sourceId : null;
}

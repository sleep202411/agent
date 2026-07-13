import type { Edge, Node } from "@xyflow/react";
import type {
  FilmClipProductionStatus,
  FilmClipSummary,
  FilmTrailerSummary,
  InteractiveFilmDraftContent,
  StoryClipPromptDraft,
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
  checkpointTargetNodeId?: string;
  choices?: StoryCanvasChoiceData[];
  autoRoutes?: StoryCanvasAutoRouteData[];
  productionStatus?: FilmClipProductionStatus;
  filmClip?: FilmClipSummary;
  filmTrailer?: FilmTrailerSummary;
  frameAspectRatio?: "16:9" | "9:16";
  directorPrompt?: StoryClipPromptDraft;
  summary?: string;
  rootStats?: {
    characters: number;
    locations: number;
    props: number;
    rules: number;
  };
}

export type StoryCanvasNode = Node<StoryCanvasNodeData, "storyCanvas">;

type StoryCanvasEdgeData =
  | { kind: "root" }
  | { kind: "auto"; priority: number; routeIndex: number }
  | { kind: "decision"; decisionId: string; sourceNodeId: string }
  | { kind: "choice"; choiceId: string }
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

export function normalizeStoryClipPromptDrafts(
  content: InteractiveFilmDraftContent
): InteractiveFilmDraftContent {
  const legacyPrompts = (content as Partial<InteractiveFilmDraftContent>).clipPrompts;
  const existing = Array.isArray(legacyPrompts) ? legacyPrompts : [];
  const existingByNodeId = new Map(existing.map((prompt) => [prompt.graphNodeId, prompt]));
  const clipPrompts = content.graph.nodes.flatMap((node) =>
    node.kind === "clip"
      ? [
          existingByNodeId.get(node.nodeId) ?? {
            graphNodeId: node.nodeId,
            clipKey: node.clipKey,
            title: node.clipKey,
            description: "",
            targetDurationMs: 15_000,
            generationControl: { mode: "frame_lock" as const, frameMode: "first_frame" as const },
            masterDirection: "",
            referenceRoleNotes: [],
            emotionalArc: "",
            beats: [
              {
                id: "beat:1",
                startMs: 0,
                endMs: 15_000,
                visual: "",
                camera: "",
                action: "",
                performance: "",
                emotion: "",
                dialogue: "",
                audio: "",
                endState: "",
                continuity: "",
              },
            ],
            negativeConstraints: [],
            continuityNotes: [],
          },
        ]
      : []
  );
  const trailerPrompt = (content as Partial<InteractiveFilmDraftContent>).trailerPrompt ?? null;
  if (
    clipPrompts.length === existing.length &&
    clipPrompts.every((prompt, index) => prompt === existing[index]) &&
    content.trailerPrompt === trailerPrompt
  ) {
    return content;
  }
  return { ...content, clipPrompts, trailerPrompt };
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
  clips: FilmClipSummary[] = [],
  copy: StoryCanvasCopy = DEFAULT_COPY,
  frameProfile: StoryFrameProfile = "landscape_16_9",
  trailer: FilmTrailerSummary | null = null
): { nodes: StoryCanvasNode[]; edges: StoryCanvasEdge[] } {
  content = normalizeStoryClipPromptDrafts(content);
  const graphNodesById = new Map(content.graph.nodes.map((node) => [node.nodeId, node]));
  const clipsByGraphNodeId = indexClips(clips, (clip) => clip.graphNodeId);
  const clipsByKey = indexClips(clips, (clip) => clip.key);
  const promptByGraphNodeId = new Map(
    content.clipPrompts.map((prompt) => [prompt.graphNodeId, prompt])
  );
  const endingCanvasIds = new Map(
    content.storyBible.endings.map((ending) => [ending.id, syntheticEndingNodeId(ending.id)])
  );
  let clipOrdinal = 0;
  let routerOrdinal = 0;

  const projections: CanvasProjection[] = [
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
          rules: content.storyBible.storyRules.length,
        },
        frameAspectRatio: frameProfile === "portrait_9_16" ? "9:16" : "16:9",
        filmTrailer: trailer ?? undefined,
      },
    },
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
      const clip = clipsByGraphNodeId.get(node.nodeId) ?? clipsByKey.get(node.clipKey);
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
          title: clip?.title.trim() || node.clipKey,
          eyebrow: `${copy.clip} ${String(clipOrdinal).padStart(2, "0")}`,
          nodeId: node.nodeId,
          clipKey: node.clipKey,
          exitKind: node.exit.kind,
          checkpointTargetNodeId:
            node.exit.kind === "checkpoint" ? node.exit.nextNodeId : undefined,
          autoRoutes: node.exit.kind === "auto" ? projectAutoRoutes(node.exit.routes) : undefined,
          productionStatus: clip?.productionStatus,
          filmClip: clip,
          frameAspectRatio:
            clip?.outputContract.aspectRatio ??
            (frameProfile === "portrait_9_16" ? "9:16" : "16:9"),
          directorPrompt: promptByGraphNodeId.get(node.nodeId),
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
  if (content.graph.entryNodeId && graphNodesById.has(content.graph.entryNodeId)) {
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
  const positions = buildLayeredPositions(projections, edges, STORY_ROOT_NODE_ID);
  const nodes = projections
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map<StoryCanvasNode>((projection) => ({
      id: projection.id,
      type: "storyCanvas",
      position: positions.get(projection.id) ?? { x: 0, y: 0 },
      // Node deletion is confirmed in the inspector. Keeping XYFlow keyboard
      // deletion disabled prevents bypassing that domain-level confirmation.
      deletable: false,
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
    if (node.exit.kind === "auto") {
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
            sourceHandle: `${node.kind === "router" ? "route" : "auto"}:${routeIndex}`,
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
          sourceHandle: "choice-trigger",
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
            data: { kind: "choice", choiceId: choice.choiceId },
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
          sourceHandle: "checkpoint",
          targetHandle: "in",
          data: { kind: "checkpoint" },
        },
      });
      continue;
    }

    const target = endingCanvasIds.get(node.exit.endingId);
    if (!target) continue;
    connections.push({
      order: order++,
      edge: {
        id: `ending:${node.nodeId}:${node.exit.endingId}`,
        source: node.nodeId,
        target,
        sourceHandle: "ending",
        targetHandle: "ending-in",
        data: { kind: "ending", endingId: node.exit.endingId },
      },
    });
  }

  return connections;
}

function projectAutoRoutes(
  routes: Extract<StoryGraphNode["exit"], { kind: "auto" }>["routes"]
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
  clips: FilmClipSummary[],
  keyOf: (clip: FilmClipSummary) => string
): Map<string, FilmClipSummary> {
  const ordered = [...clips].sort(
    (left, right) =>
      left.rank - right.rank || left.key.localeCompare(right.key) || left.id.localeCompare(right.id)
  );
  const index = new Map<string, FilmClipSummary>();
  ordered.forEach((clip) => {
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
  return `__decision__:${sourceNodeId}`;
}

export function syntheticEndingNodeId(endingId: string): string {
  return `__ending__:${endingId}`;
}

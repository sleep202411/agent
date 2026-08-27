import type { Edge, Node } from "@xyflow/react";
import type {
  InteractiveStoryDraftContent,
  StoryFrameProfile,
  StoryGraphNode,
  StoryInteractionAction,
  StoryInteractionOutcomes,
  StoryInteractionTrigger,
} from "@/lib/story-projects-api";
import type { WorldModelWorld } from "@repo/shared/world-model-protocol";
import { canvasNodeGeometry } from "@/lib/canvas-core/node-geometry";

type StoryCanvasNodeKind = "clip" | "world" | "decision";
type StoryCanvasExitKind = "auto" | "choice";

export interface StoryCanvasChoiceData {
  choiceId: string;
  label: string;
  targetNodeId: string;
  targetTitle: string | null;
}

export interface StoryCanvasInteractionData {
  interactionId: string;
  label: string;
  startMs: number;
  endMs: number;
  trigger: StoryInteractionTrigger;
  outcomes: {
    success: StoryCanvasInteractionOutcomeData;
    failure?: StoryCanvasInteractionOutcomeData;
    timeout?: StoryCanvasInteractionOutcomeData;
  };
}

export interface StoryCanvasInteractionOutcomeData {
  action: StoryInteractionAction;
  targetTitle: string | null;
}

export interface StoryCanvasNodeData extends Record<string, unknown> {
  kind: StoryCanvasNodeKind;
  title: string;
  eyebrow: string;
  nodeId: string;
  /** Canonical scene whose completion presents this derived decision node. */
  sourceNodeId?: string;
  decisionId?: string;
  clipKey?: string;
  worldId?: string | null;
  world?: WorldModelWorld | null;
  worldEntryInstruction?: string;
  maxExperienceSeconds?: 60 | 90 | 120;
  /** First appearance-reference image, shown as the card avatar. */
  exitKind?: StoryCanvasExitKind;
  continuationTargetNodeId?: string;
  choices?: StoryCanvasChoiceData[];
  interactions?: StoryCanvasInteractionData[];
  frameAspectRatio?: "16:9" | "9:16";
  summary?: string;
}

export type StoryCanvasNode = Node<StoryCanvasNodeData, "storyCanvas">;

type StoryCanvasEdgeData =
  | { kind: "continuation" }
  | { kind: "decision"; sourceNodeId: string; decisionId: string }
  | { kind: "choice"; sourceNodeId: string; choiceId: string }
  | {
      kind: "interaction";
      sourceNodeId: string;
      interactionId: string;
      outcome: keyof StoryInteractionOutcomes;
    };

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

export interface StoryCanvasCopy {
  clip: string;
  world: string;
  decision: string;
}

const DEFAULT_COPY: StoryCanvasCopy = {
  clip: "Clip",
  world: "World",
  decision: "Player decision",
};

/**
 * A decision is canonical data on a scene exit, but it is a first-class canvas
 * element. Its deterministic projection id lets layout survive reloads without
 * creating a second persistence model for the same runtime decision.
 */
export function storyDecisionCanvasNodeId(sourceNodeId: string, decisionId: string): string {
  return `@decision/${encodeURIComponent(sourceNodeId)}/${encodeURIComponent(decisionId)}`;
}

/**
 * Projects the canonical interactive-story draft into a presentation-only
 * React Flow model. The source draft is never decorated or mutated.
 */
export function buildStoryCanvasModel(
  content: InteractiveStoryDraftContent,
  locale: string,
  copyOverrides: Partial<StoryCanvasCopy> = DEFAULT_COPY,
  frameProfile: StoryFrameProfile = "landscape_16_9",
  worlds: WorldModelWorld[] = []
): { nodes: StoryCanvasNode[]; edges: StoryCanvasEdge[] } {
  const copy = { ...DEFAULT_COPY, ...copyOverrides };
  const frameAspectRatioOf = (profile: StoryFrameProfile): "16:9" | "9:16" =>
    profile === "portrait_9_16" ? "9:16" : "16:9";
  const graphNodesById = new Map(content.graph.nodes.map((node) => [node.nodeId, node]));
  const clipOrdinalsByNodeId = new Map<string, number>();
  let nextClipOrdinal = 0;
  content.graph.nodes.forEach((node) => {
    if (node.kind !== "clip") return;
    clipOrdinalsByNodeId.set(node.nodeId, ++nextClipOrdinal);
  });
  const worldsById = new Map(worlds.map((world) => [world.id, world]));
  let clipOrdinal = 0;

  const projections: CanvasProjection[] = content.graph.nodes.flatMap<CanvasProjection>(
    (node, index) => {
      if (node.kind === "world") {
        const worldOrdinal = content.graph.nodes
          .slice(0, index + 1)
          .filter((candidate) => candidate.kind === "world").length;
        const world = node.worldId ? (worldsById.get(node.worldId) ?? null) : null;
        return [
          {
            id: node.nodeId,
            order: index * 10,
            data: {
              kind: "world",
              title: node.name?.trim() || world?.name?.trim() || `${copy.world} ${worldOrdinal}`,
              eyebrow: `${copy.world} ${String(worldOrdinal).padStart(2, "0")}`,
              nodeId: node.nodeId,
              worldId: node.worldId,
              world,
              worldEntryInstruction: node.entryInstruction,
              maxExperienceSeconds: node.maxExperienceSeconds,
              exitKind: "auto",
              continuationTargetNodeId: node.exit.nextNodeId ?? undefined,
              summary: world?.prompt,
            },
          },
        ];
      }
      const choices: StoryCanvasChoiceData[] | undefined =
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
      const interactions = node.interactions.map((interaction) => ({
        interactionId: interaction.interactionId,
        label: localizedText(interaction.label, locale, interaction.interactionId),
        startMs: interaction.startMs,
        endMs: interaction.endMs,
        trigger: interaction.trigger,
        outcomes: mapInteractionOutcomes(interaction.outcomes, (action) => ({
          action,
          targetTitle:
            action.kind === "goto"
              ? graphNodeDisplayTitle(
                  graphNodesById.get(action.nodeId),
                  copy.clip,
                  clipOrdinalsByNodeId.get(action.nodeId)
                )
              : null,
        })),
      }));

      clipOrdinal += 1;
      const clipProjection: CanvasProjection = {
        id: node.nodeId,
        order: index * 10,
        data: {
          kind: "clip",
          title: node.name?.trim() || `${copy.clip} ${clipOrdinal}`,
          eyebrow: `${copy.clip} ${String(clipOrdinal).padStart(2, "0")}`,
          nodeId: node.nodeId,
          clipKey: node.clipKey,
          // A choice scene completes into a derived Decision node. Keeping the
          // scene itself automatic makes the visual grammar unambiguous:
          // Scene -> Decision -> destination Scene.
          exitKind: "auto",
          interactions,
          continuationTargetNodeId:
            node.exit.kind === "auto"
              ? (node.exit.nextNodeId ?? undefined)
              : storyDecisionCanvasNodeId(node.nodeId, node.exit.decisionId),
          frameAspectRatio: frameAspectRatioOf(frameProfile),
        },
      };
      if (node.exit.kind !== "choice") return [clipProjection];

      const choiceExit = node.exit;
      const decisionNodeId = storyDecisionCanvasNodeId(node.nodeId, choiceExit.decisionId);
      return [
        clipProjection,
        {
          id: decisionNodeId,
          order: index * 10 + 1,
          data: {
            kind: "decision",
            title: copy.decision,
            eyebrow: copy.decision,
            nodeId: decisionNodeId,
            sourceNodeId: node.nodeId,
            decisionId: choiceExit.decisionId,
            exitKind: "choice",
            choices,
            summary: localizedText(choiceExit.prompt, locale, ""),
          },
        },
      ];
    }
  );

  const connections = buildConnections(content.graph.nodes, graphNodesById, locale);
  const storyEdges = connections
    .sort((left, right) => left.order - right.order || left.edge.id.localeCompare(right.edge.id))
    .map(({ edge }) => edge);
  const layoutSeedNodeId = content.graph.entryNodeId;
  const positions = buildLayeredPositions(projections, storyEdges, layoutSeedNodeId);

  const edges = storyEdges;

  const nodes = [...projections]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map<StoryCanvasNode>((projection) => ({
      id: projection.id,
      type: "storyCanvas",
      position: positions.get(projection.id) ?? { x: 0, y: 0 },
      data: projection.data,
    }));

  return { nodes, edges };
}

function buildConnections(
  graphNodes: StoryGraphNode[],
  graphNodesById: ReadonlyMap<string, StoryGraphNode>,
  locale: string
): CanvasConnection[] {
  const connections: CanvasConnection[] = [];
  let order = 0;

  for (const node of graphNodes) {
    if (node.kind === "world") {
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
    for (const interaction of node.interactions) {
      for (const [outcome, action] of interactionOutcomeEntries(interaction.outcomes)) {
        if (action.kind !== "goto" || !graphNodesById.has(action.nodeId)) continue;
        connections.push({
          order: order++,
          edge: {
            id: `interaction:${node.nodeId}:${interaction.interactionId}:${outcome}:${action.nodeId}`,
            source: node.nodeId,
            target: action.nodeId,
            sourceHandle: `interaction:${interaction.interactionId}:${outcome}`,
            targetHandle: "in",
            label: localizedText(interaction.label, locale, interaction.interactionId),
            data: {
              kind: "interaction",
              sourceNodeId: node.nodeId,
              interactionId: interaction.interactionId,
              outcome,
            },
          },
        });
      }
    }

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
      const decisionNodeId = storyDecisionCanvasNodeId(node.nodeId, node.exit.decisionId);
      connections.push({
        order: order++,
        edge: {
          id: `decision:${node.nodeId}:${node.exit.decisionId}`,
          source: node.nodeId,
          target: decisionNodeId,
          sourceHandle: "completion",
          targetHandle: "in",
          data: {
            kind: "decision",
            sourceNodeId: node.nodeId,
            decisionId: node.exit.decisionId,
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

function interactionOutcomeEntries(
  outcomes: StoryInteractionOutcomes
): Array<[keyof StoryInteractionOutcomes, StoryInteractionAction]> {
  const entries: Array<[keyof StoryInteractionOutcomes, StoryInteractionAction]> = [
    ["success", outcomes.success],
  ];
  if (outcomes.failure) entries.push(["failure", outcomes.failure]);
  if (outcomes.timeout) entries.push(["timeout", outcomes.timeout]);
  return entries;
}

function mapInteractionOutcomes<T>(
  outcomes: StoryInteractionOutcomes,
  map: (action: StoryInteractionAction) => T
): { success: T; failure?: T; timeout?: T } {
  return {
    success: map(outcomes.success),
    ...(outcomes.failure ? { failure: map(outcomes.failure) } : {}),
    ...(outcomes.timeout ? { timeout: map(outcomes.timeout) } : {}),
  };
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
    // bottom of every tall card — a clip with several interaction anchors is
    // nearly twice as tall — and the default layout runs before React Flow can measure, so the
    // estimate has to come from the projection itself.
    // Every column is centred on one shared horizontal axis: a two-card column
    // and a nine-card column read as one balanced band instead of both hanging
    // from the top. Centring uses real card heights, so a tall interactive clip
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
  return canvasNodeGeometry({ type: "storyCanvas", data }).estimatedHeight;
}

export function localizedText(
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
  if (node.kind === "world") return node.name?.trim() || node.nodeId;
  return node.name?.trim() || (clipOrdinal ? `${clipLabel} ${clipOrdinal}` : node.clipKey);
}

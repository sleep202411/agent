import { isConnectionTargetKindAllowed, normalizePersistedEdgeHandles } from "./ports";
import type { NarrativeEdge, NarrativeNode, StoryCanvasSnapshot } from "./types";

/** Draft snapshot format written by THIS client (v2 carries storySpec).
 *  The server refuses schema downgrades, so newer drafts survive old
 *  clients. */
export const STORY_CANVAS_SCHEMA_VERSION = "story-studio-canvas-v2";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPersistedNarrativeNode(value: unknown): value is NarrativeNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (!isRecord(value.position)) return false;
  if (typeof value.position.x !== "number" || typeof value.position.y !== "number") {
    return false;
  }
  if (!isRecord(value.data)) return false;
  // Unknown kinds are PRESERVED (forward compat): a draft written by a newer
  // client must survive a round-trip through this one, not lose nodes.
  if (typeof value.data.kind !== "string" || !value.data.kind) return false;
  return typeof value.data.label === "string" && typeof value.data.eyebrow === "string";
}

function isPersistedNarrativeEdge(value: unknown): value is NarrativeEdge {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.target === "string"
  );
}

export function parseStoryCanvasSnapshot(snapshot: unknown): {
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
  base: StoryCanvasSnapshot;
} {
  const base = isRecord(snapshot) ? (snapshot as StoryCanvasSnapshot) : {};
  const canvas = isRecord(base.canvas) ? base.canvas : {};
  const nodes = Array.isArray(canvas.nodes)
    ? canvas.nodes.filter(isPersistedNarrativeNode).map((node) => ({
        ...node,
        type: "narrative" as const,
        data: { ...node.data },
        selected: false,
        dragging: false,
      }))
    : [];
  const normalizedNodes = nodes;
  const nodeKindById = new Map(normalizedNodes.map((node) => [node.id, node.data.kind]));
  const edges = Array.isArray(canvas.edges)
    ? canvas.edges
        .filter(isPersistedNarrativeEdge)
        .map((edge) => normalizePersistedEdgeHandles(edge, nodeKindById.get(edge.target)))
        .filter((edge) =>
          isConnectionTargetKindAllowed(
            edge.sourceHandle,
            nodeKindById.get(edge.target),
            edge.source
          )
        )
    : [];

  return { nodes: normalizedNodes, edges, base };
}

function serializeNarrativeNodes(nodes: NarrativeNode[]): NarrativeNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "narrative",
    position: node.position,
    data: {
      ...node.data,
      onViewStoryRoot: undefined,
      onViewCharacter: undefined,
      onEditNode: undefined,
      storyRootStats: undefined,
    },
    hidden: node.hidden,
    draggable: node.draggable,
    selectable: node.selectable,
    deletable: node.deletable,
    sourcePosition: node.sourcePosition,
    targetPosition: node.targetPosition,
    parentId: node.parentId,
    extent: node.extent,
    expandParent: node.expandParent,
    origin: node.origin,
    className: node.className,
    style: node.style,
  }));
}

function serializeNarrativeEdges(edges: NarrativeEdge[]): NarrativeEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type,
    label: edge.label,
    animated: edge.animated,
    hidden: edge.hidden,
    deletable: edge.deletable,
    selectable: edge.selectable,
    style: edge.style,
    className: edge.className,
    markerEnd: edge.markerEnd,
    pathOptions: edge.pathOptions,
    labelBgBorderRadius: edge.labelBgBorderRadius,
    labelBgPadding: edge.labelBgPadding,
    labelBgStyle: edge.labelBgStyle,
    labelStyle: edge.labelStyle,
    interactionWidth: edge.interactionWidth,
    data: edge.data,
  }));
}

export function buildStoryCanvasSnapshot(
  base: StoryCanvasSnapshot,
  nodes: NarrativeNode[],
  edges: NarrativeEdge[],
  storySpec?: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    ...base,
    // This client always writes the CURRENT format — the server refuses the
    // reverse direction (schema downgrade guard).
    schemaVersion: STORY_CANVAS_SCHEMA_VERSION,
    ...(storySpec ? { storySpec } : {}),
    canvas: {
      ...(isRecord(base.canvas) ? base.canvas : {}),
      nodes: serializeNarrativeNodes(nodes),
      edges: serializeNarrativeEdges(edges),
    },
  };
}

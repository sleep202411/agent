import type { Edge, Node } from "@xyflow/react";
import { canvasNodeGeometry } from "@/lib/canvas-core/node-geometry";

/**
 * Which nodes and edges one tidy pass should lay out: the selection when a
 * canvas opts into selection-scoped tidying and more than one node is selected,
 * otherwise the whole canvas. Edges are narrowed to those internal to the
 * target set so tidying part of a graph is not skewed by links leaving it.
 */
export function resolveCanvasTidyTargets<NodeType extends Node, EdgeType extends Edge>(
  nodes: NodeType[],
  edges: EdgeType[],
  tidySelection = false
): { nodes: NodeType[]; edges: EdgeType[] } {
  const selected = tidySelection ? nodes.filter((node) => node.selected) : [];
  const targetNodes = selected.length > 1 ? selected : nodes;
  const targetIds = new Set(targetNodes.map((node) => node.id));
  return {
    nodes: targetNodes,
    edges: edges.filter((edge) => targetIds.has(edge.source) && targetIds.has(edge.target)),
  };
}

/** Height to reserve for a node React Flow has not measured yet. */
export type CanvasNodeHeightEstimate = (node: Node) => number | undefined;

export type CanvasTidyDirection = "RIGHT" | "DOWN" | "LEFT" | "UP";
export type CanvasTidyLaneSide = "left" | "right" | "above" | "below";

/**
 * A semantic lane is deliberately kept outside the graph flow. A cast roster,
 * legend or annotation rail belongs beside the graph; treating it as a group
 * of disconnected graph nodes would let component packing scatter it.
 */
export interface CanvasTidyLane<NodeType extends Node = Node> {
  id: string;
  side: CanvasTidyLaneSide;
  matches: (node: NodeType) => boolean;
  /** Clear distance between this lane and the graph (or the previous lane). */
  gap?: number;
  /** Clear distance between nodes inside the lane. */
  nodeGap?: number;
}

export interface CanvasTidyLayoutOptions<NodeType extends Node = Node> {
  direction?: CanvasTidyDirection;
  nodeSpacing?: number;
  layerSpacing?: number;
  componentSpacing?: number;
  /** Desired width / height for packing disconnected graph components. */
  componentAspectRatio?: number;
  lanes?: readonly CanvasTidyLane<NodeType>[];
}

export interface CanvasTidyLayoutNode {
  id: string;
  width: number;
  height: number;
  position: { x: number; y: number };
}

export interface CanvasTidyLayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface CanvasTidyLayoutLane {
  id: string;
  side: CanvasTidyLaneSide;
  nodeIds: string[];
  gap: number;
  nodeGap: number;
}

/** Immutable contract consumed by the shared layout engine. */
export interface CanvasTidyLayoutRequest {
  nodes: CanvasTidyLayoutNode[];
  edges: CanvasTidyLayoutEdge[];
  direction: CanvasTidyDirection;
  nodeSpacing: number;
  layerSpacing: number;
  componentSpacing: number;
  componentAspectRatio: number;
  lanes: CanvasTidyLayoutLane[];
}

export interface CanvasTidyPosition {
  id: string;
  position: { x: number; y: number };
}

const DEFAULT_NODE_SPACING = 72;
const DEFAULT_LAYER_SPACING = 120;
const DEFAULT_COMPONENT_SPACING = 180;
const DEFAULT_COMPONENT_ASPECT_RATIO = 16 / 9;

/**
 * Converts React Flow's runtime model into an immutable, serializable layout
 * request. Real DOM measurements win; semantic estimates cover the first pass
 * before React Flow has measured a card.
 */
export function createCanvasTidyLayoutRequest<NodeType extends Node = Node>(
  nodes: NodeType[],
  edges: Edge[],
  estimateHeight?: CanvasNodeHeightEstimate,
  options: CanvasTidyLayoutOptions<NodeType> = {}
): CanvasTidyLayoutRequest {
  const ids = new Set(nodes.map((node) => node.id));
  const resolvedNodes = nodes.map((node) => {
    const geometry = canvasNodeGeometry(node);
    return {
      id: node.id,
      width: positive(node.measured?.width) ?? positive(node.width) ?? geometry.width,
      height:
        positive(node.measured?.height) ??
        positive(node.height) ??
        positive(estimateHeight?.(node)) ??
        geometry.estimatedHeight,
      position: {
        x: finite(node.position.x),
        y: finite(node.position.y),
      },
    };
  });

  const assignedLane = new Set<string>();
  const lanes = (options.lanes ?? []).map<CanvasTidyLayoutLane>((lane) => {
    const nodeIds = nodes
      .filter((node) => !assignedLane.has(node.id) && lane.matches(node))
      .map((node) => {
        assignedLane.add(node.id);
        return node.id;
      });
    return {
      id: lane.id,
      side: lane.side,
      nodeIds,
      gap: positive(lane.gap) ?? DEFAULT_COMPONENT_SPACING,
      nodeGap: positive(lane.nodeGap) ?? DEFAULT_NODE_SPACING,
    };
  });

  return {
    nodes: resolvedNodes,
    edges: edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge, index) => ({
        // React Flow edge ids should already be unique. The index also makes
        // the worker contract robust to imported canvases that violate that.
        id: `${index}:${edge.id}`,
        source: edge.source,
        target: edge.target,
      })),
    direction: options.direction ?? "RIGHT",
    nodeSpacing: positive(options.nodeSpacing) ?? DEFAULT_NODE_SPACING,
    layerSpacing: positive(options.layerSpacing) ?? DEFAULT_LAYER_SPACING,
    componentSpacing: positive(options.componentSpacing) ?? DEFAULT_COMPONENT_SPACING,
    componentAspectRatio: positive(options.componentAspectRatio) ?? DEFAULT_COMPONENT_ASPECT_RATIO,
    lanes,
  };
}

/**
 * Direct layout entry point for tests and non-UI consumers. In the browser the
 * engine delegates every expensive ELK pass to ELK's native worker.
 */
export async function computeCanvasTidyLayout<NodeType extends Node = Node>(
  nodes: NodeType[],
  edges: Edge[],
  estimateHeight?: CanvasNodeHeightEstimate,
  options?: CanvasTidyLayoutOptions<NodeType>
): Promise<CanvasTidyPosition[]> {
  return computeCanvasTidyLayoutRequest(
    createCanvasTidyLayoutRequest(nodes, edges, estimateHeight, options)
  );
}

export async function computeCanvasTidyLayoutRequest(
  request: CanvasTidyLayoutRequest
): Promise<CanvasTidyPosition[]> {
  const { layoutCanvasTidyGraph } = await import("./elk-canvas-layout-engine");
  return layoutCanvasTidyGraph(request);
}

function positive(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

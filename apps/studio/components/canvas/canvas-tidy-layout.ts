import type { Edge, Node } from "@xyflow/react";

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

/**
 * Height to reserve for a node React Flow has not measured yet.
 *
 * A canvas whose cards differ wildly in height — a three-option decision card is
 * roughly twice a clip card — must supply its own estimate, or every unmeasured
 * tall card overlaps the one beneath it.
 */
export type CanvasNodeHeightEstimate = (node: Node) => number;

const DEFAULT_UNMEASURED_HEIGHT = 200;
const ROW_GAP = 48;

/**
 * Dependency-free layered layout shared by every authoring canvas. Nodes flow
 * left-to-right by longest-path depth and stack vertically within each column,
 * advancing by each node's real height so cards never overlap.
 */
export function computeCanvasTidyLayout(
  nodes: Node[],
  edges: Edge[],
  estimateHeight?: CanvasNodeHeightEstimate
): { id: string; position: { x: number; y: number } }[] {
  if (nodes.length === 0) return [];
  const ids = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const depth = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of validEdges) {
      const next = (depth.get(edge.source) ?? 0) + 1;
      if (next > (depth.get(edge.target) ?? 0)) {
        depth.set(edge.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, Node[]>();
  nodes.forEach((node) => {
    const column = depth.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node]);
  });

  const positions: { id: string; position: { x: number; y: number } }[] = [];
  let x = 0;
  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    const columnNodes = columns.get(column) ?? [];
    const columnWidth = Math.max(...columnNodes.map((node) => node.measured?.width ?? 280));
    const heights = columnNodes.map(
      (node) => node.measured?.height ?? estimateHeight?.(node) ?? DEFAULT_UNMEASURED_HEIGHT
    );
    // Columns share one horizontal centreline. Top-aligning them left a short
    // column stranded at the top of a tall neighbour, which reads as a mistake
    // on any graph whose branches differ in length.
    const total = heights.reduce((sum, height) => sum + height, 0) + ROW_GAP * (heights.length - 1);
    let y = -total / 2;
    columnNodes.forEach((node, row) => {
      const rounded = Math.round(y);
      positions.push({
        id: node.id,
        position: { x: Math.round(x), y: rounded === 0 ? 0 : rounded },
      });
      y += heights[row]! + ROW_GAP;
    });
    x += columnWidth + 80;
  }
  return positions;
}

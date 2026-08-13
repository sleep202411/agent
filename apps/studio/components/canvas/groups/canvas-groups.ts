import type { Node, NodeChange } from "@xyflow/react";
import type { CanvasGroup } from "@/lib/canvas-core/types";
import { canvasNodeLayoutSize } from "@/lib/canvas-core/node-geometry";
export {
  addNodesToCanvasGroup,
  canvasGroupingAction,
  groupCanvasNodes,
  reconcileCanvasGroups,
  removeNodesFromCanvasGroups,
  sameCanvasGroups,
  setCanvasGroupColor,
  ungroupCanvasNodes,
  type CanvasGroupingAction,
} from "@/lib/canvas-core/canvas-groups";

export interface CanvasGroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GROUP_PADDING_X = 36;
const GROUP_PADDING_Y = 36;

export function canvasGroupBounds(
  nodes: readonly Node[],
  nodeIds: Iterable<string>
): CanvasGroupBounds | null {
  const members = new Set(nodeIds);
  const groupedNodes = nodes.filter((node) => members.has(node.id));
  if (groupedNodes.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  groupedNodes.forEach((node) => {
    const { width, height } = canvasNodeLayoutSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  });

  return {
    x: minX - GROUP_PADDING_X,
    y: minY - GROUP_PADDING_Y,
    width: maxX - minX + GROUP_PADDING_X * 2,
    height: maxY - minY + GROUP_PADDING_Y * 2,
  };
}

export function canvasGroupAtPoint(
  groups: readonly CanvasGroup[],
  nodes: readonly Node[],
  point: { x: number; y: number }
): CanvasGroup | null {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group) continue;
    const bounds = canvasGroupBounds(nodes, group.nodeIds);
    if (
      bounds &&
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    ) {
      return group;
    }
  }
  return null;
}

export function canvasGroupDropTarget(
  groups: readonly CanvasGroup[],
  nodes: readonly Node[],
  draggedNode: Node,
  draggedNodeIds: Iterable<string>,
  minimumOverlap = 0.5
): CanvasGroup | null {
  const dragged = new Set(draggedNodeIds);
  if (dragged.size === 0) return null;

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group || group.nodeIds.some((nodeId) => dragged.has(nodeId))) continue;
    const bounds = canvasGroupBounds(nodes, group.nodeIds);
    if (!bounds) continue;
    if (canvasNodeOverlapRatio(draggedNode, bounds) > minimumOverlap) return group;
  }
  return null;
}

export function canvasNodeOverlapRatio(node: Node, bounds: CanvasGroupBounds): number {
  const { width: nodeWidth, height: nodeHeight } = canvasNodeLayoutSize(node);
  const nodeArea = nodeWidth * nodeHeight;
  if (nodeArea <= 0) return 0;
  const overlapWidth = Math.max(
    0,
    Math.min(node.position.x + nodeWidth, bounds.x + bounds.width) -
      Math.max(node.position.x, bounds.x)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(node.position.y + nodeHeight, bounds.y + bounds.height) -
      Math.max(node.position.y, bounds.y)
  );
  return (overlapWidth * overlapHeight) / nodeArea;
}

export function canvasGroupPositionChanges(
  nodes: readonly Node[],
  nodeIds: Iterable<string>,
  delta: { x: number; y: number },
  dragging: boolean
): NodeChange[] {
  const members = new Set(nodeIds);
  return nodes
    .filter((node) => members.has(node.id))
    .map((node) => ({
      type: "position",
      id: node.id,
      position: {
        x: node.position.x + delta.x,
        y: node.position.y + delta.y,
      },
      dragging,
    }));
}

export function nextCanvasGroupCenter(nodes: readonly Node[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 160, y: 120 };
  const maxX = Math.max(...nodes.map((node) => node.position.x + canvasNodeLayoutSize(node).width));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  return { x: maxX + 360, y: minY + 180 };
}

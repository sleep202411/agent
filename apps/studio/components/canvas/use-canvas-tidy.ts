"use client";

import { useCallback } from "react";
import {
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { computeCanvasTidyLayout, resolveCanvasTidyTargets } from "./canvas-tidy-layout";

/**
 * React Flow wiring for {@link computeCanvasTidyLayout}, shared by every
 * authoring canvas so the layout, the fit-view framing and the selection
 * semantics are identical wherever "tidy" is offered.
 *
 * Positions are pushed through the caller's own `onNodesChange`, so a canvas
 * that guards layout mutations keeps guarding them here — tidy never becomes a
 * side door around a permission barrier.
 */
export function useCanvasTidy<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  edges,
  onNodesChange,
  tidySelection = false,
  onTidied,
}: {
  edges: EdgeType[];
  onNodesChange: (changes: NodeChange<NodeType>[]) => void;
  /** Tidy only the selection once more than one node is selected. */
  tidySelection?: boolean;
  /**
   * Receives the repositioned nodes so a canvas that persists layout separately
   * from `onNodesChange` can commit them. Omit when the change stream already
   * lands positions — a tidy the viewer sees but the store forgets is worse than
   * no tidy at all.
   */
  onTidied?: (nodes: NodeType[]) => void;
}) {
  const { fitView, getNodes } = useReactFlow<NodeType, EdgeType>();

  return useCallback(
    (padding?: FitViewOptions["padding"]) => {
      const target = resolveCanvasTidyTargets(getNodes(), edges, tidySelection);
      const targetNodeIds = new Set(target.nodes.map((node) => node.id));
      const positions = computeCanvasTidyLayout(target.nodes, target.edges);
      if (positions.length === 0) return;
      onNodesChange(
        positions.map((position) => ({
          type: "position" as const,
          id: position.id,
          position: position.position,
          dragging: false,
        }))
      );
      if (onTidied) {
        // Derived from the freshly computed positions rather than read back from
        // `getNodes()`, which has not re-rendered yet at this point.
        const tidied = new Map(positions.map((position) => [position.id, position.position]));
        onTidied(
          getNodes().map((node) => {
            const position = tidied.get(node.id);
            return position ? { ...node, position } : node;
          })
        );
      }
      window.setTimeout(() => {
        void fitView({
          nodes: getNodes().filter((node) => targetNodeIds.has(node.id)),
          padding: padding ?? (tidySelection ? 0.7 : 0.3),
          duration: 280,
        });
      }, 60);
    },
    [edges, fitView, getNodes, onNodesChange, onTidied, tidySelection]
  );
}

"use client";

import { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import {
  computeCanvasTidyLayoutRequest,
  createCanvasTidyLayoutRequest,
  resolveCanvasTidyTargets,
  type CanvasNodeHeightEstimate,
  type CanvasTidyLayoutOptions,
} from "./canvas-tidy-layout";

/**
 * React Flow wiring for the shared canvas layout engine. Positions still pass
 * through each canvas's own change and persistence boundaries; the worker only
 * computes geometry and never becomes a side door around permissions or undo.
 */
export function useCanvasTidy<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  edges,
  onNodesChange,
  tidySelection = false,
  onTidied,
  estimateHeight,
  layoutOptions,
}: {
  edges: EdgeType[];
  onNodesChange: (changes: NodeChange<NodeType>[]) => void;
  /** Tidy only the selection once more than one node is selected. */
  tidySelection?: boolean;
  /** Commit hook for canvases whose layout persistence is separate from changes. */
  onTidied?: (nodes: NodeType[]) => void;
  /** Height to reserve before React Flow has measured a card. */
  estimateHeight?: CanvasNodeHeightEstimate;
  /** Direction, spacing and semantic side-lane policy for this canvas. */
  layoutOptions?: CanvasTidyLayoutOptions<NodeType>;
}) {
  const t = useTranslations("canvas");
  const { fitView, getNodes } = useReactFlow<NodeType, EdgeType>();
  const runVersion = useRef(0);

  return useCallback(
    (padding?: FitViewOptions["padding"]) => {
      const version = ++runVersion.current;
      const target = resolveCanvasTidyTargets(getNodes(), edges, tidySelection);
      if (target.nodes.length === 0) return;
      const request = createCanvasTidyLayoutRequest(
        target.nodes,
        target.edges,
        estimateHeight,
        layoutOptions
      );
      const requestSignature = JSON.stringify(request);

      void computeCanvasTidyLayoutRequest(request)
        .then((positions) => {
          if (version !== runVersion.current) return;

          // Discard a result computed for a graph or selection that changed
          // while ELK was working. Applying stale geometry is worse than doing
          // nothing, especially when a concurrent edit deleted an endpoint.
          const latestTarget = resolveCanvasTidyTargets(getNodes(), edges, tidySelection);
          const latestRequest = createCanvasTidyLayoutRequest(
            latestTarget.nodes,
            latestTarget.edges,
            estimateHeight,
            layoutOptions
          );
          if (JSON.stringify(latestRequest) !== requestSignature) return;

          const targetNodeIds = new Set(positions.map((position) => position.id));
          onNodesChange(
            positions.map((position) => ({
              type: "position" as const,
              id: position.id,
              position: position.position,
              dragging: false,
            }))
          );
          if (onTidied) {
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
              duration: 320,
            });
          }, 60);
        })
        .catch((error: unknown) => {
          if (version !== runVersion.current) return;
          toast.error(
            t("tidyFailed", {
              message: error instanceof Error ? error.message : String(error),
            })
          );
        });
    },
    [
      edges,
      estimateHeight,
      fitView,
      getNodes,
      layoutOptions,
      onNodesChange,
      onTidied,
      t,
      tidySelection,
    ]
  );
}

"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { CanvasEdgeShape, CanvasNodeShape } from "@/lib/canvas-core/types";
import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
import {
  ADD_NODE_SHORTCUTS,
  DEFAULT_ADD_NODE_ACTIONS,
  type AddNodeAction,
} from "@/components/canvas/add-node-menu";
import {
  SHOT_NODE_TYPE,
  shotNodeData,
  shotOrderBetween,
  sortedShots,
} from "@/lib/canvas-authoring/shot-node";
import type { GenerationNodeData } from "./generation-card";
import type { CardReferences } from "./reference-stack";

const PASTE_OFFSET = 32;

type CanvasClipboard = {
  nodes: CanvasNodeShape[];
  edges: CanvasEdgeShape[];
};

function toNodeShape(node: Node): CanvasNodeShape {
  return {
    id: node.id,
    type: node.type ?? "note",
    position: node.position,
    data: (node.data ?? {}) as Record<string, unknown>,
  };
}

function remapReferences(
  data: Record<string, unknown>,
  nodeIds: ReadonlyMap<string, string>,
  edgeIds: ReadonlyMap<string, string>
): Record<string, unknown> {
  const references = (data as GenerationNodeData).references;
  if (!references) return data;
  const next: CardReferences = {};
  for (const [field, list] of Object.entries(references)) {
    const remapped = list
      .filter((reference) => !reference.edgeId || edgeIds.has(reference.edgeId))
      .map((reference) => {
        const edgeId = reference.edgeId ? edgeIds.get(reference.edgeId) : undefined;
        return {
          ...reference,
          id: edgeId ?? crypto.randomUUID(),
          edgeId,
          sourceNodeId: reference.sourceNodeId
            ? (nodeIds.get(reference.sourceNodeId) ?? reference.sourceNodeId)
            : undefined,
        };
      });
    if (remapped.length > 0) next[field] = remapped;
  }
  return { ...data, references: next };
}

function cloneForPaste(
  nodes: readonly CanvasNodeShape[],
  edges: readonly CanvasEdgeShape[],
  existingNodes: readonly Node[]
): CanvasClipboard {
  const nodeIds = new Map(nodes.map((node) => [node.id, crypto.randomUUID()] as const));
  const edgeIds = new Map(edges.map((edge) => [edge.id, crypto.randomUUID()] as const));
  // Shot order keys are unique positions in the storyboard, not content — a
  // pasted shot appends to the end of the board rather than cloning its
  // original's slot (two rows claiming one position is a broken storyboard).
  let lastShotOrder = shotNodeData(sortedShots(existingNodes).at(-1)).order ?? null;
  return {
    nodes: nodes.map((node) => {
      let data = remapReferences(node.data, nodeIds, edgeIds);
      if (node.type === SHOT_NODE_TYPE) {
        lastShotOrder = shotOrderBetween(lastShotOrder, null);
        data = { ...data, order: lastShotOrder };
      }
      return {
        ...node,
        id: nodeIds.get(node.id) ?? crypto.randomUUID(),
        position: {
          x: node.position.x + PASTE_OFFSET,
          y: node.position.y + PASTE_OFFSET,
        },
        data,
      };
    }),
    edges: edges.map((edge) => ({
      id: edgeIds.get(edge.id) ?? crypto.randomUUID(),
      source: nodeIds.get(edge.source) ?? edge.source,
      target: nodeIds.get(edge.target) ?? edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

/**
 * Shared authoring keyboard behavior for every product-owned canvas.
 *
 * The clipboard is intentionally in-memory: canvas nodes can contain signed
 * URLs and product context, so they must not leak into the operating-system
 * clipboard. Duplicated generation references are remapped to the cloned
 * internal edges, preserving a valid local dataflow graph.
 */
export function useCanvasAuthoringShortcuts({
  enabled,
  edges,
  getNodes,
  addNodesAndEdges,
  selectNodes,
  addNode,
  addNodeActions = DEFAULT_ADD_NODE_ACTIONS,
}: {
  enabled: boolean;
  edges: readonly Edge[];
  getNodes: () => Node[];
  addNodesAndEdges: CanvasGraphStore["addNodesAndEdges"];
  selectNodes: CanvasGraphStore["selectNodes"];
  addNode: (action: AddNodeAction) => void;
  /** Only the creation actions this canvas offers get a shortcut key. */
  addNodeActions?: readonly AddNodeAction[];
}) {
  const clipboard = useRef<CanvasClipboard | null>(null);

  const collectSelection = useCallback((): CanvasClipboard | null => {
    const selected = getNodes().filter((node) => node.selected);
    if (selected.length === 0) return null;
    const ids = new Set(selected.map((node) => node.id));
    return {
      nodes: selected.map(toNodeShape),
      edges: edges
        .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
        })),
    };
  }, [edges, getNodes]);

  const placeClone = useCallback(
    (source: CanvasClipboard | null) => {
      if (!source || source.nodes.length === 0) return;
      const clone = cloneForPaste(source.nodes, source.edges, getNodes());
      addNodesAndEdges(clone.nodes, clone.edges);
      selectNodes(clone.nodes.map((node) => node.id));
    },
    [addNodesAndEdges, getNodes, selectNodes]
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;

      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && key === "c") {
        event.preventDefault();
        clipboard.current = collectSelection();
        return;
      }
      if (mod && key === "v") {
        event.preventDefault();
        placeClone(clipboard.current);
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        placeClone(collectSelection());
        return;
      }
      if (mod || event.altKey) return;

      const action =
        addNodeActions.find((candidate) => ADD_NODE_SHORTCUTS[candidate] === key) ?? null;
      if (!action) return;
      event.preventDefault();
      addNode(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addNode, addNodeActions, collectSelection, enabled, placeClone]);
}

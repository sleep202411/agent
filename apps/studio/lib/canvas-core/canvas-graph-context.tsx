"use client";

import { createContext, useContext } from "react";
import type { Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";
import type { CanvasAsset, CanvasEdgeShape, CanvasNodeShape } from "./types";

/**
 * Product-neutral authoring graph port.
 *
 * Creative Studio supplies a collaborative Yjs adapter. Story Studio supplies
 * a project-document adapter. Persistence-specific operations intentionally
 * stay outside this contract.
 */
export interface CanvasGraphStore {
  nodes: Node[];
  edges: Edge[];
  getNode: (id: string) => CanvasNodeShape | null;
  /**
   * Every node, read straight from the store. Unlike `nodes` (render-derived,
   * a commit behind) this reflects a write immediately — use it whenever a
   * decision depends on edits made earlier in the same turn.
   */
  getNodes: () => CanvasNodeShape[];
  getEdges: () => CanvasEdgeShape[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  addNode: (node: CanvasNodeShape) => void;
  addEdge: (edge: CanvasEdgeShape) => void;
  addNodesAndEdges: (nodes: CanvasNodeShape[], edges: CanvasEdgeShape[]) => void;
  patchNodeData: (
    id: string,
    patch: Record<string, unknown> | ((node: CanvasNodeShape) => Record<string, unknown>)
  ) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  addLocalNode: (node: CanvasNodeShape) => void;
  promoteLocalNode: (id: string, data: Record<string, unknown>) => void;
  selectNodes: (ids: string[]) => void;
  assets: CanvasAsset[];
  addAssets: (assets: CanvasAsset[]) => void;
  renameAssetsByMediaAssetId: (mediaAssetId: string, name: string) => void;
  removeAsset: (id: string) => void;
  removeAssetsByMediaAssetId: (mediaAssetId: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  canEdit: boolean;
}

const CanvasGraphContext = createContext<CanvasGraphStore | null>(null);

export const CanvasGraphProvider = CanvasGraphContext.Provider;

export function useCanvasGraphContext(): CanvasGraphStore {
  const graph = useContext(CanvasGraphContext);
  if (!graph) {
    throw new Error("useCanvasGraphContext must be used within a CanvasGraphProvider");
  }
  return graph;
}

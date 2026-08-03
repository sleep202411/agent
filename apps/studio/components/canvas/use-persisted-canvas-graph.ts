"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { CANVAS_NODE_DRAG_HANDLE_SELECTOR } from "./canvas-interaction-policy";
import type { CanvasAsset, CanvasEdgeShape, CanvasNodeShape } from "@/lib/canvas-core/types";
import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";

export interface PersistedCanvasSnapshot {
  nodes: CanvasNodeShape[];
  edges: CanvasEdgeShape[];
  assets: CanvasAsset[];
}

export type PersistedCanvasStatus = "loading" | "ready" | "saving" | "saved" | "error";

export interface PersistedCanvasAdapter<
  Snapshot extends PersistedCanvasSnapshot = PersistedCanvasSnapshot,
> {
  load: (signal: AbortSignal) => Promise<Snapshot>;
  save: (
    snapshot: Snapshot,
    request?: {
      keepalive?: boolean;
    }
  ) => Promise<void>;
}

export interface PersistedCanvasGraphResult<
  Snapshot extends PersistedCanvasSnapshot = PersistedCanvasSnapshot,
> {
  graph: CanvasGraphStore;
  status: PersistedCanvasStatus;
  error: string | null;
  retry: () => void;
  flush: (request?: { keepalive?: boolean }) => Promise<void>;
  requestSave: () => void;
  commitSnapshotUpdate: (update: (current: Snapshot) => Snapshot | null) => boolean;
  isNodePersisted: (id: string) => boolean;
}

const SAVE_DEBOUNCE_MS = 650;
const HISTORY_LIMIT = 80;
const EDGE_TYPE = "gradient";

function shapeToNode(shape: CanvasNodeShape): Node {
  const node: Node = {
    id: shape.id,
    type: shape.type,
    position: shape.position,
    data: shape.data,
    dragHandle: CANVAS_NODE_DRAG_HANDLE_SELECTOR,
  };
  if (shape.width != null && shape.height != null) {
    node.measured = { width: shape.width, height: shape.height };
  }
  return node;
}

function nodeToShape(node: Node): CanvasNodeShape {
  return {
    id: node.id,
    type: node.type ?? "note",
    position: node.position,
    data: (node.data ?? {}) as Record<string, unknown>,
    ...(node.measured?.width != null ? { width: node.measured.width } : {}),
    ...(node.measured?.height != null ? { height: node.measured.height } : {}),
  };
}

function shapeToEdge(shape: CanvasEdgeShape): Edge {
  return {
    id: shape.id,
    source: shape.source,
    target: shape.target,
    sourceHandle: shape.sourceHandle ?? undefined,
    targetHandle: shape.targetHandle ?? undefined,
    type: EDGE_TYPE,
  };
}

function edgeToShape(edge: Edge): CanvasEdgeShape {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  };
}

function cloneSnapshot<Snapshot extends PersistedCanvasSnapshot>(snapshot: Snapshot): Snapshot {
  return structuredClone(snapshot);
}

function snapshotFrom(
  nodes: readonly Node[],
  edges: readonly Edge[],
  assets: readonly CanvasAsset[],
  localOnlyIds: ReadonlySet<string>
): PersistedCanvasSnapshot {
  return {
    nodes: nodes.filter((node) => !localOnlyIds.has(node.id)).map(nodeToShape),
    edges: edges
      .filter((edge) => !localOnlyIds.has(edge.source) && !localOnlyIds.has(edge.target))
      .map(edgeToShape),
    assets: assets.map((asset) => ({ ...asset })),
  };
}

/**
 * Plain persisted graph adapter used by product-owned canvas documents.
 *
 * It has the same editing contract as the collaborative Yjs graph, including
 * optimistic local upload nodes and bounded undo/redo, while persistence stays
 * replaceable behind load/save. Saves are serialized and coalesced so a slow
 * request can never overwrite a newer local snapshot.
 */
export function usePersistedCanvasGraph<
  Snapshot extends PersistedCanvasSnapshot = PersistedCanvasSnapshot,
>({
  adapter,
  canEdit,
  extendSnapshot,
  onApplySnapshot,
}: {
  adapter: PersistedCanvasAdapter<Snapshot>;
  canEdit: boolean;
  /**
   * Product-owned document fields that live beside the graph. Keeping this
   * adapter-level prevents Story grouping (or future product metadata) from
   * leaking into the shared node schema.
   */
  extendSnapshot?: (graph: PersistedCanvasSnapshot) => Snapshot;
  onApplySnapshot?: (snapshot: Snapshot) => void;
}): PersistedCanvasGraphResult<Snapshot> {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [assets, setAssets] = useState<CanvasAsset[]>([]);
  const [status, setStatus] = useState<PersistedCanvasStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const assetsRef = useRef<CanvasAsset[]>([]);
  const localOnlyIds = useRef(new Set<string>());
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const dragBase = useRef<Snapshot | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedSave = useRef<Snapshot | null>(null);
  const saveLoop = useRef<Promise<void> | null>(null);
  const lastSaveError = useRef<unknown>(null);
  const mounted = useRef(true);

  const updateHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
    });
  }, []);

  const currentSnapshot = useCallback(() => {
    const graph = snapshotFrom(
      nodesRef.current,
      edgesRef.current,
      assetsRef.current,
      localOnlyIds.current
    );
    return extendSnapshot ? extendSnapshot(graph) : (graph as Snapshot);
  }, [extendSnapshot]);

  const applySnapshot = useCallback(
    (snapshot: Snapshot) => {
      localOnlyIds.current.clear();
      const nextNodes = snapshot.nodes.map(shapeToNode);
      const nextEdges = snapshot.edges.map(shapeToEdge);
      const nextAssets = snapshot.assets.map((asset) => ({ ...asset }));
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      assetsRef.current = nextAssets;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setAssets(nextAssets);
      onApplySnapshot?.(snapshot);
    },
    [onApplySnapshot]
  );

  const flushSaveQueue = useCallback(
    async (request?: { keepalive?: boolean }) => {
      if (saveLoop.current) return saveLoop.current;
      const run = async () => {
        while (queuedSave.current) {
          const snapshot = queuedSave.current;
          queuedSave.current = null;
          lastSaveError.current = null;
          if (mounted.current) {
            setStatus("saving");
            setError(null);
          }
          try {
            await adapter.save(cloneSnapshot(snapshot), request);
          } catch (caught) {
            lastSaveError.current = caught;
            queuedSave.current ??= snapshot;
            if (mounted.current) {
              setStatus("error");
              setError(caught instanceof Error ? caught.message : String(caught));
            }
            return;
          }
        }
        if (mounted.current) setStatus("saved");
      };
      saveLoop.current = run().finally(() => {
        saveLoop.current = null;
      });
      return saveLoop.current;
    },
    [adapter]
  );

  const scheduleSave = useCallback(
    (snapshot = currentSnapshot()) => {
      queuedSave.current = cloneSnapshot(snapshot);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setStatus("saving");
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void flushSaveQueue();
      }, SAVE_DEBOUNCE_MS);
    },
    [currentSnapshot, flushSaveQueue]
  );

  const flush = useCallback(
    async (request?: { keepalive?: boolean }) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (saveLoop.current) await saveLoop.current;
      if (queuedSave.current) await flushSaveQueue(request);
      if (!queuedSave.current) return;
      const cause = lastSaveError.current;
      throw cause instanceof Error
        ? cause
        : new Error(cause ? String(cause) : "Canvas save failed.");
    },
    [flushSaveQueue]
  );

  const pushUndo = useCallback(
    (snapshot: Snapshot) => {
      undoStack.current.push(cloneSnapshot(snapshot));
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      updateHistoryState();
    },
    [updateHistoryState]
  );

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const onPageHide = () => {
      void flush({ keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onPageHide);
    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return null;
        setStatus("loading");
        setError(null);
        return adapter.load(controller.signal);
      })
      .then((snapshot) => {
        if (controller.signal.aborted || !snapshot) return;
        applySnapshot(snapshot);
        undoStack.current = [];
        redoStack.current = [];
        queuedSave.current = null;
        updateHistoryState();
        setStatus("ready");
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      mounted.current = false;
      controller.abort();
      window.removeEventListener("pagehide", onPageHide);
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (queuedSave.current) {
        void flush({ keepalive: true }).catch(() => undefined);
      }
    };
  }, [adapter, applySnapshot, flush, reloadKey, updateHistoryState]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!canEdit) return;
      const before = currentSnapshot();
      const startsDrag = changes.some(
        (change) => change.type === "position" && "dragging" in change && change.dragging === true
      );
      if (startsDrag && !dragBase.current) dragBase.current = before;

      const next = applyNodeChanges(changes, nodesRef.current);
      nodesRef.current = next;
      setNodes(next);

      const durable = changes.some((change) => {
        if (change.type === "select") return false;
        if (change.type === "position") return change.dragging !== true;
        return true;
      });
      if (!durable) return;

      const historyBase = dragBase.current ?? before;
      dragBase.current = null;
      const onlyDimensions = changes.every(
        (change) => change.type === "dimensions" || change.type === "select"
      );
      if (!onlyDimensions) pushUndo(historyBase);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!canEdit) return;
      const durable = changes.some((change) => change.type !== "select");
      const before = durable ? currentSnapshot() : null;
      const next = applyEdgeChanges(changes, edgesRef.current);
      edgesRef.current = next;
      setEdges(next);
      if (durable && before) {
        pushUndo(before);
        scheduleSave();
      }
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const addNode = useCallback(
    (shape: CanvasNodeShape) => {
      if (!canEdit) return;
      pushUndo(currentSnapshot());
      const next = [...nodesRef.current.filter((node) => node.id !== shape.id), shapeToNode(shape)];
      nodesRef.current = next;
      setNodes(next);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const addEdge = useCallback(
    (shape: CanvasEdgeShape) => {
      if (!canEdit) return;
      pushUndo(currentSnapshot());
      const next = [...edgesRef.current.filter((edge) => edge.id !== shape.id), shapeToEdge(shape)];
      edgesRef.current = next;
      setEdges(next);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const addNodesAndEdges = useCallback(
    (nodeShapes: CanvasNodeShape[], edgeShapes: CanvasEdgeShape[]) => {
      if (!canEdit || (nodeShapes.length === 0 && edgeShapes.length === 0)) return;
      pushUndo(currentSnapshot());
      const nodeIds = new Set(nodeShapes.map((node) => node.id));
      const edgeIds = new Set(edgeShapes.map((edge) => edge.id));
      const nextNodes = [
        ...nodesRef.current.filter((node) => !nodeIds.has(node.id)),
        ...nodeShapes.map(shapeToNode),
      ];
      const nextEdges = [
        ...edgesRef.current.filter((edge) => !edgeIds.has(edge.id)),
        ...edgeShapes.map(shapeToEdge),
      ];
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const patchNodeData = useCallback<CanvasGraphStore["patchNodeData"]>(
    (id, patch) => {
      if (!canEdit) return;
      const current = nodesRef.current.find((node) => node.id === id);
      if (!current) return;
      const before = currentSnapshot();
      const shape = nodeToShape(current);
      const value = typeof patch === "function" ? patch(shape) : patch;
      if (Object.keys(value).length === 0) return;
      pushUndo(before);
      const next = nodesRef.current.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...value } } : node
      );
      nodesRef.current = next;
      setNodes(next);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const removeNode = useCallback(
    (id: string) => {
      if (!canEdit) return;
      const exists = nodesRef.current.some((node) => node.id === id);
      if (!exists) return;
      const isLocal = localOnlyIds.current.has(id);
      if (!isLocal) pushUndo(currentSnapshot());
      localOnlyIds.current.delete(id);
      const nextNodes = nodesRef.current.filter((node) => node.id !== id);
      const nextEdges = edgesRef.current.filter((edge) => edge.source !== id && edge.target !== id);
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      if (!isLocal) scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const removeEdge = useCallback(
    (id: string) => {
      if (!canEdit || !edgesRef.current.some((edge) => edge.id === id)) return;
      pushUndo(currentSnapshot());
      const next = edgesRef.current.filter((edge) => edge.id !== id);
      edgesRef.current = next;
      setEdges(next);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const addLocalNode = useCallback(
    (shape: CanvasNodeShape) => {
      if (!canEdit) return;
      localOnlyIds.current.add(shape.id);
      const next = [...nodesRef.current.filter((node) => node.id !== shape.id), shapeToNode(shape)];
      nodesRef.current = next;
      setNodes(next);
    },
    [canEdit]
  );

  const promoteLocalNode = useCallback(
    (id: string, data: Record<string, unknown>) => {
      if (!canEdit || !localOnlyIds.current.has(id)) return;
      localOnlyIds.current.delete(id);
      const next = nodesRef.current.map((node) => (node.id === id ? { ...node, data } : node));
      nodesRef.current = next;
      setNodes(next);
      scheduleSave();
    },
    [canEdit, scheduleSave]
  );

  const selectNodes = useCallback((ids: string[]) => {
    const selected = new Set(ids);
    const next = nodesRef.current.map((node) =>
      node.selected === selected.has(node.id) ? node : { ...node, selected: selected.has(node.id) }
    );
    nodesRef.current = next;
    setNodes(next);
  }, []);

  const addAssets = useCallback(
    (incoming: CanvasAsset[]) => {
      if (!canEdit || incoming.length === 0) return;
      const before = currentSnapshot();
      const byId = new Map(assetsRef.current.map((asset) => [asset.id, asset]));
      incoming.forEach((asset) => {
        if (!byId.has(asset.id)) byId.set(asset.id, { ...asset });
      });
      const next = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
      if (next.length === assetsRef.current.length) return;
      pushUndo(before);
      assetsRef.current = next;
      setAssets(next);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const renameAssetsByMediaAssetId = useCallback(
    (mediaAssetId: string, name: string) => {
      if (!canEdit) return;
      const trimmed = name.trim();
      const next = assetsRef.current.map((asset) =>
        asset.mediaAssetId === mediaAssetId || asset.id === mediaAssetId
          ? { ...asset, name: trimmed || undefined }
          : asset
      );
      if (next.every((asset, index) => asset === assetsRef.current[index])) return;
      pushUndo(currentSnapshot());
      assetsRef.current = next;
      setAssets(next);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const removeAsset = useCallback(
    (id: string) => {
      if (!canEdit || !assetsRef.current.some((asset) => asset.id === id)) return;
      pushUndo(currentSnapshot());
      const next = assetsRef.current.filter((asset) => asset.id !== id);
      assetsRef.current = next;
      setAssets(next);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const removeAssetsByMediaAssetId = useCallback(
    (mediaAssetId: string) => {
      if (!canEdit) return;
      const next = assetsRef.current.filter(
        (asset) => asset.mediaAssetId !== mediaAssetId && asset.id !== mediaAssetId
      );
      if (next.length === assetsRef.current.length) return;
      pushUndo(currentSnapshot());
      assetsRef.current = next;
      setAssets(next);
      scheduleSave();
    },
    [canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const undo = useCallback(() => {
    if (!canEdit) return;
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(currentSnapshot());
    applySnapshot(previous);
    updateHistoryState();
    scheduleSave(previous);
  }, [canEdit, currentSnapshot, applySnapshot, scheduleSave, updateHistoryState]);

  const redo = useCallback(() => {
    if (!canEdit) return;
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(currentSnapshot());
    applySnapshot(next);
    updateHistoryState();
    scheduleSave(next);
  }, [canEdit, currentSnapshot, applySnapshot, scheduleSave, updateHistoryState]);

  const retry = useCallback(() => {
    if (queuedSave.current) {
      setStatus("saving");
      setError(null);
      void flush().catch(() => undefined);
      return;
    }
    setReloadKey((value) => value + 1);
  }, [flush]);

  const requestSave = useCallback(() => {
    if (!canEdit) return;
    scheduleSave();
  }, [canEdit, scheduleSave]);

  const isNodePersisted = useCallback((id: string) => !localOnlyIds.current.has(id), []);

  /**
   * Commits a product-owned document change that does not originate from a
   * React Flow node/edge mutation. It shares the same undo stack and serialized
   * save queue as graph edits, so document metadata cannot drift from them.
   */
  const commitSnapshotUpdate = useCallback(
    (update: (current: Snapshot) => Snapshot | null) => {
      if (!canEdit) return false;
      const before = currentSnapshot();
      const next = update(cloneSnapshot(before));
      if (!next) return false;
      pushUndo(before);
      applySnapshot(next);
      scheduleSave(next);
      return true;
    },
    [applySnapshot, canEdit, currentSnapshot, pushUndo, scheduleSave]
  );

  const graph = useMemo<CanvasGraphStore>(
    () => ({
      nodes,
      edges,
      getNode: (id) => {
        const node = nodesRef.current.find((candidate) => candidate.id === id);
        return node ? nodeToShape(node) : null;
      },
      getNodes: () => nodesRef.current.map(nodeToShape),
      getEdges: () => edgesRef.current.map(edgeToShape),
      onNodesChange,
      onEdgesChange,
      addNode,
      addEdge,
      addNodesAndEdges,
      patchNodeData,
      removeNode,
      removeEdge,
      addLocalNode,
      promoteLocalNode,
      selectNodes,
      assets,
      addAssets,
      renameAssetsByMediaAssetId,
      removeAsset,
      removeAssetsByMediaAssetId,
      canUndo: historyState.canUndo,
      canRedo: historyState.canRedo,
      undo,
      redo,
      canEdit,
    }),
    [
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      addNode,
      addEdge,
      addNodesAndEdges,
      patchNodeData,
      removeNode,
      removeEdge,
      addLocalNode,
      promoteLocalNode,
      selectNodes,
      assets,
      addAssets,
      renameAssetsByMediaAssetId,
      removeAsset,
      removeAssetsByMediaAssetId,
      historyState.canUndo,
      historyState.canRedo,
      undo,
      redo,
      canEdit,
    ]
  );

  return {
    graph,
    status,
    error,
    retry,
    flush,
    requestSave,
    commitSnapshotUpdate,
    isNodePersisted,
  };
}

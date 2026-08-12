"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import type { Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";
import type { Awareness } from "y-protocols/awareness";
import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
import type {
  CanvasAsset,
  CanvasEdgeShape,
  CanvasGroup,
  CanvasGroupColor,
  CanvasNodeShape,
} from "@/lib/canvas-core/types";
import {
  addNodesToCanvasGroup,
  canvasGroupingAction,
  groupCanvasNodes,
  reconcileCanvasGroups,
  removeNodesFromCanvasGroups,
  sameCanvasGroups,
  setCanvasGroupColor,
  ungroupCanvasNodes,
} from "@/lib/canvas-core/canvas-groups";
import {
  addAssets as yAddAssets,
  assetsMap,
  edgesMap,
  groupsMap,
  nodesMap,
  patchNodeData as yPatchNodeData,
  readAllAssets,
  readAllEdges,
  readAllGroups,
  readAllNodes,
  readEdge,
  readNode,
  reconcileCanvasToUpdate,
  renameAssetsByMediaAssetId as yRenameAssetsByMediaAssetId,
  removeAsset as yRemoveAsset,
  removeAssetsByMediaAssetId as yRemoveAssetsByMediaAssetId,
  removeEdge as yRemoveEdge,
  removeNode as yRemoveNode,
  updateNodePosition,
  writeCanvasGroups,
  writeEdge,
  writeNode,
} from "./canvas-doc";

/**
 * Binds a canvas Y.Doc to React Flow's controlled model.
 *
 * The Y.Doc is the source of truth for COMMITTED graph state (positions, data,
 * structure); three local overlays hold EPHEMERAL UI state that must not be
 * shared or persisted:
 *   • selection — never written to the doc (each client selects independently)
 *   • in-flight drag — smooth locally; only the final position is committed
 *   • measured dimensions — each client measures its own DOM
 *
 * All doc mutations run under LOCAL_ORIGIN so (a) the provider streams them to
 * the server and (b) the UndoManager tracks only this client's edits. Remote
 * updates arrive with a different origin, re-deriving state without being
 * re-sent or captured as undo steps.
 *
 * Unchanged nodes/edges keep a stable object reference across re-derives, so a
 * remote edit to one node never re-renders the whole graph.
 */

const LOCAL_ORIGIN = Symbol("fizz-local-canvas-edit");
const EDGE_TYPE = "gradient";

export interface CanvasGraph extends CanvasGraphStore {
  /**
   * Restore the canvas to a prior version's CRDT state (null/empty clears it).
   * Applied as one LOCAL_ORIGIN transaction — streams to peers + is undoable.
   */
  restoreFromUpdate: (targetBytes: Uint8Array | null) => void;
  groups: CanvasGroup[];
  toggleGroup: (nodeIds: string[]) => string | null;
  addNodesToGroup: (groupId: string, nodeIds: string[]) => boolean;
  removeNodesFromGroups: (nodeIds: string[]) => boolean;
  setGroupColor: (groupId: string, color: CanvasGroupColor) => void;
  isNodePersisted: (nodeId: string) => boolean;
}

interface NodeCacheEntry {
  sig: string;
  node: Node;
}
interface EdgeCacheEntry {
  sig: string;
  edge: Edge;
}

/**
 * Deterministic, lossless serialization for cache signatures. Sorts object keys
 * (Y.Map.toJSON iterates in per-replica insertion order, so plain JSON.stringify
 * would churn the cache) and distinguishes `undefined`/non-finite values (which
 * JSON.stringify silently coerces, causing stale cache hits).
 */
function stableSig(value: unknown): string {
  if (value === undefined) return "\u0000undef";
  if (value === null) return "null";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : `\u0000num:${String(value)}`;
  }
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableSig).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableSig(obj[k])}`)
    .join(",")}}`;
}

export function useCanvasGraph(
  doc: Y.Doc | null,
  awareness?: Awareness | null,
  canEdit = true
): CanvasGraph {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [assets, setAssets] = useState<CanvasAsset[]>([]);
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const selectedNodes = useRef<Set<string>>(new Set());
  const selectedEdges = useRef<Set<string>>(new Set());
  const dragPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Local-only optimistic nodes: rendered for this client, never in the Y.Doc.
  const localOnlyNodes = useRef<Map<string, CanvasNodeShape>>(new Map());
  const measured = useRef<Map<string, { width: number; height: number }>>(new Map());
  const nodeCache = useRef<Map<string, NodeCacheEntry>>(new Map());
  const edgeCache = useRef<Map<string, EdgeCacheEntry>>(new Map());
  const undoManager = useRef<Y.UndoManager | null>(null);
  // Throttle drag broadcasts (ghost-drag) and skip cursor-only awareness churn.
  const lastDragSentAt = useRef(0);
  const lastPresenceSig = useRef("");
  // Ghost-drag broadcast map: mirrors dragPositions, but lingers a node at its
  // committed position briefly past drag-end so peers don't flash backward — the
  // doc operation is fanned out only after a DB write, while the awareness clear
  // isn't, so an immediate clear can beat the committed position to peers.
  const dragBroadcast = useRef<Map<string, { x: number; y: number }>>(new Map());
  const dragClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rebuild = useCallback(() => {
    if (!doc) {
      nodeCache.current.clear();
      edgeCache.current.clear();
      setNodes([]);
      setEdges([]);
      return;
    }

    // Peers' in-flight drags + selections: a node a teammate is moving follows
    // their pointer live (ghost-drag); a node they've selected gets a ring in
    // their color. Read straight from awareness so it's ephemeral, never persisted.
    const peerDrag = new Map<string, { x: number; y: number; color?: string }>();
    const peerRing = new Map<string, string | undefined>();
    if (awareness) {
      const localId = doc.clientID;
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === localId) return;
        const s = state as {
          user?: { color?: string };
          drag?: Record<string, { x: number; y: number }>;
          selection?: string[];
        };
        const color = s.user?.color;
        if (s.drag) {
          for (const [id, pos] of Object.entries(s.drag)) {
            peerDrag.set(id, { x: pos.x, y: pos.y, color });
          }
        }
        if (s.selection) {
          for (const id of s.selection) {
            if (!peerRing.has(id)) peerRing.set(id, color);
          }
        }
      });
    }

    const documentNodes = readAllNodes(doc);
    const nextNodes: Node[] = [];
    const seenNodes = new Set<string>();
    for (const n of documentNodes) {
      seenNodes.add(n.id);
      const localDrag = dragPositions.current.get(n.id);
      const pdrag = peerDrag.get(n.id);
      const position = localDrag ?? (pdrag ? { x: pdrag.x, y: pdrag.y } : n.position);
      const dims = measured.current.get(n.id) ?? null;
      const selected = selectedNodes.current.has(n.id);
      // A teammate's ring — never on a node this client is itself dragging.
      const ring = localDrag ? undefined : (peerRing.get(n.id) ?? pdrag?.color);
      const sig = stableSig([n.type, position.x, position.y, dims, selected, ring ?? null, n.data]);
      const cached = nodeCache.current.get(n.id);
      if (cached && cached.sig === sig) {
        nextNodes.push(cached.node);
        continue;
      }
      const node: Node = {
        id: n.id,
        type: n.type,
        position,
        data: n.data,
      };
      if (dims) node.measured = dims;
      node.selected = selected;
      if (ring) node.style = { boxShadow: `0 0 0 2px ${ring}`, borderRadius: 12 };
      nodeCache.current.set(n.id, { sig, node });
      nextNodes.push(node);
    }
    // Local-only optimistic nodes: rendered for THIS client but never in the
    // Y.Doc (peers don't see them until promoted). Skip any id already in the
    // doc — a promoted node lives in the CRDT now, so this avoids a 1-frame dup.
    for (const [id, shape] of localOnlyNodes.current) {
      if (seenNodes.has(id)) continue;
      seenNodes.add(id);
      const localDrag = dragPositions.current.get(id);
      const position = localDrag ?? shape.position;
      const dims = measured.current.get(id) ?? null;
      const selected = selectedNodes.current.has(id);
      const sig = stableSig([
        shape.type,
        position.x,
        position.y,
        dims,
        selected,
        "local",
        shape.data,
      ]);
      const cached = nodeCache.current.get(id);
      if (cached && cached.sig === sig) {
        nextNodes.push(cached.node);
        continue;
      }
      const node: Node = {
        id,
        type: shape.type,
        position,
        data: shape.data,
      };
      if (dims) node.measured = dims;
      node.selected = selected;
      nodeCache.current.set(id, { sig, node });
      nextNodes.push(node);
    }
    for (const id of [...nodeCache.current.keys()]) {
      if (!seenNodes.has(id)) nodeCache.current.delete(id);
    }

    const nextEdges: Edge[] = [];
    const seenEdges = new Set<string>();
    for (const e of readAllEdges(doc)) {
      seenEdges.add(e.id);
      const selected = selectedEdges.current.has(e.id);
      const sig = stableSig([e.source, e.target, e.sourceHandle, e.targetHandle, selected]);
      const cached = edgeCache.current.get(e.id);
      if (cached && cached.sig === sig) {
        nextEdges.push(cached.edge);
        continue;
      }
      const edge: Edge = {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        type: EDGE_TYPE,
        selected,
      };
      edgeCache.current.set(e.id, { sig, edge });
      nextEdges.push(edge);
    }
    for (const id of [...edgeCache.current.keys()]) {
      if (!seenEdges.has(id)) edgeCache.current.delete(id);
    }

    setNodes(nextNodes);
    setEdges(nextEdges);
    const nextGroups = reconcileCanvasGroups(
      readAllGroups(doc),
      documentNodes.map((node) => node.id)
    );
    setGroups((current) => (sameCanvasGroups(current, nextGroups) ? current : nextGroups));
  }, [doc, awareness]);

  useEffect(() => {
    // New document: discard overlays/caches carried over from the previous one.
    selectedNodes.current.clear();
    selectedEdges.current.clear();
    dragPositions.current.clear();
    localOnlyNodes.current.clear();
    dragBroadcast.current.clear();
    if (dragClearTimer.current) {
      clearTimeout(dragClearTimer.current);
      dragClearTimer.current = null;
    }
    measured.current.clear();
    nodeCache.current.clear();
    edgeCache.current.clear();

    if (!doc) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      rebuild();
      setAssets([]);
      setGroups([]);
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const nm = nodesMap(doc);
    const em = edgesMap(doc);
    const gm = groupsMap(doc);
    const am = assetsMap(doc);
    // The asset library is a cumulative inventory, not editable canvas content —
    // generating/uploading shouldn't push an undo step, so `am` is NOT tracked.
    const undo = new Y.UndoManager([nm, em, gm], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    undoManager.current = undo;
    const syncUndo = () => {
      setCanUndo(undo.canUndo());
      setCanRedo(undo.canRedo());
    };
    undo.on("stack-item-added", syncUndo);
    undo.on("stack-item-popped", syncUndo);
    undo.on("stack-cleared", syncUndo);
    syncUndo();
    const handler = () => rebuild();
    nm.observeDeep(handler);
    em.observeDeep(handler);
    gm.observe(handler);
    // Assets are flat JSON values (add/remove only) — a shallow observe on the
    // map catches every library change; derive the sorted list straight from it.
    const assetHandler = () => setAssets(readAllAssets(doc));
    am.observe(assetHandler);
    assetHandler();

    // Rebuild on a peer's drag/selection change, ignoring cursor-only churn
    // (cursors render separately) so a moving cursor never re-derives the graph.
    const localId = doc.clientID;
    const presenceSig = () => {
      if (!awareness) return "";
      const parts: string[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === localId) return;
        const s = state as { drag?: unknown; selection?: unknown };
        if (s.drag === undefined && s.selection === undefined) return;
        parts.push(`${clientId}:${stableSig(s.drag)}:${stableSig(s.selection)}`);
      });
      return parts.sort().join("|");
    };
    const onPresence = () => {
      const sig = presenceSig();
      if (sig === lastPresenceSig.current) return;
      lastPresenceSig.current = sig;
      rebuild();
    };
    if (awareness) awareness.on("change", onPresence);

    rebuild();
    return () => {
      nm.unobserveDeep(handler);
      em.unobserveDeep(handler);
      gm.unobserve(handler);
      am.unobserve(assetHandler);
      if (awareness) awareness.off("change", onPresence);
      if (dragClearTimer.current) {
        clearTimeout(dragClearTimer.current);
        dragClearTimer.current = null;
      }
      undo.destroy();
      undoManager.current = null;
    };
  }, [doc, awareness, rebuild]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!doc) return;
      const current = (id: string) => {
        const yn = nodesMap(doc).get(id);
        return yn instanceof Y.Map ? readNode(yn) : null;
      };
      const positionCommits: { id: string; pos: { x: number; y: number } }[] = [];
      const removals: string[] = [];
      const writes: CanvasNodeShape[] = [];
      let overlayOnly = false;
      let dragMoved = false;
      let dragEnded = false;
      let selectionChanged = false;
      // A local-only node changed in a way the doc commit/observeDeep path won't
      // pick up (it isn't in the doc) — force a rebuild so the canvas reflects it.
      let localChanged = false;

      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) selectedNodes.current.add(change.id);
          else selectedNodes.current.delete(change.id);
          overlayOnly = true;
          selectionChanged = true;
        } else if (change.type === "position") {
          const isLocal = localOnlyNodes.current.has(change.id);
          if (change.dragging && change.position) {
            dragPositions.current.set(change.id, change.position);
            // Local-only nodes aren't shared, so never ghost-drag them to peers.
            if (!isLocal) dragBroadcast.current.set(change.id, change.position);
            overlayOnly = true;
            dragMoved = true;
          } else {
            const pos = change.position ?? dragPositions.current.get(change.id);
            dragPositions.current.delete(change.id);
            overlayOnly = true;
            dragEnded = true;
            if (isLocal) {
              // Not in the doc: persist the final position in the local overlay
              // (no commit, no peer broadcast).
              const ln = localOnlyNodes.current.get(change.id);
              if (ln && pos) localOnlyNodes.current.set(change.id, { ...ln, position: pos });
              localChanged = true;
            } else {
              if (pos) dragBroadcast.current.set(change.id, pos);
              else dragBroadcast.current.delete(change.id);
              const cur = pos ? current(change.id) : null;
              // Skip a no-op drag-end so we don't clobber a concurrent remote move.
              if (pos && (!cur || cur.position.x !== pos.x || cur.position.y !== pos.y)) {
                positionCommits.push({ id: change.id, pos });
              }
            }
          }
        } else if (change.type === "dimensions") {
          if (change.dimensions) {
            measured.current.set(change.id, change.dimensions);
            overlayOnly = true;
          }
        } else if (change.type === "remove") {
          // A local-only node isn't in the doc, so drop it from the overlay
          // directly (the doc-removal path below would no-op + skip rebuild).
          if (localOnlyNodes.current.delete(change.id)) {
            localChanged = true;
          } else {
            removals.push(change.id);
          }
          selectedNodes.current.delete(change.id);
          dragPositions.current.delete(change.id);
          dragBroadcast.current.delete(change.id);
          measured.current.delete(change.id);
          selectionChanged = true;
          dragEnded = true;
        } else if (change.type === "add" || change.type === "replace") {
          const item = change.item;
          writes.push({
            id: item.id,
            type: item.type ?? "default",
            position: item.position,
            data: (item.data ?? {}) as Record<string, unknown>,
          });
        }
      }

      const committed = positionCommits.length > 0 || removals.length > 0 || writes.length > 0;
      // Viewers (canEdit=false) still update local overlays (selection,
      // measured dims, drag) above so the graph renders + measures correctly,
      // but never commit to the doc — the read-only chokepoint.
      if (committed && canEdit) {
        doc.transact(() => {
          for (const c of positionCommits) updateNodePosition(doc, c.id, c.pos);
          for (const id of removals) yRemoveNode(doc, id);
          for (const n of writes) writeNode(doc, n);
        }, LOCAL_ORIGIN);
        // observeDeep rebuilds (reading the freshly-updated overlays too,
        // including any local-only node dropped in this same batch).
      } else if (overlayOnly || committed || localChanged) {
        rebuild();
      }

      // Broadcast this client's in-flight drag + selection so peers can render
      // ghost-drag and selection rings. Drag is throttled while moving; a
      // drag-end always flushes so the cleared/committed position is exact.
      if (awareness) {
        if (dragMoved || dragEnded) {
          const now = Date.now();
          if (dragEnded || now - lastDragSentAt.current >= 40) {
            lastDragSentAt.current = now;
            awareness.setLocalStateField("drag", Object.fromEntries(dragBroadcast.current));
          }
          if (dragEnded) {
            // Hold the committed position briefly, then drop it — by which point
            // the doc operation has propagated, so peers hand the ghost off to
            // the real node with no backward flash. A fresh drag resets this.
            if (dragClearTimer.current) clearTimeout(dragClearTimer.current);
            dragClearTimer.current = setTimeout(() => {
              dragClearTimer.current = null;
              dragBroadcast.current = new Map(dragPositions.current);
              awareness.setLocalStateField("drag", Object.fromEntries(dragBroadcast.current));
            }, 250);
          }
        }
        if (selectionChanged) {
          awareness.setLocalStateField("selection", [...selectedNodes.current]);
        }
      }
    },
    [doc, rebuild, awareness, canEdit]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!doc) return;
      const removals: string[] = [];
      const writes: CanvasEdgeShape[] = [];
      let overlayOnly = false;
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) selectedEdges.current.add(change.id);
          else selectedEdges.current.delete(change.id);
          overlayOnly = true;
        } else if (change.type === "remove") {
          removals.push(change.id);
          selectedEdges.current.delete(change.id);
        } else if (change.type === "add" || change.type === "replace") {
          const item = change.item;
          writes.push({
            id: item.id,
            source: item.source,
            target: item.target,
            sourceHandle: item.sourceHandle ?? null,
            targetHandle: item.targetHandle ?? null,
          });
        }
      }
      const committed = removals.length > 0 || writes.length > 0;
      if (committed && canEdit) {
        doc.transact(() => {
          for (const id of removals) yRemoveEdge(doc, id);
          for (const e of writes) writeEdge(doc, e);
        }, LOCAL_ORIGIN);
      } else if (overlayOnly || committed) {
        rebuild();
      }
    },
    [doc, rebuild, canEdit]
  );

  const addNode = useCallback(
    (node: CanvasNodeShape) => {
      if (!doc) return;
      doc.transact(() => writeNode(doc, node), LOCAL_ORIGIN);
    },
    [doc]
  );

  const addEdge = useCallback(
    (edge: CanvasEdgeShape) => {
      if (!doc) return;
      doc.transact(() => {
        const em = edgesMap(doc);
        // Upsert by id — a reconnect keeps the same edge id and just rebinds.
        if (em.has(edge.id)) {
          writeEdge(doc, edge);
          return;
        }
        // New edge: dedup parallel connections between the same endpoints
        // (mirrors React Flow's addEdge so references can't double-bind).
        let duplicate = false;
        em.forEach((value) => {
          if (duplicate || !(value instanceof Y.Map)) return;
          const e = readEdge(value);
          if (
            e &&
            e.source === edge.source &&
            e.target === edge.target &&
            (e.sourceHandle ?? null) === (edge.sourceHandle ?? null) &&
            (e.targetHandle ?? null) === (edge.targetHandle ?? null)
          ) {
            duplicate = true;
          }
        });
        if (!duplicate) writeEdge(doc, edge);
      }, LOCAL_ORIGIN);
    },
    [doc]
  );

  const patchNodeData = useCallback(
    (
      id: string,
      patch: Record<string, unknown> | ((node: CanvasNodeShape) => Record<string, unknown>)
    ) => {
      if (!doc) return;
      doc.transact(() => {
        let resolved: Record<string, unknown>;
        if (typeof patch === "function") {
          const yn = nodesMap(doc).get(id);
          const cur = yn instanceof Y.Map ? readNode(yn) : null;
          if (!cur) return;
          resolved = patch(cur);
        } else {
          resolved = patch;
        }
        yPatchNodeData(doc, id, resolved);
      }, LOCAL_ORIGIN);
    },
    [doc]
  );

  const removeNode = useCallback(
    (id: string) => {
      if (!doc) return;
      doc.transact(() => yRemoveNode(doc, id), LOCAL_ORIGIN);
    },
    [doc]
  );

  const removeEdge = useCallback(
    (id: string) => {
      if (!doc) return;
      doc.transact(() => yRemoveEdge(doc, id), LOCAL_ORIGIN);
    },
    [doc]
  );

  const addLocalNode = useCallback(
    (node: CanvasNodeShape) => {
      localOnlyNodes.current.set(node.id, node);
      rebuild();
    },
    [rebuild]
  );

  const promoteLocalNode = useCallback(
    (id: string, data: Record<string, unknown>) => {
      if (!doc) return;
      const local = localOnlyNodes.current.get(id);
      if (!local) return;
      const position = dragPositions.current.get(id) ?? local.position;
      const node: CanvasNodeShape = {
        id,
        type: local.type,
        position,
        data,
      };
      // Drop the local copy first, then write to the doc: observeDeep → rebuild
      // renders it from the CRDT and the seenNodes guard suppresses the (now
      // absent) local copy, so the swap is seamless with no duplicate frame.
      localOnlyNodes.current.delete(id);
      dragPositions.current.delete(id);
      doc.transact(() => writeNode(doc, node), LOCAL_ORIGIN);
    },
    [doc]
  );

  const addNodesAndEdges = useCallback(
    (newNodes: CanvasNodeShape[], newEdges: CanvasEdgeShape[]) => {
      if (!doc || (newNodes.length === 0 && newEdges.length === 0)) return;
      doc.transact(() => {
        for (const node of newNodes) writeNode(doc, node);
        for (const edge of newEdges) writeEdge(doc, edge);
      }, LOCAL_ORIGIN);
    },
    [doc]
  );

  const selectNodes = useCallback(
    (ids: string[]) => {
      selectedNodes.current = new Set(ids);
      awareness?.setLocalStateField("selection", ids);
      rebuild();
    },
    [rebuild, awareness]
  );

  const updateGroups = useCallback(
    (update: (current: CanvasGroup[]) => CanvasGroup[]): boolean => {
      if (!doc) return false;
      let changed = false;
      doc.transact(() => {
        const current = reconcileCanvasGroups(readAllGroups(doc), nodesMap(doc).keys());
        const next = reconcileCanvasGroups(update(current), nodesMap(doc).keys());
        if (sameCanvasGroups(current, next)) return;
        writeCanvasGroups(doc, next);
        changed = true;
      }, LOCAL_ORIGIN);
      return changed;
    },
    [doc]
  );

  const toggleGroup = useCallback(
    (nodeIds: string[]): string | null => {
      if (!doc) return null;
      let selectedGroupId: string | null = null;
      const changed = updateGroups((current) => {
        const persisted = nodeIds.filter((nodeId) => nodesMap(doc).has(nodeId));
        const action = canvasGroupingAction(current, persisted);
        if (!action) return current;
        if (action.type === "ungroup") {
          return ungroupCanvasNodes(current, action.groupId);
        }
        selectedGroupId = `group-${crypto.randomUUID()}`;
        return groupCanvasNodes(current, selectedGroupId, action.nodeIds);
      });
      return changed ? selectedGroupId : null;
    },
    [doc, updateGroups]
  );

  const addNodesToGroup = useCallback(
    (groupId: string, nodeIds: string[]): boolean => {
      if (!doc) return false;
      return updateGroups((current) =>
        addNodesToCanvasGroup(
          current,
          groupId,
          nodeIds.filter((nodeId) => nodesMap(doc).has(nodeId))
        )
      );
    },
    [doc, updateGroups]
  );

  const removeNodesFromGroups = useCallback(
    (nodeIds: string[]): boolean =>
      updateGroups((current) => removeNodesFromCanvasGroups(current, nodeIds)),
    [updateGroups]
  );

  const setGroupColor = useCallback(
    (groupId: string, color: CanvasGroupColor) => {
      updateGroups((current) => setCanvasGroupColor(current, groupId, color));
    },
    [updateGroups]
  );

  const isNodePersisted = useCallback(
    (nodeId: string): boolean => Boolean(doc && nodesMap(doc).has(nodeId)),
    [doc]
  );

  const restoreFromUpdate = useCallback(
    (targetBytes: Uint8Array | null) => {
      if (!doc) return;
      reconcileCanvasToUpdate(doc, targetBytes, LOCAL_ORIGIN);
    },
    [doc]
  );

  const addAssets = useCallback(
    (next: CanvasAsset[]) => {
      if (!doc || next.length === 0) return;
      doc.transact(() => yAddAssets(doc, next), LOCAL_ORIGIN);
    },
    [doc]
  );

  const removeAsset = useCallback(
    (id: string) => {
      if (!doc) return;
      doc.transact(() => yRemoveAsset(doc, id), LOCAL_ORIGIN);
    },
    [doc]
  );

  const renameAssetsByMediaAssetId = useCallback(
    (mediaAssetId: string, name: string) => {
      if (!doc) return;
      doc.transact(() => yRenameAssetsByMediaAssetId(doc, mediaAssetId, name), LOCAL_ORIGIN);
    },
    [doc]
  );

  const removeAssetsByMediaAssetId = useCallback(
    (mediaAssetId: string) => {
      if (!doc) return;
      doc.transact(() => yRemoveAssetsByMediaAssetId(doc, mediaAssetId), LOCAL_ORIGIN);
    },
    [doc]
  );

  const undo = useCallback(() => undoManager.current?.undo(), []);
  const redo = useCallback(() => undoManager.current?.redo(), []);
  const noop = useCallback(() => {}, []);
  const noGroupChange = useCallback(() => false, []);
  const noGroupToggle = useCallback(() => null, []);

  // Read-only chokepoint: a viewer gets the same derived nodes/edges/assets and
  // local selection, but every doc-writing mutator is a no-op (the server
  // rejects writes regardless; this keeps the client from even trying + drives
  // the disabled-UI affordances). onNodesChange/onEdgesChange stay live because
  // Synchronous node read straight from the Yjs doc (or local-only overlay) —
  // unlike `nodes` (render-derived, a commit behind), this reflects a write
  // immediately, so a caller can read a node right after addNode/patchNodeData.
  const getNode = useCallback(
    (id: string): CanvasNodeShape | null => {
      const local = localOnlyNodes.current.get(id);
      if (local) return local;
      if (!doc) return null;
      const yn = nodesMap(doc).get(id);
      return yn instanceof Y.Map ? readNode(yn) : null;
    },
    [doc]
  );

  // Committed nodes plus this client's local-only ones (same precedence as
  // `getNode`), deduped exactly like the render path so a node caught mid-
  // promotion is never reported twice.
  const getNodes = useCallback((): CanvasNodeShape[] => {
    const out = doc ? readAllNodes(doc) : [];
    const seen = new Set(out.map((node) => node.id));
    for (const [id, node] of localOnlyNodes.current) {
      if (!seen.has(id)) out.push(node);
    }
    return out;
  }, [doc]);

  const getEdges = useCallback((): CanvasEdgeShape[] => (doc ? readAllEdges(doc) : []), [doc]);

  // they also own ephemeral overlay state (selection/measure) — their *commits*
  // are gated internally above.
  //
  // The object is memoized so its identity only changes when a constituent
  // does. Every mutator/accessor above is a stable useCallback, so consumers
  // can safely list `graph.patchNodeData` etc. in effect deps — or the whole
  // graph, which then re-fires only on real data changes, never per render.
  // (An unmemoized literal here once had the generation provider re-arming
  // its realtime subscription + reconcile fetch on every render.)
  return useMemo<CanvasGraph>(() => {
    if (!canEdit) {
      return {
        nodes,
        edges,
        getNode,
        getNodes,
        getEdges,
        onNodesChange,
        onEdgesChange,
        addNode: noop,
        addEdge: noop,
        addNodesAndEdges: noop,
        patchNodeData: noop,
        removeNode: noop,
        removeEdge: noop,
        addLocalNode: noop,
        promoteLocalNode: noop,
        selectNodes,
        restoreFromUpdate: noop,
        groups,
        toggleGroup: noGroupToggle,
        addNodesToGroup: noGroupChange,
        removeNodesFromGroups: noGroupChange,
        setGroupColor: noop,
        isNodePersisted,
        assets,
        addAssets: noop,
        renameAssetsByMediaAssetId: noop,
        removeAsset: noop,
        removeAssetsByMediaAssetId: noop,
        canUndo: false,
        canRedo: false,
        undo: noop,
        redo: noop,
        canEdit: false,
      };
    }
    return {
      nodes,
      edges,
      getNode,
      getNodes,
      getEdges,
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
      restoreFromUpdate,
      groups,
      toggleGroup,
      addNodesToGroup,
      removeNodesFromGroups,
      setGroupColor,
      isNodePersisted,
      assets,
      addAssets,
      renameAssetsByMediaAssetId,
      removeAsset,
      removeAssetsByMediaAssetId,
      canUndo,
      canRedo,
      undo,
      redo,
      canEdit: true,
    };
  }, [
    canEdit,
    nodes,
    edges,
    assets,
    groups,
    canUndo,
    canRedo,
    getNode,
    getNodes,
    getEdges,
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
    restoreFromUpdate,
    toggleGroup,
    addNodesToGroup,
    removeNodesFromGroups,
    setGroupColor,
    isNodePersisted,
    addAssets,
    renameAssetsByMediaAssetId,
    removeAsset,
    removeAssetsByMediaAssetId,
    undo,
    redo,
    noop,
    noGroupChange,
    noGroupToggle,
  ]);
}

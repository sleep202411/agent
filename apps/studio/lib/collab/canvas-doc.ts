import * as Y from "yjs";
import type {
  CanvasAsset,
  CanvasEdgeShape,
  CanvasGroup,
  CanvasNodeShape,
} from "@/lib/canvas-core/types";
import { CANVAS_GROUP_COLORS, DEFAULT_CANVAS_GROUP_COLOR } from "@/lib/canvas-core/types";
import { reconcileCanvasGroups } from "@/lib/canvas-core/canvas-groups";

export type {
  CanvasAsset,
  CanvasEdgeShape,
  CanvasGroup,
  CanvasNodeShape,
} from "@/lib/canvas-core/types";

/**
 * Canvas graph <-> Yjs schema + conversion (pure; no React, no browser).
 *
 * Y.Doc layout (roots declared by CANVAS_ROOT_SCHEMA):
 *   meta:  Y.Map  — document metadata (title, …)
 *   nodes: Y.Map<nodeId, Y.Map>  — each node:
 *            { id: string, type: string,
 *              position: Y.Map<{x,y}>,   // distinct nodes merge; same-node x/y is LWW
 *              data: Y.Map<field, json> } // field-level merge (prompt vs settings)
 *   edges: Y.Map<edgeId, Y.Map>  — { id, source, target, sourceHandle?, targetHandle? }
 *   groups: Y.Map<groupId, CanvasGroup> — visual grouping metadata; bounds stay derived
 *
 * Node `data` field VALUES are stored as plain JSON (settings/generation/etc are
 * coarse last-write-wins within a field); positions and per-field data edits
 * merge. This is the v1 granularity — deeper nesting can come later without a
 * wire change (it's all inside the opaque CRDT). Legacy width/height fields
 * are ignored and removed when a node is next rewritten.
 */

export function nodesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("nodes");
}
export function edgesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("edges");
}
export function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("meta");
}
export function assetsMap(doc: Y.Doc): Y.Map<CanvasAsset> {
  return doc.getMap<CanvasAsset>("assets");
}
export function groupsMap(doc: Y.Doc): Y.Map<CanvasGroup> {
  return doc.getMap<CanvasGroup>("groups");
}

// ── read (Y → plain) ────────────────────────────────────────────────────────

export function readNode(yNode: Y.Map<unknown>): CanvasNodeShape | null {
  const id = yNode.get("id");
  const type = yNode.get("type");
  if (typeof id !== "string" || typeof type !== "string") return null;

  const pos = yNode.get("position");
  const position =
    pos instanceof Y.Map
      ? { x: toNumber(pos.get("x")), y: toNumber(pos.get("y")) }
      : { x: 0, y: 0 };

  const dataY = yNode.get("data");
  const data = dataY instanceof Y.Map ? (dataY.toJSON() as Record<string, unknown>) : {};

  // Legacy documents can contain client-measured width/height. They are
  // intentionally ignored: geometry is a render/layout concern derived from
  // the shared node spec, never durable project content.
  return { id, type, position, data };
}

export function readEdge(yEdge: Y.Map<unknown>): CanvasEdgeShape | null {
  const id = yEdge.get("id");
  const source = yEdge.get("source");
  const target = yEdge.get("target");
  if (typeof id !== "string" || typeof source !== "string" || typeof target !== "string") {
    return null;
  }
  const sourceHandle = yEdge.get("sourceHandle");
  const targetHandle = yEdge.get("targetHandle");
  return {
    id,
    source,
    target,
    sourceHandle: typeof sourceHandle === "string" ? sourceHandle : null,
    targetHandle: typeof targetHandle === "string" ? targetHandle : null,
  };
}

export function readAllNodes(doc: Y.Doc): CanvasNodeShape[] {
  const out: CanvasNodeShape[] = [];
  nodesMap(doc).forEach((yNode) => {
    if (yNode instanceof Y.Map) {
      const node = readNode(yNode);
      if (node) out.push(node);
    }
  });
  return out;
}

export function readAllEdges(doc: Y.Doc): CanvasEdgeShape[] {
  const out: CanvasEdgeShape[] = [];
  edgesMap(doc).forEach((yEdge) => {
    if (yEdge instanceof Y.Map) {
      const edge = readEdge(yEdge);
      if (edge) out.push(edge);
    }
  });
  return out;
}

export function readAllGroups(doc: Y.Doc): CanvasGroup[] {
  const out: CanvasGroup[] = [];
  groupsMap(doc).forEach((value, groupId) => {
    if (!value || typeof value !== "object") return;
    const nodeIds = Array.isArray(value.nodeIds)
      ? [...new Set(value.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string"))]
      : [];
    const color = CANVAS_GROUP_COLORS.includes(value.color)
      ? value.color
      : DEFAULT_CANVAS_GROUP_COLOR;
    out.push({ id: groupId, nodeIds, color });
  });
  return out.sort((left, right) => left.id.localeCompare(right.id));
}

// ── write (plain → Y) ───────────────────────────────────────────────────────

/**
 * Create or fully replace a node. Mutates an existing node's Y.Maps IN PLACE
 * (preserving their CRDT identity) rather than swapping in fresh ones, so a
 * peer's concurrent field-level edit merges per-field instead of being orphaned
 * on an unreachable old Y.Map — matching the position/data field-merge design
 * and making restore reconcile cleanly. The result equals `node` exactly;
 * client-measured dimensions are runtime state and are always removed.
 */
export function writeNode(doc: Y.Doc, node: CanvasNodeShape): void {
  const nm = nodesMap(doc);
  let yNode = nm.get(node.id);
  if (!(yNode instanceof Y.Map)) {
    yNode = new Y.Map<unknown>();
    nm.set(node.id, yNode);
  }
  yNode.set("id", node.id);
  yNode.set("type", node.type);

  let pos = yNode.get("position");
  if (!(pos instanceof Y.Map)) {
    pos = new Y.Map<number>();
    yNode.set("position", pos);
  }
  (pos as Y.Map<number>).set("x", node.position.x);
  (pos as Y.Map<number>).set("y", node.position.y);

  let dataY = yNode.get("data");
  if (!(dataY instanceof Y.Map)) {
    dataY = new Y.Map<unknown>();
    yNode.set("data", dataY);
  }
  const data = dataY as Y.Map<unknown>;
  const fields = node.data ?? {};
  const keep = new Set(Object.keys(fields));
  for (const key of [...data.keys()]) if (!keep.has(key)) data.delete(key);
  for (const [key, value] of Object.entries(fields)) data.set(key, value);

  // Clean historical measurement cache whenever a node is rewritten.
  yNode.delete("width");
  yNode.delete("height");
}

/** Move a node (granular — only the position sub-map changes). */
export function updateNodePosition(
  doc: Y.Doc,
  id: string,
  position: { x: number; y: number }
): void {
  const yNode = nodesMap(doc).get(id);
  if (!(yNode instanceof Y.Map)) return;
  let pos = yNode.get("position");
  if (!(pos instanceof Y.Map)) {
    pos = new Y.Map<number>();
    yNode.set("position", pos);
  }
  (pos as Y.Map<number>).set("x", position.x);
  (pos as Y.Map<number>).set("y", position.y);
}

/** Merge fields into a node's data (field-level; absent fields untouched). */
export function patchNodeData(doc: Y.Doc, id: string, patch: Record<string, unknown>): void {
  const yNode = nodesMap(doc).get(id);
  if (!(yNode instanceof Y.Map)) return;
  let dataY = yNode.get("data");
  if (!(dataY instanceof Y.Map)) {
    dataY = new Y.Map<unknown>();
    yNode.set("data", dataY);
  }
  for (const [key, value] of Object.entries(patch)) {
    (dataY as Y.Map<unknown>).set(key, value);
  }
}

export function removeNode(doc: Y.Doc, id: string): void {
  nodesMap(doc).delete(id);
  writeCanvasGroups(doc, reconcileCanvasGroups(readAllGroups(doc), nodesMap(doc).keys()));
}

/** Create or fully replace an edge (in place — preserves Y.Map identity). */
export function writeEdge(doc: Y.Doc, edge: CanvasEdgeShape): void {
  const em = edgesMap(doc);
  let yEdge = em.get(edge.id);
  if (!(yEdge instanceof Y.Map)) {
    yEdge = new Y.Map<unknown>();
    em.set(edge.id, yEdge);
  }
  yEdge.set("id", edge.id);
  yEdge.set("source", edge.source);
  yEdge.set("target", edge.target);
  if (edge.sourceHandle != null) yEdge.set("sourceHandle", edge.sourceHandle);
  else yEdge.delete("sourceHandle");
  if (edge.targetHandle != null) yEdge.set("targetHandle", edge.targetHandle);
  else yEdge.delete("targetHandle");
}

export function removeEdge(doc: Y.Doc, id: string): void {
  edgesMap(doc).delete(id);
}

export function writeCanvasGroups(doc: Y.Doc, groups: readonly CanvasGroup[]): void {
  const map = groupsMap(doc);
  const next = new Map(groups.map((group) => [group.id, group] as const));
  for (const groupId of [...map.keys()]) {
    if (!next.has(groupId)) map.delete(groupId);
  }
  next.forEach((group, groupId) => {
    const current = map.get(groupId);
    if (
      current?.color === group.color &&
      current.nodeIds.length === group.nodeIds.length &&
      current.nodeIds.every((nodeId, index) => nodeId === group.nodeIds[index])
    ) {
      return;
    }
    map.set(groupId, {
      id: groupId,
      nodeIds: [...group.nodeIds],
      color: group.color,
    });
  });
}

// ── assets (shared library) ──────────────────────────────────────────────────

/** Library assets, newest first. */
export function readAllAssets(doc: Y.Doc): CanvasAsset[] {
  const out: CanvasAsset[] = [];
  assetsMap(doc).forEach((asset) => {
    if (asset && typeof asset === "object" && typeof asset.id === "string") {
      out.push(asset);
    }
  });
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Add assets, deduped by id (ignores ids already present). */
export function addAssets(doc: Y.Doc, assets: CanvasAsset[]): void {
  const am = assetsMap(doc);
  for (const asset of assets) {
    if (!am.has(asset.id)) am.set(asset.id, asset);
  }
}

export function removeAsset(doc: Y.Doc, id: string): void {
  assetsMap(doc).delete(id);
}

/** Remove every asset matching a moderated media asset (by mediaAssetId or id). */
export function removeAssetsByMediaAssetId(doc: Y.Doc, mediaAssetId: string): void {
  const am = assetsMap(doc);
  for (const [id, asset] of [...am.entries()]) {
    if (asset.mediaAssetId === mediaAssetId || asset.id === mediaAssetId) {
      am.delete(id);
    }
  }
}

export function renameAssetsByMediaAssetId(doc: Y.Doc, mediaAssetId: string, name: string): void {
  const am = assetsMap(doc);
  const trimmed = name.trim();
  for (const [id, asset] of [...am.entries()]) {
    if (asset.mediaAssetId !== mediaAssetId && asset.id !== mediaAssetId) continue;
    const next: CanvasAsset = { ...asset };
    if (trimmed) next.name = trimmed;
    else delete next.name;
    am.set(id, next);
  }
}

/**
 * Seed an empty doc from existing nodes/edges (e.g. migrating a local project
 * into the shared doc). No-op if the doc already has nodes — never clobbers
 * collaborative state.
 */
export function seedCanvas(
  doc: Y.Doc,
  nodes: CanvasNodeShape[],
  edges: CanvasEdgeShape[]
): boolean {
  if (nodesMap(doc).size > 0 || edgesMap(doc).size > 0) return false;
  doc.transact(() => {
    for (const node of nodes) writeNode(doc, node);
    for (const edge of edges) writeEdge(doc, edge);
  });
  return true;
}

/**
 * Restore the canvas to a prior CRDT snapshot. `targetBytes` is a full
 * `Y.encodeStateAsUpdate` of the target version (null/empty clears the canvas).
 * Yjs updates are merge-only, so this computes a real delete-missing +
 * replace-target diff against the live doc in ONE transaction under `origin` —
 * it streams as a single operation and every collaborator converges through the
 * normal fan-out. CRDT semantics: a peer's un-synced concurrent edit survives
 * via LWW (the caller's pre-restore safety checkpoint is the reversibility handle).
 */
export function reconcileCanvasToUpdate(
  doc: Y.Doc,
  targetBytes: Uint8Array | null,
  origin: unknown
): void {
  let nodes: CanvasNodeShape[] = [];
  let edges: CanvasEdgeShape[] = [];
  let groups: CanvasGroup[] = [];
  let meta: Record<string, unknown> = {};
  if (targetBytes && targetBytes.byteLength > 0) {
    const tmp = new Y.Doc();
    try {
      Y.applyUpdate(tmp, targetBytes);
      nodes = readAllNodes(tmp);
      edges = readAllEdges(tmp);
      groups = reconcileCanvasGroups(
        readAllGroups(tmp),
        nodes.map((node) => node.id)
      );
      meta = metaMap(tmp).toJSON() as Record<string, unknown>;
    } finally {
      tmp.destroy();
    }
  }
  // Restore reverts canvas CONTENT (nodes/edges/groups/meta). The asset library is a
  // cumulative inventory of everything generated/uploaded — restoring an old
  // version must NOT wipe assets made since it, so `assets` is left untouched.
  doc.transact(() => {
    const nm = nodesMap(doc);
    const keepNodes = new Set(nodes.map((n) => n.id));
    for (const id of [...nm.keys()]) if (!keepNodes.has(id)) removeNode(doc, id);
    for (const node of nodes) writeNode(doc, node); // writeNode fully replaces

    const em = edgesMap(doc);
    const keepEdges = new Set(edges.map((e) => e.id));
    for (const id of [...em.keys()]) if (!keepEdges.has(id)) removeEdge(doc, id);
    for (const edge of edges) writeEdge(doc, edge);

    writeCanvasGroups(doc, groups);

    const mm = metaMap(doc);
    const keepMeta = new Set(Object.keys(meta));
    for (const key of [...mm.keys()]) if (!keepMeta.has(key)) mm.delete(key);
    for (const [key, value] of Object.entries(meta)) mm.set(key, value);
  }, origin);
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

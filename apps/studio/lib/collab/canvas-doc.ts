import * as Y from "yjs";

/**
 * Canvas graph <-> Yjs schema + conversion (pure; no React, no browser).
 *
 * Y.Doc layout (roots declared by CANVAS_ROOT_SCHEMA):
 *   meta:  Y.Map  — document metadata (title, …)
 *   nodes: Y.Map<nodeId, Y.Map>  — each node:
 *            { id: string, type: string,
 *              position: Y.Map<{x,y}>,   // distinct nodes merge; same-node x/y is LWW
 *              data: Y.Map<field, json>, // field-level merge (prompt vs settings)
 *              width?: number, height?: number }
 *   edges: Y.Map<edgeId, Y.Map>  — { id, source, target, sourceHandle?, targetHandle? }
 *
 * Node `data` field VALUES are stored as plain JSON (settings/generation/etc are
 * coarse last-write-wins within a field); positions and per-field data edits
 * merge. This is the v1 granularity — deeper nesting can come later without a
 * wire change (it's all inside the opaque CRDT).
 */

export interface CanvasNodeShape {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  width?: number;
  height?: number;
}

export interface CanvasEdgeShape {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * A project library asset — a persistent inventory entry that survives deleting
 * the card it came from. Always carries a durable storage `url` (generated
 * outputs + SAS uploads) so every collaborator can resolve it; stored as a flat
 * JSON value in the synced `assets` map (add/remove only — no field merge).
 */
export interface CanvasAsset {
  id: string;
  mediaAssetId?: string;
  kind: "image" | "video" | "audio";
  source: "generated" | "uploaded";
  url: string;
  width?: number;
  height?: number;
  /** User-editable display name. Prompt remains the generation/source text. */
  name?: string;
  prompt?: string;
  /** Equirectangular 360° panorama — placed/rendered as a panorama, not a flat image. */
  panorama?: boolean;
  createdAt: number;
}

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

  const node: CanvasNodeShape = { id, type, position, data };
  const width = yNode.get("width");
  const height = yNode.get("height");
  if (typeof width === "number") node.width = width;
  if (typeof height === "number") node.height = height;
  return node;
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

// ── write (plain → Y) ───────────────────────────────────────────────────────

/**
 * Create or fully replace a node. Mutates an existing node's Y.Maps IN PLACE
 * (preserving their CRDT identity) rather than swapping in fresh ones, so a
 * peer's concurrent field-level edit merges per-field instead of being orphaned
 * on an unreachable old Y.Map — matching the position/data field-merge design
 * and making restore reconcile cleanly. The result equals `node` exactly
 * (fields/dimensions absent from `node` are removed).
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

  if (typeof node.width === "number") yNode.set("width", node.width);
  else yNode.delete("width");
  if (typeof node.height === "number") yNode.set("height", node.height);
  else yNode.delete("height");
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

export function updateNodeDimensions(doc: Y.Doc, id: string, width: number, height: number): void {
  const yNode = nodesMap(doc).get(id);
  if (!(yNode instanceof Y.Map)) return;
  yNode.set("width", width);
  yNode.set("height", height);
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
  let meta: Record<string, unknown> = {};
  if (targetBytes && targetBytes.byteLength > 0) {
    const tmp = new Y.Doc();
    try {
      Y.applyUpdate(tmp, targetBytes);
      nodes = readAllNodes(tmp);
      edges = readAllEdges(tmp);
      meta = metaMap(tmp).toJSON() as Record<string, unknown>;
    } finally {
      tmp.destroy();
    }
  }
  // Restore reverts canvas CONTENT (nodes/edges/meta). The asset library is a
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

    const mm = metaMap(doc);
    const keepMeta = new Set(Object.keys(meta));
    for (const key of [...mm.keys()]) if (!keepMeta.has(key)) mm.delete(key);
    for (const [key, value] of Object.entries(meta)) mm.set(key, value);
  }, origin);
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

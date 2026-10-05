import * as Y from 'yjs';
import type { DocumentRootSchema } from './document-modes';

/**
 * CRDT merge + materialization primitives for the documents platform.
 *
 * This module is the single source of truth for how a document's binary CRDT
 * state and its materialized JSON snapshot are derived from a base state plus a
 * stream of incremental Yjs updates. It is intentionally **pure** (no DB, no
 * Redis, no clock) so the correctness-critical merge logic can be exhaustively
 * unit-tested without infrastructure.
 *
 * Invariants relied upon by callers:
 *   • Yjs updates are commutative and idempotent — applying them in any order,
 *     and applying duplicates, converges to the same document state. Callers may
 *     therefore replay an op stream defensively without exactly-once tracking.
 *   • A re-encoded full state (encodeStateAsUpdate) applied onto a fresh doc is
 *     equivalent to replaying every original update onto a fresh doc. This is
 *     what makes compaction safe: collapsing N updates into one base state never
 *     changes the resulting document. (Verified in document-crdt.spec.ts.)
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DocumentSnapshot = { [key: string]: JsonValue };

export interface MergedDocumentState {
  /** Full document state, re-encoded via Y.encodeStateAsUpdate. */
  state: Uint8Array;
  /** Materialized plain-JSON view (Y.Doc.toJSON), suitable for a Json column. */
  snapshot: DocumentSnapshot;
}

/**
 * Encode an authoritative materialized snapshot into canonical Yjs state.
 * This is used for imports and one-time schema migrations, never for merging
 * concurrent edits. Canvas accepts both the current map-shaped snapshot and
 * the former Story array-shaped snapshot, then always emits the canonical form.
 */
export function encodeDocumentSnapshot(
  snapshot: unknown,
  schema: DocumentRootSchema,
): MergedDocumentState {
  const doc = new Y.Doc({ gc: true });
  try {
    declareRoots(doc, schema);
    const source = record(snapshot);
    doc.transact(() => {
      for (const [name, kind] of Object.entries(schema)) {
        const value = source[name];
        if (kind === 'map') {
          const target = doc.getMap(name);
          if (name === 'nodes') seedCanvasNodes(target, value);
          else if (name === 'edges') seedCanvasEdges(target, value);
          else seedPlainMap(target, value);
        } else if (kind === 'array' && Array.isArray(value)) {
          doc.getArray(name).insert(0, value);
        } else if (kind === 'text' && typeof value === 'string') {
          doc.getText(name).insert(0, value);
        }
      }
    });
    return {
      state: Y.encodeStateAsUpdate(doc),
      snapshot: doc.toJSON() as unknown as DocumentSnapshot,
    };
  } finally {
    doc.destroy();
  }
}

/**
 * Incremental, memory-bounded folder of a base state plus a stream of Yjs
 * updates into a single document. Callers feed updates in batches (so the source
 * buffers can be GC'd between batches) and read the merged result at the end.
 *
 * Always pair construction with `destroy()` (use try/finally) — a live Y.Doc
 * retains internal structures until destroyed.
 */
export class DocumentStateBuilder {
  // gc:true (Yjs default, made explicit): compaction collapses deleted-item
  // content so the bootstrap state a new client loads is minimal and cannot
  // resurrect deletions, while still merging concurrent edits correctly. Per-user
  // undo is session-local on each client (it does not survive reconnect), so
  // server-side gc never truncates a client's undo history.
  private readonly doc = new Y.Doc({ gc: true });
  private destroyed = false;

  /**
   * @param base   A full state previously produced by encodeStateAsUpdate.
   * @param schema Root-type declarations for the document mode. Required for
   *               `snapshot()` to materialize — a Y.Doc hydrated from binary
   *               keeps abstract root types until they are declared with their
   *               concrete kind. Omit only when the snapshot is not needed.
   */
  constructor(base?: Uint8Array | null, schema?: DocumentRootSchema | null) {
    if (schema) declareRoots(this.doc, schema);
    if (base && base.byteLength > 0) {
      Y.applyUpdate(this.doc, base);
    }
  }

  /** Fold one incremental update in. No-ops on null/empty input. */
  apply(update: Uint8Array | null | undefined): this {
    if (update && update.byteLength > 0) {
      Y.applyUpdate(this.doc, update);
    }
    return this;
  }

  /** Fold a batch of updates in. */
  applyAll(updates: ReadonlyArray<Uint8Array | null | undefined>): this {
    for (const update of updates) this.apply(update);
    return this;
  }

  /** Re-encoded full binary state of the merged document. */
  encodeState(): Uint8Array {
    this.assertLive();
    return Y.encodeStateAsUpdate(this.doc);
  }

  /**
   * Materialized plain-JSON view. The document mode (canvas / storyboard / …)
   * decides the top-level shared-type names client-side; the server stays
   * schema-agnostic and simply serializes whatever the doc contains.
   */
  snapshot(): DocumentSnapshot {
    this.assertLive();
    return this.doc.toJSON() as unknown as DocumentSnapshot;
  }

  /** Content retained in encoded state, including updates awaiting dependencies. */
  retainedContent(): unknown[] {
    const content: unknown[] = [this.snapshot()];
    // Public encoding includes pending updates; do not depend on Yjs internals.
    for (const item of Y.decodeUpdate(this.encodeState()).structs) {
      if (!(item instanceof Y.Item)) continue;
      content.push(item.parentSub);
      if (item.content instanceof Y.ContentString)
        content.push(item.content.str);
      else if (item.content instanceof Y.ContentFormat)
        content.push(item.content.value);
      else if (
        item.content instanceof Y.ContentAny ||
        item.content instanceof Y.ContentJSON ||
        item.content instanceof Y.ContentEmbed
      ) {
        const values: unknown[] = item.content.getContent();
        content.push(...values);
      }
    }
    return content;
  }

  /** Both the re-encoded state and the materialized snapshot. */
  finish(): MergedDocumentState {
    return { state: this.encodeState(), snapshot: this.snapshot() };
  }

  destroy(): void {
    if (!this.destroyed) {
      this.doc.destroy();
      this.destroyed = true;
    }
  }

  private assertLive(): void {
    if (this.destroyed) {
      throw new Error('DocumentStateBuilder used after destroy().');
    }
  }
}

/**
 * Apply a base CRDT state and an ordered list of incremental Yjs updates onto a
 * fresh document, then return the re-encoded full state plus a materialized JSON
 * snapshot. Convenience wrapper over {@link DocumentStateBuilder} for callers
 * that already hold the whole update set in memory.
 */
export function mergeDocumentState(
  base: Uint8Array | null | undefined,
  updates: ReadonlyArray<Uint8Array>,
  schema?: DocumentRootSchema | null,
): MergedDocumentState {
  const builder = new DocumentStateBuilder(base, schema);
  try {
    return builder.applyAll(updates).finish();
  } finally {
    builder.destroy();
  }
}

/** Materialize only the JSON snapshot (skips re-encoding the binary state). */
export function materializeSnapshot(
  base: Uint8Array | null | undefined,
  updates: ReadonlyArray<Uint8Array>,
  schema?: DocumentRootSchema | null,
): DocumentSnapshot {
  const builder = new DocumentStateBuilder(base, schema);
  try {
    return builder.applyAll(updates).snapshot();
  } finally {
    builder.destroy();
  }
}

function declareRoots(doc: Y.Doc, schema: DocumentRootSchema): void {
  for (const [name, kind] of Object.entries(schema)) {
    switch (kind) {
      case 'map':
        doc.getMap(name);
        break;
      case 'array':
        doc.getArray(name);
        break;
      case 'text':
        doc.getText(name);
        break;
      case 'xml':
        doc.getXmlFragment(name);
        break;
    }
  }
}

function seedCanvasNodes(target: Y.Map<unknown>, value: unknown): void {
  for (const [id, raw] of entriesById(value)) {
    const node = record(raw);
    const yNode = new Y.Map<unknown>();
    yNode.set('id', typeof node.id === 'string' ? node.id : id);
    if (typeof node.type === 'string') yNode.set('type', node.type);
    const position = record(node.position);
    const yPosition = new Y.Map<number>();
    yPosition.set('x', finiteNumber(position.x));
    yPosition.set('y', finiteNumber(position.y));
    yNode.set('position', yPosition);
    const yData = new Y.Map<unknown>();
    for (const [key, field] of Object.entries(record(node.data))) {
      yData.set(key, field);
    }
    yNode.set('data', yData);
    if (typeof node.width === 'number' && Number.isFinite(node.width)) {
      yNode.set('width', node.width);
    }
    if (typeof node.height === 'number' && Number.isFinite(node.height)) {
      yNode.set('height', node.height);
    }
    target.set(id, yNode);
  }
}

function seedCanvasEdges(target: Y.Map<unknown>, value: unknown): void {
  for (const [id, raw] of entriesById(value)) {
    const edge = record(raw);
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      continue;
    }
    const yEdge = new Y.Map<unknown>();
    yEdge.set('id', typeof edge.id === 'string' ? edge.id : id);
    yEdge.set('source', edge.source);
    yEdge.set('target', edge.target);
    if (typeof edge.sourceHandle === 'string') {
      yEdge.set('sourceHandle', edge.sourceHandle);
    }
    if (typeof edge.targetHandle === 'string') {
      yEdge.set('targetHandle', edge.targetHandle);
    }
    target.set(id, yEdge);
  }
}

function seedPlainMap(target: Y.Map<unknown>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      const row = record(item);
      if (typeof row.id === 'string') target.set(row.id, row);
    }
    return;
  }
  for (const [key, field] of Object.entries(record(value))) {
    target.set(key, field);
  }
}

function entriesById(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const row = record(item);
      return typeof row.id === 'string' ? [[row.id, item]] : [];
    });
  }
  return Object.entries(record(value));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

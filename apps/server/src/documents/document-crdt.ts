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

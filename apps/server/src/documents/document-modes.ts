import { StudioDocumentType } from '@prisma/client';

/**
 * Root-type schema for CRDT document modes.
 *
 * A Yjs document materializes to JSON only if its root shared types are declared
 * with their concrete kind — a document hydrated purely from binary updates
 * keeps abstract root types and `toJSON()` renders nothing. The client builds
 * each mode's Y.Doc with exactly these root types; the server uses this registry
 * to declare them before materializing the snapshot during compaction.
 *
 * Only modes listed here are CRDT-backed (yjs_update) and therefore compacted.
 * Other modes (e.g. the storyboard) use the patch model, where the client ships
 * an authoritative materialized snapshot and the server never compacts.
 *
 * NOTE: this is the single source of truth shared in spirit with the client.
 * When the canvas client lands (Phase 1) it must build the Y.Doc with the same
 * root names/kinds; promote this to @repo/shared if drift becomes a risk.
 */
export type RootTypeKind = 'map' | 'array' | 'text' | 'xml';

export type DocumentRootSchema = Readonly<Record<string, RootTypeKind>>;

const ROOT_SCHEMAS: Partial<Record<StudioDocumentType, DocumentRootSchema>> = {
  [StudioDocumentType.canvas]: {
    meta: 'map',
    nodes: 'map',
    edges: 'map',
    groups: 'map',
    // Shared asset library (generated + uploaded media), keyed by asset id.
    // MUST match the client's CANVAS_ROOT_SCHEMA.
    assets: 'map',
  },
  // Text mode (e.g. the Brief): a Y.Text body. MUST match the client's
  // TEXT_DOC_ROOT_SCHEMA.
  [StudioDocumentType.brief]: {
    meta: 'map',
    content: 'text',
  },
  // Story script — free-form rich-text writing (the pipeline's source text).
  // A Y.XmlFragment body driven by Tiptap; MUST match the client's
  // RICH_TEXT_DOC_ROOT_SCHEMA.
  [StudioDocumentType.script]: {
    meta: 'map',
    content: 'xml',
  },
};

/** Root-type schema for a CRDT mode, or null if the mode is not CRDT-backed. */
export function rootSchemaFor(
  type: StudioDocumentType,
): DocumentRootSchema | null {
  return ROOT_SCHEMAS[type] ?? null;
}

/** Whether a document mode is CRDT-backed (and therefore compactable). */
export function isCrdtMode(type: StudioDocumentType): boolean {
  return rootSchemaFor(type) !== null;
}

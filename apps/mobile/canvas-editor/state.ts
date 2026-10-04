import * as Y from "yjs";
import { z } from "zod";
import { CANVAS_ROOTS } from "./schema";
const encoded = z
  .string()
  .min(4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
type CanvasSnapshot = Record<(typeof CANVAS_ROOTS)[number], Record<string, unknown>>;

function decode(value: string) {
  const bytes = Uint8Array.from(atob(encoded.parse(value)), (character) => character.charCodeAt(0));
  Y.decodeUpdate(bytes);
  return bytes;
}
function encode(bytes: Uint8Array) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    value += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(value);
}

/** Runs in the bundled canvas runtime, like the existing Script CRDT runtime.
 * The host owns authenticated transport, project identity and sequence checks.
 * All update bytes (including bytes on system/comment markers) must be supplied.
 * No network, credentials, or durable writes occur during materialization. */
export function materializeCanvas(snapshot: string, updates: readonly string[]) {
  const doc = new Y.Doc();
  try {
    for (const root of CANVAS_ROOTS) doc.getMap(root);
    for (const value of [snapshot, ...updates]) Y.applyUpdate(doc, decode(value));
    // A valid Yjs update may depend on missing earlier structs/delete targets.
    // Yjs queues these silently; showing its partial JSON would lose content.
    if (doc.store.pendingStructs || doc.store.pendingDs)
      throw Error("Canvas history is incomplete. Reload the document.");
    const snapshotJson = Object.fromEntries(
      CANVAS_ROOTS.map((root) => [root, doc.getMap(root).toJSON()])
    );
    return {
      state: encode(Y.encodeStateAsUpdate(doc)),
      // Y.Map plain-JSON values can retain references; isolate consumers.
      snapshot: JSON.parse(JSON.stringify(snapshotJson)) as CanvasSnapshot,
    };
  } finally {
    doc.destroy();
  }
}

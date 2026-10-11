import * as Y from "yjs";
import { z } from "zod";

import {
  encodedScriptState as encoded,
  scriptEditSchema as editSchema,
  scriptCheckpointSchema as checkpointSchema,
} from "./protocol";
export type ScriptEdit = z.infer<typeof editSchema>;
export type ScriptCheckpoint = z.infer<typeof checkpointSchema>;
const REMOTE = Symbol("script-remote");
function encode(bytes: Uint8Array) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}
function decode(raw: string) {
  const bytes = Uint8Array.from(atob(encoded.parse(raw)), (c) => c.charCodeAt(0));
  Y.decodeUpdate(bytes); // Validate binary structure before touching the live document.
  return bytes;
}
function fresh() {
  const doc = new Y.Doc();
  doc.getMap("meta");
  doc.getXmlFragment("content");
  return doc;
}
/** Runs inside the bundled editor. Storage and authenticated transport remain in the host. */
export class ScriptCrdt {
  readonly doc: Y.Doc;
  private pending: ScriptEdit[];
  private destroyed = false;
  constructor(
    private readonly nextId: () => string,
    checkpoint?: unknown
  ) {
    this.doc = fresh();
    this.pending = [];
    try {
      if (checkpoint !== undefined) {
        const parsed = checkpointSchema.parse(checkpoint);
        if (new Set(parsed.pending.map((p) => p.clientKey)).size !== parsed.pending.length)
          throw Error("Duplicate Script mutation IDs.");
        const state = decode(parsed.state),
          updates = parsed.pending.map((p) => decode(p.yjsUpdateBase64));
        Y.applyUpdate(this.doc, state, REMOTE);
        for (const update of updates) Y.applyUpdate(this.doc, update, REMOTE);
        this.pending = parsed.pending;
      }
      this.doc.on("update", this.updated);
    } catch (error) {
      this.doc.destroy();
      throw error;
    }
  }
  private updated = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || this.destroyed) return;
    const edit = editSchema.parse({ clientKey: this.nextId(), yjsUpdateBase64: encode(update) });
    if (this.pending.some((p) => p.clientKey === edit.clientKey))
      throw Error("Duplicate Script mutation ID.");
    this.pending.push(edit);
  };
  private current() {
    if (this.destroyed) throw Error("Script editor is closed.");
  }
  /** Remote state and all tail updates validate before any are merged into the live editor. */
  merge(snapshot: string | null | undefined, updates: string[]) {
    this.current();
    const decoded = [...(snapshot ? [snapshot] : []), ...updates].map(decode);
    const staged = fresh();
    try {
      for (const update of decoded) Y.applyUpdate(staged, update, REMOTE);
      Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(staged), REMOTE);
    } finally {
      staged.destroy();
    }
  }
  checkpoint(): ScriptCheckpoint {
    this.current();
    return {
      version: 1,
      state: encode(Y.encodeStateAsUpdate(this.doc)),
      pending: this.pending.map((p) => ({ ...p })),
    };
  }
  /** A late acknowledgement can only remove its own exact update, never newer edits. */
  acknowledge(receipt: ScriptEdit) {
    this.current();
    const parsed = editSchema.parse(receipt),
      entry = this.pending.find((p) => p.clientKey === parsed.clientKey);
    if (!entry || entry.yjsUpdateBase64 !== parsed.yjsUpdateBase64)
      throw Error("Script acknowledgement does not match a pending edit.");
    this.pending = this.pending.filter((p) => p.clientKey !== parsed.clientKey);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("update", this.updated);
    this.doc.destroy();
  }
}

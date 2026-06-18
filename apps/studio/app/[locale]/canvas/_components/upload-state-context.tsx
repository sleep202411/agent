"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/**
 * Transient state for an in-flight optimistic media upload, keyed by canvas node
 * id. It deliberately lives OUTSIDE the canvas CRDT document: the blob preview
 * URL, the File, the AbortController and the progress are session-local and
 * meaningless to collaborators — only the durable URL is ever written to the doc
 * (on confirm, by promoting the node). See use-canvas-graph's local-only nodes.
 *
 * Backed by a tiny external store with PER-NODE subscriptions so a node's
 * frequent progress ticks re-render only that node, never every upload consumer.
 */

export type UploadStatus = "uploading" | "failed";

export interface UploadEntry {
  status: UploadStatus;
  /** 0–100 from the storage PUT. The confirm POST isn't covered, so 100 briefly
   *  precedes the node swapping to its durable image. */
  progress: number;
  /** Session-local blob preview, rendered until the durable URL lands. */
  objectUrl: string;
  /** Retained so a failed upload can be retried in place. */
  file: File;
  /** Aborts the in-flight upload when the node is deleted mid-upload. */
  controller: AbortController;
  error?: string;
}

export interface UploadStateStore {
  get(id: string): UploadEntry | undefined;
  subscribe(id: string, listener: () => void): () => void;
  /** Start tracking an upload (also used by retry to reset an entry). */
  begin(id: string, entry: UploadEntry): void;
  patchProgress(id: string, percent: number): void;
  markFailed(id: string, message: string): void;
  /** Success: drop the transient entry now so the node renders its durable
   *  image; revoke the blob a beat later so that durable image paints first. */
  succeed(id: string): void;
  /** Delete / abort: stop the upload and revoke the blob immediately. */
  cancel(id: string): void;
  /** Abort + revoke EVERY in-flight upload (e.g. on document switch / unmount,
   *  so a pending upload can't promote into the wrong doc or leak its blob). */
  cancelAll(): void;
}

/** How long to keep a succeeded upload's blob alive so the durable <img src>
 *  (just written to the doc) commits + paints before the blob is revoked. */
const REVOKE_DELAY_MS = 4000;

export function createUploadStateStore(): UploadStateStore {
  const entries = new Map<string, UploadEntry>();
  const listeners = new Map<string, Set<() => void>>();
  const emit = (id: string) => listeners.get(id)?.forEach((listener) => listener());

  return {
    get: (id) => entries.get(id),
    subscribe(id, listener) {
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },
    begin(id, entry) {
      entries.set(id, entry);
      emit(id);
    },
    patchProgress(id, percent) {
      const entry = entries.get(id);
      if (!entry || entry.status !== "uploading") return;
      entries.set(id, { ...entry, progress: percent });
      emit(id);
    },
    markFailed(id, message) {
      const entry = entries.get(id);
      if (!entry) return;
      entries.set(id, { ...entry, status: "failed", error: message });
      emit(id);
    },
    succeed(id) {
      const entry = entries.get(id);
      if (!entry) return;
      entries.delete(id);
      emit(id);
      const { objectUrl } = entry;
      setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_DELAY_MS);
    },
    cancel(id) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.controller.abort();
      entries.delete(id);
      emit(id);
      URL.revokeObjectURL(entry.objectUrl);
    },
    cancelAll() {
      for (const id of [...entries.keys()]) {
        const entry = entries.get(id)!;
        entry.controller.abort();
        entries.delete(id);
        emit(id);
        URL.revokeObjectURL(entry.objectUrl);
      }
    },
  };
}

interface UploadStateContextValue {
  store: UploadStateStore;
  /** Re-run a failed upload for the node, reusing the same File. */
  retry: (id: string) => void;
}

export const UploadStateContext = createContext<UploadStateContextValue | null>(null);

/** This node's live upload entry (re-renders only this node on its own ticks). */
export function useUploadEntry(id: string): UploadEntry | undefined {
  const ctx = useContext(UploadStateContext);
  if (!ctx) throw new Error("useUploadEntry must be used within an UploadStateContext provider");
  const { store } = ctx;
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(id, listener),
    [store, id]
  );
  return useSyncExternalStore(
    subscribe,
    () => store.get(id),
    () => undefined
  );
}

export function useRetryUpload(): (id: string) => void {
  const ctx = useContext(UploadStateContext);
  if (!ctx) throw new Error("useRetryUpload must be used within an UploadStateContext provider");
  return ctx.retry;
}

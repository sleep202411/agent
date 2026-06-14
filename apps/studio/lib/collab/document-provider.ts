"use client";

import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  EMPTY_UPDATE_MAX_BYTES,
  base64ToBytes,
  bytesToBase64,
  declareRoots,
  newClientMutationId,
  type ClientFrame,
  type OperationDto,
  type RootSchema,
  type ServerFrame,
} from "./protocol";

/**
 * DocumentProvider — a Yjs provider for the FizzDragon documents gateway.
 *
 * Responsibilities:
 *   • Hold the live Y.Doc (root types per `rootSchema`) + offline cache
 *     (y-indexeddb) so edits survive reloads and disconnects.
 *   • Connect to `/aurora/ws/documents` (same-origin cookie auth), bootstrap
 *     from the server's compacted `crdtState` + replay the op tail (honoring the
 *     `resync` horizon), and apply remote operations as they arrive.
 *   • Stream local edits as `yjs_update` operations, and on every (re)connect push
 *     the state-vector delta of anything the server is missing — so edits made
 *     while offline reconcile automatically.
 *   • Carry ephemeral awareness (live cursors + identity) for the avatar group.
 *
 * Browser-only (WebSocket + IndexedDB). Construct inside a client component.
 */

const REMOTE = Symbol("fizz-remote-origin");
const PING_INTERVAL_MS = 25_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
const DEFAULT_WS_PATH = "/aurora/ws/documents";

export type ConnectionStatus = "connecting" | "synced" | "offline";

export interface DocumentProviderOptions {
  documentId: string;
  rootSchema: RootSchema;
  /** Awareness identity (name / color / avatar) advertised to peers. */
  localUser?: Record<string, unknown>;
  /** Override the WS path (defaults to same-origin `/aurora/ws/documents`). */
  wsPath?: string;
}

export class DocumentProvider {
  readonly doc = new Y.Doc({ gc: true });
  readonly awareness: Awareness;

  private readonly options: DocumentProviderOptions;
  private readonly idb: IndexeddbPersistence;
  private ws: WebSocket | null = null;
  private destroyed = false;
  private hasSynced = false;
  private lastAckedSequence = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSnapshotCrdt: Uint8Array | null = null;
  private pendingUpdates: Uint8Array[] = [];
  private status: ConnectionStatus = "connecting";
  private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();
  private readonly appEventListeners = new Set<(data: unknown) => void>();

  constructor(options: DocumentProviderOptions) {
    this.options = options;
    declareRoots(this.doc, options.rootSchema);
    this.awareness = new Awareness(this.doc);
    // Initialize a non-null local state so this client appears in awareness and
    // later setLocalStateField calls (user / cursor) take effect — setLocalStateField
    // is a no-op when the local state is null.
    this.awareness.setLocalState(options.localUser ? { user: options.localUser } : {});
    this.idb = new IndexeddbPersistence(`fizzdoc-${options.documentId}`, this.doc);

    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);

    // Connect only after the offline cache has loaded, so the first reconnect
    // delta includes any edits made in a previous offline session.
    void this.idb.whenSynced.then(() => {
      if (!this.destroyed) this.connect();
    });
  }

  // ── public API ──────────────────────────────────────────────────────────

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Update a field of this client's awareness state (e.g. `cursor`). */
  setAwarenessField(field: string, value: unknown): void {
    this.awareness.setLocalStateField(field, value);
  }

  /** Relay an ephemeral app-level signal to peers (e.g. "comments changed"). */
  broadcastAppEvent(data: unknown): void {
    this.sendFrame({ event: "app_event", data });
  }

  onAppEvent(listener: (data: unknown) => void): () => void {
    this.appEventListeners.add(listener);
    return () => this.appEventListeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.teardownSocket();
    // Removes our awareness state from peers' views.
    this.awareness.destroy();
    void this.idb.destroy();
    this.doc.destroy();
  }

  // ── connection lifecycle ────────────────────────────────────────────────

  private connect(): void {
    if (this.destroyed) return;
    this.setStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.buildWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.startPing();
      // The gateway pushes document_snapshot + operations_sync on connect.
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") this.handleFrame(event.data);
    };
    socket.onclose = () => {
      this.stopPing();
      if (this.ws === socket) this.ws = null;
      if (this.destroyed) return;
      this.setStatus("offline");
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      /* close fires next; reconnect handled there */
    };
  }

  private buildWsUrl(): string {
    const path = this.options.wsPath ?? DEFAULT_WS_PATH;
    const origin = window.location.origin.replace(/^http/, "ws");
    const params = new URLSearchParams({
      documentId: this.options.documentId,
      afterSequence: String(this.lastAckedSequence),
    });
    return `${origin}${path}?${params.toString()}`;
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** Math.min(this.reconnectAttempt, 4),
      MAX_RECONNECT_DELAY_MS
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private teardownSocket(): void {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onclose = null;
    this.ws.onerror = null;
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.sendFrame({ event: "ping" });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ── inbound frames ──────────────────────────────────────────────────────

  private handleFrame(raw: string): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(raw) as ServerFrame;
    } catch {
      return;
    }
    switch (frame.event) {
      case "document_snapshot":
        this.pendingSnapshotCrdt = frame.data.document.crdtStateBase64
          ? base64ToBytes(frame.data.document.crdtStateBase64)
          : null;
        this.lastAckedSequence = Math.max(
          this.lastAckedSequence,
          frame.data.document.snapshotSequence ?? 0
        );
        break;
      case "operations_sync":
        this.applySync(frame.data);
        break;
      case "operation_ack":
        this.lastAckedSequence = Math.max(this.lastAckedSequence, frame.data.operation.sequence);
        break;
      case "document_operation":
        this.applyRemoteOperation(frame.data);
        break;
      case "awareness":
      case "awareness_state":
        this.applyRemoteAwareness(frame.data.update);
        break;
      case "awareness_request":
        this.announceAwareness();
        break;
      case "app_event":
        for (const listener of this.appEventListeners) listener(frame.data);
        break;
      case "heartbeat":
      case "presence_state":
      case "presence_update":
      case "presence_left":
      case "terminate":
      case "error":
        break;
    }
  }

  private applySync(data: {
    operations: OperationDto[];
    resync?: boolean;
    afterSequence?: number;
  }): void {
    const firstSync = !this.hasSynced;
    const opUpdates: Uint8Array[] = [];
    for (const op of data.operations) {
      if (op.yjsUpdateBase64) opUpdates.push(base64ToBytes(op.yjsUpdateBase64));
      this.lastAckedSequence = Math.max(this.lastAckedSequence, op.sequence);
    }
    // Honor the server's authoritative replay floor (it may be raised to the
    // compaction horizon) so our resume point matches what the server reported.
    if (typeof data.afterSequence === "number") {
      this.lastAckedSequence = Math.max(this.lastAckedSequence, data.afterSequence);
    }

    // Apply the server's view. crdtState is applied on the first sync or when
    // forced to resync (we fell behind the compaction horizon); on a plain
    // incremental reconnect the op tail alone is enough.
    const applyCrdt = (data.resync || firstSync) && this.pendingSnapshotCrdt != null;
    const toApply: Uint8Array[] = [];
    if (applyCrdt && this.pendingSnapshotCrdt) {
      toApply.push(this.pendingSnapshotCrdt);
    }
    toApply.push(...opUpdates);
    if (toApply.length > 0) {
      Y.applyUpdate(this.doc, Y.mergeUpdates(toApply), REMOTE);
    }

    if (firstSync) {
      // First sync reconstructs the FULL server state (crdtState + the tail from
      // the snapshot horizon, or all ops from sequence 0), so the state-vector
      // delta below correctly ships ONLY local-beyond-server content — including
      // edits from a prior offline session. It subsumes the pre-sync queue.
      this.pushLocalDelta(opUpdates);
      this.pendingUpdates = [];
    } else {
      // On a reconnect a partial op tail is NOT a full server base, so diffing
      // against it would re-upload the entire document. Edits made while
      // disconnected were queued — flush exactly those.
      this.flushPendingUpdates();
    }

    this.hasSynced = true;
    this.pendingSnapshotCrdt = null;
    this.setStatus("synced");
    this.announceAwareness();
  }

  private flushPendingUpdates(): void {
    if (this.pendingUpdates.length === 0) return;
    const merged = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];
    if (merged.byteLength > EMPTY_UPDATE_MAX_BYTES) this.sendOperation(merged);
  }

  /** Send the server anything our doc has that its view lacks (offline edits). */
  private pushLocalDelta(opUpdates: Uint8Array[]): void {
    const serverView = new Y.Doc({ gc: true });
    try {
      const base: Uint8Array[] = [];
      // pendingSnapshotCrdt may already be cleared by applySync ordering; capture
      // it before. (Called from applySync before the clear.)
      if (this.pendingSnapshotCrdt) base.push(this.pendingSnapshotCrdt);
      base.push(...opUpdates);
      if (base.length > 0) Y.applyUpdate(serverView, Y.mergeUpdates(base));
      const serverStateVector = Y.encodeStateVector(serverView);
      const delta = Y.encodeStateAsUpdate(this.doc, serverStateVector);
      if (delta.byteLength > EMPTY_UPDATE_MAX_BYTES) {
        this.sendOperation(delta);
      }
    } finally {
      serverView.destroy();
    }
  }

  private applyRemoteOperation(op: OperationDto): void {
    if (op.yjsUpdateBase64) {
      Y.applyUpdate(this.doc, base64ToBytes(op.yjsUpdateBase64), REMOTE);
    }
    this.lastAckedSequence = Math.max(this.lastAckedSequence, op.sequence);
  }

  private applyRemoteAwareness(updateBase64: string): void {
    try {
      applyAwarenessUpdate(this.awareness, base64ToBytes(updateBase64), REMOTE);
    } catch {
      /* malformed awareness update — ignore */
    }
  }

  // ── outbound ────────────────────────────────────────────────────────────

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Skip server-applied updates (echo) and offline-cache loads (the first-sync
    // delta carries those, not live ops).
    if (origin === REMOTE || origin === this.idb) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendOperation(update);
    } else {
      // Edits made while disconnected are queued and flushed on reconnect.
      this.pendingUpdates.push(update);
    }
  };

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === REMOTE) return;
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (changed.length === 0) return;
    const update = encodeAwarenessUpdate(this.awareness, changed);
    this.sendFrame({ event: "awareness", data: { update: bytesToBase64(update) } });
  };

  private sendOperation(update: Uint8Array): void {
    this.sendFrame({
      event: "operation",
      data: {
        operationType: "yjs_update",
        yjsUpdateBase64: bytesToBase64(update),
        clientMutationId: newClientMutationId(),
      },
    });
  }

  /**
   * Re-announce local awareness after a (re)connect or on request. Re-setting
   * the local state bumps its clock so a server/peer that still holds our
   * previous entry accepts the rejoin (otherwise a same-clock update is ignored
   * and our cursor/identity silently goes missing). The awareness 'update'
   * listener performs the actual broadcast.
   */
  private announceAwareness(): void {
    const state = this.awareness.getLocalState();
    if (!state) return;
    this.awareness.setLocalState(state);
  }

  private sendFrame(frame: ClientFrame): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(frame));
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

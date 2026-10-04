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

/**
 * Absolute WS base for local dev. Next.js dev `rewrites()` only proxy HTTP, NOT
 * WebSocket upgrades, so the same-origin `/aurora/ws/documents` can't reach the
 * backend through the dev server. Point this straight at the backend gateway
 * (e.g. `ws://localhost:4399/ws/documents`). Unset in prod, where the ingress
 * upgrades the same-origin WS — so prod behaviour is unchanged.
 */
const WS_ABSOLUTE_BASE = process.env.NEXT_PUBLIC_AURORA_WS_BASE;

export type ConnectionStatus = "connecting" | "synced" | "offline";

export interface DocumentProviderOptions {
  documentId: string;
  rootSchema: RootSchema;
  /** Awareness identity (name / color / avatar) advertised to peers. */
  localUser?: Record<string, unknown>;
  /**
   * Override the WS endpoint. Defaults to same-origin `/aurora/ws/documents`.
   * May be a relative path, or a full absolute `ws(s)://` URL (takes priority,
   * for pointing at a backend that the dev proxy can't WS-upgrade to).
   */
  wsPath?: string;
}

export class DocumentProvider {
  readonly doc = new Y.Doc({ gc: true });
  readonly awareness: Awareness;

  private readonly options: DocumentProviderOptions;
  private readonly idb: IndexeddbPersistence;
  private ws: WebSocket | null = null;
  private destroyed = false;
  /** Set when the server revokes access — suppresses the reconnect loop. */
  private accessRevoked = false;
  private hasSynced = false;
  private lastAckedSequence = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSnapshotCrdt: Uint8Array | null = null;
  private pendingUpdates: Uint8Array[] = [];
  /** Retain sent edits until acknowledgement; reconnects replay the same receipt. */
  private readonly unacknowledged = new Map<string, Extract<ClientFrame, { event: "operation" }>>();
  private status: ConnectionStatus = "connecting";
  private error: string | null = null;
  private readonly errorListeners = new Set<(error: string | null) => void>();
  private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();
  // Round-trip latency of the app-level ping → heartbeat, for the connection
  // signal. null = not measured yet / disconnected.
  private lastPingSentAt = 0;
  private rtt: number | null = null;
  private readonly rttListeners = new Set<(rtt: number | null) => void>();
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

  canRetry(): boolean {
    return !this.destroyed && !this.accessRevoked;
  }

  getError(): string | null {
    return this.error;
  }

  onError(listener: (error: string | null) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Reconnect without replacing the CRDT or pending operation receipts. */
  retry(): void {
    if (this.destroyed || this.accessRevoked) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    this.teardownSocket();
    this.connect();
  }

  private setError(error: string | null): void {
    if (this.error === error) return;
    this.error = error;
    for (const listener of this.errorListeners) listener(error);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getRtt(): number | null {
    return this.rtt;
  }

  onRtt(listener: (rtt: number | null) => void): () => void {
    this.rttListeners.add(listener);
    return () => this.rttListeners.delete(listener);
  }

  private setRtt(rtt: number | null): void {
    this.rtt = rtt;
    for (const listener of this.rttListeners) listener(rtt);
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
    this.pendingUpdates = [];
    this.unacknowledged.clear();
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
      if (this.destroyed || this.ws !== socket) return;
      this.reconnectAttempt = 0;
      this.startPing();
      // The gateway pushes document_snapshot + operations_sync on connect.
    };
    socket.onmessage = (event) => {
      if (this.destroyed || this.ws !== socket) return;
      if (typeof event.data === "string") this.handleFrame(event.data);
    };
    socket.onclose = () => {
      if (this.destroyed || this.ws !== socket) return;
      this.stopPing();
      if (this.ws === socket) this.ws = null;
      if (this.destroyed) return;
      this.setStatus("offline");
      // A revoked socket would only fail the next handshake — don't loop.
      if (this.accessRevoked) return;
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      /* close fires next; reconnect handled there */
    };
  }

  private buildWsUrl(): string {
    const params = new URLSearchParams({
      documentId: this.options.documentId,
      afterSequence: String(this.lastAckedSequence),
    });
    // An absolute ws(s):// endpoint (explicit option, then env) wins — needed
    // in local dev where the Next proxy can't upgrade a same-origin WS.
    const explicit = this.options.wsPath;
    const absolute =
      explicit && /^wss?:\/\//.test(explicit)
        ? explicit
        : WS_ABSOLUTE_BASE && /^wss?:\/\//.test(WS_ABSOLUTE_BASE)
          ? WS_ABSOLUTE_BASE
          : null;
    if (absolute) {
      const sep = absolute.includes("?") ? "&" : "?";
      return `${absolute}${sep}${params.toString()}`;
    }
    const path = explicit ?? DEFAULT_WS_PATH;
    const origin = window.location.origin.replace(/^http/, "ws");
    return `${origin}${path}?${params.toString()}`;
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const ceiling = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** Math.min(this.reconnectAttempt, 4),
      MAX_RECONNECT_DELAY_MS
    );
    // Full jitter — random in [0, ceiling] — so a mass disconnect (e.g. a pod
    // restart dropping every socket) doesn't produce a synchronized reconnect herd.
    const delay = Math.random() * ceiling;
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
    const ping = () => {
      this.lastPingSentAt = Date.now();
      this.sendFrame({ event: "ping" });
    };
    ping(); // immediate, so the connection signal has a reading right away
    this.pingTimer = setInterval(ping, PING_INTERVAL_MS);
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
        if (frame.data.operation.clientMutationId) {
          this.unacknowledged.delete(frame.data.operation.clientMutationId);
        }
        this.lastAckedSequence = Math.max(this.lastAckedSequence, frame.data.operation.sequence);
        if (
          this.error &&
          this.ws?.readyState === WebSocket.OPEN &&
          this.unacknowledged.size === 0
        ) {
          this.flushPendingUpdates();
          if (this.unacknowledged.size === 0) {
            this.setError(null);
            this.setStatus("synced");
          }
        }
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
      case "terminate":
        // Access revoked (member removed) — stop reconnecting; the removal
        // toast comes from the notifications channel.
        if (frame.data.reason === "access_revoked" || frame.data.reason === "unauthorized") {
          this.accessRevoked = true;
          this.setError(
            frame.data.reason === "access_revoked"
              ? "Your access to this document was revoked."
              : "Your session is no longer authorized to access this document."
          );
          this.stopPing();
          this.teardownSocket();
          this.setStatus("offline");
        }
        break;
      case "heartbeat":
        // The gateway replies to our app-level ping with a heartbeat — measure
        // the round trip for the connection signal.
        if (this.lastPingSentAt > 0) this.setRtt(Date.now() - this.lastPingSentAt);
        break;
      case "presence_state":
      case "presence_update":
      case "presence_left":
        break;
      case "error":
        this.setError(frame.data.message || frame.data.code);
        this.stopPing();
        this.teardownSocket();
        this.setStatus("offline");
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

    // The server deduplicates by idempotencyKey, including a commit whose ack
    // was lost when the previous socket closed.
    for (const operation of this.unacknowledged.values()) this.sendFrame(operation);

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
    // A successful handshake does not prove rejected edits were persisted.
    if (this.error && this.unacknowledged.size === 0) this.setError(null);
    this.setStatus(this.error ? "offline" : "synced");
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
    if (this.status === "synced" && this.ws?.readyState === WebSocket.OPEN) {
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
    const mutationId = newClientMutationId();
    const frame: Extract<ClientFrame, { event: "operation" }> = {
      event: "operation",
      data: {
        operationType: "yjs_update",
        yjsUpdateBase64: bytesToBase64(update),
        clientMutationId: mutationId,
        idempotencyKey: mutationId,
      },
    };
    this.unacknowledged.set(mutationId, frame);
    this.sendFrame(frame);
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
    // A dropped/connecting socket has no meaningful latency; clear it so the
    // signal reflects the outage instead of a stale reading.
    if (status !== "synced") this.setRtt(null);
    for (const listener of this.statusListeners) listener(status);
  }
}

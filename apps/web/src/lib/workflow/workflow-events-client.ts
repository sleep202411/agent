/**
 * WorkflowEventsClient — browser WebSocket subscriber for workflow events.
 *
 * Replaces the 1.5s `setInterval` polling loop that ToolWorkflowCard used
 * to hit /aurora/workflow/:runId/status + /drafts/:runId. Push-based
 * updates land within ~50ms of Mastra emitting them.
 *
 * Server-side partner: apps/server/src/assistant/workflow-events.gateway.ts
 * (plus Mastra's appendEvent publish hook in
 * apps/agent/src/mastra/workflows/engine/state.ts).
 *
 * Lifecycle rules (see docs/workflow-events-ws.md):
 *   1. Mount → connect immediately
 *   2. Heartbeat watchdog: 75s without a frame → force reconnect
 *   3. document.hidden ≥ 60s → explicit close (drop server load)
 *   4. document.visible → reconnect + onMismatch() to resync state
 *   5. Close code 1008 → policy violation, do NOT retry
 *   6. Other close → exponential backoff (1s → 30s max) + jitter
 *   7. `online` event → immediate reconnect (skip backoff)
 *   8. Unmount → explicit close(1000), clear timers
 */

import type { WorkflowEvent, WorkflowStatus, WorkflowProgress } from "./workflow-client";

// ─── Wire protocol (matches WorkflowEventsGateway) ────────────────────

export type WsFrame =
  | {
      event: "heartbeat";
      data: { runHash: string; serverTime: number };
    }
  | {
      event: "workflow_event";
      data: WorkflowEvent;
    }
  | {
      event: "terminate";
      data: { reason: string; code: number };
    };

// ─── Client ────────────────────────────────────────────────────────────

const HEARTBEAT_TIMEOUT_MS = 75_000; // 30s expected + 2× tolerance
const HIDDEN_DISCONNECT_MS = 60_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_JITTER_MS = 250;
const DONT_RETRY_CODE = 1008;

/**
 * Local mirror of the fields that feed `computeRunHash` on the server.
 * Keep the builder symmetric so mismatch detection is meaningful.
 */
export interface LocalRunHashInputs {
  status: WorkflowStatus;
  currentStep?: string;
  progress?: WorkflowProgress;
}

export function computeLocalRunHash(inputs: LocalRunHashInputs): string {
  const cur = inputs.progress?.current ?? 0;
  const tot = inputs.progress?.total ?? 0;
  return `${inputs.status}:${inputs.currentStep ?? ""}:${cur}/${tot}`;
}

export interface WorkflowEventsClientOptions {
  runId: string;
  projectId: string;
  /** Push-target for every deduped workflow event. */
  onEvent: (event: WorkflowEvent) => void;
  /**
   * Called when heartbeat's runHash disagrees with the client's local
   * computation — signals a dropped frame. Consumer should fetch
   * /status via REST to reconcile.
   */
  onMismatch: () => void;
  /**
   * Gives the client a point-in-time view of the local state so it can
   * compute its own hash and compare. Called lazily each heartbeat.
   */
  getLocalHashInputs: () => LocalRunHashInputs | null;
  /** Optional: connect state hook for UI indicators. */
  onStatusChange?: (s: "connecting" | "open" | "reconnecting" | "closed") => void;
}

export class WorkflowEventsClient {
  private ws?: WebSocket;
  private destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatWatchdog?: ReturnType<typeof setTimeout>;
  private hiddenTimer?: ReturnType<typeof setTimeout>;
  private seenIds = new Set<string>();

  constructor(private readonly opts: WorkflowEventsClientOptions) {
    this.connect();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
    }
  }

  /** Close permanently and release all resources. Safe to call twice. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
    }
    this.clearReconnectTimer();
    this.clearHeartbeatWatchdog();
    this.clearHiddenTimer();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "component_unmount");
    }
    this.ws = undefined;
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private connect() {
    if (this.destroyed) return;
    this.clearReconnectTimer();
    this.opts.onStatusChange?.(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");

    // Same-origin WS URL — reuses the page's cookie for auth automatically.
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const qs = new URLSearchParams({
      runId: this.opts.runId,
      projectId: this.opts.projectId,
    });
    const url = `${proto}//${location.host}/aurora/workflow-events?${qs.toString()}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.warn("[workflow-events] WebSocket construct failed:", err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.armHeartbeatWatchdog();
      this.opts.onStatusChange?.("open");
    };

    ws.onmessage = (e) => {
      this.armHeartbeatWatchdog();
      let frame: WsFrame;
      try {
        frame = JSON.parse(e.data as string) as WsFrame;
      } catch {
        return;
      }
      this.handleFrame(frame);
    };

    ws.onerror = () => {
      // ws will also fire onclose, which is where we reconnect from.
    };

    ws.onclose = (e) => {
      this.clearHeartbeatWatchdog();
      if (this.destroyed) return;
      if (e.code === DONT_RETRY_CODE) {
        // Policy violation — auth failure, bad runId, etc. Permanent.
        this.opts.onStatusChange?.("closed");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private handleFrame(frame: WsFrame) {
    if (frame.event === "heartbeat") {
      const local = this.opts.getLocalHashInputs();
      if (local) {
        const localHash = computeLocalRunHash(local);
        if (localHash !== frame.data.runHash) {
          this.opts.onMismatch();
        }
      }
      return;
    }
    if (frame.event === "workflow_event") {
      const id = frame.data.id;
      if (id) {
        if (this.seenIds.has(id)) return; // dedup across reconnects
        this.seenIds.add(id);
        // Unbounded growth guard — in practice we see O(100) ids per run;
        // cap at 2000 which is also the Redis stream cap.
        if (this.seenIds.size > 2_000) {
          this.seenIds = new Set(Array.from(this.seenIds).slice(-1_000));
        }
      }
      this.opts.onEvent(frame.data);
      return;
    }
    if (frame.event === "terminate") {
      // Server asked us to stop reconnecting. Treat like 1008.
      this.destroyed = true;
      this.opts.onStatusChange?.("closed");
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.reconnectAttempt += 1;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (this.reconnectAttempt - 1));
    const jitter = Math.floor(Math.random() * BACKOFF_JITTER_MS);
    const delay = base + jitter;
    this.opts.onStatusChange?.("reconnecting");
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private armHeartbeatWatchdog() {
    this.clearHeartbeatWatchdog();
    this.heartbeatWatchdog = setTimeout(() => {
      // Nothing heard in 75s — force a reconnect.
      try {
        this.ws?.close(1001, "heartbeat_timeout");
      } catch {
        // ignore
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeatWatchdog() {
    if (this.heartbeatWatchdog) {
      clearTimeout(this.heartbeatWatchdog);
      this.heartbeatWatchdog = undefined;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private clearHiddenTimer() {
    if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = undefined;
    }
  }

  // ─── Visibility / network events ─────────────────────────────────────

  private onVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      // Delay actual disconnect — users often tab back within seconds.
      this.clearHiddenTimer();
      this.hiddenTimer = setTimeout(() => {
        try {
          this.ws?.close(1000, "hidden_disconnect");
        } catch {
          // ignore
        }
      }, HIDDEN_DISCONNECT_MS);
    } else {
      this.clearHiddenTimer();
      // Returning to tab — resync via REST regardless of socket state,
      // then make sure we're connected.
      this.opts.onMismatch();
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.reconnectAttempt = 0; // skip backoff on explicit user return
        this.connect();
      }
    }
  };

  private onOnline = () => {
    // Network came back — jump straight to reconnect, don't wait for backoff.
    if (this.destroyed) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();
      this.connect();
    }
  };
}

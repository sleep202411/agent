"use client";

/**
 * NotificationsSocket — a lean client for the server's `/aurora/ws/notifications`
 * gateway. Unlike the documents provider there is no Yjs / offline cache: it
 * just holds one authenticated WebSocket (same-origin cookie auth), reconnects
 * with backoff, keeps itself non-zombie with a periodic ping, and fans inbound
 * `notification` frames out to subscribers. Browser-only.
 */

const PING_INTERVAL_MS = 25_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

/** Mirror of the server NotificationDTO (packages/shared). */
export interface StudioNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  meta: { deeplink?: string; [k: string]: unknown };
  readAt: string | null;
  createdAt: string;
}

type Listener = (n: StudioNotification) => void;

/**
 * Build the notifications WS URL. In prod the ingress upgrades the same-origin
 * `/aurora/ws/notifications`. In dev the Next proxy can't WS-upgrade, so reuse
 * the documents dev base (`NEXT_PUBLIC_AURORA_WS_BASE`, e.g.
 * `ws://localhost:4399/ws/documents`) but swap its path to notifications.
 */
function buildWsUrl(): string {
  const devBase = process.env.NEXT_PUBLIC_AURORA_WS_BASE;
  if (devBase && /^wss?:\/\//.test(devBase)) {
    try {
      const u = new URL(devBase);
      u.pathname = "/ws/notifications";
      u.search = "";
      return u.toString();
    } catch {
      /* fall through to same-origin */
    }
  }
  const origin = window.location.origin.replace(/^http/, "ws");
  return `${origin}/aurora/ws/notifications`;
}

export class NotificationsSocket {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  connect() {
    if (this.destroyed || this.ws) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(buildWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.startPing();
    };
    socket.onmessage = (event) => this.onMessage(event);
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.stopPing();
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    this.destroyed = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.listeners.clear();
    if (this.ws) {
      this.ws.onclose = null; // don't reconnect on an intentional close
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }

  private onMessage(event: MessageEvent) {
    let frame: { event?: string; data?: unknown };
    try {
      frame = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (frame.event === "notification" && frame.data) {
      const n = frame.data as StudioNotification;
      for (const listener of this.listeners) listener(n);
    }
    // heartbeat / terminate frames need no action: a terminate is followed by a
    // close, which triggers reconnect (a fresh auth handshake).
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ event: "ping" }));
        } catch {
          /* socket dying; onclose will reconnect */
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

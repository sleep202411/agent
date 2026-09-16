"use client";

/**
 * WebSocket client for `/aurora/entity-events/subscribe` — per-user
 * real-time entity change notifications. A single socket covers all
 * projects the user has open, all background worker write-backs, and
 * all LLM tool-call mutations. The consumer invalidates React Query
 * caches / dispatches Redux touch actions based on the event payload.
 *
 * Wire protocol (see `EntityEventsGateway.ts`):
 *   { event: "entity_changed", data: EntityEvent }
 *   { event: "heartbeat",      data: { serverTime } }
 *   { event: "terminate",      data: { reason, code } }
 */
import type { EntityEvent } from "@repo/shared/entity-events";

export type EntityEventsFrame =
  | { event: "entity_changed"; data: EntityEvent }
  | { event: "heartbeat"; data: { serverTime: number } }
  | { event: "terminate"; data: { reason: string; code: number } };

export interface EntityEventsClientHandlers {
  onOpen?: () => void;
  onReconnected?: () => void;
  onEntityChanged?: (event: EntityEvent) => void;
  onTerminate?: (reason: string, code: number) => void;
  onClose?: (code: number, reason: string) => void;
}

export interface EntityEventsClient {
  close(): void;
  readonly isOpen: boolean;
}

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
const FATAL_CLOSE_CODES = new Set([1008, 4001]);

function buildUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("EntityEventsClient only works in the browser");
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // In local dev the web (Next) and the backend (Nest) live on
  // different ports; Next doesn't proxy the WS Upgrade, so we hit the
  // Nest port directly and use the bare gateway path (no `/aurora`
  // prefix — that prefix only exists because of nginx / AKS ingress
  // routing in prod, where the upstream strips it before forwarding).
  // satoken is mirrored into the query string as defence in depth:
  // the gateway prefers query and falls back to the cookie header,
  // so handshakes survive odd cookie-jar edge cases.
  const isLocal = window.location.hostname === "localhost";
  const host = isLocal ? "localhost:4399" : window.location.host;
  const basePath = isLocal ? "" : "/aurora";
  const params = new URLSearchParams();
  const tokenMatch = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  if (tokenMatch) params.set("satoken", tokenMatch[1]);
  const qs = params.toString();
  return `${proto}//${host}${basePath}/entity-events/subscribe${qs ? `?${qs}` : ""}`;
}

function parseFrame(raw: string): EntityEventsFrame | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    const event = obj.event;
    const data = obj.data;
    if (typeof event !== "string") return null;
    return { event, data } as EntityEventsFrame;
  } catch {
    return null;
  }
}

/**
 * Opens a user-scoped WS. Call site should close when the user logs
 * out / app unmounts. Auto-reconnects with bounded backoff.
 */
export function openEntityEventsClient(handlers: EntityEventsClientHandlers): EntityEventsClient {
  const url = buildUrl();

  let ws: WebSocket | null = null;
  let userClosed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTerminateCode: number | null = null;

  const connect = () => {
    if (userClosed) return;
    console.log(`[entity-events] open attempt#${attempts + 1}`);
    const sock = new WebSocket(url);
    ws = sock;

    sock.addEventListener("open", () => {
      if (userClosed || ws !== sock) return;
      const wasReconnect = attempts > 0;
      attempts = 0;
      console.log(`[entity-events] open success`);
      handlers.onOpen?.();
      if (!userClosed && ws === sock && wasReconnect) handlers.onReconnected?.();
    });

    sock.addEventListener("message", (ev) => {
      if (userClosed || ws !== sock) return;
      const frame = parseFrame(typeof ev.data === "string" ? ev.data : "");
      if (!frame) return;
      if (frame.event === "entity_changed") {
        handlers.onEntityChanged?.(frame.data);
      } else if (frame.event === "terminate") {
        lastTerminateCode = frame.data.code;
        handlers.onTerminate?.(frame.data.reason, frame.data.code);
      }
      // heartbeat: ignored by default; socket liveness only
    });

    sock.addEventListener("close", (ev) => {
      if (ws !== sock) return;
      ws = null;
      handlers.onClose?.(ev.code, ev.reason);
      if (userClosed) return;
      const fatal =
        FATAL_CLOSE_CODES.has(ev.code) ||
        (lastTerminateCode != null && FATAL_CLOSE_CODES.has(lastTerminateCode));
      console.log(
        `[entity-events] close code=${ev.code} reason=${ev.reason} terminateCode=${lastTerminateCode ?? "-"} fatal=${fatal} attempts=${attempts}`
      );
      if (fatal) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempts, RECONNECT_DELAYS_MS.length - 1)];
      attempts += 1;
      reconnectTimer = setTimeout(connect, delay);
    });

    sock.addEventListener("error", () => {
      // noisy on flaky wifi; close handler drives reconnect
    });
  };

  connect();

  return {
    close() {
      userClosed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws?.close(1000, "client_close");
      } catch {}
      ws = null;
    },
    get isOpen() {
      return ws?.readyState === WebSocket.OPEN;
    },
  };
}

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
import { env } from "@/src/env";

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
  const isDev =
    window.location.hostname === "localhost" &&
    (window.location.port === "3000" || window.location.port === "5173");
  // `WS_HOST` lets prod-com bypass a CDN-fronted main domain by pointing the
  // WS straight at the platform host (e.g. `fizzstudio.fizzdragon.com`). When
  // we cross origins like that, the auth cookie won't auto-attach, so we
  // pull `satoken` out of `document.cookie` and append it as a query param;
  // the gateway falls back to query if the cookie header is empty.
  const host = isDev ? "localhost:3001" : env.WS_HOST || window.location.host;
  const params = new URLSearchParams();
  const tokenMatch = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  if (tokenMatch) params.set("satoken", tokenMatch[1]);
  const qs = params.toString();
  return `${proto}//${host}/aurora/entity-events/subscribe${qs ? `?${qs}` : ""}`;
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
    const tokenHint = url.match(/satoken=([^&]{0,8})/)?.[1] ?? "(none)";
    console.log(`[entity-events] open attempt#${attempts + 1} token=${tokenHint}`);
    const sock = new WebSocket(url);
    ws = sock;

    sock.addEventListener("open", () => {
      const wasReconnect = attempts > 0;
      attempts = 0;
      console.log(`[entity-events] open success token=${tokenHint}`);
      handlers.onOpen?.();
      if (wasReconnect) handlers.onReconnected?.();
    });

    sock.addEventListener("message", (ev) => {
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

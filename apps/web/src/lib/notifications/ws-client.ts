"use client";

/**
 * WebSocket client for `/aurora/notifications/subscribe` — per-user
 * realtime push for in-app notifications.
 *
 * Same wire pattern as entity-events: heartbeat / terminate frames,
 * cross-origin satoken-in-query fallback, bounded reconnect backoff.
 * Fatal close codes (1008 unauthorized) stop reconnect; transient
 * codes trigger exponential backoff.
 *
 * Lifecycle expectation: open ONCE per browser tab from the app root.
 * Don't open per-component — that's the bug we hit on chat
 * (project_chat_ws_lifecycle). Notification provider mounts this
 * directly under the auth boundary and only closes on logout / unload.
 */

import type { NotificationDTO } from "@repo/shared/notifications";
import { env } from "@/src/env";

export type NotificationFrame =
  | { event: "notification"; data: NotificationDTO }
  | { event: "heartbeat"; data: { serverTime: number } }
  | { event: "terminate"; data: { reason: string; code: number } };

export interface NotificationWsHandlers {
  onOpen?: () => void;
  onReconnected?: () => void;
  onNotification?: (n: NotificationDTO) => void;
  onTerminate?: (reason: string, code: number) => void;
  onClose?: (code: number, reason: string) => void;
}

export interface NotificationWsClient {
  close(): void;
  readonly isOpen: boolean;
}

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
const FATAL_CLOSE_CODES = new Set([1008, 4001]);

function buildUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("NotificationWsClient only works in the browser");
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const isDev =
    window.location.hostname === "localhost" &&
    (window.location.port === "3000" || window.location.port === "5173");
  const host = isDev ? "localhost:3001" : env.WS_HOST || window.location.host;
  const params = new URLSearchParams();
  const tokenMatch = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  if (tokenMatch) params.set("satoken", tokenMatch[1]);
  const qs = params.toString();
  return `${proto}//${host}/aurora/notifications/subscribe${qs ? `?${qs}` : ""}`;
}

function parseFrame(raw: string): NotificationFrame | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    const event = obj.event;
    const data = obj.data;
    if (typeof event !== "string") return null;
    return { event, data } as NotificationFrame;
  } catch {
    return null;
  }
}

export function openNotificationWs(handlers: NotificationWsHandlers): NotificationWsClient {
  const url = buildUrl();

  let ws: WebSocket | null = null;
  let userClosed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTerminateCode: number | null = null;

  const connect = () => {
    if (userClosed) return;
    const sock = new WebSocket(url);
    ws = sock;

    sock.addEventListener("open", () => {
      const wasReconnect = attempts > 0;
      attempts = 0;
      handlers.onOpen?.();
      if (wasReconnect) handlers.onReconnected?.();
    });

    sock.addEventListener("message", (ev) => {
      const frame = parseFrame(typeof ev.data === "string" ? ev.data : "");
      if (!frame) return;
      if (frame.event === "notification") {
        handlers.onNotification?.(frame.data);
      } else if (frame.event === "terminate") {
        lastTerminateCode = frame.data.code;
        handlers.onTerminate?.(frame.data.reason, frame.data.code);
      }
    });

    sock.addEventListener("close", (ev) => {
      ws = null;
      handlers.onClose?.(ev.code, ev.reason);
      if (userClosed) return;
      const fatal =
        FATAL_CLOSE_CODES.has(ev.code) ||
        (lastTerminateCode != null && FATAL_CLOSE_CODES.has(lastTerminateCode));
      if (fatal) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempts, RECONNECT_DELAYS_MS.length - 1)];
      attempts += 1;
      reconnectTimer = setTimeout(connect, delay);
    });

    sock.addEventListener("error", () => {
      // Close handler drives reconnect; the error event is too noisy
      // on flaky networks to act on directly.
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

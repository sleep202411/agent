"use client";

/**
 * WebSocket client for `/aurora/ws/conversations` — per-user
 * realtime push for messages, read advances, and context flips
 * across all conversations the user participates in.
 *
 * Same wire pattern + lifecycle as notifications/ws-client.ts:
 *   - heartbeat / terminate frames
 *   - cross-origin satoken-in-query fallback
 *   - bounded exponential reconnect; fatal codes (1008 unauthorized)
 *     stop the loop
 *
 * Open ONCE per browser tab from the app root (auth boundary).
 * Per-component opens were the bug we hit on the chat module
 * (project_chat_ws_lifecycle); don't repeat it.
 */
import type {
  ConversationContextType,
  ConversationFrame,
  MessageDTO,
} from "@repo/shared/conversation";

export interface ConversationWsHandlers {
  onOpen?: () => void;
  onReconnected?: () => void;
  onMessage?: (data: {
    conversationId: string;
    message: MessageDTO;
    lastMessageAt: string;
    unreadCount: number;
  }) => void;
  onReadAdvanced?: (data: {
    conversationId: string;
    userId: string;
    lastReadMessageId: string;
  }) => void;
  onContextChanged?: (data: {
    conversationId: string;
    from: ConversationContextType;
    to: ConversationContextType;
    contextId: string;
  }) => void;
  onTerminate?: (reason: string, code: number) => void;
  onClose?: (code: number, reason: string) => void;
}

export interface ConversationWsClient {
  close(): void;
  readonly isOpen: boolean;
}

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
const FATAL_CLOSE_CODES = new Set([1008, 4001]);

function buildUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("ConversationWsClient only works in the browser");
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Same dev vs. prod path rule as notifications: nginx / AKS
  // ingress strips `/aurora` upstream; localhost goes direct.
  const isLocal = window.location.hostname === "localhost";
  const host = isLocal ? "localhost:4399" : window.location.host;
  const basePath = isLocal ? "" : "/aurora";
  const params = new URLSearchParams();
  const tokenMatch = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  if (tokenMatch) params.set("satoken", tokenMatch[1]);
  const qs = params.toString();
  return `${proto}//${host}${basePath}/ws/conversations${qs ? `?${qs}` : ""}`;
}

function parseFrame(raw: string): ConversationFrame | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    const event = obj.event;
    if (typeof event !== "string") return null;
    return obj as unknown as ConversationFrame;
  } catch {
    return null;
  }
}

export function openConversationWs(handlers: ConversationWsHandlers): ConversationWsClient {
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
      switch (frame.event) {
        case "message.created":
          handlers.onMessage?.(frame.data);
          break;
        case "read.advanced":
          handlers.onReadAdvanced?.(frame.data);
          break;
        case "context.changed":
          handlers.onContextChanged?.(frame.data);
          break;
        case "terminate":
          lastTerminateCode = frame.data.code;
          handlers.onTerminate?.(frame.data.reason, frame.data.code);
          break;
        // heartbeat: implicit — receipt updates lastActivity on the
        // server side via the socket-level pong; no client action.
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
      // Close drives reconnect — error fires too noisily on flaky
      // networks to act on directly.
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

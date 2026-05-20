/**
 * WebSocket client for `/aurora/quota/subscribe` — per-user quota
 * live updates.
 *
 * Wire protocol (see `QuotaEventsGateway.ts`):
 *   { event: "quota_updated", data: QuotaSnapshotWire }
 *   { event: "heartbeat",      data: { serverTime } }
 *   { event: "terminate",      data: { reason, code } }
 *
 * Mirrors the shape of `entity-events-client.ts` — same auto-reconnect
 * + same satoken-in-query defence-in-depth. The shared QuotaProvider
 * owns one of these for the lifetime of the authenticated session.
 */
import type { QuotaEventFrame, QuotaSnapshotWire } from "@repo/shared";

export interface QuotaClientHandlers {
  onUpdate?: (snapshot: QuotaSnapshotWire) => void;
  onOpen?: () => void;
  onReconnected?: () => void;
  onTerminate?: (reason: string, code: number) => void;
  onClose?: (code: number, reason: string) => void;
}

export interface QuotaClient {
  close(): void;
  readonly isOpen: boolean;
}

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
const FATAL_CLOSE_CODES = new Set([1008, 4001]);

function buildUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("QuotaClient only works in the browser");
  }
  // Same-host WS — apex nginx and AKS ingress both proxy the Upgrade
  // header. satoken mirrored into the query so the gateway's
  // query-first fallback can pick it up if the cookie jar misses.
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const isDev =
    window.location.hostname === "localhost" &&
    (window.location.port === "3000" || window.location.port === "5173");
  const host = isDev ? "localhost:3001" : window.location.host;
  const params = new URLSearchParams();
  const tokenMatch = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  if (tokenMatch) params.set("satoken", tokenMatch[1]);
  const qs = params.toString();
  return `${proto}//${host}/aurora/quota/subscribe${qs ? `?${qs}` : ""}`;
}

function parseFrame(raw: string): QuotaEventFrame | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    const event = obj.event;
    if (typeof event !== "string") return null;
    return obj as unknown as QuotaEventFrame;
  } catch {
    return null;
  }
}

export function openQuotaClient(handlers: QuotaClientHandlers): QuotaClient {
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
      if (frame.event === "quota_updated") {
        handlers.onUpdate?.(frame.data);
      } else if (frame.event === "terminate") {
        lastTerminateCode = frame.data.code;
        handlers.onTerminate?.(frame.data.reason, frame.data.code);
      }
      // heartbeat: socket-liveness only; nothing to render
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
      // close fires after error, retry handled there
    });
  };

  connect();

  return {
    close() {
      userClosed = true;
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      try {
        ws?.close(1000, "user_closed");
      } catch {}
      ws = null;
    },
    get isOpen() {
      return ws?.readyState === WebSocket.OPEN;
    },
  };
}

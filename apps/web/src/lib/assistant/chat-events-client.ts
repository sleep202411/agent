/**
 * WebSocket client for `/aurora/chat-events` — the per-conversation event
 * fan-out that ChatEventsGateway publishes. Opens a connection bound to a
 * projectId and emits frame-level events to the caller.
 *
 * Wire protocol (server-authored, see chat-events.gateway.ts):
 *   { event: "message_list",    data: { messageIds } }       — initial snapshot
 *   { event: "message_added",   data: { messageId } }        — new message committed
 *   { event: "message_updated", data: { messageId } }        — content mutated
 *   { event: "agent_state",     data: { state } }            — running/idle/...
 *   { event: "heartbeat",       data: { conversationHash } } — every 30s
 *   { event: "terminate",       data: { reason, code } }     — server-initiated close
 */
export type ChatAgentState = "idle" | "running" | "waiting" | "failed" | string;

export type ChatEventFrame =
  | { event: "message_list"; data: { messageIds: string[] } }
  | { event: "message_added"; data: { messageId: string } }
  | { event: "message_updated"; data: { messageId: string } }
  | { event: "agent_state"; data: { state: ChatAgentState } }
  | {
      event: "heartbeat";
      data: { conversationHash: string; serverTime: number };
    }
  | { event: "terminate"; data: { reason: string; code: number } };

export interface ChatEventsClientHandlers {
  onOpen?: () => void;
  onFrame?: (frame: ChatEventFrame) => void;
  onMessageList?: (messageIds: string[]) => void;
  onMessageChanged?: (messageId: string) => void;
  onAgentState?: (state: ChatAgentState) => void;
  onTerminate?: (reason: string, code: number) => void;
  /**
   * Fires only when the client gives up — either `close()` was called,
   * a fatal terminate (auth failure) was received, or max reconnect
   * attempts were exhausted. Transient drops that reconnect cleanly do
   * NOT fire this.
   */
  onClose?: (event: CloseEvent) => void;
  /** Fires each time we drop and will attempt to reconnect. */
  onReconnecting?: (attempt: number, delayMs: number) => void;
  /** Fires after a reconnect succeeds. */
  onReconnected?: () => void;
}

export interface ChatEventsClient {
  close(): void;
  readonly isOpen: boolean;
}

// Backoff schedule. Matches what production users tolerate — first retry is
// near-instant so the usual "flaky wifi blip" feels seamless, then we back
// off to avoid hammering the server during a real outage.
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
// Terminate codes we should NOT retry — no point reconnecting when the
// server already said "go away".
const FATAL_CLOSE_CODES = new Set([
  1008, // policy violation (auth failure, missing conversationId)
  4001, // custom "do not reconnect" if we add it later
]);

function buildUrl(conversationId: string, workspaceId?: string): string {
  if (typeof window === "undefined") {
    throw new Error("ChatEventsClient only works in the browser");
  }
  // Production (through Nginx) uses same-origin — the `/aurora/chat/...`
  // location block proxies the Upgrade header to Nest. In local dev the
  // Next.js dev server does NOT proxy WS upgrades (only HTTP via
  // next.config rewrites), so we hit Nest directly on :3001. Matches the
  // handling in workflow-events-client.ts for the sibling gateway.
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const isDev =
    window.location.hostname === "localhost" &&
    (window.location.port === "3000" || window.location.port === "5173");
  const host = isDev ? "localhost:3001" : window.location.host;
  const params = new URLSearchParams({ conversationId });
  if (workspaceId) params.set("workspaceId", workspaceId);
  return `${proto}//${host}/aurora/chat/subscribe-conversation?${params.toString()}`;
}

function parseFrame(raw: string): ChatEventFrame | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    const event = obj.event;
    const data = obj.data;
    if (typeof event !== "string") return null;
    return { event, data } as ChatEventFrame;
  } catch {
    return null;
  }
}

/**
 * Opens a WS bound to one conversation. The caller is responsible for
 * closing it when no longer needed (e.g. project switch, unmount).
 *
 * Auto-reconnects on unclean drops with bounded backoff. On reconnect the
 * server replays the message_list snapshot, so callers relying on onMessageList
 * for initial state will see it again — they should treat it as idempotent.
 */
export function openChatEventsClient(
  conversationId: string,
  handlers: ChatEventsClientHandlers,
  opts?: { workspaceId?: string }
): ChatEventsClient {
  const url = buildUrl(conversationId, opts?.workspaceId);

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
      handlers.onFrame?.(frame);
      switch (frame.event) {
        case "message_list":
          handlers.onMessageList?.(frame.data.messageIds);
          break;
        case "message_added":
        case "message_updated":
          handlers.onMessageChanged?.(frame.data.messageId);
          break;
        case "agent_state":
          handlers.onAgentState?.(frame.data.state);
          break;
        case "terminate":
          lastTerminateCode = frame.data.code;
          handlers.onTerminate?.(frame.data.reason, frame.data.code);
          break;
      }
    });

    sock.addEventListener("close", (event) => {
      if (userClosed) {
        handlers.onClose?.(event);
        return;
      }
      const fatalByTerminate =
        lastTerminateCode !== null && FATAL_CLOSE_CODES.has(lastTerminateCode);
      const fatalByCode = FATAL_CLOSE_CODES.has(event.code);
      if (fatalByTerminate || fatalByCode) {
        userClosed = true;
        handlers.onClose?.(event);
        return;
      }
      if (attempts >= RECONNECT_DELAYS_MS.length) {
        userClosed = true;
        handlers.onClose?.(event);
        return;
      }
      const delay = RECONNECT_DELAYS_MS[attempts];
      attempts += 1;
      handlers.onReconnecting?.(attempts, delay);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    });
  };

  connect();

  return {
    close() {
      if (userClosed) return;
      userClosed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws?.close(1000, "client_close");
      } catch {
        /* already dead */
      }
      ws = null;
    },
    get isOpen() {
      return !userClosed && ws?.readyState === WebSocket.OPEN;
    },
  };
}

/**
 * WebSocket client for `/aurora/chat-events` — the per-conversation event
 * fan-out that ChatEventsGateway publishes. Opens a connection bound to a
 * projectId and emits frame-level events to the caller.
 *
 * Wire protocol (server-authored, see chat-events.gateway.ts):
 *   { event: "message_list",     data: { messageIds } }
 *        — initial snapshot, triggers batch get-messages fetch on first connect
 *   { event: "message_added",    data: { messageId, message? } }
 *        — new message; `message` is the full blob for same-tick renders.
 *          When omitted (rare fallback), client falls back to get-messages.
 *   { event: "message_updated",  data: { messageId, message? } }
 *        — structural change; same payload convention as added
 *   { event: "message_chunk",    data: { messageId, partIndex, appendText } }
 *        — streaming text delta, append in place, no fetch
 *   { event: "message_finalize", data: { messageId } }
 *        — streaming done, drop caret / unlock actions
 *   { event: "agent_state",      data: { state } }
 *        — running/idle/waiting/failed
 *   { event: "heartbeat",        data: { conversationHash, serverTime } }
 *        — every 30s
 *   { event: "terminate",        data: { reason, code } }
 *        — server-initiated close
 */
import type { AgentState } from "@repo/shared";

export type ChatAgentState = "idle" | "running" | "waiting" | "failed" | string;

/**
 * Messages are opaque to this layer — the canonical shape lives in
 * assistant-types.ts. We only care that `id` exists and the object is
 * JSON-serializable.
 */
export type InlineMessage = { id: string; [k: string]: unknown };

export type ChatEventFrame =
  | { event: "message_list"; data: { messageIds: string[] } }
  | { event: "message_added"; data: { messageId: string; message?: InlineMessage } }
  | {
      event: "message_updated";
      data: { messageId: string; message?: InlineMessage };
    }
  | {
      event: "message_chunk";
      data: { messageId: string; partIndex: number; appendText: string };
    }
  | { event: "message_finalize"; data: { messageId: string } }
  | { event: "agent_state"; data: { state: ChatAgentState } }
  | {
      // Rich agent-state event from AgentStateService — replaces the
      // simpler `agent_state` event for new clients. Both flow on the
      // same WS for the migration window; this carries turnId /
      // lastError / enteredAt for richer composer hints.
      event: "agent_state_changed";
      data: { projectId: string; state: AgentState };
    }
  | {
      event: "heartbeat";
      data: { conversationHash: string; serverTime: number };
    }
  | { event: "terminate"; data: { reason: string; code: number } };

export interface ChatEventsClientHandlers {
  onOpen?: () => void;
  onFrame?: (frame: ChatEventFrame) => void;
  onMessageList?: (messageIds: string[]) => void;
  /**
   * Fires for both `message_added` and `message_updated`. When the frame
   * inlined the full blob (the steady-state path), `message` is set and
   * the consumer can dispatch directly; when absent (rare — legacy
   * events), the consumer should fall back to a REST fetch by messageId.
   */
  onMessageChanged?: (messageId: string, message?: InlineMessage) => void;
  /**
   * Fires on every streaming text-delta. Client should append `appendText`
   * to `message.parts[partIndex].text` in place — do NOT refetch the
   * message via get-messages.
   */
  onMessageChunk?: (messageId: string, partIndex: number, appendText: string) => void;
  /**
   * Fires when a streaming message finishes. The Redis blob is now final;
   * clients can drop any "streaming" UI indicator (caret etc).
   */
  onMessageFinalize?: (messageId: string) => void;
  onAgentState?: (state: ChatAgentState) => void;
  /** Rich agent-state callback. Receives the full AgentState from
   *  the server-authoritative AgentStateService — projectId is
   *  passed through so multi-project consumers can route. */
  onAgentStateChanged?: (projectId: string, state: AgentState) => void;
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
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // In local dev the web (Next) and the backend (Nest) live on
  // different ports; Next doesn't proxy the WS Upgrade, so we hit the
  // Nest port directly and use the bare gateway path (no `/aurora`
  // prefix — that prefix only exists because of nginx / AKS ingress
  // routing in prod, where the upstream strips it before forwarding).
  const isLocal = window.location.hostname === "localhost";
  const host = isLocal ? "localhost:4399" : window.location.host;
  const basePath = isLocal ? "" : "/aurora";
  const params = new URLSearchParams({ conversationId });
  if (workspaceId) params.set("workspaceId", workspaceId);
  const tokenMatch = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  if (tokenMatch) params.set("satoken", tokenMatch[1]);
  return `${proto}//${host}${basePath}/chat/subscribe-conversation?${params.toString()}`;
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
    const tokenHint = url.match(/satoken=([^&]{0,8})/)?.[1] ?? "(none)";
    console.log(
      `[chat-events] open attempt#${attempts + 1} conv=${conversationId.slice(0, 8)} token=${tokenHint}`
    );
    const sock = new WebSocket(url);
    ws = sock;

    sock.addEventListener("open", () => {
      const wasReconnect = attempts > 0;
      attempts = 0;
      console.log(`[chat-events] open success token=${tokenHint}`);
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
          handlers.onMessageChanged?.(frame.data.messageId, frame.data.message);
          break;
        case "message_chunk":
          handlers.onMessageChunk?.(
            frame.data.messageId,
            frame.data.partIndex,
            frame.data.appendText
          );
          break;
        case "message_finalize":
          handlers.onMessageFinalize?.(frame.data.messageId);
          break;
        case "agent_state":
          handlers.onAgentState?.(frame.data.state);
          break;
        case "agent_state_changed":
          handlers.onAgentStateChanged?.(frame.data.projectId, frame.data.state);
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
      console.log(
        `[chat-events] close code=${event.code} reason=${event.reason} terminateCode=${lastTerminateCode ?? "-"} fatal=${fatalByTerminate || fatalByCode} attempts=${attempts}`
      );
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

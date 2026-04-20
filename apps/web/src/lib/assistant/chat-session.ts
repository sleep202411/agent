/**
 * Project-scoped chat WS session — the authoritative live channel for
 * message / agent-state updates. Aligns with oii's "connect once, listen
 * forever" model: one WS per active project, decoupled from individual
 * POST submissions.
 *
 * Lifecycle
 *   - ensureSession(projectId, handlers) — idempotent. Opens WS + wires
 *     handlers. Safe to call on every panel mount / project switch.
 *   - closeSession(projectId) — drops the WS.
 *
 * The WS only drives two things:
 *   1. message_list / message_added / message_updated → fetch content via
 *      /aurora/chat/get-messages → invoke onMessage callback
 *   2. agent_state → invoke onAgentState callback (UI flips "thinking"
 *      indicator, runs post-turn effects on transition to "idle")
 *
 * Submission is separate: `submitMessageToAgent` POSTs and returns; the
 * agent stream is consumed server-side into Redis, WS events bubble up
 * here, content pulled on demand.
 */
import type { AssistantMessage } from "./assistant-types";
import {
  openChatEventsClient,
  type ChatAgentState,
  type ChatEventsClient,
} from "./chat-events-client";
import { fetchMessagesByIds } from "./assistant-client";

export interface ChatSessionHandlers {
  onMessage: (message: AssistantMessage) => void;
  /**
   * Fires on every streaming text-delta. Consumer should patch the
   * in-memory AssistantMessage at `parts[partIndex].text += appendText`
   * without a REST round-trip. Missing messageId (we haven't seen the
   * `message_added` yet) is a no-op — the full blob will land shortly.
   */
  onMessageChunk?: (messageId: string, partIndex: number, appendText: string) => void;
  /**
   * Fires when a streaming message finishes. The in-memory copy is now
   * canonical; consumer can drop any "streaming" UI flag.
   */
  onMessageFinalize?: (messageId: string) => void;
  onAgentState?: (state: ChatAgentState) => void;
  onError?: (err: Error) => void;
}

interface ActiveSession {
  projectId: string;
  client: ChatEventsClient;
  handlers: ChatSessionHandlers;
  // IDs we've queued to pull from the store but haven't fetched yet.
  pendingIds: Set<string>;
  fetching: boolean;
  // The last agentState we pushed up, so we don't re-fire identical events.
  lastAgentState: ChatAgentState | null;
}

const sessions = new Map<string, ActiveSession>();

async function drainPending(session: ActiveSession): Promise<void> {
  if (session.fetching) return;
  if (session.pendingIds.size === 0) return;
  session.fetching = true;
  const ids = [...session.pendingIds];
  session.pendingIds.clear();
  try {
    const fetched = await fetchMessagesByIds(session.projectId, ids);
    for (const msg of fetched) {
      try {
        session.handlers.onMessage(msg);
      } catch (err) {
        console.warn("[chat-session] onMessage handler threw:", err);
      }
    }
  } catch (err) {
    console.warn("[chat-session] get-messages failed:", err);
    session.handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
  } finally {
    session.fetching = false;
    if (session.pendingIds.size > 0) void drainPending(session);
  }
}

function openSession(projectId: string, handlers: ChatSessionHandlers): ActiveSession {
  const session = {
    projectId,
    handlers,
    pendingIds: new Set<string>(),
    fetching: false,
    lastAgentState: null as ChatAgentState | null,
  } as ActiveSession;

  session.client = openChatEventsClient(projectId, {
    onMessageList: (ids) => {
      for (const id of ids) session.pendingIds.add(id);
      void drainPending(session);
    },
    onMessageChanged: (id, inlineMessage) => {
      // Steady-state path: the frame already carries the full blob, so
      // dispatch immediately without a REST round-trip. Fall back to
      // get-messages only if the server omitted it (legacy / transitional
      // shape).
      if (inlineMessage) {
        try {
          session.handlers.onMessage(inlineMessage as unknown as AssistantMessage);
        } catch (err) {
          console.warn("[chat-session] onMessage handler threw:", err);
        }
        return;
      }
      session.pendingIds.add(id);
      void drainPending(session);
    },
    onMessageChunk: (id, partIndex, appendText) => {
      // Fire-and-forget: the consumer patches its in-memory copy. No fetch.
      try {
        session.handlers.onMessageChunk?.(id, partIndex, appendText);
      } catch (err) {
        console.warn("[chat-session] onMessageChunk handler threw:", err);
      }
    },
    onMessageFinalize: (id) => {
      try {
        session.handlers.onMessageFinalize?.(id);
      } catch (err) {
        console.warn("[chat-session] onMessageFinalize handler threw:", err);
      }
    },
    onAgentState: (state) => {
      if (state === session.lastAgentState) return;
      session.lastAgentState = state;
      // On transition to terminal states, wait for any pending fetches so
      // consumers see final content before the idle hook runs.
      if (state === "idle" || state === "failed") {
        void (async () => {
          await drainPending(session);
          session.handlers.onAgentState?.(state);
        })();
      } else {
        session.handlers.onAgentState?.(state);
      }
    },
    onTerminate: (reason) => {
      session.handlers.onError?.(new Error(`chat-events terminated: ${reason}`));
    },
    onClose: (ev) => {
      if (!ev.wasClean) {
        session.handlers.onError?.(new Error(`chat-events closed unclean: ${ev.code}`));
      }
    },
  });

  return session;
}

/**
 * Ensure a live WS session for this projectId. Handlers replace any
 * previously-registered ones (keyed by projectId) — callers should treat
 * this as the single source of truth for that project's live updates.
 */
export function ensureSession(projectId: string, handlers: ChatSessionHandlers): void {
  const existing = sessions.get(projectId);
  if (existing) {
    // Swap handlers onto the live client — common on panel remount after
    // React fast-refresh / RSC navigations.
    existing.handlers = handlers;
    return;
  }
  sessions.set(projectId, openSession(projectId, handlers));
}

export function closeSession(projectId: string): void {
  const session = sessions.get(projectId);
  if (!session) return;
  sessions.delete(projectId);
  session.client.close();
}

export function closeAllSessions(): void {
  for (const [id] of sessions) closeSession(id);
}

/** Test / debug helper — returns current WS open state. */
export function isSessionOpen(projectId: string): boolean {
  return sessions.get(projectId)?.client.isOpen === true;
}

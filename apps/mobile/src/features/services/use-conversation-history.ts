import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchConversation,
  fetchConversationMessages,
  type NativeConversation,
  type NativeMessage,
} from "./conversation-api";
type History = { items: NativeMessage[]; nextCursor: string | null };
/** Both inputs are newest-first. Retain older rows only when the fresh page
 * overlaps them; otherwise reset pagination rather than implying no gap. */
export function refreshMessageHistory(previous: History, fresh: History): History {
  const boundary = fresh.items.at(-1)?.id;
  const index = boundary ? previous.items.findIndex((m) => m.id === boundary) : -1;
  if (index < 0 || fresh.nextCursor === null) return fresh;
  const freshIds = new Set(fresh.items.map((m) => m.id));
  return {
    items: [...fresh.items, ...previous.items.slice(index + 1).filter((m) => !freshIds.has(m.id))],
    nextCursor: previous.nextCursor,
  };
}
type Mode = "refresh" | "older";
type Session = {
  key: string;
  abort: AbortController;
  busy: boolean;
  pendingRefresh: boolean;
  failed?: Mode;
  detail?: NativeConversation;
  history: History;
  cursors: Set<string>;
};
type Snapshot = {
  key: string;
  detail?: NativeConversation;
  messages: NativeMessage[];
  loading: boolean;
  hasMore: boolean;
  error?: string;
};
export function useConversationHistory(
  conversationId: string,
  viewerId: string,
  generation: number,
  active: boolean
) {
  const key = JSON.stringify([conversationId, viewerId, generation, active]);
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [snapshotScope, setSnapshotScope] = useState(key);
  if (snapshotScope !== key) {
    setSnapshotScope(key);
    setSnapshot(undefined);
  }
  const load = useCallback(
    async function run(session: Session, mode: Mode) {
      if (session.abort.signal.aborted) return;
      if (session.busy) {
        if (mode === "refresh") session.pendingRefresh = true;
        return;
      }
      if (mode === "older" && !session.history.nextCursor) return;
      session.busy = true;
      const publish = (error?: string) => {
        if (!session.abort.signal.aborted)
          setSnapshot({
            key: session.key,
            detail: session.detail,
            messages: [...session.history.items].reverse(),
            loading: session.busy,
            hasMore: !!session.history.nextCursor,
            error,
          });
      };
      publish();
      let error: string | undefined;
      let validatedAccess = mode === "older";
      try {
        if (mode === "refresh") {
          session.detail = await fetchConversation(conversationId, viewerId, session.abort.signal);
          validatedAccess = true;
        }
        if (session.abort.signal.aborted) return;
        const result = await fetchConversationMessages(
          conversationId,
          mode === "older" ? session.history.nextCursor : null,
          session.abort.signal
        );
        if (session.abort.signal.aborted) return;
        if (mode === "older") {
          if (result.nextCursor && session.cursors.has(result.nextCursor))
            throw new Error("Message pagination did not advance");
          const seen = new Set(session.history.items.map((m) => m.id));
          session.history = {
            items: [
              ...session.history.items,
              ...result.items.filter((m) => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
              }),
            ],
            nextCursor: result.nextCursor,
          };
        } else {
          session.history = refreshMessageHistory(session.history, result);
          session.cursors.clear();
        }
        if (session.history.nextCursor) session.cursors.add(session.history.nextCursor);
        session.failed = undefined;
      } catch (cause) {
        if (session.abort.signal.aborted) return;
        const status =
          cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (!validatedAccess || status === 401 || status === 403 || status === 404) {
          session.detail = undefined;
          session.history = { items: [], nextCursor: null };
          session.pendingRefresh = false;
        }
        session.failed = session.detail ? mode : "refresh";
        error = cause instanceof Error ? cause.message : String(cause);
      } finally {
        session.busy = false;
        publish(error);
        if (!session.abort.signal.aborted && session.pendingRefresh) {
          session.pendingRefresh = false;
          void run(session, "refresh");
        }
      }
    },
    [conversationId, viewerId]
  );
  useEffect(() => {
    if (!active || !conversationId || !viewerId) return;
    const session: Session = {
      key,
      abort: new AbortController(),
      busy: false,
      pendingRefresh: false,
      history: { items: [], nextCursor: null },
      cursors: new Set(),
    };
    current.current = session;
    void load(session, "refresh");
    return () => {
      session.abort.abort();
      current.current = undefined;
    };
  }, [key, active, conversationId, viewerId, load]);
  const request = (mode: Mode, retry = false) => {
    const session = current.current;
    if (!session || session.key !== key || (mode === "older" && session.failed && !retry)) return;
    void load(session, retry ? (session.failed ?? mode) : mode);
  };
  const visible = active && snapshot?.key === key ? snapshot : undefined;
  return {
    detail: visible?.detail,
    messages: visible?.messages ?? [],
    loading: active && !!conversationId && !!viewerId && (visible?.loading ?? true),
    error: visible?.error,
    hasMore: visible?.hasMore ?? false,
    refresh: () => request("refresh"),
    loadOlder: () => request("older"),
    retry: () => request("refresh", true),
  };
}

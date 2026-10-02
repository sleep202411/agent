import { useCallback, useEffect, useRef, useState } from "react";
import { fetchInbox, type InboxItem, type InboxFilter } from "./inbox-api";
type Session = {
  key: string;
  abort: AbortController;
  cursor: string | null;
  seen: Set<string>;
  more: boolean;
  busy: boolean;
  failed: boolean;
  emptyPageHops: number;
  items: InboxItem[];
};
type Snapshot = {
  key: string;
  items: InboxItem[];
  loading: boolean;
  error?: string;
  more: boolean;
};
export function useInbox(owner: string | undefined, contextType: InboxFilter) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([owner, contextType, revision]);
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [snapshotScope, setSnapshotScope] = useState(key);
  // A return visit must await its own read, even when the account/filter matches.
  if (snapshotScope !== key) {
    setSnapshotScope(key);
    setSnapshot(undefined);
  }
  const load = useCallback(
    async (session: Session) => {
      if (session.busy || !session.more || session.abort.signal.aborted) return;
      session.busy = true;
      let error: string | undefined;
      try {
        do {
          const result = await fetchInbox(contextType, session.cursor, session.abort.signal);
          if (session.abort.signal.aborted) return;
          if (result.nextCursor && session.seen.has(result.nextCursor))
            throw new Error("Inbox pagination did not advance");
          if (result.nextCursor) session.seen.add(result.nextCursor);
          session.items = Array.from(
            new Map([...session.items, ...result.items].map((i) => [i.id, i])).values()
          );
          session.cursor = result.nextCursor;
          session.more = !!result.nextCursor;
          session.failed = false;
          if (session.items.length || !session.more || session.emptyPageHops >= 8) break;
          session.emptyPageHops += 1;
        } while (!session.abort.signal.aborted);
      } catch (cause) {
        if (session.abort.signal.aborted) return;
        session.failed = true;
        const status =
          cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (status === 401 || status === 403) {
          session.items = [];
          session.cursor = null;
          session.seen.clear();
          session.more = true;
        }
        error = cause instanceof Error ? cause.message : "Unable to load conversations";
      } finally {
        session.busy = false;
        if (!session.abort.signal.aborted)
          setSnapshot({
            key: session.key,
            items: session.items,
            loading: false,
            error,
            more: session.more,
          });
      }
    },
    [contextType]
  );
  useEffect(() => {
    if (!owner) return;
    const session: Session = {
      key,
      abort: new AbortController(),
      cursor: null,
      seen: new Set(),
      more: true,
      busy: false,
      failed: false,
      emptyPageHops: 0,
      items: [],
    };
    current.current = session;
    void load(session);
    return () => {
      session.abort.abort();
      current.current = undefined;
    };
  }, [key, owner, revision, load]);
  const more = (retry: boolean, fromScroll = false) => {
    const session = current.current;
    if (
      !session ||
      session.key !== key ||
      session.busy ||
      !session.more ||
      (fromScroll && !session.items.length && session.emptyPageHops >= 8) ||
      (session.failed && !retry)
    )
      return;
    setSnapshot({ key, items: session.items, loading: true, more: true });
    void load(session);
  };
  const visible = owner && snapshot?.key === key ? snapshot : undefined;
  return {
    items: visible?.items ?? [],
    loading: !!owner && (visible?.loading ?? true),
    error: visible?.error,
    hasMore: visible?.more ?? false,
    loadMore: () => more(false),
    loadMoreOnScroll: () => more(false, true),
    retry: () => more(true),
    refresh: () => setRevision((v) => v + 1),
  };
}

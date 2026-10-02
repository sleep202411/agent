import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeNotificationReads } from "./notification-read-events";
import {
  fetchNotifications,
  type NotificationItem,
  type NotificationFilter,
} from "./notification-api";
type Session = {
  key: string;
  abort: AbortController;
  cursor: string | null;
  seen: Set<string>;
  more: boolean;
  busy: boolean;
  failed: boolean;
  refreshFailed: boolean;
  pages: number;
  items: NotificationItem[];
};
type Snapshot = {
  key: string;
  items: NotificationItem[];
  loading: boolean;
  error?: string;
  more: boolean;
};
export function useNotifications(owner: string | undefined, contextType: NotificationFilter) {
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      subscribeNotificationReads((generation) => {
        if (owner && Number(owner) === generation) setRevision((value) => value + 1);
      }),
    [owner]
  );
  const key = JSON.stringify([owner, contextType, revision]);
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [snapshotScope, setSnapshotScope] = useState(key);
  // Returning to an earlier scope requires a fresh response, not its old snapshot.
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
        const result = await fetchNotifications(
          contextType,
          session.cursor,
          Number(owner),
          session.abort.signal
        );
        if (session.abort.signal.aborted) return;
        if (result.nextCursor && session.seen.has(result.nextCursor))
          throw new Error("Notification pagination did not advance");
        if (result.nextCursor) session.seen.add(result.nextCursor);
        session.items = Array.from(
          new Map([...session.items, ...result.items].map((i) => [i.id, i])).values()
        );
        session.cursor = result.nextCursor;
        session.more = !!result.nextCursor;
        session.failed = false;
        session.refreshFailed = false;
        session.pages += 1;
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
        error = cause instanceof Error ? cause.message : "Unable to load notifications";
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
    [contextType, owner]
  );
  const revalidate = useCallback(
    async (session: Session) => {
      if (session.busy || session.abort.signal.aborted) return;
      session.busy = true;
      let error: string | undefined;
      try {
        let cursor: string | null = null;
        const seen = new Set<string>();
        const items = new Map<string, NotificationItem>();
        let pages = 0;
        do {
          const result = await fetchNotifications(
            contextType,
            cursor,
            Number(owner),
            session.abort.signal
          );
          if (session.abort.signal.aborted) return;
          if (result.nextCursor && seen.has(result.nextCursor))
            throw new Error("Notification pagination did not advance");
          if (result.nextCursor) seen.add(result.nextCursor);
          for (const item of result.items) items.set(item.id, item);
          cursor = result.nextCursor;
          pages += 1;
        } while (cursor && pages < Math.max(1, session.pages));
        // Replace atomically after every loaded page is current. A background
        // check must not empty the list or leave old and new cursors mixed.
        session.items = [...items.values()];
        session.cursor = cursor;
        session.seen = seen;
        session.pages = pages;
        session.more = !!cursor;
        session.failed = false;
        session.refreshFailed = false;
      } catch (cause) {
        if (session.abort.signal.aborted) return;
        session.failed = true;
        session.refreshFailed = true;
        const status =
          cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (status === 401 || status === 403) {
          session.items = [];
          session.cursor = null;
          session.seen.clear();
          session.pages = 0;
          session.more = true;
        }
        error = cause instanceof Error ? cause.message : "Unable to load notifications";
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
    [contextType, owner]
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
      refreshFailed: false,
      pages: 0,
      items: [],
    };
    current.current = session;
    void load(session);
    const timer = setInterval(() => {
      if (!session.failed) void revalidate(session);
    }, 60_000);
    return () => {
      clearInterval(timer);
      session.abort.abort();
      current.current = undefined;
    };
  }, [key, owner, revision, load, revalidate]);
  const more = (retry: boolean) => {
    const session = current.current;
    if (
      !session ||
      session.key !== key ||
      session.busy ||
      (!session.more && !session.refreshFailed) ||
      (session.failed && !retry)
    )
      return;
    setSnapshot({ key, items: session.items, loading: true, more: true });
    if (session.refreshFailed) void revalidate(session);
    else void load(session);
  };
  const visible = owner && snapshot?.key === key ? snapshot : undefined;
  return {
    items: visible?.items ?? [],
    loading: !!owner && (visible?.loading ?? true),
    error: visible?.error,
    hasMore: visible?.more ?? false,
    loadMore: () => more(false),
    retry: () => more(true),
    refresh: () => setRevision((v) => v + 1),
  };
}

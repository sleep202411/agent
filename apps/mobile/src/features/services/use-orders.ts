import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOrders,
  type OrderListItem,
  type OrderRole,
  type OrderFilter,
} from "./order-list-api";
type Session = {
  key: string;
  abort: AbortController;
  cursor: string | null;
  seen: Set<string>;
  more: boolean;
  busy: boolean;
  failed: boolean;
  items: OrderListItem[];
};
type Snapshot = {
  key: string;
  items: OrderListItem[];
  loading: boolean;
  error?: string;
  more: boolean;
};
export function useOrders(owner: string | undefined, role: OrderRole, status: OrderFilter) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([owner, role, status, revision]);
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const load = useCallback(
    async (session: Session) => {
      if (session.busy || !session.more || session.abort.signal.aborted) return;
      session.busy = true;
      let error: string | undefined;
      try {
        const result = await fetchOrders(role, status, session.cursor, session.abort.signal);
        if (session.abort.signal.aborted) return;
        if (result.nextCursor && session.seen.has(result.nextCursor))
          throw new Error("Order pagination did not advance");
        if (result.nextCursor) session.seen.add(result.nextCursor);
        session.items = Array.from(
          new Map([...session.items, ...result.items].map((i) => [i.id, i])).values()
        );
        session.cursor = result.nextCursor;
        session.more = !!result.nextCursor;
        session.failed = false;
      } catch (cause) {
        if (session.abort.signal.aborted) return;
        session.failed = true;
        error = cause instanceof Error ? cause.message : "Unable to load orders";
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
    [role, status]
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
      items: [],
    };
    current.current = session;
    void load(session);
    return () => {
      session.abort.abort();
      current.current = undefined;
    };
  }, [key, owner, revision, load]);
  const more = (retry: boolean) => {
    const session = current.current;
    if (
      !session ||
      session.key !== key ||
      session.busy ||
      !session.more ||
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
    retry: () => more(true),
    refresh: () => setRevision((v) => v + 1),
  };
}

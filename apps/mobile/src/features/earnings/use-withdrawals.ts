import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchWithdrawalBalances,
  fetchWithdrawalHistory,
  type WithdrawalBalance,
  type Withdrawal,
} from "./withdrawal-api";
type Snapshot = {
  key: string;
  balances?: WithdrawalBalance[];
  balanceError?: string;
  items: Withdrawal[];
  historyError?: string;
  more: boolean;
  loading: boolean;
};
type Session = Snapshot & {
  abort: AbortController;
  cursor: string | null;
  seen: Set<string>;
  pages: number;
  busy: boolean;
  failedRefresh: boolean;
};
export function useWithdrawals(generation: number, active: boolean) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([generation, active, revision]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [snapshotKey, setSnapshotKey] = useState(key);
  if (snapshotKey !== key) {
    setSnapshotKey(key);
    setSnapshot(undefined);
  }
  const current = useRef<Session | null>(null);
  const load = useCallback(
    async (session: Session, refresh: boolean) => {
      if (session.busy || session.abort.signal.aborted) return;
      session.busy = true;
      await Promise.all([
        refresh
          ? fetchWithdrawalBalances(generation, session.abort.signal)
              .then((balances) => {
                session.balances = balances;
                session.balanceError = undefined;
              })
              .catch((cause: unknown) => {
                session.balances = undefined;
                session.balanceError = cause instanceof Error ? cause.message : String(cause);
              })
          : Promise.resolve(),
        (async () => {
          try {
            let cursor = refresh ? null : session.cursor;
            let rows = refresh ? [] : session.items;
            const seen = refresh ? new Set<string>() : new Set(session.seen);
            let pages = refresh ? 0 : session.pages;
            const count = refresh ? Math.max(session.pages, 1) : 1;
            for (let index = 0; index < count; index++) {
              const page = await fetchWithdrawalHistory(generation, cursor, session.abort.signal);
              if (session.abort.signal.aborted) return;
              if (page.nextCursor && (page.nextCursor === cursor || seen.has(page.nextCursor)))
                throw Error("Withdrawal pagination did not advance.");
              if (cursor) seen.add(cursor);
              rows = [...new Map([...rows, ...page.items].map((row) => [row.id, row])).values()];
              cursor = page.nextCursor;
              pages++;
              if (!cursor) break;
            }
            Object.assign(session, {
              items: rows,
              cursor,
              seen,
              pages,
              more: !!cursor,
              historyError: undefined,
              failedRefresh: false,
            });
          } catch (cause) {
            session.historyError = cause instanceof Error ? cause.message : String(cause);
            session.failedRefresh = refresh;
            // A failed refresh cannot establish that earlier statuses/proofs remain current.
            if (refresh) session.items = [];
            const status =
              cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
            if (
              status === 401 ||
              status === 403 ||
              (status === 400 && /cursor/i.test(session.historyError ?? ""))
            ) {
              session.items = [];
              session.cursor = null;
              session.pages = 0;
              session.seen.clear();
              session.more = true;
            }
          }
        })(),
      ]);
      session.busy = false;
      if (!session.abort.signal.aborted) setSnapshot({ ...session, loading: false });
    },
    [generation]
  );
  useEffect(() => {
    if (!active) return;
    const session: Session = {
      key,
      abort: new AbortController(),
      cursor: null,
      seen: new Set(),
      pages: 0,
      busy: false,
      failedRefresh: false,
      items: [],
      more: false,
      loading: true,
    };
    current.current = session;
    queueMicrotask(() => void load(session, true));
    const timer = setInterval(() => {
      if (!session.balanceError && !session.historyError) void load(session, true);
    }, 60000);
    return () => {
      clearInterval(timer);
      session.abort.abort();
      current.current = null;
    };
  }, [key, active, load]);
  const more = () => {
    const session = current.current;
    if (!session || session.key !== key || session.busy || (!session.more && !session.historyError))
      return;
    setSnapshot({ ...session, loading: true });
    void load(session, session.failedRefresh);
  };
  const visible = active && snapshot?.key === key ? snapshot : undefined;
  return {
    balances: visible?.balances,
    balanceError: visible?.balanceError,
    items: visible?.items ?? [],
    historyError: visible?.historyError,
    hasMore: visible?.more ?? false,
    loading: active && (visible?.loading ?? true),
    loadMore: more,
    refresh: () => setRevision((value) => value + 1),
  };
}

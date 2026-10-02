import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCrewIncome,
  type IncomeRow,
  type IncomePage,
  type IncomeView,
} from "./crew-income-api";
type Session = {
  key: string;
  abort: AbortController;
  cursor: string | null;
  seen: Set<string>;
  more: boolean;
  busy: boolean;
  failed: boolean;
  failedRefresh: boolean;
  pages: number;
  items: IncomeRow[];
  summary?: IncomePage;
};
type Snapshot = {
  key: string;
  items: IncomeRow[];
  summary?: IncomePage;
  loading: boolean;
  error?: string;
  more: boolean;
};
export function useCrewIncome(
  owner: string | undefined,
  userId: string,
  currency: "USD" | "CNY",
  view: IncomeView,
  crewId: string
) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([owner, userId, currency, view, crewId, revision]);
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [snapshotScope, setSnapshotScope] = useState(key);
  // A return visit must not resurrect the previous visit's rows or totals.
  if (snapshotScope !== key) {
    setSnapshotScope(key);
    setSnapshot(undefined);
  }
  const load = useCallback(
    async (session: Session, refresh = false) => {
      if (session.busy || (!refresh && !session.more) || session.abort.signal.aborted) return;
      session.busy = true;
      let error: string | undefined;
      try {
        let cursor = refresh ? null : session.cursor;
        let items = refresh ? [] : session.items;
        let summary = refresh ? undefined : session.summary;
        const seen = refresh ? new Set<string>() : new Set(session.seen);
        let pages = refresh ? 0 : session.pages;
        const count = refresh ? Math.max(1, session.pages) : 1;
        for (let index = 0; index < count; index++) {
          const result = await fetchCrewIncome(
            userId,
            currency,
            view,
            crewId,
            cursor,
            session.abort.signal
          );
          if (session.abort.signal.aborted) return;
          if (result.nextCursor && seen.has(result.nextCursor))
            throw new Error("Earnings pagination did not advance");
          if (result.nextCursor) seen.add(result.nextCursor);
          items = Array.from(
            new Map([...items, ...result.items].map((item) => [item.id, item])).values()
          );
          summary ??= result;
          cursor = result.nextCursor;
          pages++;
          if (!cursor) break;
        }
        session.items = items;
        session.summary = summary;
        session.cursor = cursor;
        session.seen = seen;
        session.pages = pages;
        session.more = !!cursor;
        session.failedRefresh = false;
        session.failed = false;
      } catch (cause) {
        if (session.abort.signal.aborted) return;
        session.failed = true;
        session.failedRefresh = refresh;
        const status =
          cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (
          status === 401 ||
          status === 403 ||
          (status === 400 && /cursor/i.test(cause instanceof Error ? cause.message : ""))
        ) {
          session.items = [];
          session.pages = 0;
          session.summary = undefined;
          session.cursor = null;
          session.seen.clear();
          session.more = true;
        }
        error = cause instanceof Error ? cause.message : "Unable to load earnings";
      } finally {
        session.busy = false;
        if (!session.abort.signal.aborted)
          setSnapshot({
            key: session.key,
            items: session.items,
            summary: session.summary,
            loading: false,
            error,
            more: session.more,
          });
      }
    },
    [userId, currency, view, crewId]
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
      failedRefresh: false,
      pages: 0,
      items: [],
    };
    current.current = session;
    void load(session);
    const timer = setInterval(() => {
      if (!session.busy && !session.failed) void load(session, true);
    }, 60_000);
    return () => {
      clearInterval(timer);
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
      (!session.more && !(retry && session.failedRefresh)) ||
      (session.failed && !retry)
    )
      return;
    setSnapshot({ key, items: session.items, summary: session.summary, loading: true, more: true });
    void load(session, retry && session.failedRefresh);
  };
  const visible = owner && snapshot?.key === key ? snapshot : undefined;
  return {
    items: visible?.items ?? [],
    summary: visible?.summary,
    loading: !!owner && (visible?.loading ?? true),
    error: visible?.error,
    hasMore: visible?.more ?? false,
    loadMore: () => more(false),
    retry: () => more(true),
    refresh: () => setRevision((v) => v + 1),
  };
}

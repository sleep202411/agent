import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMyTaskContracts,
  type ContractTask,
  type ContractLifecycle,
} from "./task-contract-files-api";
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
  items: ContractTask[];
};
type Snapshot = {
  key: string;
  items: ContractTask[];
  loading: boolean;
  error?: string;
  more: boolean;
};
export function useTaskContracts(
  active: boolean,
  generation: number,
  lifecycle: ContractLifecycle
) {
  const [revision, setRevision] = useState(0);
  const owner = active ? String(generation) : undefined;
  const key = JSON.stringify([owner, lifecycle, revision]);
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [snapshotScope, setSnapshotScope] = useState(key);
  // Returning to an earlier scope requires a fresh response, not its old snapshot.
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
        const seen = refresh ? new Set<string>() : new Set(session.seen);
        let pages = refresh ? 0 : session.pages;
        const count = refresh ? Math.max(1, session.pages) : 1;
        for (let index = 0; index < count; index++) {
          const result = await fetchMyTaskContracts(
            lifecycle,
            cursor,
            generation,
            session.abort.signal
          );
          if (session.abort.signal.aborted) return;
          if (result.nextCursor && seen.has(result.nextCursor))
            throw new Error("Contract pagination did not advance");
          if (result.nextCursor) seen.add(result.nextCursor);
          items = Array.from(
            new Map([...items, ...result.items].map((item) => [item.id, item])).values()
          );
          cursor = result.nextCursor;
          pages++;
          if (!cursor) break;
        }
        session.items = items;
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
          status === 404 ||
          refresh ||
          (status === 400 && /cursor/i.test(cause instanceof Error ? cause.message : ""))
        ) {
          session.items = [];
          session.pages = 0;
          session.cursor = null;
          session.seen.clear();
          session.more = true;
        }
        error = cause instanceof Error ? cause.message : "Unable to load contracts";
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
    [lifecycle, generation]
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
    setSnapshot({ key, items: session.items, loading: true, more: true });
    void load(session, retry && session.failedRefresh);
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

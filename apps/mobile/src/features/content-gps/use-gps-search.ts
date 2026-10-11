import { useCallback, useEffect, useRef, useState } from "react";
import { uuid } from "expo-modules-core";
import { ApiRequestError } from "@/lib/api-client";
import {
  searchGps,
  GpsSearchChanged,
  type GpsPage,
  type GpsQuery,
  type GpsSearchScope,
  type GpsSearchOptions,
} from "./search-api";
type Session = {
  key: string;
  abort: AbortController;
  cursor: GpsPage["nextCursor"];
  seen: Set<string>;
  items: GpsPage["items"];
  page?: GpsPage;
  busy: boolean;
  failed: boolean;
  restart: boolean;
};
type Snapshot = {
  key: string;
  items: GpsPage["items"];
  page?: GpsPage;
  loading: boolean;
  error?: string;
  restart: boolean;
};
export function useGpsSearch(
  scope: GpsSearchScope,
  query: GpsQuery,
  locale: string,
  enabled: boolean,
  options: GpsSearchOptions
) {
  const [revision, setRevision] = useState(0),
    [snapshot, setSnapshot] = useState<Snapshot>();
  const key = JSON.stringify([
    scope.generation,
    scope.viewerId,
    locale,
    query,
    options,
    revision,
    enabled,
  ]);
  const [snapshotScope, setSnapshotScope] = useState(key);
  // Do not restore data from an earlier visit before its replacement request completes.
  if (snapshotScope !== key) {
    setSnapshotScope(key);
    setSnapshot(undefined);
  }
  const owner = useRef<Session | null>(null);
  const { generation, viewerId } = scope;
  const load = useCallback(
    async (s: Session) => {
      if (s.busy || s.abort.signal.aborted) return;
      s.busy = true;
      let error: string | undefined;
      try {
        const next = await searchGps(
          { generation, viewerId },
          query,
          s.cursor,
          uuid.v4(),
          s.abort.signal,
          options
        );
        if (s.abort.signal.aborted) return;
        if (
          (s.page &&
            (s.page.queryId !== next.queryId ||
              s.page.matchedCount !== next.matchedCount ||
              s.page.accessibleCount !== next.accessibleCount)) ||
          (next.nextCursor && s.seen.has(next.nextCursor.afterId)) ||
          next.items.some((item) => s.items.some((old) => old.id === item.id))
        )
          throw new GpsSearchChanged("IP results changed. Refresh before loading more.");
        if (next.nextCursor) s.seen.add(next.nextCursor.afterId);
        s.items = [...s.items, ...next.items];
        s.page = next;
        s.cursor = next.nextCursor;
        s.failed = false;
      } catch (e) {
        if (s.abort.signal.aborted) return;
        error = e instanceof Error ? e.message : String(e);
        s.failed = true;
        if (
          e instanceof GpsSearchChanged ||
          (e instanceof ApiRequestError && [400, 401, 403, 404, 409].includes(e.status))
        ) {
          s.items = [];
          s.page = undefined;
          s.cursor = null;
          s.restart = true;
        }
      } finally {
        s.busy = false;
        if (!s.abort.signal.aborted)
          setSnapshot({
            key: s.key,
            items: s.items,
            page: s.page,
            loading: false,
            error,
            restart: s.restart,
          });
      }
    },
    [generation, viewerId, query, options]
  );
  useEffect(() => {
    if (!enabled) return;
    const s: Session = {
      key,
      abort: new AbortController(),
      cursor: null,
      seen: new Set(),
      items: [],
      busy: false,
      failed: false,
      restart: false,
    };
    owner.current = s;
    void load(s);
    return () => {
      s.abort.abort();
      if (owner.current === s) owner.current = null;
    };
  }, [key, enabled, load]);
  const more = (retry: boolean) => {
    const s = owner.current;
    if (!s || s.key !== key || s.busy || (s.failed && !retry)) return;
    if (s.restart) {
      setRevision((v) => v + 1);
      return;
    }
    if (s.page && !s.cursor) return;
    setSnapshot({ key, items: s.items, page: s.page, loading: true, restart: false });
    void load(s);
  };
  const value = enabled && snapshot?.key === key ? snapshot : undefined;
  return {
    items: value?.items ?? [],
    page: value?.page,
    error: value?.error,
    loading: enabled && (value?.loading ?? true),
    hasMore: !!value?.page?.nextCursor,
    loadMore: () => more(false),
    retry: () => more(true),
    refresh: () => setRevision((v) => v + 1),
  };
}

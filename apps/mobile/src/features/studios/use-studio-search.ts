import { useCallback, useEffect, useRef, useState } from "react";
import { uuid } from "expo-modules-core";
import { ApiRequestError } from "@/lib/api-client";
import {
  searchStudios,
  StudioSearchChanged,
  type StudioPage,
  type StudioQuery,
  type StudioScope,
  type StudioViewport,
} from "./studio-search-api";
type Session = {
  key: string;
  abort: AbortController;
  cursor: StudioPage["nextCursor"];
  seen: Set<string>;
  items: StudioPage["items"];
  page?: StudioPage;
  busy: boolean;
  failed: boolean;
  restart: boolean;
};
type Snapshot = {
  key: string;
  items: StudioPage["items"];
  page?: StudioPage;
  loading: boolean;
  error?: string;
  restart: boolean;
};
export function useStudioSearch(
  scope: StudioScope,
  query: StudioQuery,
  locale: string,
  enabled: boolean,
  selectedCreatorId: string | null = null,
  viewport: StudioViewport | null = null
) {
  const [revision, setRevision] = useState(0),
    [snapshot, setSnapshot] = useState<Snapshot>();
  const key = JSON.stringify([
    scope.generation,
    scope.viewerId,
    locale,
    query,
    selectedCreatorId,
    viewport,
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
        const next = await searchStudios(
          { generation, viewerId },
          query,
          s.cursor,
          uuid.v4(),
          s.abort.signal,
          selectedCreatorId,
          viewport
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
          throw new StudioSearchChanged("Studio results changed. Refresh before loading more.");
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
          e instanceof StudioSearchChanged ||
          (e instanceof ApiRequestError && [401, 403, 404].includes(e.status))
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
    [generation, viewerId, query, selectedCreatorId, viewport]
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

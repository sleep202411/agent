import { useCallback, useEffect, useRef, useState } from "react";
import { getIpCatalogPage } from "@/data/browse-service";
import type { IpSummary, Genre, TaxonomyTerm } from "@/data/types";
type Filters = { genreCode?: string; typeCode?: string };
type Session = {
  key: string;
  abort: AbortController;
  cursor: string | null;
  seen: Set<string>;
  more: boolean;
  busy: boolean;
  failed: boolean;
  items: IpSummary[];
  genres: Genre[];
  typeTags: TaxonomyTerm[];
};
type Snapshot = {
  key: string;
  items: IpSummary[];
  genres: Genre[];
  typeTags: TaxonomyTerm[];
  loading: boolean;
  error?: string;
  more: boolean;
};
export function useDiscoveryFeed(owner: string | undefined, query: Filters) {
  const queryKey = JSON.stringify(query);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([owner, queryKey, revision]);
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const load = useCallback(
    async (session: Session) => {
      if (session.busy || !session.more || session.abort.signal.aborted) return;
      session.busy = true;
      let error: string | undefined;
      try {
        const result = await getIpCatalogPage({
          ...(JSON.parse(queryKey) as Filters),
          cursor: session.cursor,
          limit: 20,
          signal: session.abort.signal,
        });
        if (session.abort.signal.aborted) return;
        if (result.nextCursor && session.seen.has(result.nextCursor))
          throw new Error("Discovery pagination did not advance");
        if (result.nextCursor) session.seen.add(result.nextCursor);
        session.items = Array.from(
          new Map([...session.items, ...result.items].map((i) => [i.id, i])).values()
        );
        session.genres = result.genres;
        session.typeTags = result.typeTags;
        session.cursor = result.nextCursor;
        session.more = !!result.nextCursor;
        session.failed = false;
      } catch (cause) {
        if (session.abort.signal.aborted) return;
        const status =
          cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (status === 401 || status === 403 || status === 404) {
          session.items = [];
          session.cursor = null;
          session.seen.clear();
        }
        session.failed = true;
        error = cause instanceof Error ? cause.message : "Unable to load discovery";
      } finally {
        session.busy = false;
        if (!session.abort.signal.aborted)
          setSnapshot({
            key: session.key,
            items: session.items,
            genres: session.genres,
            typeTags: session.typeTags,
            loading: false,
            error,
            more: session.more,
          });
      }
    },
    [queryKey]
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
      genres: [],
      typeTags: [],
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
    setSnapshot({
      key,
      items: session.items,
      genres: session.genres,
      typeTags: session.typeTags,
      loading: true,
      more: true,
    });
    void load(session);
  };
  const visible = owner && snapshot?.key === key ? snapshot : undefined;
  return {
    items: visible?.items ?? [],
    genres: visible?.genres ?? [],
    typeTags: visible?.typeTags ?? [],
    loading: !!owner && (visible?.loading ?? true),
    error: visible?.error,
    hasMore: visible?.more ?? false,
    loadMore: () => more(false),
    retry: () => more(true),
    refresh: () => setRevision((v) => v + 1),
  };
}

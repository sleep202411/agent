import { getWorkRevision, subscribeWorks } from "./work-refresh";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchMyWorksPage, type MyWork } from "@/data/mine-api";
type Session = {
  owner: string;
  controller: AbortController;
  page: number;
  busy: boolean;
  hasMore: boolean;
  failed: boolean;
  works: MyWork[];
};
type Snapshot = { owner: string; works: MyWork[]; loading: boolean; failed: boolean };
/** Owner includes auth generation so logging back into the same account starts fresh. */
export function useMyWorks(owner: string | undefined) {
  const revision = useSyncExternalStore(subscribeWorks, getWorkRevision, getWorkRevision);
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const load = useCallback(async (session: Session) => {
    if (session.busy || !session.hasMore || session.controller.signal.aborted) return;
    session.busy = true;
    session.failed = false;
    try {
      const result = await fetchMyWorksPage(session.page, session.controller.signal);
      if (session.controller.signal.aborted) return;
      session.works = Array.from(
        new Map([...session.works, ...result.works].map((work) => [work.id, work])).values()
      );
      session.page += 1;
      session.hasMore = result.hasMore;
    } catch {
      if (session.controller.signal.aborted) return;
      session.failed = true;
    } finally {
      session.busy = false;
      if (!session.controller.signal.aborted)
        setSnapshot({
          owner: session.owner,
          works: session.works,
          loading: false,
          failed: session.failed,
        });
    }
  }, []);
  useEffect(() => {
    if (!owner) return;
    const session: Session = {
      owner,
      controller: new AbortController(),
      page: 1,
      busy: false,
      hasMore: true,
      failed: false,
      works: [],
    };
    current.current = session;
    void load(session);
    return () => {
      session.controller.abort();
      current.current = undefined;
    };
  }, [owner, load, revision]);
  const request = (retry: boolean) => {
    const session = current.current;
    if (
      session &&
      session.owner === owner &&
      !session.busy &&
      session.hasMore &&
      !session.controller.signal.aborted &&
      (retry || !session.failed)
    ) {
      setSnapshot({ owner: session.owner, works: session.works, loading: true, failed: false });
      void load(session);
    }
  };
  const visible = owner && snapshot?.owner === owner ? snapshot : undefined;
  return {
    works: visible?.works,
    loading: !!owner && (visible?.loading ?? true),
    failed: visible?.failed ?? false,
    loadMore: () => request(false),
    retry: () => request(true),
  };
}

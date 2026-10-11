import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { getWorkRevision, subscribeWorks } from "./work-refresh";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchMyWorksPage, type MyWork } from "@/data/mine-api";
type Session = {
  key: string;
  controller: AbortController;
  page: number;
  busy: boolean;
  hasMore: boolean;
  failed: boolean;
  error?: string;
  works: MyWork[];
};
type Snapshot = {
  key: string;
  works: MyWork[];
  loading: boolean;
  failed: boolean;
  error?: string;
  hasMore: boolean;
};
/** Owner includes auth generation so logging back into the same account starts fresh. */
export function useMyWorks(owner: string | undefined) {
  const active = useScreenActive(),
    t = useTranslations();
  const revision = useSyncExternalStore(subscribeWorks, getWorkRevision, getWorkRevision);
  const key = owner && active ? JSON.stringify([owner, revision]) : undefined;
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [snapshotScope, setSnapshotScope] = useState(key);
  if (snapshotScope !== key) {
    setSnapshotScope(key);
    setSnapshot(undefined);
  }
  const load = useCallback(
    async (session: Session) => {
      if (session.busy || !session.hasMore || session.controller.signal.aborted) return;
      session.busy = true;
      session.failed = false;
      session.error = undefined;
      try {
        const result = await fetchMyWorksPage(session.page, session.controller.signal);
        if (session.controller.signal.aborted) return;
        session.works = Array.from(
          new Map([...session.works, ...result.works].map((work) => [work.id, work])).values()
        );
        session.page += 1;
        session.hasMore = result.hasMore;
      } catch (error) {
        if (session.controller.signal.aborted) return;
        session.failed = true;
        if ([401, 403, 404].includes((error as { status?: number })?.status ?? 0)) {
          session.works = [];
          session.page = 1;
          session.hasMore = true;
        }
        session.error =
          error instanceof Error && error.message.trim()
            ? error.message
            : t("creatorDetail.personalWorksError");
      } finally {
        session.busy = false;
        if (!session.controller.signal.aborted)
          setSnapshot({
            key: session.key,
            works: session.works,
            loading: false,
            failed: session.failed,
            error: session.error,
            hasMore: session.hasMore,
          });
      }
    },
    [t]
  );
  useEffect(() => {
    if (!key) return;
    const session: Session = {
      key,
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
  }, [key, load]);
  const request = (retry: boolean) => {
    const session = current.current;
    if (
      session &&
      session.key === key &&
      !session.busy &&
      session.hasMore &&
      !session.controller.signal.aborted &&
      (retry || !session.failed)
    ) {
      setSnapshot({
        key: session.key,
        works: session.works,
        loading: true,
        failed: false,
        hasMore: session.hasMore,
      });
      void load(session);
    }
  };
  const visible = key && snapshot?.key === key ? snapshot : undefined;
  return {
    works: visible?.works,
    loading: !!key && (visible?.loading ?? true),
    failed: visible?.failed ?? false,
    error: visible?.error,
    hasMore: !!key && (visible?.hasMore ?? false),
    loadMore: () => request(false),
    retry: () => request(true),
  };
}

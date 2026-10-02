import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMyIpsPage, type MyIp } from "@/data/ip-api";
import { useBrowseVersion } from "@/data/browse-refresh";
import { useLocale, useTranslations } from "@/i18n";

type Session = {
  key: string;
  controller: AbortController;
  cursor: string | null;
  cursors: Set<string>;
  busy: boolean;
  hasMore: boolean;
  error?: string;
  items: MyIp[];
};
type Snapshot = Pick<Session, "key" | "items" | "hasMore" | "error"> & { loading: boolean };

/** Owner includes the auth generation; locale and browse mutations start a fresh list. */
export function useMyIps(owner?: string) {
  const locale = useLocale(),
    version = useBrowseVersion(),
    t = useTranslations();
  const [revision, setRevision] = useState(0);
  const key = owner ? JSON.stringify([owner, locale, version, revision]) : undefined;
  const current = useRef<Session | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [snapshotScope, setSnapshotScope] = useState(key);
  // Do not restore data from an earlier visit before its replacement request completes.
  if (snapshotScope !== key) {
    setSnapshotScope(key);
    setSnapshot(undefined);
  }
  const load = useCallback(
    async (session: Session) => {
      if (session.busy || !session.hasMore || session.controller.signal.aborted) return;
      session.busy = true;
      session.error = undefined;
      try {
        const page = await fetchMyIpsPage(session.cursor, session.controller.signal);
        if (session.controller.signal.aborted) return;
        if (page.nextCursor && session.cursors.has(page.nextCursor))
          throw new Error("Invalid owned IP cursor. Please retry.");
        session.items = Array.from(
          new Map([...session.items, ...page.items].map((item) => [item.id, item])).values()
        );
        session.cursor = page.nextCursor;
        if (page.nextCursor) session.cursors.add(page.nextCursor);
        session.hasMore = Boolean(page.nextCursor);
      } catch (failure) {
        if (session.controller.signal.aborted) return;
        const status = (failure as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) {
          session.items = [];
          session.cursor = null;
          session.cursors.clear();
        }
        session.error = (failure instanceof Error && failure.message) || t("ips.loadErrorFallback");
      } finally {
        session.busy = false;
        if (!session.controller.signal.aborted)
          setSnapshot({
            key: session.key,
            items: session.items,
            hasMore: session.hasMore,
            error: session.error,
            loading: false,
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
      cursor: null,
      cursors: new Set(),
      busy: false,
      hasMore: true,
      items: [],
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
      !session ||
      session.key !== key ||
      session.busy ||
      !session.hasMore ||
      session.controller.signal.aborted ||
      (session.error && !retry)
    )
      return;
    setSnapshot({
      key: session.key,
      items: session.items,
      hasMore: session.hasMore,
      loading: true,
    });
    void load(session);
  };
  const visible = key && snapshot?.key === key ? snapshot : undefined;
  return {
    items: visible?.items,
    loading: !!key && (visible?.loading ?? true),
    error: visible?.error,
    hasMore: visible?.hasMore ?? false,
    loadMore: () => request(false),
    retry: () => request(true),
    refresh: () => {
      current.current?.controller.abort();
      setRevision((value) => value + 1);
    },
  };
}

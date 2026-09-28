"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DocumentProvider } from "./document-provider";

/** Own each refresh by its document/provider lifetime and request order. */
export function useDocumentFeed<T>(
  documentId: string | null,
  provider: DocumentProvider | null,
  eventType: string,
  read: (id: string, signal?: AbortSignal) => Promise<T[]>
) {
  const owner = useMemo(() => ({ documentId, provider }), [documentId, provider]);
  const lifetime = useRef<{
    owner: typeof owner;
    request: number;
    controller: AbortController | null;
  } | null>(null);
  const [state, setState] = useState<{ owner: typeof owner; rows: T[]; loading: boolean }>();
  useLayoutEffect(() => {
    const next = { owner, request: 0, controller: null as AbortController | null };
    lifetime.current = next;
    return () => {
      next.controller?.abort();
      if (lifetime.current === next) lifetime.current = null;
    };
  }, [owner]);
  const isActive = useCallback(
    () => lifetime.current?.owner === owner && !!documentId,
    [documentId, owner]
  );
  const refetch = useCallback(async () => {
    const currentLifetime = lifetime.current;
    if (currentLifetime?.owner !== owner || !owner.documentId) return;
    const request = ++currentLifetime.request;
    currentLifetime.controller?.abort();
    const controller = new AbortController();
    currentLifetime.controller = controller;
    const current = () =>
      lifetime.current === currentLifetime &&
      request === currentLifetime.request &&
      !controller.signal.aborted;
    try {
      const rows = await read(owner.documentId, controller.signal);
      if (current()) setState({ owner, rows, loading: false });
    } catch {
      // Keep loaded rows; the next peer signal retries transient failures.
      if (current())
        setState((previous) => ({
          owner,
          rows: previous?.owner === owner ? previous.rows : [],
          loading: false,
        }));
    } finally {
      if (currentLifetime.controller === controller) currentLifetime.controller = null;
    }
  }, [owner, read]);
  useEffect(() => {
    queueMicrotask(() => {
      void refetch();
    });
    return provider?.onAppEvent((data) => {
      if (data && typeof data === "object" && (data as { type?: string }).type === eventType)
        void refetch();
    });
  }, [eventType, provider, refetch]);
  return {
    rows: state?.owner === owner ? state.rows : [],
    loading: state?.owner === owner ? state.loading : !!documentId,
    refetch,
    isActive,
  };
}

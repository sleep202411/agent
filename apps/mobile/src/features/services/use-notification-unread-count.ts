import { useEffect, useState } from "react";
import { fetchNotificationUnreadCount } from "./notification-api";
import { subscribeNotificationReads } from "./notification-read-events";

export function useNotificationUnreadCount(generation: number | undefined) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([generation, revision]);
  const [scope, setScope] = useState(key);
  const [result, setResult] = useState<{ key: string; count?: number; error?: string }>();
  if (scope !== key) {
    setScope(key);
    setResult(undefined);
  }
  useEffect(() => {
    if (generation === undefined) return;
    const refresh = () => setRevision((value) => value + 1);
    const unsubscribe = subscribeNotificationReads((owner) => {
      if (owner === generation) refresh();
    });
    // Match Web's safety net for missed realtime events, only while visible.
    const timer = setInterval(refresh, 60_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [generation]);
  useEffect(() => {
    if (generation === undefined) return;
    const controller = new AbortController();
    void fetchNotificationUnreadCount(generation, controller.signal).then(
      (count) => {
        if (!controller.signal.aborted) setResult({ key, count });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setResult({ key, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [generation, key]);
  const visible = generation !== undefined && result?.key === key ? result : undefined;
  return {
    count: visible?.count,
    error: visible?.error,
    loading: generation !== undefined && !visible,
    refresh: () => setRevision((value) => value + 1),
  };
}

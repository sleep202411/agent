"use client";
import { useEffect, useRef, useState } from "react";
import { revenueApi, type RevenuePage } from "./revenue-api";

export function useRevenuePage<T extends { id: string }>(path: string) {
  const [data, setData] = useState<RevenuePage<T>>({ items: [], nextCursor: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    revenueApi<RevenuePage<T>>(path, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setError("");
          setLoading(false);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Could not load records.");
          setLoading(false);
        }
      });
    return () => active.current?.abort();
  }, [path, revision]);
  function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
  }
  async function more() {
    if (loading || !data.nextCursor) return;
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await revenueApi<RevenuePage<T>>(
        `${path}${path.includes("?") ? "&" : "?"}after=${encodeURIComponent(data.nextCursor)}`,
        controller.signal
      );
      if (!controller.signal.aborted)
        setData((previous) => ({
          ...result,
          items: [
            ...new Map([...previous.items, ...result.items].map((row) => [row.id, row])).values(),
          ],
        }));
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : "Could not load records.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  return { ...data, error, loading, refresh, more };
}

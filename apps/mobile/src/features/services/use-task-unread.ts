import { useEffect, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskUnread } from "./task-unread-api";
export function useTaskUnread(active: boolean, generation: number) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([active, generation, revision]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    counts: Record<string, number>;
    error?: string;
  }>();
  const [snapshotScope, setSnapshotScope] = useState(key);
  // Do not restore data from an earlier visit before its replacement request completes.
  if (snapshotScope !== key) {
    setSnapshotScope(key);
    setSnapshot(undefined);
  }
  useEffect(() => {
    if (!active || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    async function load() {
      try {
        const counts = await fetchTaskUnread(generation, controller.signal);
        if (!current()) return;
        setSnapshot({ key, counts });
        timer = setTimeout(() => void load(), 60_000);
      } catch (cause) {
        if (current())
          setSnapshot({
            key,
            counts: {},
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, generation, key]);
  const visible =
    active && generation === getAuthGeneration() && snapshot?.key === key ? snapshot : undefined;
  return {
    counts: visible?.counts ?? {},
    error: visible?.error,
    refresh: () => setRevision((v) => v + 1),
  };
}

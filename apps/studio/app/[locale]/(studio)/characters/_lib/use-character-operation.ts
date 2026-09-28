"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useAuth } from "@/app/_components/auth-provider";

/** Share admission across character mutations and retire callbacks with their view. */
export function useCharacterOperation(scope: string, reset: () => void) {
  const { user } = useAuth();
  const epoch = useMemo(() => ({ userId: user?.id, scope }), [user?.id, scope]);
  const activeEpoch = useRef<typeof epoch | null>(null);
  const activeRun = useRef<AbortController | null>(null);
  const resetRef = useRef(reset);
  useLayoutEffect(() => {
    resetRef.current = reset;
  });
  useLayoutEffect(() => {
    activeEpoch.current = epoch;
    return () => {
      activeEpoch.current = null;
      activeRun.current?.abort();
      activeRun.current = null;
      resetRef.current();
    };
  }, [epoch]);
  const start = useCallback(() => {
    if (!epoch.userId || activeEpoch.current !== epoch || activeRun.current) return null;
    const run = new AbortController();
    activeRun.current = run;
    return run;
  }, [epoch]);
  const isCurrent = useCallback(
    (run: object) => activeEpoch.current === epoch && activeRun.current === run,
    [epoch]
  );
  const finish = useCallback(
    (run: object) => {
      if (!isCurrent(run)) return false;
      activeRun.current = null;
      return true;
    },
    [isCurrent]
  );
  return { start, isCurrent, finish };
}

import { useCallback, useEffect, useEffectEvent, useRef } from "react";

/** A story timeout accrues only while presented; disabling starts a new window. */
export function usePausableTimeout({
  identity,
  enabled,
  running,
  durationMs,
  onTimeout,
  initialRemainingMs,
}: {
  identity?: string;
  enabled: boolean;
  running: boolean;
  durationMs: number;
  onTimeout: () => void;
  initialRemainingMs?: number;
}) {
  const remaining = useRef(durationMs);
  const completed = useRef(false);
  const runningSince = useRef<number | null>(null);
  const fire = useEffectEvent(onTimeout);
  const initial = useEffectEvent(() => initialRemainingMs);
  useEffect(() => {
    const restored = initial();
    remaining.current =
      restored !== undefined && Number.isFinite(restored)
        ? Math.max(0, Math.min(durationMs, restored))
        : durationMs;
    completed.current = false;
  }, [identity, enabled, durationMs]);
  useEffect(() => {
    if (!enabled || !running || completed.current) return;
    const started = performance.now();
    runningSince.current = started;
    const timer = setTimeout(() => {
      completed.current = true;
      remaining.current = 0;
      runningSince.current = null;
      fire();
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      if (runningSince.current !== null)
        remaining.current = Math.max(0, remaining.current - (performance.now() - started));
      runningSince.current = null;
    };
  }, [identity, enabled, running, durationMs]);
  return useCallback(
    () =>
      Math.max(
        0,
        remaining.current -
          (runningSince.current === null ? 0 : performance.now() - runningSince.current)
      ),
    []
  );
}

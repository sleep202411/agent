import { useEffect, useEffectEvent, useRef } from "react";

/** A story timeout accrues only while presented; disabling starts a new window. */
export function usePausableTimeout({
  identity,
  enabled,
  running,
  durationMs,
  onTimeout,
}: {
  identity?: string;
  enabled: boolean;
  running: boolean;
  durationMs: number;
  onTimeout: () => void;
}) {
  const remaining = useRef(durationMs);
  const completed = useRef(false);
  const fire = useEffectEvent(onTimeout);
  useEffect(() => {
    remaining.current = durationMs;
    completed.current = false;
  }, [identity, enabled, durationMs]);
  useEffect(() => {
    if (!enabled || !running || completed.current) return;
    const started = performance.now();
    const timer = setTimeout(() => {
      completed.current = true;
      fire();
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [identity, enabled, running, durationMs]);
}

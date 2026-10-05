import { useCallback, useEffect, useEffectEvent, useRef } from "react";

/** A story timeout accrues only while presented; disabling starts a new window. */
export function usePausableTimeout({
  identity,
  enabled,
  running,
  durationMs,
  onTimeout,
  initialRemainingMs,
  playbackRate = 1,
}: {
  identity?: string;
  enabled: boolean;
  running: boolean;
  durationMs: number;
  onTimeout: () => void;
  initialRemainingMs?: number;
  playbackRate?: number;
}) {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0)
    throw new RangeError("Playback rate must be finite and positive.");
  const runningRate = useRef(playbackRate);
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
    runningRate.current = playbackRate;
    const timer = setTimeout(() => {
      completed.current = true;
      remaining.current = 0;
      runningSince.current = null;
      fire();
    }, remaining.current / playbackRate);
    return () => {
      clearTimeout(timer);
      if (runningSince.current !== null)
        remaining.current = Math.max(
          0,
          remaining.current - (performance.now() - started) * playbackRate
        );
      runningSince.current = null;
    };
  }, [identity, enabled, running, durationMs, playbackRate]);
  return useCallback(
    () =>
      Math.max(
        0,
        remaining.current -
          (runningSince.current === null
            ? 0
            : (performance.now() - runningSince.current) * runningRate.current)
      ),
    []
  );
}

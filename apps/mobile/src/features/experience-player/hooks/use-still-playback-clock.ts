import { useEffect, useEffectEvent, useRef } from "react";

const TICK_MS = 250;

/** A still's elapsed presentation time survives pauses, not media replacement. */
export function useStillPlaybackClock({
  identity,
  ready,
  presenting,
  durationMs,
  timelineOffsetMs,
  onDisplayed,
  onHoldComplete,
  onTimelineTimeMs,
}: {
  identity: string;
  ready: boolean;
  presenting: boolean;
  durationMs: number;
  timelineOffsetMs: number;
  onDisplayed: () => void;
  onHoldComplete: () => void;
  onTimelineTimeMs: (timeMs: number) => void;
}) {
  const elapsedMs = useRef(0);
  const runningSince = useRef<number | null>(null);
  const displayed = useRef(false);
  const completed = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };
  const tick = useEffectEvent(() => {
    if (completed.current) return;
    const elapsed =
      elapsedMs.current +
      (runningSince.current === null ? 0 : performance.now() - runningSince.current);
    const now = Math.min(elapsed, durationMs);
    onTimelineTimeMs(timelineOffsetMs + now);
    if (now >= durationMs) {
      completed.current = true;
      elapsedMs.current = durationMs;
      runningSince.current = null;
      stop();
      onHoldComplete();
    }
  });
  const display = useEffectEvent(() => onDisplayed());
  useEffect(() => {
    elapsedMs.current = 0;
    runningSince.current = null;
    displayed.current = false;
    completed.current = false;
    return stop;
  }, [identity]);
  useEffect(() => {
    if (!ready || !presenting || completed.current) return;
    runningSince.current = performance.now();
    if (!displayed.current) {
      displayed.current = true;
      display();
    }
    tick();
    if (!completed.current) timer.current = setInterval(() => tick(), TICK_MS);
    return () => {
      if (runningSince.current !== null) {
        elapsedMs.current += performance.now() - runningSince.current;
        runningSince.current = null;
      }
      stop();
    };
  }, [identity, ready, presenting, durationMs, timelineOffsetMs]);
}

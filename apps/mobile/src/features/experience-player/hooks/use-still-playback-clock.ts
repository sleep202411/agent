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
  initialPositionMs = 0,
  initiallyCompleted = false,
  playbackRate = 1,
}: {
  identity: string;
  ready: boolean;
  presenting: boolean;
  durationMs: number;
  timelineOffsetMs: number;
  onDisplayed: () => void;
  onHoldComplete: () => void;
  onTimelineTimeMs: (timeMs: number) => void;
  initialPositionMs?: number;
  initiallyCompleted?: boolean;
  playbackRate?: number;
}) {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0)
    throw new RangeError("Playback rate must be finite and positive.");
  const runningRate = useRef(playbackRate);
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
      (runningSince.current === null
        ? 0
        : (performance.now() - runningSince.current) * runningRate.current);
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
  const initial = useEffectEvent(() => ({
    position: Number.isFinite(initialPositionMs)
      ? Math.max(0, Math.min(durationMs, initialPositionMs))
      : 0,
    completed: initiallyCompleted,
  }));
  useEffect(() => {
    const restored = initial();
    elapsedMs.current = restored.position;
    runningSince.current = null;
    displayed.current = restored.position > 0 || restored.completed;
    completed.current = restored.completed;
    return stop;
  }, [identity]);
  useEffect(() => {
    if (!ready || !presenting || completed.current) return;
    runningRate.current = playbackRate;
    runningSince.current = performance.now();
    if (!displayed.current) {
      displayed.current = true;
      display();
    }
    tick();
    if (!completed.current) timer.current = setInterval(() => tick(), TICK_MS);
    return () => {
      if (runningSince.current !== null) {
        elapsedMs.current += (performance.now() - runningSince.current) * runningRate.current;
        runningSince.current = null;
      }
      stop();
    };
  }, [identity, ready, presenting, durationMs, timelineOffsetMs, playbackRate]);
}

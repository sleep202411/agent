import { useEffect, useEffectEvent, useRef } from "react";

/** Fixed scene time is measured in story milliseconds, including after restoration. */
export function useFixedPlaybackClock({
  identity,
  enabled,
  running,
  durationMs,
  initialPositionMs = 0,
  initiallyCompleted = false,
  playbackRate = 1,
  onTime,
  onCompleted,
}: {
  identity: string;
  enabled: boolean;
  running: boolean;
  durationMs: number;
  initialPositionMs?: number;
  initiallyCompleted?: boolean;
  playbackRate?: number;
  onTime: (timeMs: number) => void;
  onCompleted: () => void;
}) {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0)
    throw new RangeError("Playback rate must be finite and positive.");
  const position = useRef(0);
  const completed = useRef(false);
  const restore = useEffectEvent(() => ({ initialPositionMs, initiallyCompleted }));
  const report = useEffectEvent(onTime);
  const finish = useEffectEvent(onCompleted);
  useEffect(() => {
    const saved = restore();
    position.current = Math.max(0, Math.min(durationMs, saved.initialPositionMs));
    completed.current = saved.initiallyCompleted;
  }, [identity, durationMs]);
  useEffect(() => {
    if (!enabled || !running || completed.current) return;
    const startedAt = performance.now();
    const startPosition = position.current;
    let frame: number | null = null;
    const now = () =>
      Math.min(durationMs, startPosition + (performance.now() - startedAt) * playbackRate);
    const tick = () => {
      frame = null;
      position.current = now();
      report(position.current);
      if (position.current >= durationMs) {
        completed.current = true;
        finish();
      } else {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (!completed.current) position.current = now();
    };
  }, [identity, durationMs, enabled, running, playbackRate]);
}

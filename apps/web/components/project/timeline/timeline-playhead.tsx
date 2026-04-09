import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { formatClock, PLAYHEAD_OFFSET, snapTimeToTick } from "./timeline-types";

interface TimelinePlayheadProps {
  currentTime: number;
  pxPerSecond: number;
  maxTime: number;
  showTime: boolean;
  onSeek: (time: number) => void;
  onSeekStart: () => void;
  onSeekEnd: (time: number) => void;
}

export function TimelinePlayhead({
  currentTime,
  pxPerSecond,
  maxTime,
  showTime,
  onSeek,
  onSeekStart,
  onSeekEnd,
}: TimelinePlayheadProps) {
  const position = currentTime * pxPerSecond + PLAYHEAD_OFFSET;

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      onSeekStart();

      const startX = event.clientX;
      const startTime = currentTime;

      const handleMouseMove = (nextEvent: MouseEvent) => {
        const deltaX = nextEvent.clientX - startX;
        const deltaTime = deltaX / pxPerSecond;
        const nextTime = snapTimeToTick(
          Math.max(0, Math.min(maxTime, startTime + deltaTime)),
          pxPerSecond
        );
        onSeek(nextTime);
      };

      const handleMouseUp = () => {
        onSeekEnd(currentTime);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [currentTime, maxTime, onSeek, onSeekEnd, onSeekStart, pxPerSecond]
  );

  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-20 -translate-x-1/2"
      style={{ left: position }}
    >
      <div
        className="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2 cursor-ew-resize px-1 text-[#FF4444] transition-colors hover:text-[#FF6666]"
        onMouseDown={handleMouseDown}
      >
        <svg width="12" height="10" viewBox="0 0 12 10">
          <path d="M0 0 L12 0 L6 10 Z" fill="currentColor" />
        </svg>
      </div>
      <div className="absolute left-1/2 top-3 h-[calc(100%-12px)] w-0.5 -translate-x-1/2 bg-[#FF4444]" />
      {showTime ? (
        <div className="absolute left-1/2 top-3.5 -translate-x-1/2 rounded bg-[#FF4444] px-1.5 py-0.5 font-mono text-[10px] text-white">
          {formatClock(currentTime)}
        </div>
      ) : null}
    </div>
  );
}

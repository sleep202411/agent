"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface MediaTimelineContextValue {
  durationSeconds: number;
  width: number;
}

const MediaTimelineContext = createContext<MediaTimelineContextValue | null>(null);

export interface MediaTimelineRangeValue {
  startSeconds: number;
  endSeconds: number;
}

export type MediaTimelineRangeOperation = "move" | "resize-start" | "resize-end";

type TimelineRangeOperation = {
  pointerId: number;
  kind: MediaTimelineRangeOperation;
  originClientX: number;
  initialValue: MediaTimelineRangeValue;
  captureElement: HTMLElement;
};

export function MediaTimelineTrack({
  children,
  className,
  durationSeconds,
  onSeek,
}: {
  children: ReactNode;
  className?: string;
  durationSeconds: number;
  onSeek?: (seconds: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(trackRef);
  const safeDuration = toPositiveDuration(durationSeconds);
  const context = useMemo(() => ({ durationSeconds: safeDuration, width }), [safeDuration, width]);

  return (
    <MediaTimelineContext.Provider value={context}>
      <div
        ref={trackRef}
        className={cn("relative", className)}
        onClick={(event) => {
          if (!onSeek || width <= 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          onSeek(timelinePixelsToSeconds(event.clientX - bounds.left, width, safeDuration));
        }}
      >
        {children}
      </div>
    </MediaTimelineContext.Provider>
  );
}

export function MediaTimelineRange({
  ariaLabel,
  children,
  className,
  disabled = false,
  handleClassName,
  minDurationSeconds = 0.1,
  onChange,
  onScrub,
  onSelect,
  selected = false,
  value,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  handleClassName?: string;
  minDurationSeconds?: number;
  onChange: (value: MediaTimelineRangeValue) => void;
  onScrub?: (seconds: number, operation: MediaTimelineRangeOperation) => void;
  onSelect?: () => void;
  selected?: boolean;
  value: MediaTimelineRangeValue;
}) {
  const timeline = useContext(MediaTimelineContext);
  if (!timeline) throw new Error("MediaTimelineRange must be inside MediaTimelineTrack.");

  const { durationSeconds, width } = timeline;
  const normalized = normalizeTimelineRange(value, durationSeconds, minDurationSeconds);
  const startX = timelineSecondsToPixels(normalized.startSeconds, width, durationSeconds);
  const rangeWidth = Math.max(
    width > 0 ? 1 : 0,
    timelineSecondsToPixels(normalized.endSeconds - normalized.startSeconds, width, durationSeconds)
  );
  const minimumWidth = Math.max(
    1,
    timelineSecondsToPixels(minDurationSeconds, width, durationSeconds)
  );
  const rangeRef = useRef<HTMLDivElement>(null);
  const operationRef = useRef<TimelineRangeOperation | null>(null);

  const beginOperation = (event: ReactPointerEvent, kind: TimelineRangeOperation["kind"]) => {
    event.stopPropagation();
    if (disabled || width <= 0 || event.button !== 0) return;
    event.preventDefault();
    onSelect?.();
    const captureElement = event.target instanceof HTMLElement ? event.target : rangeRef.current;
    if (!captureElement) return;
    captureElement.setPointerCapture(event.pointerId);
    operationRef.current = {
      pointerId: event.pointerId,
      kind,
      originClientX: event.clientX,
      initialValue: normalized,
      captureElement,
    };
    onScrub?.(timelineRangePreviewTime(normalized, kind), kind);
  };

  const updateOperation = (event: ReactPointerEvent<HTMLDivElement>) => {
    const operation = operationRef.current;
    if (!operation || operation.pointerId !== event.pointerId || width <= 0) return;
    event.stopPropagation();
    event.preventDefault();
    const deltaSeconds = ((event.clientX - operation.originClientX) / width) * durationSeconds;
    const nextValue = applyTimelineRangeDelta(
      operation.initialValue,
      operation.kind,
      deltaSeconds,
      durationSeconds,
      minDurationSeconds
    );
    onChange(nextValue);
    onScrub?.(timelineRangePreviewTime(nextValue, operation.kind), operation.kind);
  };

  const endOperation = (event: ReactPointerEvent<HTMLDivElement>) => {
    const operation = operationRef.current;
    if (!operation || operation.pointerId !== event.pointerId) return;
    event.stopPropagation();
    operationRef.current = null;
    if (operation.captureElement.hasPointerCapture(event.pointerId)) {
      operation.captureElement.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={rangeRef}
      className={cn("absolute touch-none", className)}
      style={{
        top: 6,
        left: 0,
        width: Math.max(minimumWidth, rangeWidth),
        height: 24,
        transform: `translate3d(${startX}px, 0, 0)`,
      }}
      onPointerDown={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const handle = target?.closest<HTMLElement>("[data-media-timeline-range-handle]");
        const side = handle?.dataset.mediaTimelineRangeHandle;
        beginOperation(
          event,
          side === "left" ? "resize-start" : side === "right" ? "resize-end" : "move"
        );
      }}
      onPointerMove={updateOperation}
      onPointerUp={endOperation}
      onPointerCancel={endOperation}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        className="size-full overflow-hidden rounded-[inherit] px-2 text-left outline-none"
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.();
        }}
      >
        {children}
      </button>
      {selected && !disabled ? (
        <>
          <span
            data-media-timeline-range-handle="left"
            className={cn(
              "absolute inset-y-0 -left-1 z-10 block w-2 cursor-ew-resize rounded-[inherit]",
              handleClassName
            )}
          />
          <span
            data-media-timeline-range-handle="right"
            className={cn(
              "absolute inset-y-0 -right-1 z-10 block w-2 cursor-ew-resize rounded-[inherit]",
              handleClassName
            )}
          />
        </>
      ) : null}
    </div>
  );
}

export function timelineSecondsToPixels(
  seconds: number,
  width: number,
  durationSeconds: number
): number {
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  )
    return 0;
  return (clamp(seconds, 0, durationSeconds) / durationSeconds) * width;
}

export function timelinePixelsToSeconds(
  pixels: number,
  width: number,
  durationSeconds: number
): number {
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  )
    return 0;
  return clamp((pixels / width) * durationSeconds, 0, durationSeconds);
}

export function normalizeTimelineRange(
  value: MediaTimelineRangeValue,
  durationSeconds: number,
  minDurationSeconds: number
): MediaTimelineRangeValue {
  const safeDuration = toPositiveDuration(durationSeconds);
  const safeMinimum = clamp(minDurationSeconds, 0.001, safeDuration);
  const startSeconds = clamp(value.startSeconds, 0, safeDuration - safeMinimum);
  const endSeconds = clamp(value.endSeconds, startSeconds + safeMinimum, safeDuration);
  return { startSeconds, endSeconds };
}

export function applyTimelineRangeDelta(
  value: MediaTimelineRangeValue,
  operation: TimelineRangeOperation["kind"],
  deltaSeconds: number,
  durationSeconds: number,
  minDurationSeconds: number
): MediaTimelineRangeValue {
  const safeDuration = toPositiveDuration(durationSeconds);
  const safeMinimum = clamp(minDurationSeconds, 0.001, safeDuration);
  const normalized = normalizeTimelineRange(value, safeDuration, safeMinimum);

  if (operation === "move") {
    const windowSeconds = normalized.endSeconds - normalized.startSeconds;
    const startSeconds = clamp(
      normalized.startSeconds + deltaSeconds,
      0,
      safeDuration - windowSeconds
    );
    return { startSeconds, endSeconds: startSeconds + windowSeconds };
  }

  if (operation === "resize-start") {
    return {
      startSeconds: clamp(
        normalized.startSeconds + deltaSeconds,
        0,
        normalized.endSeconds - safeMinimum
      ),
      endSeconds: normalized.endSeconds,
    };
  }

  return {
    startSeconds: normalized.startSeconds,
    endSeconds: clamp(
      normalized.endSeconds + deltaSeconds,
      normalized.startSeconds + safeMinimum,
      safeDuration
    ),
  };
}

export function timelineRangePreviewTime(
  value: MediaTimelineRangeValue,
  operation: MediaTimelineRangeOperation
): number {
  return operation === "resize-end" ? value.endSeconds : value.startSeconds;
}

function useElementWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function toPositiveDuration(durationSeconds: number): number {
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0.001;
}

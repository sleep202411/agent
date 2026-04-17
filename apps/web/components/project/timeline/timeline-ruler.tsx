"use client";

import { useCallback, useEffect, useRef } from "react";
import { PLAYHEAD_OFFSET } from "./timeline-types";

interface TimelineRulerProps {
  duration: number;
  pxPerSecond: number;
  /** Height of the track area below the ruler (px) */
  trackHeight: number;
}

const RULER_HEIGHT = 32;

// ─── Helpers ──────────────────────────────────────────

function formatTickLabel(time: number) {
  if (time >= 60) {
    return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
  }
  return Number.isInteger(time) ? String(time) : time.toFixed(1);
}

function getIntervals(pxPerSecond: number) {
  const rawInterval = 40 / pxPerSecond;
  const intervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const majorTickInterval = intervals.find((i) => i >= rawInterval) ?? 600;
  const minorTickInterval =
    majorTickInterval >= 10
      ? majorTickInterval / 5
      : majorTickInterval >= 2
        ? majorTickInterval / 2
        : 0.5;
  const microTickInterval = (minorTickInterval / 5) * pxPerSecond >= 8 ? minorTickInterval / 5 : 0;
  return { majorTickInterval, minorTickInterval, microTickInterval };
}

// ─── Component ────────────────────────────────────────

export function TimelineRuler({ duration, pxPerSecond, trackHeight }: TimelineRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const totalHeight = RULER_HEIGHT + trackHeight;

    canvas.width = width * dpr;
    canvas.height = totalHeight * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, totalHeight);

    const { majorTickInterval, minorTickInterval, microTickInterval } = getIntervals(pxPerSecond);

    // ═══════════════════════════════════════════════════
    // RULER AREA (0 → RULER_HEIGHT)
    // ═══════════════════════════════════════════════════

    // Ruler background
    ctx.fillStyle = "#1E1E1E";
    ctx.fillRect(0, 0, width, RULER_HEIGHT);

    // Ruler bottom border
    ctx.strokeStyle = "#2A2A2A";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT - 0.5);
    ctx.lineTo(width, RULER_HEIGHT - 0.5);
    ctx.stroke();

    // Micro ticks (ruler)
    if (microTickInterval) {
      ctx.strokeStyle = "#2A2A2A";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let time = microTickInterval; time < duration; time += microTickInterval) {
        const majorMod = time % majorTickInterval;
        const minorMod = time % minorTickInterval;
        const isMajor =
          Math.abs(majorMod) < 0.001 || Math.abs(majorMod - majorTickInterval) < 0.001;
        const isMinor =
          Math.abs(minorMod) < 0.001 || Math.abs(minorMod - minorTickInterval) < 0.001;
        if (isMajor || isMinor) continue;
        const x = Math.round(time * pxPerSecond + PLAYHEAD_OFFSET) + 0.5;
        ctx.moveTo(x, RULER_HEIGHT);
        ctx.lineTo(x, RULER_HEIGHT - 4);
      }
      ctx.stroke();
    }

    // Minor ticks (ruler)
    ctx.strokeStyle = "#3A3A3A";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let time = minorTickInterval; time < duration; time += minorTickInterval) {
      const mod = time % majorTickInterval;
      if (Math.abs(mod) < 0.001 || Math.abs(mod - majorTickInterval) < 0.001) continue;
      const x = Math.round(time * pxPerSecond + PLAYHEAD_OFFSET) + 0.5;
      ctx.moveTo(x, RULER_HEIGHT);
      ctx.lineTo(x, RULER_HEIGHT - 8);
    }
    ctx.stroke();

    // Major ticks + labels (ruler)
    ctx.strokeStyle = "#4A4A4A";
    ctx.lineWidth = 1;
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#9A9A9A";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let time = 0; time <= duration; time += majorTickInterval) {
      const x = Math.round(time * pxPerSecond + PLAYHEAD_OFFSET) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT);
      ctx.lineTo(x, RULER_HEIGHT - 12);
      ctx.stroke();
      ctx.fillText(formatTickLabel(time), x, 4);
    }

    // ═══════════════════════════════════════════════════
    // TRACK BACKGROUND GRID (RULER_HEIGHT → totalHeight)
    // ═══════════════════════════════════════════════════

    const trackTop = RULER_HEIGHT;

    // Major grid lines (full height, subtle)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let time = majorTickInterval; time < duration; time += majorTickInterval) {
      const x = Math.round(time * pxPerSecond + PLAYHEAD_OFFSET) + 0.5;
      ctx.moveTo(x, trackTop);
      ctx.lineTo(x, totalHeight);
    }
    ctx.stroke();

    // Minor grid lines (shorter dash style, very subtle)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let time = minorTickInterval; time < duration; time += minorTickInterval) {
      const mod = time % majorTickInterval;
      if (Math.abs(mod) < 0.001 || Math.abs(mod - majorTickInterval) < 0.001) continue;
      const x = Math.round(time * pxPerSecond + PLAYHEAD_OFFSET) + 0.5;
      ctx.moveTo(x, trackTop);
      ctx.lineTo(x, totalHeight);
    }
    ctx.stroke();
  }, [duration, pxPerSecond, trackHeight]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      style={{ height: RULER_HEIGHT + trackHeight }}
    />
  );
}

export { RULER_HEIGHT };

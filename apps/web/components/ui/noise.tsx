"use client";

/**
 * Noise — animated film-grain canvas overlay. Ported from react-bits
 * (MIT + Commons Clause). The upstream version pins to viewport size;
 * we rescope to fill the parent (must be `position: relative`) so it
 * can sit inside a single hero section instead of covering everything.
 */

import { useEffect, useRef } from "react";

export interface NoiseProps {
  /** Frames between regenerations. 1 = every frame, higher = subtler. */
  patternRefreshInterval?: number;
  /** Alpha 0-255 for grain pixels. Lower = barely-there. */
  patternAlpha?: number;
  className?: string;
}

export function Noise({
  patternRefreshInterval = 2,
  patternAlpha = 15,
  className = "",
}: NoiseProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const canvasSize = 1024;
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    let frame = 0;
    let animationId = 0;

    const drawGrain = () => {
      const imageData = ctx.createImageData(canvasSize, canvasSize);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = patternAlpha;
      }
      ctx.putImageData(imageData, 0, 0);
    };

    const loop = () => {
      if (frame % patternRefreshInterval === 0) drawGrain();
      frame++;
      animationId = window.requestAnimationFrame(loop);
    };
    loop();

    return () => window.cancelAnimationFrame(animationId);
  }, [patternRefreshInterval, patternAlpha]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export default Noise;

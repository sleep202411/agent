"use client";

/**
 * GradualBlur — stacked backdrop-filter masks producing a directional
 * gradient blur (sharp on one edge, blurrier toward the opposite edge).
 * Useful as a soft section-transition: the underlying content visually
 * fades into mist rather than hard-cutting at a section boundary.
 *
 * Ported from react-bits (https://reactbits.dev/animations/gradual-blur).
 * License: MIT + Commons Clause v1.0.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Position = "top" | "bottom" | "left" | "right";
type Curve = "linear" | "bezier" | "ease-in" | "ease-out" | "ease-in-out";
type Animated = false | true | "scroll";

export interface GradualBlurProps {
  position?: Position;
  /** Multiplier on the per-layer blur radius. */
  strength?: number;
  /** Length of the blur band — px or rem (e.g. "6rem"). */
  height?: string;
  /** Width when position is left/right. Defaults to height. */
  width?: string;
  /** Number of layered divs. More = smoother gradient, slightly more cost. */
  divCount?: number;
  /** Use exponential blur ramp instead of linear. */
  exponential?: boolean;
  zIndex?: number;
  animated?: Animated;
  duration?: string;
  easing?: string;
  opacity?: number;
  curve?: Curve;
  /** "parent" pins to nearest positioned ancestor; "page" fixes to viewport. */
  target?: "parent" | "page";
  className?: string;
  style?: CSSProperties;
  /** Optional hover intensity multiplier on `strength`. */
  hoverIntensity?: number;
}

const CURVES: Record<Curve, (p: number) => number> = {
  linear: (p) => p,
  bezier: (p) => p * p * (3 - 2 * p),
  "ease-in": (p) => p * p,
  "ease-out": (p) => 1 - Math.pow(1 - p, 2),
  "ease-in-out": (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
};

const DIRECTION_MAP: Record<Position, string> = {
  top: "to top",
  bottom: "to bottom",
  left: "to left",
  right: "to right",
};

function GradualBlurInner({
  position = "bottom",
  strength = 2,
  height = "6rem",
  width,
  divCount = 5,
  exponential = false,
  zIndex = 1000,
  animated = false,
  duration = "0.3s",
  easing = "ease-out",
  opacity = 1,
  curve = "linear",
  target = "parent",
  className = "",
  style,
  hoverIntensity,
}: GradualBlurProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(animated !== "scroll");

  useEffect(() => {
    if (animated !== "scroll" || !containerRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), {
      threshold: 0.1,
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [animated]);

  const blurDivs = useMemo(() => {
    const increment = 100 / divCount;
    const currentStrength = isHovered && hoverIntensity ? strength * hoverIntensity : strength;
    const curveFn = CURVES[curve];
    const direction = DIRECTION_MAP[position];

    return Array.from({ length: divCount }, (_, idx) => {
      const i = idx + 1;
      const progress = curveFn(i / divCount);
      const blurValue = exponential
        ? Math.pow(2, progress * 4) * 0.0625 * currentStrength
        : 0.0625 * (progress * divCount + 1) * currentStrength;

      const p1 = Math.round((increment * i - increment) * 10) / 10;
      const p2 = Math.round(increment * i * 10) / 10;
      const p3 = Math.round((increment * i + increment) * 10) / 10;
      const p4 = Math.round((increment * i + increment * 2) * 10) / 10;

      let gradient = `transparent ${p1}%, black ${p2}%`;
      if (p3 <= 100) gradient += `, black ${p3}%`;
      if (p4 <= 100) gradient += `, transparent ${p4}%`;

      const mask = `linear-gradient(${direction}, ${gradient})`;
      const layerStyle: CSSProperties = {
        position: "absolute",
        inset: 0,
        maskImage: mask,
        WebkitMaskImage: mask,
        backdropFilter: `blur(${blurValue.toFixed(3)}rem)`,
        WebkitBackdropFilter: `blur(${blurValue.toFixed(3)}rem)`,
        opacity,
        transition:
          animated && animated !== "scroll" ? `backdrop-filter ${duration} ${easing}` : undefined,
      };

      return <div key={i} style={layerStyle} />;
    });
  }, [
    divCount,
    isHovered,
    hoverIntensity,
    strength,
    curve,
    exponential,
    position,
    opacity,
    animated,
    duration,
    easing,
  ]);

  const containerStyle = useMemo<CSSProperties>(() => {
    const isVertical = position === "top" || position === "bottom";
    const isPageTarget = target === "page";
    const base: CSSProperties = {
      position: isPageTarget ? "fixed" : "absolute",
      pointerEvents: hoverIntensity ? "auto" : "none",
      opacity: isVisible ? 1 : 0,
      transition: animated ? `opacity ${duration} ${easing}` : undefined,
      zIndex: isPageTarget ? zIndex + 100 : zIndex,
      ...style,
    };
    if (isVertical) {
      base.height = height;
      base.width = width || "100%";
      base[position] = 0;
      base.left = 0;
      base.right = 0;
    } else {
      base.width = width || height;
      base.height = "100%";
      base[position] = 0;
      base.top = 0;
      base.bottom = 0;
    }
    return base;
  }, [
    position,
    target,
    hoverIntensity,
    isVisible,
    animated,
    duration,
    easing,
    zIndex,
    height,
    width,
    style,
  ]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`pointer-events-none overflow-hidden ${className}`}
      style={containerStyle}
      onMouseEnter={hoverIntensity ? () => setIsHovered(true) : undefined}
      onMouseLeave={hoverIntensity ? () => setIsHovered(false) : undefined}
    >
      <div className="pointer-events-none relative h-full w-full">{blurDivs}</div>
    </div>
  );
}

export const GradualBlur = memo(GradualBlurInner);
GradualBlur.displayName = "GradualBlur";

export default GradualBlur;

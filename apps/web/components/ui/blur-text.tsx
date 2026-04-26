"use client";

/**
 * BlurText — word/character staggered reveal with a two-step blur ramp.
 * Ported from react-bits (https://reactbits.dev). License: MIT + Commons
 * Clause v1.0 (free in our product, can't redistribute as a library).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, type Easing, type TargetAndTransition } from "motion/react";

type AnimateBy = "words" | "letters";
type Direction = "top" | "bottom";

interface KeyFrame {
  filter?: string;
  opacity?: number;
  y?: number;
}

export interface BlurTextProps {
  text: string;
  /** ms delay between each word/letter */
  delay?: number;
  className?: string;
  animateBy?: AnimateBy;
  direction?: Direction;
  threshold?: number;
  rootMargin?: string;
  animationFrom?: KeyFrame;
  animationTo?: KeyFrame[];
  easing?: Easing;
  stepDuration?: number;
  onAnimationComplete?: () => void;
}

function buildKeyframes(from: KeyFrame, steps: KeyFrame[]) {
  const keys = new Set<string>([...Object.keys(from), ...steps.flatMap((s) => Object.keys(s))]);
  const out: Record<string, unknown[]> = {};
  keys.forEach((k) => {
    const key = k as keyof KeyFrame;
    out[k] = [from[key], ...steps.map((s) => s[key])];
  });
  return out;
}

export function BlurText({
  text,
  delay = 200,
  className = "",
  animateBy = "words",
  direction = "top",
  threshold = 0.1,
  rootMargin = "0px",
  animationFrom,
  animationTo,
  easing,
  stepDuration = 0.35,
  onAnimationComplete,
}: BlurTextProps) {
  const elements = animateBy === "words" ? text.split(" ") : text.split("");
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(el);
        }
      },
      { threshold, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  const defaultFrom = useMemo<KeyFrame>(
    () =>
      direction === "top"
        ? { filter: "blur(10px)", opacity: 0, y: -50 }
        : { filter: "blur(10px)", opacity: 0, y: 50 },
    [direction]
  );

  const defaultTo = useMemo<KeyFrame[]>(
    () => [
      { filter: "blur(5px)", opacity: 0.5, y: direction === "top" ? 5 : -5 },
      { filter: "blur(0px)", opacity: 1, y: 0 },
    ],
    [direction]
  );

  const fromSnapshot = animationFrom ?? defaultFrom;
  const toSnapshots = animationTo ?? defaultTo;

  const stepCount = toSnapshots.length + 1;
  const totalDuration = stepDuration * (stepCount - 1);
  const times = Array.from({ length: stepCount }, (_, i) =>
    stepCount === 1 ? 0 : i / (stepCount - 1)
  );

  return (
    <p ref={ref} className={className} style={{ display: "flex", flexWrap: "wrap" }}>
      {elements.map((segment, index) => {
        const animateKeyframes = buildKeyframes(fromSnapshot, toSnapshots);
        return (
          <motion.span
            key={index}
            className="inline-block will-change-[transform,filter,opacity]"
            initial={fromSnapshot as TargetAndTransition}
            animate={(inView ? animateKeyframes : fromSnapshot) as TargetAndTransition}
            transition={{
              duration: totalDuration,
              times,
              delay: (index * delay) / 1000,
              ease: easing,
            }}
            onAnimationComplete={index === elements.length - 1 ? onAnimationComplete : undefined}
          >
            {segment === " " ? " " : segment}
            {animateBy === "words" && index < elements.length - 1 && " "}
          </motion.span>
        );
      })}
    </p>
  );
}

export default BlurText;

"use client";

/**
 * SmoothScroll — Lenis-driven smooth scroll wrapper, scoped to the (site)
 * marketing layout. Studio / workbench routes are NOT wrapped because
 * those pages have nested scroll containers (storyboard, asset library,
 * chat history) that conflict with a global scroll hijack.
 *
 * Behaviour:
 * - Desktop: wheel scroll is dampened with lerp interpolation, giving a
 *   ~200ms inertia tail after the user stops scrolling.
 * - Mobile: `syncTouch: false` lets native momentum handle touchmove —
 *   software-emulated touch scroll usually feels worse than native iOS.
 * - Accessibility: respects `prefers-reduced-motion: reduce` and falls
 *   back to native scroll for users who opt out of motion.
 */

import { useEffect, useRef, type ReactNode } from "react";
import Lenis from "lenis";
import "./smooth-scroll.css";

export function SmoothScroll({ children }: { children: ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const lenis = new Lenis({
      lerp: 0.1, // lower = smoother / heavier; 0.1 is a balanced default
      smoothWheel: true,
      syncTouch: false, // let native momentum handle touch on mobile
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    });
    lenisRef.current = lenis;

    let rafId: number;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return <>{children}</>;
}

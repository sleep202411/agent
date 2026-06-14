"use client";

import { useEffect, useRef } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import gsap from "gsap";

/**
 * Hero carousel — a GSAP-driven Apple "Cover Flow" of creation cards for the
 * hero's right half. The focused card sits flat and forward; cards to either
 * side tilt back on the Y axis, recede in depth, shrink and dim with distance.
 *
 * It auto-advances (snap + dwell) and wraps endlessly, but is fully steerable:
 * prev/next arrows, click a side card to bring it to centre. Autoplay pauses on
 * hover and resumes on leave; honours reduced-motion.
 *
 * Decorative chrome (royalty-free placeholder thumbnails + sample titles, like
 * the prior cluster). Wire to the real generation feed later.
 */

interface Slide {
  seed: string;
  title: string;
}

const SLIDES: Slide[] = [
  { seed: "fizz-cf-1", title: "Coastal cliffs" },
  { seed: "fizz-cf-2", title: "Midnight sky" },
  { seed: "fizz-cf-3", title: "Golden hour bridge" },
  { seed: "fizz-cf-4", title: "Alpine pass" },
  { seed: "fizz-cf-5", title: "Mangrove delta" },
  { seed: "fizz-cf-6", title: "Desert dunes" },
  { seed: "fizz-cf-7", title: "Neon district" },
  { seed: "fizz-cf-8", title: "Misty forest" },
  { seed: "fizz-cf-9", title: "Open road" },
];
const COUNT = SLIDES.length;

// Cover Flow geometry (px / deg) — tuned for big, wide landscape cards.
const CENTER_GAP = 225; // focused card → first side card
const SIDE_GAP = 70; // spacing between stacked side cards
const DEPTH = 110; // translateZ step as cards recede
const TILT = 60; // side-card rotateY
const AUTO_DELAY = 2.4; // dwell between auto-advances (s)

export function HeroCarousel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const apiRef = useRef<{
    step: (dir: number) => void;
    focus: (index: number) => void;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const state = { progress: 0 };
    const { clamp } = gsap.utils;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let target = 0; // focused index (unbounded; cards wrap modulo COUNT)
    let hovered = false;
    let autoCall: gsap.core.Tween | null = null;

    const layout = () => {
      cardsRef.current.forEach((card, i) => {
        if (!card) return;
        // Signed distance from the focused position, wrapped so cards recycle.
        let off = (i - state.progress) % COUNT;
        if (off > COUNT / 2) off -= COUNT;
        if (off < -COUNT / 2) off += COUNT;

        const abs = Math.abs(off);
        const sign = Math.sign(off);
        const near = Math.min(abs, 1); // ramps the centre→side transition

        gsap.set(card, {
          x: sign * (near * CENTER_GAP + Math.max(abs - 1, 0) * SIDE_GAP),
          z: -Math.min(abs, 4) * DEPTH,
          rotationY: -sign * TILT * near,
          scale: Math.max(1 - abs * 0.12, 0.55),
          opacity: clamp(0, 1, 1 - Math.max(abs - 1, 0) * 0.5),
          filter: `brightness(${clamp(0.4, 1, 1 - abs * 0.14)})`,
          zIndex: Math.round(1000 - abs * 10),
          pointerEvents: abs > 2.5 ? "none" : "auto",
        });
      });
    };

    const animateTo = (next: number) => {
      gsap.to(state, {
        progress: next,
        duration: 0.7,
        ease: "power2.out",
        overwrite: true,
        onUpdate: layout,
      });
    };

    const killAuto = () => {
      autoCall?.kill();
      autoCall = null;
    };
    const scheduleAuto = () => {
      killAuto();
      if (reduce.matches || hovered) return;
      autoCall = gsap.delayedCall(AUTO_DELAY, () => {
        target += 1;
        animateTo(target);
        scheduleAuto();
      });
    };

    const step = (dir: number) => {
      target += dir;
      animateTo(target);
      scheduleAuto();
    };
    const focus = (index: number) => {
      // Shortest wrapped path to bring card `index` to centre.
      let delta = (((index - target) % COUNT) + COUNT) % COUNT;
      if (delta > COUNT / 2) delta -= COUNT;
      if (delta === 0) return;
      target += delta;
      animateTo(target);
      scheduleAuto();
    };
    apiRef.current = { step, focus };

    layout();
    scheduleAuto();

    const onEnter = () => {
      hovered = true;
      killAuto();
    };
    const onLeave = () => {
      hovered = false;
      scheduleAuto();
    };
    container.addEventListener("pointerenter", onEnter);
    container.addEventListener("pointerleave", onLeave);

    return () => {
      killAuto();
      gsap.killTweensOf(state);
      apiRef.current = null;
      container.removeEventListener("pointerenter", onEnter);
      container.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <div className="relative mx-auto h-full max-w-[720px]">
        <div className="size-full" style={{ perspective: "1300px" }}>
          <div
            className="absolute top-1/2 left-1/2 -mt-28 -ml-48 h-56 w-96"
            style={{ transformStyle: "preserve-3d" }}
          >
            {SLIDES.map((slide, i) => (
              <button
                type="button"
                key={slide.seed}
                tabIndex={-1}
                aria-label={`Show ${slide.title}`}
                onClick={() => apiRef.current?.focus(i)}
                ref={(el) => {
                  cardsRef.current[i] = el;
                }}
                className="absolute inset-0 block cursor-pointer overflow-hidden rounded-2xl text-left shadow-2xl shadow-black/60 ring-1 ring-white/10"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://picsum.photos/seed/${slide.seed}/640/360`}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
                {/* Title scrim */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-3.5 pt-8">
                  <span className="text-sm font-semibold text-white drop-shadow">
                    {slide.title}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Prev / Next — docked to the left & right sides. */}
        <button
          type="button"
          aria-label="Previous"
          onClick={() => apiRef.current?.step(-1)}
          className="absolute top-1/2 left-4 z-[2000] flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
        >
          <IconChevronLeft className="size-5" stroke={2} />
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => apiRef.current?.step(1)}
          className="absolute top-1/2 right-4 z-[2000] flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
        >
          <IconChevronRight className="size-5" stroke={2} />
        </button>
      </div>
    </div>
  );
}

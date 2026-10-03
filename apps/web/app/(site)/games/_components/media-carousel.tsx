"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { StoreMediaItem } from "../_data/interactive-film-store";

/**
 * Steam-style media showcase for the interactive-film store dialog: a
 * trailer/screenshot stage with arrow navigation, a thumbnail rail, and gentle
 * auto-advance for stills. Video slides never auto-advance — the trailer owns
 * the stage until the viewer moves on, and is paused when it loses the stage.
 */

const IMAGE_ADVANCE_MS = 4500;

export function MediaCarousel({
  media,
  title,
  trailerLabel,
  counterLabel,
  imageAltFallback,
}: {
  media: StoreMediaItem[];
  title: string;
  trailerLabel: string;
  counterLabel: (index: number, total: number) => string;
  imageAltFallback: string;
}) {
  const [active, setActive] = useState(0);
  const [hovering, setHovering] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const total = media.length;
  const current = media[active];

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      setActive(((next % total) + total) % total);
    },
    [total]
  );

  const onPrev = useCallback(() => goTo(active - 1), [goTo, active]);
  const onNext = useCallback(() => goTo(active + 1), [goTo, active]);

  // Pause the trailer whenever it leaves the stage so audio never bleeds
  // into screenshot browsing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (current?.kind !== "video") video.pause();
  }, [current]);

  // Auto-advance stills only. Hover/focus pauses the rotation, and any
  // manual navigation resets the timer so a slide never flips mid-read.
  useEffect(() => {
    if (current?.kind !== "video" && !hovering) {
      const timer = window.setTimeout(() => goTo(active + 1), IMAGE_ADVANCE_MS);
      return () => window.clearTimeout(timer);
    }
  }, [active, current, goTo, hovering]);

  // Keep the active thumbnail in view when the stage advances.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const child = rail.children[active] as HTMLElement | undefined;
    if (!child) return;
    const target = child.offsetLeft - rail.clientWidth / 2 + child.clientWidth / 2;
    if (Math.abs(target - rail.scrollLeft) > 8) {
      rail.scrollTo({ left: target, behavior: "smooth" });
    }
  }, [active]);

  const stopAndRun = useCallback((fn: () => void) => {
    return (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      fn();
    };
  }, []);

  const thumbnails = useMemo(
    () =>
      media.map((item, index) => (
        <button
          key={item.url}
          type="button"
          onClick={stopAndRun(() => goTo(index))}
          aria-current={index === active}
          aria-label={counterLabel(index + 1, total)}
          className={`relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-black transition-opacity sm:w-32 ${
            index === active
              ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
              : "opacity-60 hover:opacity-100"
          }`}
        >
          {item.kind === "video" ? (
            <>
              <Image
                src={item.posterUrl}
                alt={trailerLabel}
                fill
                unoptimized
                sizes="128px"
                className="object-cover"
              />
              <span className="absolute inset-0 grid place-items-center bg-black/35">
                <span className="grid size-6 place-items-center rounded-full bg-white/90 text-black">
                  <IconChevronRight className="size-3.5 translate-x-px fill-current" stroke={0} />
                </span>
              </span>
            </>
          ) : (
            <Image
              src={item.url}
              alt={item.alt || imageAltFallback}
              fill
              unoptimized
              sizes="128px"
              className="object-cover"
            />
          )}
        </button>
      )),
    [media, active, goTo, stopAndRun, counterLabel, total, trailerLabel, imageAltFallback]
  );

  if (total === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      className="relative"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        {media.map((item, index) =>
          item.kind === "video" ? (
            <video
              key={item.url}
              ref={index === active ? videoRef : undefined}
              className={`absolute inset-0 z-0 size-full object-cover transition-opacity duration-300 ${
                index === active ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              src={item.url}
              poster={item.posterUrl}
              controls
              muted
              autoPlay
              playsInline
              preload="metadata"
              aria-label={`${title} — ${trailerLabel}`}
            />
          ) : (
            <Image
              key={item.url}
              src={item.url}
              alt={item.alt || imageAltFallback}
              fill
              unoptimized
              sizes="(min-width: 1024px) 640px, 100vw"
              priority={index === 0}
              className={`z-0 object-cover transition-opacity duration-300 ${
                index === active ? "opacity-100" : "opacity-0"
              }`}
            />
          )
        )}

        {total > 1 ? (
          <>
            <CarouselArrow side="left" onClick={onPrev} />
            <CarouselArrow side="right" onClick={onNext} />
            <span className="pointer-events-none absolute right-3 bottom-3 z-20 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/85 backdrop-blur-md">
              {counterLabel(active + 1, total)}
            </span>
          </>
        ) : null}
      </div>

      {total > 1 ? (
        <div
          ref={railRef}
          className="mt-3 flex gap-2.5 overflow-x-auto px-1 py-1.5 [scrollbar-width:thin]"
        >
          {thumbnails}
        </div>
      ) : null}
    </section>
  );
}

function CarouselArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const Icon = side === "left" ? IconChevronLeft : IconChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous media" : "Next media"}
      className={`absolute top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      <Icon className="size-5" stroke={1.8} />
    </button>
  );
}

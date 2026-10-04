"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { StoreMediaItem } from "../_data/store-media";

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
  errorLabel,
  retryLabel,
}: {
  media: StoreMediaItem[];
  title: string;
  trailerLabel: string;
  counterLabel: (index: number, total: number) => string;
  imageAltFallback: string;
  errorLabel: string;
  retryLabel: string;
}) {
  const [active, setActive] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const total = media.length;
  // A refreshed snapshot can remove unavailable media while the dialog stays open.
  // Reconcile before commit so no empty stage or out-of-range counter is displayed.
  if (active >= total && active !== 0) setActive(Math.max(0, total - 1));
  const current = media[active];
  const failed = current ? failedUrls.has(current.url) : false;

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      setActive(((next % total) + total) % total);
    },
    [total]
  );

  const onPrev = useCallback(() => goTo(active - 1), [goTo, active]);
  const onNext = useCallback(() => goTo(active + 1), [goTo, active]);

  // Capture the active element before React clears its ref on slide change.
  // Only the active slide is mounted, so hidden videos cannot start playing.
  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [current, failed, attempt]);

  // Auto-advance stills only. Hover/focus pauses the rotation, and any
  // manual navigation resets the timer so a slide never flips mid-read.
  useEffect(() => {
    if (total > 1 && current?.kind !== "video" && !hovering && !failed) {
      const timer = window.setTimeout(() => goTo(active + 1), IMAGE_ADVANCE_MS);
      return () => window.clearTimeout(timer);
    }
  }, [active, current, goTo, hovering, total, failed]);

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
          key={`${item.kind}:${item.url}:${index}`}
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
              {item.posterUrl ? (
                <Image
                  src={item.posterUrl}
                  alt={trailerLabel}
                  fill
                  unoptimized
                  sizes="128px"
                  className="object-cover"
                />
              ) : null}
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
      className="relative isolate"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        {failed && current ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-12 text-center text-sm text-white/75"
          >
            <p>{errorLabel}</p>
            <button
              type="button"
              data-media-retry
              className="rounded-lg bg-white/[0.08] px-4 py-2 text-xs font-medium hover:bg-white/[0.12]"
              onClick={() => {
                setFailedUrls((urls) => {
                  const next = new Set(urls);
                  next.delete(current.url);
                  return next;
                });
                setAttempt((value) => value + 1);
              }}
            >
              {retryLabel}
            </button>
          </div>
        ) : current?.kind === "video" ? (
          <video
            key={`${current.url}:${attempt}`}
            ref={videoRef}
            className="absolute inset-0 size-full object-cover"
            src={current.url}
            poster={current.posterUrl ?? undefined}
            controls
            muted
            autoPlay
            playsInline
            preload="metadata"
            aria-label={`${title} — ${trailerLabel}`}
            onError={() => setFailedUrls((urls) => new Set(urls).add(current.url))}
          />
        ) : current ? (
          <Image
            key={`${current.url}:${attempt}`}
            src={current.url}
            alt={current.alt || imageAltFallback}
            fill
            unoptimized
            sizes="(min-width: 1024px) 640px, 100vw"
            priority={active === 0}
            className="object-cover"
            onError={() => setFailedUrls((urls) => new Set(urls).add(current.url))}
          />
        ) : null}

        {total > 1 ? (
          <>
            <CarouselArrow
              side="left"
              label={counterLabel(((active - 1 + total) % total) + 1, total)}
              onClick={onPrev}
            />
            <CarouselArrow
              side="right"
              label={counterLabel(((active + 1) % total) + 1, total)}
              onClick={onNext}
            />
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
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const Icon = side === "left" ? IconChevronLeft : IconChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      <Icon className="size-5" stroke={1.8} />
    </button>
  );
}

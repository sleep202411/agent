"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  IconBolt,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPlay,
  IconPlus,
  IconVolumeOff,
  IconMovie,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { usePlazaFeatured, usePlazaForYou } from "../_hooks/use-ip";

// Cinematic hero for the IP Plaza — Netflix-style featured carousel + a
// horizontal "For you" rail underneath. Both data sources come from
// `/project/plaza/featured` and `/project/plaza/for-you`; until backend
// ships them the hero renders nothing (Plaza page below still works).

const AUTO_ADVANCE_MS = 8000;

export function IPCinematicHero() {
  const t = useTranslations("ip");
  const { data: slides = [] } = usePlazaFeatured();
  const { data: railData } = usePlazaForYou({ pageSize: 10 });
  const rail = railData?.list ?? [];

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = slides.length;

  // Reset to first slide if backend payload shrinks below the current index
  // (e.g. an item is unfeatured while the page is open).
  useEffect(() => {
    if (index >= total && total > 0) setIndex(0);
  }, [index, total]);

  // Auto-advance carousel; pause on hover so reading the slide isn't yanked
  // away mid-sentence.
  useEffect(() => {
    if (paused || total <= 1) return;
    const handle = window.setTimeout(() => {
      setIndex((i) => (i + 1) % total);
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(handle);
  }, [index, paused, total]);

  // Backend not ready / empty result — render a placeholder at the
  // hero's full fixed height so the rail below doesn't jump up. Plaza
  // listing further down is unaffected.
  if (total === 0) {
    return (
      <section className="relative">
        <div className="relative flex h-[100svh] w-full items-center justify-center overflow-hidden bg-black">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 60% 60% at 50% 40%, hsl(42 95% 55% / 0.08) 0%, transparent 65%), radial-gradient(ellipse 40% 50% at 80% 80%, hsl(280 60% 55% / 0.06) 0%, transparent 60%)",
            }}
          />
          <div className="relative z-10 flex flex-col items-center gap-3 px-6 text-center text-white/70">
            <div className="inline-flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <IconMovie className="size-5 text-amber-300/80" />
            </div>
            <h2 className="font-heading text-xl font-bold uppercase tracking-[0.18em] text-white sm:text-2xl">
              {t("featuredEmptyTitle")}
            </h2>
            <p className="max-w-md text-sm text-white/55">{t("featuredEmptyBody")}</p>
          </div>
        </div>
      </section>
    );
  }

  const prev = () => setIndex((i) => (i - 1 + total) % total);
  const next = () => setIndex((i) => (i + 1) % total);
  const slide = slides[index];

  return (
    <section
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* ── Hero ──────────────────────────────────────── */}
      {/* Height is viewport-relative so the rail below stays in the first
          fold on standard laptop sizes; hard min/max keep it readable on
          tiny / huge screens. */}
      <div className="relative h-[100svh] w-full overflow-hidden bg-black">
        {/* Crossfade between key arts */}
        {slides.map((s, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={s.id}
            src={s.keyArt}
            alt=""
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-700",
              i === index ? "opacity-100" : "opacity-0"
            )}
          />
        ))}

        {/* Left + bottom legibility scrims — separate layers so we can tune
            each independently without one swallowing the other. */}
        <div className="absolute inset-0 bg-linear-to-r from-background via-background/70 to-transparent to-60%" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-background to-transparent" />

        {/* Content */}
        <div className="relative z-10 mx-auto flex h-full max-w-screen-2xl items-end px-6 pt-24 pb-16 sm:px-10">
          <div className="max-w-2xl">
            {slide.eyebrow && (
              <div className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                <IconBolt className="size-3.5" />
                {slide.eyebrow}
              </div>
            )}
            <h1 className="font-heading text-5xl font-black uppercase tracking-tight text-white drop-shadow-lg sm:text-7xl">
              {slide.title}
            </h1>
            {slide.subtitle && (
              <div className="mt-2 font-heading text-sm font-bold uppercase tracking-[0.3em] text-white/70 sm:text-base">
                {slide.subtitle}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-white/80">
              <span>{t("detailEpisodeCount", { count: slide.episodes })}</span>
            </div>
            {slide.description && (
              <p className="mt-4 line-clamp-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
                {slide.description}
              </p>
            )}
            <div className="mt-6 flex items-center gap-3">
              <Link
                href={`/ips/${slide.id}`}
                className="inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90"
              >
                <IconPlayerPlay className="size-4 fill-current" />
                {t("detailViewProfile")}
              </Link>
            </div>
            {slide.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center text-[11px] text-white/55">
                {slide.tags.map((tag, i) => (
                  <span key={tag}>
                    {i > 0 && <span className="mx-1.5 text-white/30">·</span>}
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right corner: mute */}
        <div className="absolute bottom-8 right-6 z-10 flex items-center gap-3">
          <button
            type="button"
            aria-label="Toggle audio"
            className="inline-flex size-9 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
          >
            <IconVolumeOff className="size-4" />
          </button>
        </div>

        {/* Carousel arrows */}
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Previous"
              className="absolute left-4 top-1/2 z-10 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
            >
              <IconChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Next"
              className="absolute right-4 top-1/2 z-10 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
            >
              <IconChevronRight className="size-5" />
            </button>

            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    i === index ? "w-8 bg-white" : "w-4 bg-white/30 hover:bg-white/50"
                  )}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── For you rail ──────────────────────────────── */}
      {rail.length > 0 && (
        <div className="mx-auto -mt-2 max-w-screen-2xl px-6 pt-6 sm:px-10">
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-foreground">{t("forYou")}</h2>
          </div>
          <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-4 sm:-mx-10 sm:px-10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {rail.map((item) => (
              <Link
                key={item.id}
                href={`/ips/${item.id}`}
                className="group block w-64 shrink-0 sm:w-72"
              >
                <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.cover}
                    alt=""
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-black/85 to-transparent" />
                  <div className="absolute inset-x-3 bottom-3 pr-10">
                    <h3 className="line-clamp-1 text-sm font-semibold text-white">{item.title}</h3>
                  </div>
                  <button
                    type="button"
                    aria-label="Add to list"
                    onClick={(e) => e.preventDefault()}
                    className="absolute bottom-3 right-3 inline-flex size-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
                  >
                    <IconPlus className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{t("detailEpisodeCount", { count: item.episodes })}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

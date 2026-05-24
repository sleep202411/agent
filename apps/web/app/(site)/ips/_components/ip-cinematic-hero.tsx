"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  IconBolt,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPlay,
  IconShare3,
  IconVolumeOff,
  IconMovie,
} from "@tabler/icons-react";
import { toast } from "sonner";
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
  // If the backend payload shrinks below the current index, render the
  // first available slide without a synchronous state write in an effect.
  const activeIndex = total > 0 && index < total ? index : 0;

  // Auto-advance carousel; pause on hover so reading the slide isn't yanked
  // away mid-sentence.
  useEffect(() => {
    if (paused || total <= 1) return;
    const handle = window.setTimeout(() => {
      setIndex((activeIndex + 1) % total);
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(handle);
  }, [activeIndex, paused, total]);

  // Featured-empty branch. Featured comes from `/project/featured/list`
  // which the backend hasn't shipped yet, but the For You rail (sourced
  // from the regular `/project/list`) usually has data — so we show the
  // rail by itself rather than gating the entire hero on Featured. When
  // both are empty we fall back to the original placeholder.
  if (total === 0) {
    if (rail.length > 0) {
      return (
        <section className="relative pt-20">
          <div className="mx-auto max-w-[1800px] px-6 sm:px-10">
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
                    <div className="absolute inset-x-3 bottom-3">
                      <h3 className="line-clamp-1 text-sm font-semibold text-white">
                        {item.title}
                      </h3>
                    </div>
                  </div>
                  {item.episodes > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{t("detailEpisodeCount", { count: item.episodes })}</span>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </section>
      );
    }
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

  const prev = () => setIndex((activeIndex - 1 + total) % total);
  const next = () => setIndex((activeIndex + 1) % total);
  const slide = slides[activeIndex];

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
              i === activeIndex ? "opacity-100" : "opacity-0"
            )}
          />
        ))}

        {/* Left + bottom legibility scrims — separate layers so we can tune
            each independently without one swallowing the other. */}
        <div className="absolute inset-0 bg-linear-to-r from-background via-background/70 to-transparent to-60%" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-background to-transparent" />

        {/* Content */}
        <div className="relative z-10 mx-auto flex h-full max-w-[1800px] items-end px-6 pt-24 pb-16 sm:px-10">
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
            {slide.episodes > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-white/80">
                <span>{t("detailEpisodeCount", { count: slide.episodes })}</span>
              </div>
            )}
            {slide.description && (
              <p className="mt-4 line-clamp-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
                {slide.description}
              </p>
            )}
            <div className="mt-6 flex items-center gap-3">
              <Link
                href={`/ips/${slide.id}`}
                className="group/cta relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-white/30 bg-white/10 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 backdrop-blur-xl backdrop-saturate-150 transition-all duration-300 hover:border-white/50 hover:bg-white/20 hover:shadow-white/10"
              >
                {/* Liquid-glass shimmer: a soft diagonal highlight that
                 *  drifts across the surface on hover. Pure CSS, no JS. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover/cta:translate-x-full"
                />
                <IconPlayerPlay className="relative size-4 fill-current" />
                <span className="relative">{t("detailViewProfile")}</span>
              </Link>
              <button
                type="button"
                onClick={async () => {
                  // Build the absolute URL from the page's origin so the
                  // copied link works no matter which locale-prefixed
                  // path the user is currently sitting on. Fall back to
                  // legacy execCommand for browsers without async
                  // clipboard (older Safari / non-HTTPS contexts).
                  const url = `${window.location.origin}/ips/${slide.id}`;
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(url);
                    } else {
                      const ta = document.createElement("textarea");
                      ta.value = url;
                      ta.style.position = "fixed";
                      ta.style.opacity = "0";
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand("copy");
                      document.body.removeChild(ta);
                    }
                    toast.success(t("shareCopied"));
                  } catch {
                    toast.error(t("shareCopyFailed"));
                  }
                }}
                aria-label={t("share")}
                className="inline-flex size-12 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white shadow-lg shadow-black/30 backdrop-blur-xl backdrop-saturate-150 transition-all duration-300 hover:border-white/50 hover:bg-white/20 hover:shadow-white/10"
              >
                <IconShare3 className="size-4" />
              </button>
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

        {/* Top-right: mute (moved here so the bottom-right is free for
         *  the thumbnail strip below) */}
        <div className="absolute top-6 right-6 z-10 flex items-center gap-3">
          <button
            type="button"
            aria-label="Toggle audio"
            className="inline-flex size-9 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
          >
            <IconVolumeOff className="size-4" />
          </button>
        </div>

        {/* Bottom-right: slide thumbnails. Replaces the previous bullet
         *  dots — gives users a visual peek of what's coming next and
         *  doubles as the position indicator. Hidden on small screens
         *  to avoid crowding the hero. */}
        {total > 1 && (
          <div className="absolute right-6 bottom-6 z-10 hidden gap-2 lg:flex">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Slide ${i + 1}: ${s.title ?? ""}`}
                aria-current={i === activeIndex}
                // Active state: solid 2px primary border + 4px halo of
                // primary at ~30% alpha, stacked via two box-shadows so
                // the inner edge stays sharp and the outer halo softly
                // bleeds outward without nudging layout.
                style={
                  i === activeIndex
                    ? {
                        boxShadow:
                          "0 0 0 2px var(--color-primary), 0 0 0 6px color-mix(in srgb, var(--color-primary) 30%, transparent)",
                      }
                    : undefined
                }
                className={cn(
                  "relative h-20 w-32 overflow-hidden rounded-lg transition-all",
                  i === activeIndex ? "opacity-100" : "opacity-50 hover:opacity-90"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.keyArt} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}

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
          </>
        )}
      </div>

      {/* ── For you rail ──────────────────────────────── */}
      {rail.length > 0 && (
        <div className="mx-auto -mt-2 max-w-[1800px] px-6 pt-6 sm:px-10">
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
                  <div className="absolute inset-x-3 bottom-3">
                    <h3 className="line-clamp-1 text-sm font-semibold text-white">{item.title}</h3>
                  </div>
                </div>
                {item.episodes > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{t("detailEpisodeCount", { count: item.episodes })}</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

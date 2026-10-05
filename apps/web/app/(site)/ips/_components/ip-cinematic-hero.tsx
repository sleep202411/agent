"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IpHoverPreview } from "./ip-hover-preview";
import { ChannelBadge } from "@/components/channel-badge";
import {
  IconBolt,
  IconMovie,
  IconPlayerPlay,
  IconShare3,
  IconVolumeOff,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { ipRoomPath } from "@/src/lib/ip-commerce/urls";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import type { PlazaProject } from "./plaza-types";

const AUTO_ADVANCE_MS = 8000;

export function IPCinematicHero({
  loading,
  slides,
  rail,
}: {
  loading: boolean;
  slides: PlazaProject[];
  rail: PlazaProject[];
}) {
  const t = useTranslations("ip");
  const locale = useLocale() as Locale;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = slides.length;
  const activeIndex = total > 0 && index < total ? index : 0;

  useEffect(() => {
    if (paused || total <= 1) return;
    const handle = window.setTimeout(() => {
      setIndex((activeIndex + 1) % total);
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(handle);
  }, [activeIndex, paused, total]);

  if (total === 0) {
    if (rail.length > 0) {
      return <RailOnly rail={rail} locale={locale} />;
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
              {loading ? t("loading") : t("featuredEmptyTitle")}
            </h2>
            {!loading && <p className="max-w-md text-sm text-white/55">{t("featuredEmptyBody")}</p>}
          </div>
        </div>
      </section>
    );
  }

  const slide = slides[activeIndex];

  return (
    <section className="relative">
      <div
        className="relative h-[100svh] w-full overflow-hidden bg-black"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
        }}
      >
        {slides.map((item, i) =>
          item.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.id}
              src={item.cover}
              alt=""
              className={cn(
                "absolute inset-0 size-full object-cover transition-opacity duration-700",
                i === activeIndex ? "opacity-100" : "opacity-0"
              )}
            />
          ) : (
            <div
              key={item.id}
              className={cn(
                "absolute inset-0 bg-[radial-gradient(circle_at_35%_30%,rgba(245,158,11,0.18),transparent_34%),linear-gradient(135deg,#111827,#050505)] transition-opacity duration-700",
                i === activeIndex ? "opacity-100" : "opacity-0"
              )}
            />
          )
        )}

        <IpHoverPreview
          key={`${slide.id}:${slide.trailer}:${paused}`}
          src={slide.trailer}
          active={paused}
        />
        <div className="absolute inset-0 bg-linear-to-r from-background via-background/70 to-transparent to-60%" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-background to-transparent" />

        <div className="relative z-10 mx-auto flex h-full max-w-[1800px] items-center gap-8 px-6 pb-16 pt-24 sm:px-10">
          {/* Vertical thumbnail switcher — left rail (desktop). Mobile uses the
              prev/next arrows instead, since the rail is hidden there. */}
          {total > 1 && (
            <div className="hidden shrink-0 flex-col gap-2.5 self-center lg:flex">
              {slides.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Slide ${i + 1}: ${item.name}`}
                  aria-current={i === activeIndex}
                  style={
                    i === activeIndex
                      ? {
                          boxShadow:
                            "0 0 0 2px var(--color-primary), 0 0 0 6px color-mix(in srgb, var(--color-primary) 30%, transparent)",
                        }
                      : undefined
                  }
                  className={cn(
                    "relative h-14 w-24 overflow-hidden rounded-md transition-all",
                    i === activeIndex ? "opacity-100" : "opacity-50 hover:opacity-90"
                  )}
                >
                  {item.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.cover} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="size-full bg-muted" />
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="max-w-2xl">
            {slide.eyebrow && (
              <div className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                <IconBolt className="size-3.5" />
                {slide.eyebrow}
              </div>
            )}
            <h1 className="font-heading text-5xl font-black uppercase tracking-tight text-white drop-shadow-lg sm:text-7xl">
              {slide.name}
            </h1>
            <ChannelBadge category={slide.channelType} />
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
                href={localizePath(ipRoomPath(slide.roomNumber), locale)}
                className="group/cta relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-white/30 bg-white/10 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-black/30 backdrop-blur-xl backdrop-saturate-150 transition-all duration-300 hover:border-white/50 hover:bg-white/20 hover:shadow-white/10"
              >
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
                  const url = `${window.location.origin}${localizePath(ipRoomPath(slide.roomNumber), locale)}`;
                  try {
                    await navigator.clipboard.writeText(url);
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

        <div className="absolute right-6 top-6 z-10 flex items-center gap-3">
          <button
            type="button"
            aria-label="Toggle audio"
            className="inline-flex size-9 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
          >
            <IconVolumeOff className="size-4" />
          </button>
        </div>
      </div>

      {rail.length > 0 && <RailOnly rail={rail} locale={locale} compact />}
    </section>
  );
}

function RailOnly({
  rail,
  locale,
  compact = false,
}: {
  rail: PlazaProject[];
  locale: Locale;
  compact?: boolean;
}) {
  const t = useTranslations("ip");
  const [previewId, setPreviewId] = useState<string | null>(null);
  return (
    <div className={cn("mx-auto max-w-[1800px] px-6 sm:px-10", compact ? "-mt-2 pt-6" : "pt-20")}>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-foreground">{t("forYou")}</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {rail.map((item) => (
          <Link
            key={item.id}
            onMouseEnter={() => setPreviewId(item.id)}
            onMouseLeave={() => setPreviewId(null)}
            onFocus={() => setPreviewId(item.id)}
            onBlur={() => setPreviewId(null)}
            href={localizePath(ipRoomPath(item.roomNumber), locale)}
            className="group block min-w-0"
          >
            <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
              {item.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.cover}
                  alt=""
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="size-full bg-secondary" />
              )}
              <IpHoverPreview
                key={`${item.id}:${item.trailer}:${previewId === item.id}`}
                src={item.trailer}
                active={previewId === item.id}
              />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-black/85 to-transparent" />
              <div className="absolute inset-x-3 bottom-3">
                <h3 className="line-clamp-1 text-sm font-semibold text-white">{item.name}</h3>
                <ChannelBadge category={item.channelType} />
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
  );
}

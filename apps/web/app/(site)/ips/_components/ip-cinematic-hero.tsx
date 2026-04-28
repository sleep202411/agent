"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  IconBookmark,
  IconBolt,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPlay,
  IconPlus,
  IconThumbDown,
  IconVolumeOff,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

// Cinematic hero for the IP Plaza — Netflix-style featured carousel + a
// horizontal "For you" rail underneath. All data here is hardcoded so we can
// iterate on the layout independently of backend wiring; swap the constants
// for `useIPProjects()` data once the visual is approved.
//
// Sibling component to the original `ip-fan-hero.tsx`; both are kept and the
// Plaza page picks one. Replace at the call site, not in this file.

interface HeroSlide {
  id: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  level: string;
  year: string;
  episodes: number;
  matchLabel: string;
  description: string;
  keyArt: string;
  tags: string[];
  primaryCta: string;
  primaryHref: string;
  ageRating: string;
}

const SLIDES: HeroSlide[] = [
  {
    id: "neon-anchor",
    eyebrow: "FIZZDRAGON · INVESTING NOW",
    title: "霓虹之锚",
    subtitle: "NEON ANCHOR",
    level: "FD5",
    year: "2026",
    episodes: 12,
    matchLabel: "98% match",
    description:
      "2099 年的远东都市，一群普通人因为一段被遗忘的代码相遇。他们要做的事情简单又残酷：把一个被关进数据深处的人捞出来。",
    keyArt:
      "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1920&q=80&auto=format&fit=crop",
    tags: ["赛博朋克", "AI 动画", "悬疑", "群像"],
    primaryCta: "立即投资",
    primaryHref: "/ips/1",
    ageRating: "16+",
  },
  {
    id: "shu-embers",
    eyebrow: "FIZZDRAGON · PRE-ORDER",
    title: "蜀山·余烬",
    subtitle: "EMBERS OF SHU",
    level: "FD4",
    year: "2026",
    episodes: 10,
    matchLabel: "94% match",
    description:
      "古蜀国的山林深处，最后一座青铜祭坛即将熄灭。少年祭司被告知，他必须独自走完这段被神族放弃的路 —— 只有他还记得起源的祷词。",
    keyArt:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80&auto=format&fit=crop",
    tags: ["奇幻", "国风", "冒险"],
    primaryCta: "立即预购",
    primaryHref: "/ips/2",
    ageRating: "13+",
  },
  {
    id: "last-call",
    eyebrow: "FIZZDRAGON · NOW PRODUCING",
    title: "末日时刻",
    subtitle: "LAST CALL",
    level: "FD5",
    year: "2026",
    episodes: 8,
    matchLabel: "Featured",
    description:
      "末日来临前的最后一夜，一通永远不会被接听的电话改变了所有人的命运。当太阳重新升起时，世界已经不再是他们离开时的模样。",
    keyArt:
      "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920&q=80&auto=format&fit=crop",
    tags: ["科幻", "末日", "动作"],
    primaryCta: "上线提醒",
    primaryHref: "/ips/3",
    ageRating: "16+",
  },
  {
    id: "white-night",
    eyebrow: "FIZZDRAGON · NOW SHOWING",
    title: "白夜剧院",
    subtitle: "WHITE NIGHT THEATRE",
    level: "FD3",
    year: "2025",
    episodes: 6,
    matchLabel: "100% match",
    description:
      "AI 占领银幕的第十年，一位老剧作家决定亲自拍摄一部完全由人类讲述、人类演出、人类剪辑的电影。然后，他的助手发来了一封很长的拒信。",
    keyArt:
      "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1920&q=80&auto=format&fit=crop",
    tags: ["治愈", "实验影像", "群像"],
    primaryCta: "立即观看",
    primaryHref: "/ips/4",
    ageRating: "PG",
  },
  {
    id: "paper-stars",
    eyebrow: "FIZZDRAGON · INVESTING NOW",
    title: "纸星辰",
    subtitle: "PAPER STARS",
    level: "FD4",
    year: "2026",
    episodes: 12,
    matchLabel: "92% match",
    description:
      "海边小镇的旧书店里，一本永远翻不到最后一页的日记吸引了三代人的好奇。每翻开一次，他们就距离真相更近一步 —— 也距离自己更远一点。",
    keyArt:
      "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?w=1920&q=80&auto=format&fit=crop",
    tags: ["悬疑", "治愈", "群像"],
    primaryCta: "立即投资",
    primaryHref: "/ips/5",
    ageRating: "PG",
  },
];

interface RailItem {
  id: string;
  title: string;
  cover: string;
  year: string;
  episodes: number;
  matchLabel: string;
}

const RAIL: RailItem[] = [
  {
    id: "shu-embers",
    title: "蜀山·余烬",
    cover:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80&auto=format&fit=crop",
    year: "2026",
    episodes: 10,
    matchLabel: "94% match",
  },
  {
    id: "last-call",
    title: "末日时刻",
    cover:
      "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=600&q=80&auto=format&fit=crop",
    year: "2026",
    episodes: 8,
    matchLabel: "Featured",
  },
  {
    id: "paper-stars",
    title: "纸星辰",
    cover:
      "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?w=600&q=80&auto=format&fit=crop",
    year: "2026",
    episodes: 12,
    matchLabel: "92% match",
  },
  {
    id: "morning-telegram",
    title: "晨曦电报",
    cover:
      "https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=600&q=80&auto=format&fit=crop",
    year: "2025",
    episodes: 6,
    matchLabel: "88% match",
  },
  {
    id: "grey-salt",
    title: "灰盐之城",
    cover:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&q=80&auto=format&fit=crop",
    year: "2026",
    episodes: 10,
    matchLabel: "Trending",
  },
  {
    id: "white-night",
    title: "白夜剧院",
    cover:
      "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=600&q=80&auto=format&fit=crop",
    year: "2025",
    episodes: 6,
    matchLabel: "100% match",
  },
  {
    id: "unsung",
    title: "未尽之歌",
    cover:
      "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&q=80&auto=format&fit=crop",
    year: "2026",
    episodes: 8,
    matchLabel: "85% match",
  },
];

const AUTO_ADVANCE_MS = 8000;

export function IPCinematicHero() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = SLIDES.length;

  // Auto-advance carousel; pause on hover so reading the slide isn't yanked
  // away mid-sentence.
  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => {
      setIndex((i) => (i + 1) % total);
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [index, paused, total]);

  const prev = () => setIndex((i) => (i - 1 + total) % total);
  const next = () => setIndex((i) => (i + 1) % total);
  const slide = SLIDES[index];

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
      <div className="relative h-[calc(100svh-220px)] max-h-170 min-h-[460px] w-full overflow-hidden bg-black">
        {/* Crossfade between key arts */}
        {SLIDES.map((s, i) => (
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
            <div className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
              <IconBolt className="size-3.5" />
              {slide.eyebrow}
            </div>
            <h1 className="font-heading text-5xl font-black uppercase tracking-tight text-white drop-shadow-lg sm:text-7xl">
              {slide.title}
            </h1>
            {slide.subtitle && (
              <div className="mt-2 font-heading text-sm font-bold uppercase tracking-[0.3em] text-white/70 sm:text-base">
                {slide.subtitle}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-white/80">
              <span className="rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-black">
                FD
              </span>
              <span>{slide.level}</span>
              <span className="text-white/40">·</span>
              <span>{slide.year}</span>
              <span className="text-white/40">·</span>
              <span>{slide.episodes} episodes</span>
              <span className="text-white/40">·</span>
              <span className="font-medium text-emerald-300">{slide.matchLabel}</span>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
              {slide.description}
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Link
                href={slide.primaryHref}
                className="inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90"
              >
                <IconPlayerPlay className="size-4 fill-current" />
                {slide.primaryCta}
              </Link>
              <button
                type="button"
                aria-label="Not interested"
                className="inline-flex size-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/85 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
              >
                <IconThumbDown className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Add to list"
                className="inline-flex size-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/85 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
              >
                <IconPlus className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Bookmark"
                className="inline-flex size-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/85 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
              >
                <IconBookmark className="size-4" />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center text-[11px] text-white/55">
              {slide.tags.map((tag, i) => (
                <span key={tag}>
                  {i > 0 && <span className="mx-1.5 text-white/30">·</span>}
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right corner: mute + age rating */}
        <div className="absolute bottom-8 right-6 z-10 flex items-center gap-3">
          <button
            type="button"
            aria-label="Toggle audio"
            className="inline-flex size-9 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
          >
            <IconVolumeOff className="size-4" />
          </button>
          <span className="rounded border border-white/25 bg-black/40 px-2 py-0.5 text-xs font-medium text-white/80 backdrop-blur-sm">
            {slide.ageRating}
          </span>
        </div>

        {/* Carousel arrows */}
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

        {/* Pagination dots */}
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
          {SLIDES.map((s, i) => (
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
      </div>

      {/* ── For you rail ──────────────────────────────── */}
      <div className="mx-auto -mt-2 max-w-screen-2xl px-6 pt-6 sm:px-10">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-foreground">For you</h2>
        </div>
        <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-4 sm:-mx-10 sm:px-10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {RAIL.map((item) => (
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
                <span>{item.year}</span>
                <span className="text-muted-foreground/40">·</span>
                <span>{item.episodes} eps</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-emerald-400/90">{item.matchLabel}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

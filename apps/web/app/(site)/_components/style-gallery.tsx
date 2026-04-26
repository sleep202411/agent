"use client";

/**
 * StyleGallery — "one story, every look" demo.
 *
 * Left column: large featured frame with a style-name badge. Right column:
 * 12-up grid of style thumbnails. Hovering / focusing a thumbnail swaps the
 * featured image — the gallery doubles as a hero preview and a visual
 * statement that the platform is style-agnostic.
 *
 * All images are placeholders pulled from Unsplash. Swap with real platform
 * renders when we have a curated style pack.
 */

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { IconArrowRight } from "@tabler/icons-react";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

type Style = { id: string; name: string; image: string };

const STYLES: Style[] = [
  {
    id: "anime",
    name: "Anime",
    image: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200&q=80&fit=crop",
  },
  {
    id: "cinematic",
    name: "Cinematic",
    image: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1200&q=80&fit=crop",
  },
  {
    id: "watercolor",
    name: "Watercolor",
    image: "https://images.unsplash.com/photo-1513366208864-87536b8bd7b4?w=1200&q=80&fit=crop",
  },
  {
    id: "pixel",
    name: "Pixel art",
    image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&q=80&fit=crop",
  },
  {
    id: "pixar",
    name: "3D Pixar",
    image: "https://images.unsplash.com/photo-1608889825205-eebdb9fc5806?w=1200&q=80&fit=crop",
  },
  {
    id: "comic",
    name: "Comic",
    image: "https://images.unsplash.com/photo-1531259683007-016a7b628fc3?w=1200&q=80&fit=crop",
  },
  {
    id: "noir",
    name: "Film noir",
    image: "https://images.unsplash.com/photo-1543722530-d2c3201371e7?w=1200&q=80&fit=crop",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    image: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=1200&q=80&fit=crop",
  },
  {
    id: "pastel",
    name: "Pastel",
    image: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1200&q=80&fit=crop",
  },
  {
    id: "oil",
    name: "Oil painting",
    image: "https://images.unsplash.com/photo-1549289524-06cf8837ace5?w=1200&q=80&fit=crop",
  },
  {
    id: "manga",
    name: "Manga",
    image: "https://images.unsplash.com/photo-1605379399642-870262d3d051?w=1200&q=80&fit=crop",
  },
  {
    id: "vapor",
    name: "Vaporwave",
    image: "https://images.unsplash.com/photo-1614851099175-e5b30eb6f696?w=1200&q=80&fit=crop",
  },
];

export function StyleGallery() {
  const locale = useLocale() as Locale;
  const [active, setActive] = useState<Style>(STYLES[0]);

  return (
    <section className="relative border-t border-border/40 px-6 py-32">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_30%,hsl(var(--primary)/0.08),transparent_70%)]" />
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground"
          >
            Style library
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
          >
            One story,{" "}
            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-amber-200 bg-clip-text text-transparent">
              every look.
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            Render the same script in any visual language — anime, cinematic, watercolor, 3D. Pick a
            style, ship a series.
          </motion.p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Featured frame */}
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-border/50 bg-card lg:aspect-auto">
            <motion.img
              key={active.id}
              src={active.image}
              alt={active.name}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="absolute inset-0 size-full object-cover"
            />
            <div className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur">
              {active.name}
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </div>

          {/* Sidebar: copy + thumb grid + CTA */}
          <div className="flex flex-col">
            <div className="hidden lg:block">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                Trending styles
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Hover any thumbnail to preview it on the left. From classic painting to modern
                digital art — pick the look that fits your story.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-4 gap-3">
              {STYLES.map((style) => {
                const isActive = style.id === active.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onMouseEnter={() => setActive(style)}
                    onFocus={() => setActive(style)}
                    onClick={() => setActive(style)}
                    aria-label={style.name}
                    className={`group relative aspect-square overflow-hidden rounded-xl border transition-all ${
                      isActive
                        ? "border-amber-300/70 ring-2 ring-amber-300/30"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <img
                      src={style.image}
                      alt={style.name}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    <span className="pointer-events-none absolute inset-x-0 bottom-1.5 truncate px-2 text-center text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {style.name}
                    </span>
                  </button>
                );
              })}
            </div>

            <Link
              href={localizePath("/login", locale)}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-6 py-4 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              Explore all 437+ styles
              <IconArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

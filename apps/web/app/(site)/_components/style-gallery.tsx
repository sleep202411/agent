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
import { motion } from "motion/react";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

// Static layout: id → image. The visible label is read at render time
// from `home.styleGallery.styles.<id>` so the same gallery localizes.
type StyleId =
  | "anime"
  | "cinematic"
  | "watercolor"
  | "pixel"
  | "pixar"
  | "comic"
  | "noir"
  | "cyberpunk"
  | "pastel"
  | "oil"
  | "manga"
  | "vapor";

type Style = { id: StyleId; image: string };

// Image hosting: own OSS at static.fizzspace.cn under static/pc/.
// Same subject (a young woman with a dragon coiled around her on a
// city rooftop at dusk) rendered in 12 styles — that's the section's
// load-bearing claim ("one story, every look"), so the images need
// to share a subject. Uploaded via the platform's public upload
// endpoint; replace the OSS object to swap an image without touching
// this file.
const OSS_BASE = "https://static.fizzspace.cn/static/pc";

const STYLES: Style[] = [
  { id: "anime", image: `${OSS_BASE}/home-style-anime.png` },
  { id: "cinematic", image: `${OSS_BASE}/home-style-cinematic.png` },
  { id: "watercolor", image: `${OSS_BASE}/home-style-watercolor.png` },
  { id: "pixel", image: `${OSS_BASE}/home-style-pixel.png` },
  { id: "pixar", image: `${OSS_BASE}/home-style-pixar.png` },
  { id: "comic", image: `${OSS_BASE}/home-style-comic.png` },
  { id: "noir", image: `${OSS_BASE}/home-style-noir.png` },
  { id: "cyberpunk", image: `${OSS_BASE}/home-style-cyberpunk.png` },
  { id: "pastel", image: `${OSS_BASE}/home-style-pastel.png` },
  { id: "oil", image: `${OSS_BASE}/home-style-oil.png` },
  { id: "manga", image: `${OSS_BASE}/home-style-manga.png` },
  { id: "vapor", image: `${OSS_BASE}/home-style-vapor.png` },
];

export function StyleGallery() {
  const t = useTranslations("home");
  const [active, setActive] = useState<Style>(STYLES[0]);
  const activeName = t(`styleGallery.styles.${active.id}`);

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
            {t("styleGallery.eyebrow")}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
          >
            {t("styleGallery.titleLine1")}{" "}
            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-amber-200 bg-clip-text text-transparent">
              {t("styleGallery.titleLine2")}
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            {t("styleGallery.subtitle")}
          </motion.p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Featured frame */}
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-border/50 bg-card lg:aspect-auto">
            <motion.img
              key={active.id}
              src={active.image}
              alt={activeName}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="absolute inset-0 size-full object-cover"
            />
            <div className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur">
              {activeName}
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </div>

          {/* Sidebar: copy + thumb grid + CTA */}
          <div className="flex flex-col">
            <div className="hidden lg:block">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                {t("styleGallery.sidebarTitle")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t("styleGallery.sidebarBody")}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-4 gap-3">
              {STYLES.map((style) => {
                const isActive = style.id === active.id;
                const styleName = t(`styleGallery.styles.${style.id}`);
                return (
                  <button
                    key={style.id}
                    type="button"
                    onMouseEnter={() => setActive(style)}
                    onFocus={() => setActive(style)}
                    onClick={() => setActive(style)}
                    aria-label={styleName}
                    className={`group relative aspect-square overflow-hidden rounded-xl border transition-all ${
                      isActive
                        ? "border-amber-300/70 ring-2 ring-amber-300/30"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <img
                      src={style.image}
                      alt={styleName}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    <span className="pointer-events-none absolute inset-x-0 bottom-1.5 truncate px-2 text-center text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {styleName}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Non-interactive count badge — used to be a Link to /login,
                but the "browse all 437+ styles" promise wasn't actually
                delivered post-click (login lands in workspace, not a
                public style library). Demoting to a stat label keeps
                the breadth-of-platform cue without the broken promise.
                Restyle: subtle muted background + sparkle icon, NOT a
                pill-button shape, so it doesn't read as clickable. */}
            <div
              className="mt-6 inline-flex items-center justify-center gap-2 self-start rounded-full border border-border/50 bg-card/40 px-5 py-3 text-sm font-medium text-muted-foreground"
              aria-label={t("styleGallery.cta")}
            >
              <IconSparkles className="size-4 text-amber-300/70" />
              {t("styleGallery.cta")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

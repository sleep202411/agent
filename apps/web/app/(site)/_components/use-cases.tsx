"use client";

/**
 * UseCases — "built for every kind of story" tabbed grid.
 *
 * Pill tab control switches between three audience buckets (Creative,
 * Business, Education). Each bucket renders four cards: tall image, title,
 * one-line pitch, "Try it" pill. Card images are placeholder Unsplash
 * stills; swap for real platform output before launch.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "@/src/i18n/i18n";

type TabId = "creative" | "business" | "education";
type CardKey =
  | "seriesCreators"
  | "webcomicArtists"
  | "indieAnimators"
  | "musicAndShorts"
  | "brandFilms"
  | "productLaunches"
  | "socialAds"
  | "investorPitches"
  | "courseVideos"
  | "historyAndCulture"
  | "childrensStories"
  | "trainingMaterial";

const TABS: TabId[] = ["creative", "business", "education"];

// Image references stay in source — title/body are localized via t().
const CARD_LAYOUT: Record<TabId, { key: CardKey; image: string }[]> = {
  creative: [
    {
      key: "seriesCreators",
      image: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=900&q=80&fit=crop",
    },
    {
      key: "webcomicArtists",
      image: "https://images.unsplash.com/photo-1531259683007-016a7b628fc3?w=900&q=80&fit=crop",
    },
    {
      key: "indieAnimators",
      image: "https://static.fizzspace.cn/static/pc/indie-animators.png",
    },
    {
      key: "musicAndShorts",
      image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=80&fit=crop",
    },
  ],
  business: [
    {
      key: "brandFilms",
      image: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=900&q=80&fit=crop",
    },
    {
      key: "productLaunches",
      image: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=900&q=80&fit=crop",
    },
    {
      key: "socialAds",
      image: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=900&q=80&fit=crop",
    },
    {
      key: "investorPitches",
      image: "https://images.unsplash.com/photo-1664575196044-195f135295df?w=900&q=80&fit=crop",
    },
  ],
  education: [
    {
      key: "courseVideos",
      image: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&q=80&fit=crop",
    },
    {
      key: "historyAndCulture",
      image: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=900&q=80&fit=crop",
    },
    {
      key: "childrensStories",
      image: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=900&q=80&fit=crop",
    },
    {
      key: "trainingMaterial",
      image: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=900&q=80&fit=crop",
    },
  ],
};

export function UseCases() {
  const t = useTranslations("home");
  const [tab, setTab] = useState<TabId>("creative");
  const cards = CARD_LAYOUT[tab];

  return (
    <section className="relative border-t border-border/40 px-6 py-32">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground"
          >
            {t("useCases.eyebrow")}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
          >
            {t("useCases.title")}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            {t("useCases.subtitle")}
          </motion.p>
        </div>

        {/* Pill tab control */}
        <div className="mt-12 flex justify-center">
          <div className="relative inline-flex items-center gap-1 rounded-full border border-border/50 bg-card/40 p-1.5 backdrop-blur-sm">
            {TABS.map((tabId) => {
              const isActive = tabId === tab;
              return (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setTab(tabId)}
                  className="relative px-6 py-2 text-sm font-medium"
                >
                  {isActive && (
                    <motion.span
                      layoutId="usecase-tab-pill"
                      className="absolute inset-0 rounded-full bg-amber-300"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span
                    className={`relative ${
                      isActive ? "text-zinc-900" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(`useCases.tabs.${tabId}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cards */}
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <AnimatePresence mode="wait">
            {cards.map((card, i) => {
              const cardTitle = t(`useCases.cards.${tab}.${card.key}.title`);
              const cardBody = t(`useCases.cards.${tab}.${card.key}.body`);
              return (
                <motion.div
                  key={`${tab}-${card.key}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35, ease: "easeOut", delay: i * 0.05 }}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-border"
                >
                  <div className="aspect-[4/3] overflow-hidden">
                    <img
                      src={card.image}
                      alt={cardTitle}
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {cardTitle}
                    </h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {cardBody}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

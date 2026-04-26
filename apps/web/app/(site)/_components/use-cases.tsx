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
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { IconArrowRight } from "@tabler/icons-react";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

type Card = { title: string; body: string; image: string };
type TabId = "creative" | "business" | "education";

const TABS: { id: TabId; label: string }[] = [
  { id: "creative", label: "Creative" },
  { id: "business", label: "Business" },
  { id: "education", label: "Education" },
];

const CARDS: Record<TabId, Card[]> = {
  creative: [
    {
      title: "Series creators",
      body: "Plan a multi-episode arc, render every frame, keep characters consistent across the season.",
      image: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=900&q=80&fit=crop",
    },
    {
      title: "Webcomic artists",
      body: "Turn scripts into paneled, lettered pages. Reuse cast and props across chapters.",
      image: "https://images.unsplash.com/photo-1531259683007-016a7b628fc3?w=900&q=80&fit=crop",
    },
    {
      title: "Indie animators",
      body: "Storyboard, voice, lip-sync, and cut — without a studio behind you.",
      image: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=900&q=80&fit=crop",
    },
    {
      title: "Music & shorts",
      body: "Match cuts to beats. Drop a track, sketch a vibe, render the visuals in an afternoon.",
      image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=80&fit=crop",
    },
  ],
  business: [
    {
      title: "Brand films",
      body: "Pitch decks, product reels, social cuts — script to render in an afternoon, on-brand the whole way.",
      image: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=900&q=80&fit=crop",
    },
    {
      title: "Product launches",
      body: "Animated explainers and demo cinematics for new features, without a video budget.",
      image: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=900&q=80&fit=crop",
    },
    {
      title: "Social ads",
      body: "Spin up a dozen variations from one storyboard. Test cuts, swap looks, ship daily.",
      image: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=900&q=80&fit=crop",
    },
    {
      title: "Investor pitches",
      body: "Tell your story with cinematic visuals — narrative arc instead of bullet points.",
      image: "https://images.unsplash.com/photo-1664575196044-195f135295df?w=900&q=80&fit=crop",
    },
  ],
  education: [
    {
      title: "Course videos",
      body: "Convert lesson plans into illustrated, voiced story videos. Any subject, any age group.",
      image: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&q=80&fit=crop",
    },
    {
      title: "History & culture",
      body: "Bring historical events and folk tales to life with period-accurate visuals.",
      image: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=900&q=80&fit=crop",
    },
    {
      title: "Children's stories",
      body: "Soft, illustrated, age-appropriate. Voice the characters, sync the mouths, share the link.",
      image: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=900&q=80&fit=crop",
    },
    {
      title: "Training material",
      body: "Onboarding, safety, compliance — narrative video instead of slide decks.",
      image: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=900&q=80&fit=crop",
    },
  ],
};

export function UseCases() {
  const locale = useLocale() as Locale;
  const [tab, setTab] = useState<TabId>("creative");
  const cards = CARDS[tab];

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
            For every creator
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
          >
            Built for every kind of story.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            From series to social ads to lesson plans — FizzDragon adapts to your medium and your
            team.
          </motion.p>
        </div>

        {/* Pill tab control */}
        <div className="mt-12 flex justify-center">
          <div className="relative inline-flex items-center gap-1 rounded-full border border-border/50 bg-card/40 p-1.5 backdrop-blur-sm">
            {TABS.map((t) => {
              const isActive = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
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
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cards */}
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <AnimatePresence mode="wait">
            {cards.map((card, i) => (
              <motion.div
                key={`${tab}-${card.title}`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: "easeOut", delay: i * 0.05 }}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-border"
              >
                <div className="aspect-[4/3] overflow-hidden">
                  <img
                    src={card.image}
                    alt={card.title}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">
                    {card.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {card.body}
                  </p>
                  <Link
                    href={localizePath("/login", locale)}
                    className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-foreground/95 px-5 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-foreground"
                  >
                    Try it now
                    <IconArrowRight className="size-4" />
                  </Link>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

"use client";

/**
 * FAQ — accordion of common questions, animated open/close.
 *
 * One item open at a time. Click an open item to collapse, click another to
 * swap. Motion's layout animation handles the height transition; chevron
 * rotates 180° on open. Copy is editorial — short, declarative, no marketing
 * fluff. Update questions as the product evolves.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { IconChevronDown, IconHelp } from "@tabler/icons-react";
import Link from "next/link";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

const QA: { q: string; a: string }[] = [
  {
    q: "What is FizzDragon?",
    a: "An AI studio for storytellers. Drop in a script, novel chapter, or rough idea — eleven specialist agents draft it, storyboard it, voice it, and render every frame. You direct, they execute.",
  },
  {
    q: "How does the AI crew actually work?",
    a: "A supervisor agent reads your project and routes each ask to the right specialist — Outliner, Episode Planner, Scriptwriter, Storyboard Designer, Art Director, and more. They share a project bible so characters, scenes, and props stay consistent across episodes.",
  },
  {
    q: "How long does it take to make something?",
    a: "About five minutes from idea to first frame. A single 60-second short typically renders in under fifteen minutes; a multi-episode arc can be planned and storyboarded in an afternoon.",
  },
  {
    q: "What visual styles are supported?",
    a: "437+ and growing — anime, cinematic, watercolor, 3D Pixar, comic, noir, pixel art, vaporwave, and more. The same script can be rendered in any style without rewriting a single line.",
  },
  {
    q: "What about pricing and credits?",
    a: "Free to start. Each phase has a clear, predictable credit cost shown up-front — no surprise bills mid-render. Heavier renders (long-form video, lip sync) consume more credits; planning and scripting are nearly free.",
  },
  {
    q: "Do I own what I create?",
    a: "Yes. You retain rights to your scripts, storyboards, and final renders. Commercial use is allowed on paid plans.",
  },
  {
    q: "What languages can I create in?",
    a: "Scripts and dialogue support English, 简体中文, and 繁體中文 today. Voice synthesis covers the same set with native-quality TTS, and more languages are on the roadmap.",
  },
];

export function FAQ() {
  const locale = useLocale() as Locale;
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section className="relative border-t border-border/40 px-6 py-32">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_50%_40%_at_50%_30%,hsl(var(--primary)/0.05),transparent_70%)]" />
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground"
          >
            FAQ
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
          >
            Questions, answered.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            Everything you might want to know before pressing record on your first scene.
          </motion.p>
        </div>

        <div className="mt-14 space-y-3">
          {QA.map((item, i) => {
            const isOpen = openIdx === i;
            return (
              <motion.div
                key={item.q}
                layout
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, ease: "easeOut", delay: i * 0.04 }}
                className={`overflow-hidden rounded-2xl border backdrop-blur-sm transition-colors ${
                  isOpen
                    ? "border-border bg-card/60"
                    : "border-border/50 bg-card/30 hover:border-border/80"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
                >
                  <span className="text-base font-medium tracking-tight text-foreground sm:text-lg">
                    {item.q}
                  </span>
                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground"
                  >
                    <IconChevronDown className="size-4" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-6 text-sm leading-relaxed text-muted-foreground sm:text-base">
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-border/50 bg-card/40 p-8 text-center backdrop-blur-sm sm:flex-row sm:justify-between sm:text-left"
        >
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/[0.02] text-foreground/80">
              <IconHelp className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-foreground">
                Still have questions?
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Drop us a line — we read every message.
              </p>
            </div>
          </div>
          <Link
            href={localizePath("/contact", locale)}
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/50 px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-background"
          >
            Contact us
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

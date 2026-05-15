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
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

const QUESTION_KEYS = [
  "whatIs",
  "howCrewWorks",
  "howLong",
  "styles",
  "pricing",
  "ownership",
  "languages",
] as const;

export function FAQ() {
  const locale = useLocale() as Locale;
  const t = useTranslations("home");
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
            {t("faq.eyebrow")}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
          >
            {t("faq.title")}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            {t("faq.subtitle")}
          </motion.p>
        </div>

        <div className="mt-14 space-y-3">
          {QUESTION_KEYS.map((qKey, i) => {
            const isOpen = openIdx === i;
            return (
              <motion.div
                key={qKey}
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
                    {t(`faq.questions.${qKey}.q`)}
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
                        {t(`faq.questions.${qKey}.a`)}
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
                {t("faq.stillHaveQuestions.title")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("faq.stillHaveQuestions.body")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Link
              href={localizePath("/faq", locale)}
              className="inline-flex items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              {t("faq.viewAllCta")}
            </Link>
            <Link
              href={localizePath("/contact", locale)}
              className="inline-flex items-center justify-center rounded-full border border-border/60 bg-background/50 px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-background"
            >
              {t("faq.stillHaveQuestions.cta")}
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

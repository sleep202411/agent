"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  IconArrowRight,
  IconBook2,
  IconBuildingStore,
  IconClock,
  IconUsersGroup,
  IconWand,
  IconLayoutGrid,
  IconMessage2,
  IconLibrary,
  IconWorld,
  IconSparkles,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { Hero } from "./_components/hero";
import { MadeWithFizz } from "./_components/made-with-fizz";
import { PartnersMarquee } from "./_components/partners-marquee";
import { StyleGallery } from "./_components/style-gallery";
import { UseCases } from "./_components/use-cases";
import { Testimonials } from "./_components/testimonials";
import { FAQ } from "./_components/faq";
import { SmoothScroll } from "./_components/smooth-scroll";

// Cast / toolkit are kept here as the source of truth for icons + grid
// layout; visible text is read at render time from the home.* i18n
// namespace via the `key` field. Adding a member: append the key here
// and the matching entry in `home.cast.members.<key>` in messages/*.json.
const CAST_KEYS = [
  "storyOutliner",
  "episodePlanner",
  "scriptwriter",
  "storyboardDesigner",
  "artDirector",
  "sceneAndPropDesigner",
] as const;

const TOOLKIT_TILES = [
  {
    key: "storyboardEditor",
    icon: IconLayoutGrid,
    image: "/assets/home/toolkit/storyboard-editor.png",
    imageClass: "right-[-16%] bottom-[-20%] w-[92%] opacity-80",
    span: "lg:col-span-2 lg:row-span-2",
  },
  {
    key: "directorOnCall",
    icon: IconMessage2,
    image: "/assets/home/toolkit/director-on-call.png",
    imageClass: "right-[-9%] bottom-[-34%] w-[58%] opacity-75",
    span: "lg:col-span-2",
  },
  {
    key: "assetLibrary",
    icon: IconLibrary,
    image: "/assets/home/toolkit/asset-library.png",
    imageClass: "right-[-26%] bottom-[-22%] w-[78%] opacity-70",
    span: "",
  },
  {
    key: "crewWorkspace",
    icon: IconUsersGroup,
    image: "/assets/home/toolkit/crew-workspace.png",
    imageClass: "right-[-38%] bottom-[-14%] w-[94%] opacity-70",
    span: "",
  },
  {
    key: "ipPlaza",
    icon: IconWorld,
    image: "/assets/home/toolkit/ip-plaza.png",
    imageClass: "right-[-7%] bottom-[-42%] w-[45%] opacity-75",
    span: "lg:col-span-2",
  },
] as const;

// Three pillars — Make / Connect / Show. Each maps to a destination
// route so the CTA on the pillar card delivers the user into the
// right product surface (workspace / crews directory / IP Plaza).
const PILLARS = [
  { key: "make", icon: IconSparkles, href: "/login" },
  { key: "connect", icon: IconUsersGroup, href: "/crews" },
  { key: "show", icon: IconBuildingStore, href: "/ips" },
] as const;

export default function HomePage() {
  const locale = useLocale() as Locale;
  const t = useTranslations("home");

  return (
    <SmoothScroll>
      {/* Cancel the (site) layout's pt-16 so the cinematic hero stays
          full-bleed under the translucent nav. */}
      <div className="-mt-16">
        <Hero />
        <MadeWithFizz />

        {/* ─── Three Pillars: Make / Connect / Show ─────────────────────── */}
        {/* Anchored at the top of the page so visitors immediately see
            FizzDragon spans more than the AI tool — each pillar is a
            different way to be on the platform, with its own destination
            CTA. Order matches user-journey flow: make a thing → find
            people to make it with → show it to an audience. */}
        <section className="relative border-t border-border/40 px-6 py-32">
          <div className="mx-auto max-w-6xl">
            <SectionHeader
              eyebrow={t("pillars.eyebrow")}
              title={
                <>
                  {t("pillars.titleLine1")}
                  <br />
                  <span className="text-muted-foreground">{t("pillars.titleLine2")}</span>
                </>
              }
              subtitle={t("pillars.subtitle")}
            />

            <div className="mt-20 grid gap-5 md:grid-cols-3">
              {PILLARS.map((pillar, i) => (
                <motion.div
                  key={pillar.key}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.5, ease: "easeOut", delay: i * 0.08 }}
                  className="group relative flex flex-col rounded-2xl border border-border/50 bg-gradient-to-br from-card/70 to-card/20 p-8 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-border"
                >
                  <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/[0.02] text-foreground/80">
                    <pillar.icon className="size-5" />
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
                    {t(`pillars.items.${pillar.key}.title`)}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {t(`pillars.items.${pillar.key}.body`)}
                  </p>
                  <Link
                    href={localizePath(pillar.href, locale)}
                    className="mt-6 inline-flex items-center gap-1.5 self-start text-sm font-medium text-foreground transition-colors group-hover:text-primary"
                  >
                    {t(`pillars.items.${pillar.key}.cta`)}
                    <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Inside the AI crew ───────────────────────────────────────── */}
        <section className="relative border-t border-border/40 px-6 py-32">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_50%_40%_at_50%_50%,hsl(var(--primary)/0.06),transparent_70%)]" />
          <div className="mx-auto max-w-6xl">
            <SectionHeader
              eyebrow={t("cast.eyebrow")}
              title={
                <>
                  {t("cast.titleLine1")}
                  <br />
                  <span className="text-muted-foreground">{t("cast.titleLine2")}</span>
                </>
              }
              subtitle={t("cast.subtitle")}
            />

            <div className="mt-20 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {CAST_KEYS.map((memberKey, i) => (
                <motion.div
                  key={memberKey}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.4, ease: "easeOut", delay: i * 0.05 }}
                  className="group relative rounded-2xl border border-border/50 bg-gradient-to-br from-card/60 to-card/20 p-6 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-border"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/[0.02] text-foreground/80">
                    <IconWand className="size-4" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
                    {t(`cast.members.${memberKey}.name`)}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`cast.members.${memberKey}.role`)}
                  </p>
                </motion.div>
              ))}
            </div>

            <p className="mt-10 text-center text-sm text-muted-foreground/70">
              {t("cast.footnote")}
            </p>
          </div>
        </section>

        {/* ─── Toolkit (bento) ──────────────────────────────────────────── */}
        <section className="relative border-t border-border/40 px-6 py-32">
          <div className="mx-auto max-w-6xl">
            <SectionHeader
              eyebrow={t("toolkit.eyebrow")}
              title={
                <>
                  {t("toolkit.titleLine1")}
                  <br />
                  <span className="text-muted-foreground">{t("toolkit.titleLine2")}</span>
                </>
              }
              subtitle={t("toolkit.subtitle")}
            />

            <div className="mt-20 grid auto-rows-[minmax(180px,auto)] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {TOOLKIT_TILES.map((tile, i) => (
                <motion.div
                  key={tile.key}
                  initial={{ opacity: 0, scale: 0.96 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.5, ease: "easeOut", delay: i * 0.06 }}
                  className={cn(
                    "group relative min-h-[220px] overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card/75 to-card/20 p-7 backdrop-blur-sm transition-all hover:border-border",
                    tile.span
                  )}
                >
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={tile.image}
                      alt=""
                      aria-hidden="true"
                      className={cn(
                        "absolute max-w-none select-none object-contain transition-transform duration-700 group-hover:scale-[1.03]",
                        tile.imageClass
                      )}
                    />
                    <div className="absolute inset-0 bg-linear-to-r from-card via-card/80 to-card/15" />
                    <div className="absolute inset-0 bg-linear-to-b from-transparent via-card/10 to-card/70" />
                  </div>

                  <div className="relative z-10 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/[0.02] text-foreground/80">
                    <tile.icon className="size-4" />
                  </div>
                  <div className="relative z-10 max-w-[72%]">
                    <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
                      {t(`toolkit.items.${tile.key}.title`)}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {t(`toolkit.items.${tile.key}.body`)}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <StyleGallery />
        <UseCases />
        <Testimonials />
        <PartnersMarquee />
        <FAQ />

        {/* ─── Final CTA ────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-t border-border/40 px-6 py-40">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,hsl(var(--primary)/0.18),transparent_75%)]" />
          <div className="mx-auto max-w-3xl text-center">
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl md:text-6xl"
            >
              {t("finalCta.title")}
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
              className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-lg"
            >
              {t("finalCta.subtitle")}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}
              className="mt-10 flex flex-wrap items-center justify-center gap-3"
            >
              <Button size="lg" asChild>
                <Link href={localizePath("/art-studio", locale)}>
                  {t("finalCta.primaryCta")}
                  <IconArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" color="muted" asChild>
                <Link href={localizePath("/ips", locale)}>
                  <IconBook2 className="size-4" />
                  {t("finalCta.secondaryCta")}
                </Link>
              </Button>
            </motion.div>
            <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
              <IconClock className="size-3.5" />
              {t("finalCta.timing")}
            </p>
          </div>
        </section>
      </div>
    </SmoothScroll>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
}) {
  return (
    <div className="text-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground"
      >
        {eyebrow}
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
        className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
      >
        {title}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
        className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
      >
        {subtitle}
      </motion.p>
    </div>
  );
}

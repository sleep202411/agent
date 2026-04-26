"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  IconArrowRight,
  IconBook2,
  IconClock,
  IconWand,
  IconLayoutGrid,
  IconMessage2,
  IconLibrary,
  IconMicrophone,
  IconSparkles,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { Hero } from "./_components/hero";
import { MadeWithFizz } from "./_components/made-with-fizz";
import { StyleGallery } from "./_components/style-gallery";
import { UseCases } from "./_components/use-cases";
import { Testimonials } from "./_components/testimonials";
import { FAQ } from "./_components/faq";
import { SmoothScroll } from "./_components/smooth-scroll";

const CAST = [
  {
    name: "Story Outliner",
    role: "Reads your source material. Structures cast, settings, and props into a working bible.",
  },
  {
    name: "Episode Planner",
    role: "Paces multi-episode arcs. Hooks, beats, and the exit on each one.",
  },
  {
    name: "Scriptwriter",
    role: "Line-level dialogue and stage direction, faithful to the planner's beats.",
  },
  {
    name: "Storyboard Designer",
    role: "Composes shots with camera moves, framing, and lensing notes.",
  },
  {
    name: "Art Director",
    role: "Keeps style coherent across roles, scenes, and props from frame one.",
  },
  {
    name: "Scene & Prop Designer",
    role: "Builds the world your story lives in. Reusable across episodes.",
  },
] as const;

const TOOLKIT = [
  {
    icon: IconLayoutGrid,
    title: "Storyboard editor",
    body: "An editor that thinks in shots — every cell holds prompts, references, generations, and notes.",
    span: "lg:col-span-2 lg:row-span-2",
  },
  {
    icon: IconMessage2,
    title: "Director on call",
    body: "A supervisor agent that knows your project and routes your asks to the right specialist.",
    span: "lg:col-span-2",
  },
  {
    icon: IconLibrary,
    title: "Asset library",
    body: "Roles, scenes, props — searchable, reusable across every episode.",
    span: "",
  },
  {
    icon: IconMicrophone,
    title: "Voice & lip sync",
    body: "Voice every character, sync mouths to lines.",
    span: "",
  },
  {
    icon: IconSparkles,
    title: "Predictable credits",
    body: "Clear cost per phase. No surprise bills mid-render.",
    span: "lg:col-span-2",
  },
] as const;

export default function HomePage() {
  const locale = useLocale() as Locale;

  return (
    <SmoothScroll>
      <Hero />
      <MadeWithFizz />

      {/* ─── The Cast ─────────────────────────────────────────────────── */}
      <section className="relative border-t border-border/40 px-6 py-32">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_50%_40%_at_50%_50%,hsl(var(--primary)/0.06),transparent_70%)]" />
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            eyebrow="Meet your crew"
            title={
              <>
                You're not directing one AI.
                <br />
                <span className="text-muted-foreground">You're directing a crew.</span>
              </>
            }
            subtitle="Eleven specialist agents, each tuned for one job, talking to each other through a supervisor that takes your direction."
          />

          <div className="mt-20 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CAST.map((member, i) => (
              <motion.div
                key={member.name}
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
                  {member.name}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{member.role}</p>
              </motion.div>
            ))}
          </div>

          <p className="mt-10 text-center text-sm text-muted-foreground/70">
            …plus Brief Analyzer, Script Splitter, Evaluator, and Story Editor working behind the
            scenes.
          </p>
        </div>
      </section>

      {/* ─── Toolkit (bento) ──────────────────────────────────────────── */}
      <section className="relative border-t border-border/40 px-6 py-32">
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            eyebrow="The studio"
            title={
              <>
                A studio that fits
                <br />
                <span className="text-muted-foreground">in your browser.</span>
              </>
            }
            subtitle="Everything a creative team needs to ship — without needing a creative team."
          />

          <div className="mt-20 grid auto-rows-[minmax(180px,auto)] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {TOOLKIT.map((tile, i) => (
              <motion.div
                key={tile.title}
                initial={{ opacity: 0, scale: 0.96 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, ease: "easeOut", delay: i * 0.06 }}
                className={`group relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card/70 to-card/20 p-7 backdrop-blur-sm transition-all hover:border-border ${tile.span}`}
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/[0.02] text-foreground/80">
                  <tile.icon className="size-4" />
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
                  {tile.title}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {tile.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <StyleGallery />
      <UseCases />
      <Testimonials />
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
            Ready to direct your first crew?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            Free to start. Bring your story, we'll bring the crew.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <Button size="lg" asChild>
              <Link href={localizePath("/login", locale)}>
                Start creating
                <IconArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" color="muted" asChild>
              <Link href={localizePath("/ips", locale)}>
                <IconBook2 className="size-4" />
                Browse IPs
              </Link>
            </Button>
          </motion.div>
          <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <IconClock className="size-3.5" />
            About 5 minutes from idea to first frame.
          </p>
        </div>
      </section>
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

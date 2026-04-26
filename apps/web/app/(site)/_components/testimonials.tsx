"use client";

/**
 * Testimonials — masonry-style 3-column testimonial wall.
 *
 * NOTE: the quotes below are illustrative placeholders for development.
 * Replace with real user testimonials before any public launch.
 * Avatars use initials-on-gradient (no stock face photos) so we don't
 * pretend to feature specific real people during dev.
 */

import { motion } from "motion/react";
import { IconStar } from "@tabler/icons-react";
import { GlitchText } from "@/components/ui/glitch-text";

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  /** Tailwind gradient classes for the avatar circle. */
  gradient: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "Just tried FizzDragon and I'm genuinely blown away. As someone who always wrestles with the storyboard pipeline, having an AI crew that actually understands shot composition is wild. It's the first AI animation tool I'd hand to my peers without caveats.",
    name: "Sarah Chen",
    role: "Indie animator",
    gradient: "from-orange-500 to-pink-500",
  },
  {
    quote:
      "FizzDragon's text-to-video pipeline turns a paragraph into something I'd actually keep editing. The seamless asset library across episodes is the part nobody talks about.",
    name: "Alex Johnson",
    role: "Tech reviewer",
    gradient: "from-cyan-500 to-blue-500",
  },
  {
    quote:
      "Best video creation tool I've used this year. The agent system feels less like a toy and more like a small studio you can actually direct.",
    name: "Michael Rodriguez",
    role: "Video director",
    gradient: "from-violet-500 to-fuchsia-500",
  },
  {
    quote:
      "FizzDragon completely changed how I produce short content. The text-to-video flow is unbelievable — I describe a scene and have something I'd put on the timeline by lunch. The frame-level refinement is what sealed it for me.",
    name: "Emma Thompson",
    role: "Content creator",
    gradient: "from-rose-500 to-red-500",
  },
  {
    quote:
      "Played with the video and image enhancement tools — the convenience for producing professional-grade content is real. This is the first time I haven't fought the model.",
    name: "Chris Park",
    role: "Freelance designer",
    gradient: "from-amber-500 to-orange-500",
  },
  {
    quote:
      "FizzDragon flat-out changed my content workflow. Beginner-friendly UI, but the engine underneath is serious. I'd hand this to anyone building a series.",
    name: "David Kim",
    role: "Social media manager",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    quote:
      "It took a few lines of text and turned them into a high-quality video, and the editor felt familiar. As a digital content creator I've burned through a lot of tools — this is the one I keep coming back to.",
    name: "Jessica Martinez",
    role: "Digital content creator",
    gradient: "from-indigo-500 to-violet-500",
  },
];

// Manual column distribution for an asymmetric masonry feel — keeps
// columns balanced regardless of quote length without pulling in a
// masonry library.
const COLUMNS: Testimonial[][] = [
  [TESTIMONIALS[0], TESTIMONIALS[1]],
  [TESTIMONIALS[2], TESTIMONIALS[3], TESTIMONIALS[4]],
  [TESTIMONIALS[5], TESTIMONIALS[6]],
];

export function Testimonials() {
  return (
    <section className="relative border-t border-border/40 px-6 py-32">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_55%_45%_at_50%_15%,hsl(var(--primary)/0.08),transparent_70%)]" />

      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/[0.08] px-3 py-1 text-[11px] font-mono uppercase tracking-[0.25em] text-amber-300"
          >
            <IconStar className="size-3 fill-current" />
            Praise
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="mx-auto mt-5 max-w-3xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
          >
            What creators are saying about{" "}
            <GlitchText className="font-bold text-foreground" speed={1.2}>
              FizzDragon
            </GlitchText>
            .
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            Hear from creators who use FizzDragon to ship professional visual content.
          </motion.p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col, colIndex) => (
            <div key={colIndex} className="flex flex-col gap-4">
              {col.map((t, rowIndex) => (
                <Card key={t.name} testimonial={t} delay={(colIndex * 3 + rowIndex) * 0.06} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ testimonial, delay }: { testimonial: Testimonial; delay: number }) {
  const initial = testimonial.name.charAt(0).toUpperCase();
  return (
    <motion.figure
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: "easeOut", delay }}
      className="group relative rounded-2xl border border-border/50 bg-card/40 p-6 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-border"
    >
      <blockquote className="text-[15px] leading-relaxed text-foreground/85">
        {testimonial.quote}
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <div
          className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${testimonial.gradient} text-base font-semibold text-white shadow-sm`}
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{testimonial.name}</div>
          <div className="truncate text-xs text-muted-foreground">{testimonial.role}</div>
        </div>
      </figcaption>
    </motion.figure>
  );
}
